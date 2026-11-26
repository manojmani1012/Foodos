"""Turning the ledger into payouts on the schedule, and what staff do with them.

`run()` (the background loop, every few minutes, and the admin's "Run now")
looks for schedule periods that are over and not yet batched. For each, under
one lock, every restaurant and rider with ledger rows up to the period's last
day gets one payout, due on the batch's pay date, holding exactly those rows.
A party owed less than the minimum (or owing Foodos, as a rider holding cash
can) gets nothing this time: the rows stay and roll into the next batch. A
batch is made once; rows written after it (a late sweep, a cancelled payout)
go into the next one, never an old one whose pay date has passed.

Staff then pay by hand and mark each payout paid with the bank reference, or
hold, reschedule, fail, retry or cancel it. A cancelled payout lets go of its
rows, so the money is owed again and goes into the next batch.
"""

import datetime
import json
import logging
import uuid
from typing import Any, Optional

from ...database import fetch, fetchrow, fetchval, transaction
from ...errors import AppError, bad_request, conflict, not_found
from ..admin import audit
from . import dates, notify
from . import settings as payment_settings
from .views import BLOCKED_SQL, PAYOUT_SELECT, blocker, payout_row

logger = logging.getLogger("foodos.payouts")

# How far before automatic payouts began batches are still made, so the
# period running when they began is not skipped.
WINDOW_DAYS = 21

BATCH_LOCK = "payout-batches"

# action -> (statuses it may follow, status it sets)
TRANSITIONS = {
    "hold": ({"scheduled", "failed"}, "on_hold"),
    "release": ({"on_hold"}, "scheduled"),
    "reschedule": ({"scheduled", "on_hold"}, None),
    "paid": ({"scheduled", "on_hold", "failed", "processing"}, "paid"),
    "failed": ({"scheduled", "processing"}, "failed"),
    "retry": ({"failed"}, "scheduled"),
    "cancel": ({"scheduled", "on_hold", "failed"}, "cancelled"),
}

ACTION_LABELS = {
    "hold": "Held payout",
    "release": "Released payout",
    "reschedule": "Rescheduled payout",
    "paid": "Marked payout paid",
    "failed": "Marked payout failed",
    "retry": "Retried payout",
    "cancel": "Cancelled payout",
}

ACTION_PAST = {
    "hold": "held",
    "release": "released",
    "reschedule": "rescheduled",
    "paid": "marked paid",
    "failed": "marked failed",
    "retry": "retried",
    "cancel": "cancelled",
}

STATUS_WORDS = {
    "on_hold": "on hold",
    "scheduled": "scheduled",
    "paid": "paid",
    "failed": "failed",
    "cancelled": "cancelled",
    "processing": "being processed",
    "pending": "pending",
}


BLOCKER_WORDS = {
    "bank_missing": "No bank details have been added, so this cannot be paid yet",
    "bank_pending": "The bank details are not verified yet, so this cannot be paid",
    "bank_rejected": "The bank details were rejected, so this cannot be paid until they are corrected",
}


async def india_today() -> datetime.date:
    """The calendar date in India (no cutoff): pay dates are calendar days."""
    return await fetchval("select (now() at time zone 'Asia/Kolkata')::date")


def _totals(party_type: str, rows: list[Any]) -> dict:
    net = sum(row["amount_paise"] for row in rows)
    gross = commission = 0

    for row in rows:
        b = row["breakdown"]

        if row["kind"] == "order":
            gross += int(b.get("foodPaise", 0)) + int(b.get("packagingPaise", 0))
            commission += (
                int(b.get("commissionPaise", 0))
                + int(b.get("gatewayFeePaise", 0))
                + int(b.get("gstOnCommissionPaise", 0))
            )
        elif row["kind"] == "delivery":
            # Pay before the TDS taken off it; the TDS lands in adjustments.
            gross += row["amount_paise"] + int(b.get("tdsPaise", 0))

    # Everything that is not earnings less fees: coupon, TDS, refunds, cash,
    # deposits and adjustments.
    return {
        "net": net,
        "gross": gross,
        "commission": commission,
        "adjustments": net - gross + commission,
        "first": min(row["business_date"] for row in rows),
    }


