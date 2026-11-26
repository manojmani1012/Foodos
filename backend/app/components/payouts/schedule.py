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
from ...errors import bad_request, conflict, not_found
from ..admin import audit
from . import dates, notify
from . import settings as payment_settings
from .views import PAYOUT_SELECT, payout_row

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
            commission += int(b.get("commissionPaise", 0)) + int(b.get("gstOnCommissionPaise", 0))
        elif row["kind"] == "delivery":
            gross += row["amount_paise"]

    # Everything that is not earnings less commission: TDS, refunds, cash,
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
