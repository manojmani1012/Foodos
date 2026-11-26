"""Cash a rider holds from cash-on-delivery orders, and the limit on it.

The rider collects the bill at the door, and that money is Foodos's. It counts
as in hand from the moment the order is delivered until it is either handed
over (a deposit an admin records) or settled in a payout, which takes the cash
off the rider's pay. A paid payout settles the cash rows in it, and, as with
the payouts recorded by hand before automatic payouts, every day it covers.

Once a rider holds the cash limit (the payment settings, else the server's
`rider_cash_limit_paise`), dispatch offers them only prepaid orders, or no
orders at all if the settings say so, until they deposit the cash: to staff,
or online with "Deposit now" (deposits.py). A rider never loses an order
already in their hands because of it.
"""

import uuid
from typing import Optional

from ...config import get_settings
from ...database import fetch, fetchval
from ..payouts import settings as payment_settings


def _unpaid(partner: str, day: str) -> str:
    """True for a day no paid payout has covered for this rider yet."""
    return f"""not exists (
        select 1 from payouts y
        where y.party_type = 'delivery_partner' and y.partner_id = {partner} and y.status = 'paid'
          and {day} between y.period_start and y.period_end
    )"""


def _settled_entry(source: str) -> str:
    """True when the ledger row for this cash is in a paid payout: the cash
    was taken off (or, for a deposit, added back to) the rider's pay."""
    return f"""exists (
        select 1 from earnings_entries e join payouts y on y.id = e.payout_id
        where e.source = {source} and y.status = 'paid'
    )"""


def in_hand_sql(partner: str) -> str:
    """SQL for the cash, in paise, the rider `partner` (a column or a
    parameter) holds right now."""
    return f"""greatest(0,
        coalesce((
          select sum(o.total_paise) from deliveries d join orders o on o.id = d.order_id
          where d.partner_id = {partner} and d.status = 'delivered' and o.payment_method = 'cod'
            and {_unpaid(partner, 'd.delivered_at::date')}
            and not {_settled_entry("'order:' || o.id || ':cash'")}
        ), 0)
        - coalesce((
          select sum(c.amount_paise) from rider_cash_deposits c
          where c.partner_id = {partner} and {_unpaid(partner, 'c.created_at::date')}
            and not {_settled_entry("'deposit:' || c.id")}
        ), 0)
    )::bigint"""


async def in_hand(partner_id: uuid.UUID) -> int:
    return int(await fetchval(f"select {in_hand_sql('$1::uuid')}", partner_id))


def limit_paise() -> int:
    """The most cash a rider may hold; 0 for no limit."""
    chosen = payment_settings.current()["riderCashLimitPaise"]

    return get_settings().rider_cash_limit_paise if chosen is None else chosen


def summary_of(in_hand_paise: int) -> dict:
    limit = limit_paise()

    return {
        "inHandPaise": in_hand_paise,
        # 0 when there is no limit.
        "limitPaise": limit,
        "limitReached": bool(limit) and in_hand_paise >= limit,
        # What stops at the limit: 'cash_orders' or 'all_orders'.
        "blocks": payment_settings.current()["riderCashBlock"],
    }


async def summary(partner_id: uuid.UUID) -> dict:
    return summary_of(await in_hand(partner_id))


async def deposits(partner_id: uuid.UUID, limit: int = 10) -> list[dict]:
    rows = await fetch(
        """
        select c.id, c.amount_paise, c.reference, c.created_at, c.payment_id, u.full_name as recorded_by
        from rider_cash_deposits c
        left join users u on u.id = c.recorded_by
        where c.partner_id = $1
        order by c.created_at desc
        limit $2
        """,
        partner_id,
        limit,
    )

    return [
        {
            "id": str(row["id"]),
            "amountPaise": row["amount_paise"],
            "reference": row["reference"],
            "recordedBy": row["recorded_by"],
            "online": row["payment_id"] is not None,
            "createdAt": row["created_at"].isoformat(),
        }
        for row in rows
    ]


def skip_limit(payment_method: Optional[str], payment_status: Optional[str]) -> bool:
    """Whether the limit is ignored for this order: always when none is set.
    Prepaid orders put no cash in the rider's pocket, so unless the settings
    block all orders, the limit does not apply to them either."""
    if not limit_paise():
        return True

    if payment_settings.current()["riderCashBlock"] == "all_orders":
        return False

    return not (payment_method == "cod" and payment_status != "paid")