async def _make_batch(start: datetime.date, end: datetime.date, pay_weekday: int, holidays: set) -> list[uuid.UUID]:
    """Creates the batch for one period and its payouts. Returns the payouts
    made; none if another run made the batch first."""

    created: list[uuid.UUID] = []
    minimum = payment_settings.current()["minPayoutPaise"]

    async with transaction() as connection:
        await connection.execute("select pg_advisory_xact_lock(hashtext($1))", BATCH_LOCK)

        batch_id = await connection.fetchval(
            """
            insert into payout_batches (period_start, period_end, pay_date) values ($1, $2, $3)
            on conflict (period_start, period_end) do nothing
            returning id
            """,
            start,
            end,
            dates.pay_date(end, pay_weekday, holidays),
        )

        if batch_id is None:
            return []

        pay_on = await connection.fetchval("select pay_date from payout_batches where id = $1", batch_id)

        rows = await connection.fetch(
            """
            select id, party_type, restaurant_id, partner_id, kind, amount_paise, breakdown, business_date
            from earnings_entries
            where payout_id is null and excluded_reason is null and business_date <= $1
            order by id
            for update
            """,
            end,
        )

        parties: dict[tuple, list] = {}

        for row in rows:
            key = (row["party_type"], row["restaurant_id"] or row["partner_id"])
            breakdown = row["breakdown"]
            parties.setdefault(key, []).append(
                {
                    **dict(row),
                    "breakdown": json.loads(breakdown) if isinstance(breakdown, str) else (breakdown or {}),
                }
            )

        for (party_type, party_id), entries in parties.items():
            totals = _totals(party_type, entries)

            # Below the minimum, or owing Foodos: carried forward.
            if totals["net"] <= 0 or totals["net"] < minimum:
                continue

            column = "restaurant_id" if party_type == "restaurant" else "partner_id"
            payout_id = await connection.fetchval(
                f"""
                insert into payouts
                  (party_type, {column}, batch_id, period_start, period_end, scheduled_for, gross_paise,
                   commission_paise, adjustments_paise, net_paise, status)
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'scheduled')
                returning id
                """,
                party_type,
                party_id,
                batch_id,
                totals["first"],
                end,
                pay_on,
                totals["gross"],
                totals["commission"],
                totals["adjustments"],
                totals["net"],
            )
            await connection.execute(
                "update earnings_entries set payout_id = $1 where id = any($2::bigint[])",
                payout_id,
                [entry["id"] for entry in entries],
            )
            created.append(payout_id)

    return created


async def run(today: Optional[datetime.date] = None) -> int:
    """Makes every batch that is due. Returns how many payouts it created.
    Safe to run at any time: a batch is made once."""
    settings = payment_settings.current()
    today = today or await payment_settings.business_today()
    window_start = payment_settings.started_on() - datetime.timedelta(days=WINDOW_DAYS)
    last_end = await fetchval("select max(period_end) from payout_batches")
    first = max(window_start, last_end + datetime.timedelta(days=1)) if last_end else window_start
    holidays = await payment_settings.holiday_days()

    created: list[uuid.UUID] = []

    for start, end, pay_weekday in dates.periods_between(
        first, today - datetime.timedelta(days=1), settings["payoutSchedule"]
    ):
        created += await _make_batch(start, end, pay_weekday, holidays)

    for payout_id in created:
        await notify.scheduled(payout_id)

    return len(created)


async def send_reminders() -> int:
    """The "payout scheduled" message for any that missed it, and the reminder
    the day before a payout is due. Each is sent once."""
    unsent = await fetch(
        "select id from payouts where status = 'scheduled' and notified_scheduled_at is null and batch_id is not null"
    )

    for row in unsent:
        await notify.scheduled(row["id"])

    due = await fetch(
        """
        select id from payouts
        where status = 'scheduled' and reminded_at is null
          and scheduled_for = (now() at time zone 'Asia/Kolkata')::date + 1
        """
    )

    for row in due:
        await notify.reminder(row["id"])

    return len(unsent) + len(due)


# --- Staff actions ----------------------------------------------------------


def as_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found("payout_not_found", "That payout could not be found")


async def get_row(payout_id: uuid.UUID) -> dict:
    row = await fetchrow(f"{PAYOUT_SELECT} where p.id = $1", payout_id)

    if row is None:
        raise not_found("payout_not_found", "That payout could not be found")

    return payout_row(row)


