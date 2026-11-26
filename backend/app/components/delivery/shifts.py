"""Rider login hours, and the shift rule for the per-order incentive.

Hours   A session starts when a rider goes online and lasts while their phone
        keeps reporting its position. A silence longer than SILENCE_MINUTES
        ends it at the last report, so a closed app is not counted as work.
Rule    Off unless staff switch it on. Then the per-order incentive is not paid
        on the trip. Once the business day has ended, a rider who was online
        long enough in every shift, and turned down no more offers than
        allowed, is paid it for each of that day's trips.
"""

import datetime
import json
import uuid
from typing import Any, Optional

from ...database import fetch, fetchval, transaction
from ..payouts import ledger
from ..payouts import settings as payment_settings

SILENCE_MINUTES = 10


# --- Recording the hours ------------------------------------------------------


async def seen(partner_id: uuid.UUID) -> None:
    """The rider is online and has just been heard from."""
    async with transaction() as connection:
        # One at a time per rider: two reports at once must not open two sessions.
        await connection.execute("select 1 from delivery_partners where user_id = $1 for update", partner_id)

        extended = await connection.fetchval(
            """
            update rider_online_sessions set last_seen_at = now()
            where partner_id = $1 and ended_at is null
              and last_seen_at > now() - make_interval(mins => $2)
            returning 1
            """,
            partner_id,
            SILENCE_MINUTES,
        )

        if extended:
            return

        await connection.execute(
            "update rider_online_sessions set ended_at = last_seen_at where partner_id = $1 and ended_at is null",
            partner_id,
        )
        await connection.execute("insert into rider_online_sessions (partner_id) values ($1)", partner_id)


async def gone_offline(partner_id: uuid.UUID, connection: Any = None) -> None:
    """Ends the open session, at now if the rider was just heard from."""
    query = """
        update rider_online_sessions
        set last_seen_at = case when last_seen_at > now() - make_interval(mins => $2) then now() else last_seen_at end,
            ended_at = case when last_seen_at > now() - make_interval(mins => $2) then now() else last_seen_at end
        where partner_id = $1 and ended_at is null
        returning 1
    """

    if connection is None:
        await fetchval(query, partner_id, SILENCE_MINUTES)
    else:
        await connection.execute(query, partner_id, SILENCE_MINUTES)


# Seconds of this rider's sessions that fall between two India-time moments.
OVERLAP_SQL = """
    select coalesce(sum(greatest(0, extract(epoch from
             least(coalesce(s.ended_at, s.last_seen_at), $3::timestamp at time zone 'Asia/Kolkata')
             - greatest(s.started_at, $2::timestamp at time zone 'Asia/Kolkata')))), 0)::int
    from rider_online_sessions s
    where s.partner_id = $1
"""


async def minutes_between(partner_id: uuid.UUID, start: datetime.datetime, end: datetime.datetime) -> int:
    return int(await fetchval(OVERLAP_SQL, partner_id, start, end)) // 60


def _clock(text: str) -> datetime.time:
    hours, minutes = (int(part) for part in text.split(":"))

    return datetime.time(hours, minutes)


def _window(day: datetime.date, start: str, end: str) -> tuple[datetime.datetime, datetime.datetime]:
    first = datetime.datetime.combine(day, _clock(start))
    last = datetime.datetime.combine(day, _clock(end))

    # A late shift may run past midnight.
    if last <= first:
        last += datetime.timedelta(days=1)

    return first, last


async def rejections_on(partner_id: uuid.UUID, day: datetime.date) -> int:
    return int(
        await fetchval(
            """
            select count(*)::int from delivery_requests
            where partner_id = $1 and status = 'rejected' and business_date(responded_at, $3::interval) = $2
            """,
            partner_id,
            day,
            payment_settings.cutoff(),
        )
    )


async def day_report(partner_id: uuid.UUID, day: datetime.date) -> dict:
    """How the rider stands against the rule on one business day."""
    settings = payment_settings.current()
    start = datetime.datetime.combine(day, datetime.time()) + payment_settings.cutoff()
    shifts = []

    for shift in settings["riderShifts"]:
        done = await minutes_between(partner_id, *_window(day, shift["start"], shift["end"]))
        shifts.append({**shift, "doneMinutes": done, "met": done >= shift["minMinutes"]})

    rejections = await rejections_on(partner_id, day)

    return {
        "date": day.isoformat(),
        "onlineMinutes": await minutes_between(partner_id, start, start + datetime.timedelta(days=1)),
        "shifts": shifts,
        "rejections": rejections,
        "maxRejections": settings["riderMaxRejections"],
        "eligible": all(shift["met"] for shift in shifts) and rejections <= settings["riderMaxRejections"],
    }


