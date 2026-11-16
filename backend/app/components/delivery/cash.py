"""Cash a rider holds from cash-on-delivery orders, and the limit on it.

The rider collects the bill at the door, and that money is Foodos's. It counts
as in hand from the moment the order is delivered until it is either handed
over (a deposit an admin records) or settled in a payout, which takes the cash
off the rider's pay for those days.

Once a rider holds `rider_cash_limit_paise`, dispatch offers them only prepaid
orders until they deposit the cash, as Swiggy and Zomato do. A rider never
loses an order already in their hands because of it.
"""

import uuid
from typing import Optional

from ...config import get_settings
from ...database import fetch, fetchval


def _unpaid(partner: str, day: str) -> str:
    """True for a day no paid payout has covered for this rider yet."""
    return f"""not exists (
        select 1 from payouts y
        where y.party_type = 'delivery_partner' and y.partner_id = {partner} and y.status = 'paid'
          and {day} between y.period_start and y.period_end
    )"""


def in_hand_sql(partner: str) -> str:
    """SQL for the cash, in paise, the rider `partner` (a column or a
    parameter) holds right now."""
    return f"""greatest(0,
        coalesce((
          select sum(o.total_paise) from deliveries d join orders o on o.id = d.order_id
          where d.partner_id = {partner} and d.status = 'delivered' and o.payment_method = 'cod'
            and {_unpaid(partner, 'd.delivered_at::date')}
        ), 0)
        - coalesce((
          select sum(c.amount_paise) from rider_cash_deposits c
          where c.partner_id = {partner} and {_unpaid(partner, 'c.created_at::date')}
        ), 0)
    )::bigint"""


async def in_hand(partner_id: uuid.UUID) -> int:
    return int(await fetchval(f"select {in_hand_sql('$1::uuid')}", partner_id))


def summary_of(in_hand_paise: int) -> dict:
    limit = get_settings().rider_cash_limit_paise

    return {
        "inHandPaise": in_hand_paise,
        # 0 when there is no limit.
        "limitPaise": limit,
        "limitReached": bool(limit) and in_hand_paise >= limit,
    }


async def summary(partner_id: uuid.UUID) -> dict:
    return summary_of(await in_hand(partner_id))


async def deposits(partner_id: uuid.UUID, limit: int = 10) -> list[dict]:
    rows = await fetch(
        """
        select c.id, c.amount_paise, c.reference, c.created_at, u.full_name as recorded_by
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
            "createdAt": row["created_at"].isoformat(),
        }
        for row in rows
    ]


def skip_limit(payment_method: Optional[str], payment_status: Optional[str]) -> bool:
    """Prepaid orders put no cash in the rider's pocket, so the limit does not
    apply to them; nor does it when no limit is set."""
    cash_order = payment_method == "cod" and payment_status != "paid"

    return not cash_order or not get_settings().rider_cash_limit_paise