async def act(
    payout_id: str,
    action: str,
    actor_id: uuid.UUID,
    ip: Optional[str],
    reason: Optional[str] = None,
    reference: Optional[str] = None,
    date: Optional[datetime.date] = None,
) -> dict:
    identifier = as_uuid(payout_id)
    allowed, to_status = TRANSITIONS[action]
    reason = (reason or "").strip() or None
    reference = (reference or "").strip() or None

    if action in ("hold", "failed", "cancel") and (not reason or len(reason) < 3):
        raise bad_request("reason_required", "Give a reason, so the team knows why later")

    if action == "paid" and (not reference or not 4 <= len(reference) <= 60):
        raise bad_request("reference_required", "Enter the bank reference (UTR), 4 to 60 characters")

    if action == "reschedule":
        if date is None:
            raise bad_request("date_required", "Choose the new payout date")

        if date < await india_today():
            raise bad_request("date_in_past", "Choose today or a later date")

    async with transaction() as connection:
        payout = await connection.fetchrow(
            "select id, status, net_paise, party_type, coalesce(restaurant_id, partner_id) as party_id "
            "from payouts where id = $1 for update",
            identifier,
        )

        if payout is None:
            raise not_found("payout_not_found", "That payout could not be found")

        if payout["status"] not in allowed:
            raise conflict(
                "payout_action_not_allowed",
                f"This payout is {STATUS_WORDS.get(payout['status'], payout['status'])}, so it cannot be "
                f"{ACTION_PAST[action]}",
            )

        if action == "paid" and payout["status"] != "processing":
            # Money only goes to an account staff have checked. One waiting on a
            # bank file was checked when the file was made, and has been sent.
            why = blocker(await connection.fetchrow(f"{PAYOUT_SELECT} where p.id = $1", identifier))

            if why is not None:
                raise AppError(
                    409,
                    "bank_not_verified",
                    BLOCKER_WORDS[why],
                    {"blocker": why},
                )

        if action == "hold":
            await connection.execute(
                "update payouts set status = 'on_hold', hold_reason = $2, updated_at = now() where id = $1",
                identifier,
                reason,
            )
        elif action == "release":
            await connection.execute(
                "update payouts set status = 'scheduled', hold_reason = null, updated_at = now() where id = $1",
                identifier,
            )
        elif action == "reschedule":
            # A new date earns a new reminder.
            await connection.execute(
                "update payouts set scheduled_for = $2, reminded_at = null, updated_at = now() where id = $1",
                identifier,
                date,
            )
        elif action == "paid":
            if await connection.fetchval(
                "select 1 from payouts where lower(payout_reference) = lower($1) and id <> $2 and bank_file_id is not null",
                reference,
                identifier,
            ):
                raise conflict("reference_used", "That bank reference is already used by another payout")

            await connection.execute(
                """
                update payouts
                set status = 'paid', payout_reference = $2, paid_at = now(), paid_by = $3,
                    hold_reason = null, failure_reason = null, updated_at = now()
                where id = $1
                """,
                identifier,
                reference,
                actor_id,
            )
        elif action == "failed":
            await connection.execute(
                "update payouts set status = 'failed', failure_reason = $2, updated_at = now() where id = $1",
                identifier,
                reason,
            )
        elif action == "retry":
            await connection.execute(
                "update payouts set status = 'scheduled', failure_reason = null, updated_at = now() where id = $1",
                identifier,
            )
        elif action == "cancel":
            await connection.execute(
                "update payouts set status = 'cancelled', updated_at = now() where id = $1", identifier
            )
            # The money is owed again: the rows go into the next batch.
            await connection.execute("update earnings_entries set payout_id = null where payout_id = $1", identifier)

        await audit.record(
            actor_id,
            ACTION_LABELS[action],
            "Payouts",
            "payout",
            identifier,
            {
                "from": payout["status"],
                "to": to_status or payout["status"],
                "netPaise": payout["net_paise"],
                "partyType": payout["party_type"],
                "partyId": str(payout["party_id"]),
                "reason": reason,
                "reference": reference,
                "date": date.isoformat() if date else None,
            },
            ip,
            connection,
        )

    if action == "paid":
        await notify.paid(identifier)
    elif action == "failed":
        await notify.failed(identifier)
    elif action == "hold":
        await notify.held(identifier)

    return await get_row(identifier)


# --- Whole-batch controls -----------------------------------------------------

BATCH_STATUSES = ("scheduled", "on_hold", "failed", "paid", "cancelled", "processing")


