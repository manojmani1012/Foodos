"""What the restaurant and rider apps show about getting paid: what is owed
and not yet in a payout, the payouts coming up, and the ones already sent."""

import datetime
import uuid
from typing import Any

from ...database import fetch, fetchrow
from ...errors import not_found
from ..delivery import cash
from . import dates, statements
from . import settings as payment_settings
from .ledger import ENTRY_COLUMNS, entry_to_dict, party_column
from .views import PAYOUT_SELECT, breakdown, payout_breakdown, payout_summary

UPCOMING = ("scheduled", "on_hold", "processing")
DONE = ("paid", "failed")
HISTORY_LIMIT = 20


async def next_pay_date() -> datetime.date:
    """When money earned today will be paid, if nothing is held up."""
    settings = payment_settings.current()
    today = await payment_settings.business_today()
    _, end, weekday = dates.period_of(today, settings["payoutSchedule"])

    return dates.pay_date(end, weekday, await payment_settings.holiday_days())


async def _summaries(party_type: str, party_id: uuid.UUID, statuses: tuple, newest_first: bool, limit: int) -> list[dict]:
    column = party_column(party_type)
    order = "coalesce(p.paid_at::date, p.scheduled_for) desc, p.created_at desc" if newest_first else "p.scheduled_for, p.created_at"
    rows = await fetch(
        f"""
        {PAYOUT_SELECT}
        where p.party_type = $1 and p.{column} = $2 and p.status = any($3::text[])
        order by {order}
        limit $4
        """,
        party_type,
        party_id,
        list(statuses),
        limit,
    )

    return [payout_summary(row, await payout_breakdown(row["id"], party_type)) for row in rows]


async def overview(party_type: str, party_id: uuid.UUID) -> dict:
    column = party_column(party_type)
    owed, due, count = await breakdown(
        party_type, f"e.{column} = $1 and e.payout_id is null and e.excluded_reason is null", party_id
    )
    minimum = payment_settings.current()["minPayoutPaise"]

    unpaid = {
        "duePaise": due,
        "entryCount": count,
        "nextPayDate": (await next_pay_date()).isoformat() if due > 0 else None,
        "belowMinimum": due < minimum,
        "minPayoutPaise": minimum,
        "breakdown": owed,
    }

    if party_type == "delivery_partner":
        unpaid["cashInHandPaise"] = await cash.in_hand(party_id)

    result: dict[str, Any] = {
        "unpaid": unpaid,
        "upcoming": await _summaries(party_type, party_id, UPCOMING, False, 50),
        "history": await _summaries(party_type, party_id, DONE, True, HISTORY_LIMIT),
    }

    if party_type == "restaurant":
        plan = await fetchrow("select commission_plan, commission_pct from restaurants where id = $1", party_id)
        result = {
            "plan": {"commissionPlan": plan["commission_plan"], "commissionPct": float(plan["commission_pct"]),
                "gatewayFeePct": float(payment_settings.current()["paymentGatewayFeePct"]),
            },
            **result,
        }

    return result


async def _owned(party_type: str, party_id: uuid.UUID, payout_id: str) -> Any:
    try:
        identifier = uuid.UUID(str(payout_id))
    except (ValueError, TypeError):
        raise not_found("payout_not_found", "That payout could not be found")

    column = party_column(party_type)
    row = await fetchrow(f"{PAYOUT_SELECT} where p.id = $1 and p.party_type = $2 and p.{column} = $3", identifier, party_type, party_id)

    # Another party's payout is reported as missing, not forbidden.
    if row is None:
        raise not_found("payout_not_found", "That payout could not be found")

    return row


async def entries_of(payout_id: Any) -> list[dict]:
    rows = await fetch(
        f"""
        select {ENTRY_COLUMNS}
        from earnings_entries e left join orders o on o.id = e.order_id
        where e.payout_id = $1
        order by e.business_date, e.id
        """,
        payout_id,
    )

    return [entry_to_dict(row) for row in rows]


async def detail(party_type: str, party_id: uuid.UUID, payout_id: str) -> dict:
    row = await _owned(party_type, party_id, payout_id)

    return {
        **payout_summary(row, await payout_breakdown(row["id"], party_type)),
        "entries": await entries_of(row["id"]),
    }


async def statement_link(party_type: str, party_id: uuid.UUID, payout_id: str) -> str:
    row = await _owned(party_type, party_id, payout_id)

    return statements.link(row["id"])

