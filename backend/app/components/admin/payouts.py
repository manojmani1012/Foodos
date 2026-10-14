"""What Foodos owes its partners for a period, and a record of paying it.

Restaurants: food plus packaging on delivered orders, less the commission on
the food, the same sum the restaurant app shows the owner under Earnings.

Riders: their pay on delivered trips (base, distance, incentives and every
rupee of tips), less the cash they collected at the door, which is Foodos's
money in their pocket. A rider who collected more cash than they earned owes
the difference, and the statement says so.

The money itself moves outside Foodos (bank transfer or UPI). Recording a
payout stores the amounts as they stood and the bank reference, and refuses a
second payout for any day already paid, so nobody is paid twice.
"""

import datetime
import uuid
from typing import Any, Optional

from ...database import fetch, fetchval, transaction
from ...errors import bad_request, conflict, not_found
from . import audit

PARTY_LABEL = {"restaurant": "Restaurants", "delivery_partner": "Riders"}
MAX_PERIOD_DAYS = 92


def _check_period(start: datetime.date, end: datetime.date) -> None:
    if end < start:
        raise bad_request("period_invalid", "The period ends before it starts")

    if (end - start).days >= MAX_PERIOD_DAYS:
        raise bad_request("period_too_long", "Choose a period of three months or less")


async def _restaurant_lines(start: datetime.date, end: datetime.date, party_id: Optional[uuid.UUID] = None) -> list[dict]:
    rows = await fetch(
        """
        select r.id, r.name, r.commission_pct, u.full_name as owner_name, u.phone as owner_phone,
               count(o.id)::int as orders,
               sum(o.subtotal_paise)::bigint as food,
               sum(o.packaging_fee_paise)::bigint as packaging
        from orders o
        join restaurants r on r.id = o.restaurant_id
        join users u on u.id = r.owner_id
        where o.status = 'delivered'
          and o.placed_at::date between $1 and $2
          and ($3::uuid is null or r.id = $3)
        group by r.id, u.full_name, u.phone
        order by r.name
        """,
        start,
        end,
        party_id,
    )

    lines = []

    for row in rows:
        food, packaging = int(row["food"]), int(row["packaging"])
        # Rounded on the total, exactly as the restaurant app's Earnings does.
        commission = round(food * float(row["commission_pct"]) / 100)

        lines.append(
            {
                "partyId": str(row["id"]),
                "name": row["name"],
                "contact": {"name": row["owner_name"], "phone": row["owner_phone"]},
                "count": row["orders"],
                "breakdown": {
                    "foodPaise": food,
                    "packagingPaise": packaging,
                    "commissionPct": float(row["commission_pct"]),
                },
                "grossPaise": food + packaging,
                "commissionPaise": commission,
                "adjustmentsPaise": 0,
                "netPaise": food + packaging - commission,
            }
        )

    return lines


async def _rider_lines(start: datetime.date, end: datetime.date, party_id: Optional[uuid.UUID] = None) -> list[dict]:
    rows = await fetch(
        """
        select p.user_id, u.full_name, u.phone, p.payout_upi_id,
               count(d.id)::int as deliveries,
               sum(d.base_earning_paise)::bigint as base,
               sum(d.incentive_paise)::bigint as incentive,
               sum(d.tip_paise)::bigint as tips,
               coalesce(sum(o.total_paise) filter (where o.payment_method = 'cod'), 0)::bigint as cash
        from deliveries d
        join orders o on o.id = d.order_id
        join delivery_partners p on p.user_id = d.partner_id
        join users u on u.id = p.user_id
        where d.status = 'delivered'
          and d.delivered_at::date between $1 and $2
          and ($3::uuid is null or p.user_id = $3)
        group by p.user_id, u.full_name, u.phone
        order by u.full_name
        """,
        start,
        end,
        party_id,
    )

    lines = []

    for row in rows:
        base, incentive, tips, cash = (int(row[key]) for key in ("base", "incentive", "tips", "cash"))
        gross = base + incentive + tips

        lines.append(
            {
                "partyId": str(row["user_id"]),
                "name": row["full_name"],
                "contact": {"name": row["full_name"], "phone": row["phone"], "upi": row["payout_upi_id"]},
                "count": row["deliveries"],
                "breakdown": {"basePaise": base, "incentivePaise": incentive, "tipsPaise": tips, "cashCollectedPaise": cash},
                "grossPaise": gross,
                "commissionPaise": 0,
                "adjustmentsPaise": -cash,
                "netPaise": gross - cash,
            }
        )

    return lines


async def _payouts_overlapping(
    party_type: str, start: datetime.date, end: datetime.date, party_id: Optional[uuid.UUID] = None
) -> list[Any]:
    column = "restaurant_id" if party_type == "restaurant" else "partner_id"

    return await fetch(
        f"""
        select id, {column} as party_id, period_start, period_end, net_paise, payout_reference, paid_at
        from payouts
        where party_type = $1 and status = 'paid'
          and period_start <= $3 and period_end >= $2
          and ($4::uuid is null or {column} = $4)
        order by period_start
        """,
        party_type,
        start,
        end,
        party_id,
    )