def _batch_row(row: Any) -> dict:
    return {
        "id": str(row["id"]),
        "payDate": row["pay_date"].isoformat(),
        "periodStart": row["period_start"].isoformat(),
        "periodEnd": row["period_end"].isoformat(),
        "holdReason": row["hold_reason"],
        "counts": {status: row[status] for status in BATCH_STATUSES},
        "payoutCount": row["payout_count"],
        "netPaise": int(row["net"]),
        "blockedCount": row["blocked"],
    }


async def _batches(where: str, *args: Any) -> list[dict]:
    rows = await fetch(
        f"""
        select b.id, b.pay_date, b.period_start, b.period_end, b.hold_reason,
               {", ".join(f"count(p.id) filter (where p.status = '{s}')::int as {s}" for s in BATCH_STATUSES)},
               count(p.id)::int as payout_count,
               coalesce(sum(p.net_paise), 0)::bigint as net,
               (count(p.id) filter (where p.status in ('scheduled', 'on_hold') and {BLOCKED_SQL}))::int as blocked
        from payout_batches b
        left join ({PAYOUT_SELECT}) p on p.batch_id = b.id
        where {where}
        group by b.id
        order by b.pay_date desc, b.period_start desc
        """,
        *args,
    )

    return [_batch_row(row) for row in rows]


async def list_batches(status: str) -> dict:
    # A period with nothing to pay still gets a batch; it is of no interest here.
    where = "exists (select 1 from payouts x where x.batch_id = b.id)"

    if status != "all":
        where = "exists (select 1 from payouts x where x.batch_id = b.id and x.status in ('scheduled', 'on_hold'))"

    return {"batches": await _batches(where)}


async def _batch(batch_id: uuid.UUID) -> dict:
    found = await _batches("b.id = $1", batch_id)

    if not found:
        raise not_found("batch_not_found", "That payout batch could not be found")

    return found[0]


def _batch_id(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found("batch_not_found", "That payout batch could not be found")


async def act_on_batch(
    batch_id: str,
    action: str,
    actor_id: uuid.UUID,
    ip: Optional[str],
    reason: Optional[str] = None,
    date: Optional[datetime.date] = None,
) -> dict:
    """Hold, release or reschedule every affected payout of a batch at once.
    Only payouts in a status the single action allows are touched."""
    identifier = _batch_id(batch_id)
    reason = (reason or "").strip() or None

    if action == "hold" and (not reason or len(reason) < 3):
        raise bad_request("reason_required", "Give a reason, so the team knows why later")

    if action == "reschedule":
        if date is None:
            raise bad_request("date_required", "Choose the new payout date")

        if date < await india_today():
            raise bad_request("date_in_past", "Choose today or a later date")

    async with transaction() as connection:
        # The batch row is the lock: two staff holding at once queue up.
        if await connection.fetchval("select 1 from payout_batches where id = $1 for update", identifier) is None:
            raise not_found("batch_not_found", "That payout batch could not be found")

        if action == "hold":
            rows = await connection.fetch(
                """
                update payouts set status = 'on_hold', hold_reason = $2, updated_at = now()
                where batch_id = $1 and status = 'scheduled' returning id
                """,
                identifier,
                reason,
            )
            await connection.execute("update payout_batches set hold_reason = $2 where id = $1", identifier, reason)
        elif action == "release":
            rows = await connection.fetch(
                """
                update payouts set status = 'scheduled', hold_reason = null, updated_at = now()
                where batch_id = $1 and status = 'on_hold' returning id
                """,
                identifier,
            )
            await connection.execute("update payout_batches set hold_reason = null where id = $1", identifier)
        else:
            rows = await connection.fetch(
                """
                update payouts set scheduled_for = $2, reminded_at = null, updated_at = now()
                where batch_id = $1 and status in ('scheduled', 'on_hold') returning id
                """,
                identifier,
                date,
            )
            await connection.execute("update payout_batches set pay_date = $2 where id = $1", identifier, date)

        await audit.record(
            actor_id,
            {"hold": "Held payout batch", "release": "Released payout batch", "reschedule": "Rescheduled payout batch"}[action],
            "Payouts",
            "payout_batch",
            identifier,
            {"changed": len(rows), "reason": reason, "date": date.isoformat() if date else None},
            ip,
            connection,
        )

    # Phones are told after the change has committed, as for a single payout.
    for row in rows:
        if action == "hold":
            await notify.held(row["id"])
        elif action == "reschedule":
            await notify.rescheduled(row["id"])

    return {"batch": await _batch(identifier), "changed": len(rows)}