async def summary(partner_id: uuid.UUID, days: int = 7) -> dict:
    """Today's standing and the hours of the last few days."""
    settings = payment_settings.current()
    today = await payment_settings.business_today()
    history = []

    for back in range(days):
        day = today - datetime.timedelta(days=back)
        report = await day_report(partner_id, day)
        history.append({"date": report["date"], "onlineMinutes": report["onlineMinutes"]})

    settled = await fetch(
        "select day, eligible, trips, amount_paise from rider_incentive_days where partner_id = $1 order by day desc limit $2",
        partner_id,
        days,
    )

    return {
        "ruleOn": settings["riderIncentiveNeedsShifts"],
        "incentivePerOrderPaise": settings["riderOrderIncentivePaise"],
        "today": await day_report(partner_id, today),
        "days": history,
        "results": [
            {"date": row["day"].isoformat(), "eligible": row["eligible"], "trips": row["trips"],
             "amountPaise": row["amount_paise"]}
            for row in settled
        ],
    }


# --- Paying the incentive once the day is over -------------------------------


async def settle() -> int:
    """Applies the rule to every finished day with waiting trips. Safe to run
    at any time: a rider's day is settled once. Returns how many it settled."""
    today = await payment_settings.business_today()
    # A trip waits until its own ledger row exists, so the incentive is not
    # counted both in that row and in the one written here.
    rows = await fetch(
        """
        select distinct d.partner_id, business_date(d.delivered_at, $1::interval) as day
        from deliveries d
        join earnings_entries e on e.source = 'order:' || d.order_id || ':rider'
        where d.deferred_incentive_paise is not null and d.status = 'delivered'
          and business_date(d.delivered_at, $1::interval) < $2
        """,
        payment_settings.cutoff(),
        today,
    )
    settled = 0

    for row in rows:
        settled += await _settle_day(row["partner_id"], row["day"])

    return settled


async def _settle_day(partner_id: uuid.UUID, day: datetime.date) -> int:
    report = await day_report(partner_id, day)

    async with transaction() as connection:
        await connection.execute("select 1 from delivery_partners where user_id = $1 for update", partner_id)
        trips = await connection.fetch(
            """
            select d.id, d.deferred_incentive_paise as paise from deliveries d
            join earnings_entries e on e.source = 'order:' || d.order_id || ':rider'
            where d.partner_id = $1 and d.deferred_incentive_paise is not null and d.status = 'delivered'
              and business_date(d.delivered_at, $2::interval) = $3
            for update of d
            """,
            partner_id,
            payment_settings.cutoff(),
            day,
        )

        if not trips:
            return 0

        gross = sum(trip["paise"] for trip in trips) if report["eligible"] else 0
        ids = [trip["id"] for trip in trips]

        if report["eligible"]:
            await connection.execute(
                """
                update deliveries
                set order_incentive_paise = order_incentive_paise + deferred_incentive_paise,
                    incentive_paise = incentive_paise + deferred_incentive_paise,
                    deferred_incentive_paise = null
                where id = any($1::uuid[])
                """,
                ids,
            )
            await ledger.record_incentive(connection, partner_id, day, gross, len(trips))
        else:
            await connection.execute(
                "update deliveries set deferred_incentive_paise = null where id = any($1::uuid[])", ids
            )

        await connection.execute(
            """
            insert into rider_incentive_days (partner_id, day, eligible, trips, amount_paise, detail)
            values ($1, $2, $3, $4, $5, $6::jsonb)
            on conflict (partner_id, day) do update
              set trips = rider_incentive_days.trips + excluded.trips,
                  amount_paise = rider_incentive_days.amount_paise + excluded.amount_paise
            """,
            partner_id,
            day,
            report["eligible"],
            len(trips),
            gross,
            json.dumps({"shifts": report["shifts"], "rejections": report["rejections"]}),
        )

    return 1