def _payout_to_dict(row: Any) -> dict:
    return {
        "id": str(row["id"]),
        "periodStart": row["period_start"].isoformat(),
        "periodEnd": row["period_end"].isoformat(),
        "netPaise": row["net_paise"],
        "reference": row["payout_reference"],
        "paidAt": row["paid_at"].isoformat() if row["paid_at"] else None,
    }


async def statement(party_type: str, start: datetime.date, end: datetime.date) -> dict:
    _check_period(start, end)

    lines = await (_restaurant_lines(start, end) if party_type == "restaurant" else _rider_lines(start, end))
    paid = await _payouts_overlapping(party_type, start, end)
    today = await fetchval("select current_date")

    by_party: dict[str, list[Any]] = {}

    for row in paid:
        by_party.setdefault(str(row["party_id"]), []).append(row)

    for line in lines:
        payouts = by_party.get(line["partyId"], [])
        exact = next(
            (p for p in payouts if p["period_start"] == start and p["period_end"] == end), None
        )

        line["payout"] = _payout_to_dict(exact) if exact else None
        # Some of these days were paid in a different period: recording this
        # one would pay them twice, so it is blocked.
        line["overlaps"] = [_payout_to_dict(p) for p in payouts if p is not exact]

    def total(key: str) -> int:
        return sum(line[key] for line in lines)

    return {
        "partyType": party_type,
        "periodStart": start.isoformat(),
        "periodEnd": end.isoformat(),
        # Days that are not over yet can still change, so they are not paid.
        "canRecord": end < today,
        "lines": lines,
        "totals": {
            "count": total("count"),
            "grossPaise": total("grossPaise"),
            "commissionPaise": total("commissionPaise"),
            "adjustmentsPaise": total("adjustmentsPaise"),
            "netPaise": total("netPaise"),
            "unpaidNetPaise": sum(line["netPaise"] for line in lines if not line["payout"]),
        },
    }


async def record(body: Any, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    party_type, start, end = body.partyType, body.periodStart, body.periodEnd
    _check_period(start, end)

    try:
        party_id = uuid.UUID(body.partyId)
    except ValueError:
        raise not_found("party_not_found", "That partner could not be found")

    async with transaction() as connection:
        today = await connection.fetchval("select current_date")

        if end >= today:
            raise bad_request("period_not_over", "Payouts can only cover days that are over. End the period yesterday or earlier")

        # One payout decision per partner at a time: two people pressing
        # Record together cannot both get past the overlap check.
        await connection.execute("select pg_advisory_xact_lock(hashtext($1))", f"payout:{party_id}")

        column = "restaurant_id" if party_type == "restaurant" else "partner_id"
        clash = await connection.fetchrow(
            f"""
            select period_start, period_end from payouts
            where party_type = $1 and {column} = $2 and status = 'paid'
              and period_start <= $4 and period_end >= $3
            limit 1
            """,
            party_type,
            party_id,
            start,
            end,
        )

        if clash is not None:
            raise conflict(
                "payout_overlaps",
                f"Days from {clash['period_start'].isoformat()} to {clash['period_end'].isoformat()} are already paid",
            )

        lines = await (
            _restaurant_lines(start, end, party_id) if party_type == "restaurant" else _rider_lines(start, end, party_id)
        )

        if not lines:
            raise bad_request("nothing_to_pay", "Nothing was delivered in that period, so there is nothing to pay")

        line = lines[0]

        payout_id = await connection.fetchval(
            f"""
            insert into payouts
              (party_type, {column}, period_start, period_end, gross_paise, commission_paise,
               adjustments_paise, net_paise, status, payout_reference, paid_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, 'paid', $9, now())
            returning id
            """,
            party_type,
            party_id,
            start,
            end,
            line["grossPaise"],
            line["commissionPaise"],
            line["adjustmentsPaise"],
            line["netPaise"],
            body.reference,
        )

        await audit.record(
            actor_id,
            "Recorded payout",
            "Payouts",
            party_type,
            party_id,
            {
                "name": line["name"],
                "period": f"{start.isoformat()} to {end.isoformat()}",
                "netPaise": line["netPaise"],
                "reference": body.reference,
            },
            ip,
            connection,
        )

    return {"payoutId": str(payout_id), "line": line}


async def history(party_type: Optional[str], limit: int, offset: int) -> dict:
    rows = await fetch(
        """
        select p.id, p.party_type, p.period_start, p.period_end, p.gross_paise, p.commission_paise,
               p.adjustments_paise, p.net_paise, p.payout_reference, p.paid_at,
               coalesce(r.name, u.full_name) as party_name,
               coalesce(p.restaurant_id, p.partner_id) as party_id,
               count(*) over ()::int as total
        from payouts p
        left join restaurants r on r.id = p.restaurant_id
        left join users u on u.id = p.partner_id
        where ($1::text is null or p.party_type = $1)
        order by p.paid_at desc nulls last, p.created_at desc
        limit $2 offset $3
        """,
        party_type,
        limit,
        offset,
    )

    return {
        "total": rows[0]["total"] if rows else 0,
        "payouts": [
            {
                **_payout_to_dict(row),
                "partyType": row["party_type"],
                "partyId": str(row["party_id"]),
                "partyName": row["party_name"],
                "grossPaise": row["gross_paise"],
                "commissionPaise": row["commission_paise"],
                "adjustmentsPaise": row["adjustments_paise"],
            }
            for row in rows
        ],
    }
