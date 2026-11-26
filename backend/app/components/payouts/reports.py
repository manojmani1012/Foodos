"""The finance reports: the six the client asked for, and two working ones.

    collections  daily collections: online, wallet and cash on delivery
    commission   commission (and plan) per restaurant, with GST and TDS
    payouts      each payout with its deductions and bank reference (UTR)
    refunds      refunds and adjustments, and who paid for each
    tax          GST and TDS summary per restaurant and rider
    riders       rider cash-on-delivery and incentive ledger
    ledger       every earnings ledger line
    tds          rider TDS

Each covers a date range and can be narrowed to one restaurant or one rider.
The subscription fee is not charged yet, so the commission report shows each
restaurant's plan without a fee column.
"""

import datetime
import uuid
from typing import Optional

from ...config import get_settings
from ...database import fetch
from ...errors import bad_request, not_found
from . import export, finance, tds
from .export import COUNT, DATE, MONEY, Column, Table
from .views import PAYOUT_SELECT, payout_row

# Which narrowing each report understands.
FILTERS = {
    "collections": {"restaurant", "rider"},
    "commission": {"restaurant"},
    "payouts": {"restaurant", "rider"},
    "refunds": {"restaurant", "rider"},
    "tax": {"restaurant", "rider"},
    "riders": {"rider"},
    "ledger": {"restaurant", "rider"},
    "tds": {"rider"},
}

# In these a row belongs to one party, so both filters together match nothing.
ONE_PARTY = {"payouts", "tax", "ledger"}


def _ist_day(column: str) -> str:
    return f"({column} at time zone 'Asia/Kolkata')::date"


async def _collections(start, end, restaurant, rider) -> Table:
    table = Table(
        "Daily collections", "Daily collections",
        [Column("Date", DATE), Column("Orders", COUNT), Column("Online (Razorpay)", MONEY),
         Column("Foodos wallet", MONEY), Column("Cash on delivery", MONEY), Column("Total collected", MONEY),
         Column("Delivery fees", MONEY), Column("Tips", MONEY), Column("GST on orders", MONEY),
         Column("Discounts", MONEY), Column("Refunded", MONEY), Column("Net of refunds", MONEY)],
    )
    day = _ist_day("coalesce(o.delivered_at, o.placed_at)")
    rows = await fetch(
        f"""
        with refunded as (
          select order_id, sum(amount_paise) as amount from refunds where status <> 'failed' group by order_id
        )
        select {day} as day, count(*)::int as orders,
               coalesce(sum(o.total_paise) filter (where o.payment_method in ('upi', 'card')), 0) as online,
               coalesce(sum(o.total_paise) filter (where o.payment_method = 'wallet'), 0) as wallet,
               coalesce(sum(o.total_paise) filter (where o.payment_method = 'cod'), 0) as cash,
               sum(o.total_paise) as total, sum(o.delivery_fee_paise) as delivery, sum(o.tip_paise) as tips,
               sum(o.tax_paise) as tax, sum(o.discount_paise) as discount, coalesce(sum(f.amount), 0) as refunded
        from orders o
        left join refunded f on f.order_id = o.id
        left join deliveries d on d.order_id = o.id
        where o.status = 'delivered' and not o.is_test and {day} between $1 and $2
          and ($3::uuid is null or o.restaurant_id = $3) and ($4::uuid is null or d.partner_id = $4)
        group by 1 order by 1
        """,
        start, end, restaurant, rider,
    )

    for row in rows:
        table.rows.append(
            [row["day"], row["orders"], row["online"], row["wallet"], row["cash"], row["total"], row["delivery"],
             row["tips"], row["tax"], row["discount"], row["refunded"], row["total"] - row["refunded"]]
        )

    return table


async def _commission(start, end, restaurant, rider) -> Table:
    table = Table(
        "Commission", "Commission and subscription",
        [Column("Restaurant"), Column("Plan"), Column("Orders", COUNT), Column("Food", MONEY),
         Column("Packaging", MONEY), Column("Commission", MONEY), Column("Gateway fee", MONEY),
         Column("GST on commission and gateway fee", MONEY), Column("TDS", MONEY),
         Column("Coupons paid by restaurant", MONEY), Column("Bank offers (not charged)", MONEY),
         Column("Restaurant share", MONEY)],
    )
    rows = await fetch(
        """
        select r.name, r.commission_plan, count(*)::int as orders,
               sum((e.breakdown->>'foodPaise')::bigint) as food,
               sum((e.breakdown->>'packagingPaise')::bigint) as packaging,
               sum((e.breakdown->>'commissionPaise')::bigint) as commission,
               sum(coalesce((e.breakdown->>'gatewayFeePaise')::bigint, 0)) as gateway,
               sum((e.breakdown->>'gstOnCommissionPaise')::bigint) as gst,
               sum((e.breakdown->>'tdsPaise')::bigint) as tds,
               sum(coalesce((e.breakdown->>'discountPaise')::bigint, 0)) as discount,
               sum(coalesce((e.breakdown->>'bankOfferPaise')::bigint, 0)) as bank_offer,
               sum(e.amount_paise) as share
        from earnings_entries e join restaurants r on r.id = e.restaurant_id
        where e.kind = 'order' and e.business_date between $1 and $2 and ($3::uuid is null or r.id = $3)
        group by r.id
        order by r.name
        """,
        start, end, restaurant,
    )

    for row in rows:
        table.rows.append(
            [row["name"], row["commission_plan"], row["orders"], row["food"], row["packaging"], row["commission"],
             row["gateway"], row["gst"], row["tds"], row["discount"], row["bank_offer"], row["share"]]
        )

    return table


async def _payouts(start, end, restaurant, rider) -> Table:
    table = Table(
        "Payouts", "Payouts with deductions and bank reference",
        [Column("Payout id", pdf=False), Column("Party type", pdf=False), Column("Name"), Column("Phone", pdf=False),
         Column("Status"), Column("Payout date", DATE), Column("Period start", DATE, pdf=False),
         Column("Period end", DATE, pdf=False), Column("Food and packaging", MONEY), Column("Delivery pay", MONEY),
         Column("Tips", MONEY), Column("Commission", MONEY), Column("Gateway fee", MONEY),
         Column("GST on fees", MONEY), Column("TDS", MONEY), Column("Coupons", MONEY), Column("Refunds", MONEY),
         Column("Cash collected", MONEY), Column("Cash handed over", MONEY), Column("Adjustments", MONEY),
         Column("Net", MONEY), Column("Bank reference (UTR)"), Column("Paid at", pdf=False),
         Column("Bank verified", pdf=False), Column("Pay to", pdf=False)],
    )

    def part(key: str, kinds: str) -> str:
        return f"coalesce(sum(coalesce((e.breakdown->>'{key}')::bigint, 0)) filter (where e.kind in ({kinds})), 0)"

    def amount(kind: str) -> str:
        return f"coalesce(sum(e.amount_paise) filter (where e.kind = '{kind}'), 0)"

    sums = await fetch(
        f"""
        select e.payout_id,
               {part('foodPaise', "'order'")} + {part('packagingPaise', "'order'")} as food,
               {part('basePaise', "'delivery'")} + {part('distancePaise', "'delivery'")}
                 + {part('incentivePaise', "'delivery', 'incentive'")} as pay,
               {part('tipPaise', "'delivery'")} as tips,
               {part('commissionPaise', "'order'")} as commission,
               {part('gatewayFeePaise', "'order'")} as gateway,
               {part('gstOnCommissionPaise', "'order'")} as gst,
               {part('tdsPaise', "'order', 'delivery', 'incentive'")} as tds,
               {part('discountPaise', "'order'")} as coupons,
               -({amount('refund')}) as refunds,
               -({amount('cash_collected')}) as cash_collected,
               {amount('cash_deposit')} as cash_deposited,
               {amount('adjustment')} as adjustments
        from earnings_entries e
        join payouts p on p.id = e.payout_id
        where coalesce(p.scheduled_for, p.period_end) between $1 and $2
        group by e.payout_id
        """,
        start, end,
    )
    by_payout = {str(row["payout_id"]): row for row in sums}
    # A restaurant filter leaves out every rider, and the other way round.
    rows = await fetch(
        f"""
        select * from ({PAYOUT_SELECT} where coalesce(p.scheduled_for, p.period_end) between $1 and $2) q
        where ($3::uuid is null or (q.party_type = 'restaurant' and q.party_id = $3))
          and ($4::uuid is null or (q.party_type = 'delivery_partner' and q.party_id = $4))
        order by coalesce(q.scheduled_for, q.period_end), q.party_name
        """,
        start, end, restaurant, rider,
    )
    keys = ("food", "pay", "tips", "commission", "gateway", "gst", "tds", "coupons", "refunds", "cash_collected",
            "cash_deposited", "adjustments")

    for row in rows:
        item = payout_row(row)
        parts = by_payout.get(item["id"])
        table.rows.append(
            [item["id"], item["partyType"], item["partyName"], item["contact"]["phone"], item["status"],
             row["scheduled_for"], row["period_start"], row["period_end"]]
            # A payout from before the ledger has no lines to break down.
            + [int(parts[key]) if parts else 0 for key in keys]
            + [item["netPaise"], item["reference"], item["paidAt"], "yes" if item["bank"]["verified"] else "no",
               item["bank"]["summary"]]
        )

    return table


PAYER = {"restaurant": "Restaurant", "rider": "Rider", "foodos": "Foodos", None: "Foodos"}


async def _refunds(start, end, restaurant, rider) -> Table:
    table = Table(
        "Refunds and adjustments", "Refunds and adjustments, and who paid",
        [Column("Date", DATE), Column("Type"), Column("Order"), Column("Restaurant"), Column("Rider"),
         # Refunds and signed adjustments do not add up to anything meaningful.
         Column("Amount", MONEY, total=False), Column("Refunded to customer", MONEY), Column("Who paid"),
         Column("Problem"), Column("Refunded to"), Column("Reason"), Column("Status"), Column("By")],
    )
    day = _ist_day("f.created_at")
    refunds = await fetch(
        f"""
        select {day} as day, f.amount_paise, f.charged_to, f.issue, f.destination, f.reason, f.status,
               o.order_number, r.name as restaurant, ru.full_name as rider,
               coalesce(u.full_name, u.email) as actor
        from refunds f
        left join orders o on o.id = f.order_id
        left join restaurants r on r.id = o.restaurant_id
        left join deliveries d on d.order_id = o.id
        left join users ru on ru.id = d.partner_id
        left join users u on u.id = f.requested_by
        where {day} between $1 and $2 and not coalesce(o.is_test, false)
          and ($3::uuid is null or o.restaurant_id = $3) and ($4::uuid is null or d.partner_id = $4)
        order by f.created_at
        """,
        start, end, restaurant, rider,
    )

    for row in refunds:
        # A cancellation refund has no payer chosen: nobody's pay is touched.
        kind = "Partial refund" if row["charged_to"] else "Cancellation refund"
        table.rows.append(
            [row["day"], kind, row["order_number"], row["restaurant"], row["rider"], row["amount_paise"],
             row["amount_paise"] if row["status"] != "failed" else 0, PAYER[row["charged_to"]], row["issue"],
             "Foodos wallet" if row["destination"] == "wallet" else "Card or UPI", row["reason"], row["status"],
             row["actor"]]
        )

    adjustments = await fetch(
        """
        select e.business_date as day, e.amount_paise, e.note, e.party_type, o.order_number, r.name as restaurant,
               ru.full_name as rider, coalesce(u.full_name, u.email) as actor
        from earnings_entries e
        left join orders o on o.id = e.order_id
        left join restaurants r on r.id = e.restaurant_id
        left join users ru on ru.id = e.partner_id
        left join users u on u.id = e.created_by
        where e.kind = 'adjustment' and e.business_date between $1 and $2
          and ($3::uuid is null or e.restaurant_id = $3) and ($4::uuid is null or e.partner_id = $4)
        order by e.business_date, e.id
        """,
        start, end, restaurant, rider,
    )

    for row in adjustments:
        # Plus is money Foodos gives the partner; minus comes off them.
        if row["amount_paise"] > 0:
            payer = "Foodos"
        else:
            payer = "Restaurant" if row["party_type"] == "restaurant" else "Rider"

        table.rows.append(
            [row["day"], "Adjustment", row["order_number"], row["restaurant"], row["rider"], row["amount_paise"], 0,
             payer, None, None, row["note"], None, row["actor"]]
        )

    table.rows.sort(key=lambda line: line[0])

    return table


async def _tax(start, end, restaurant, rider) -> Table:
    table = Table(
        "GST and TDS", "GST and TDS summary",
        [Column("Party type"), Column("Name"), Column("Phone", pdf=False), Column("Orders", COUNT),
         Column("Sales or earnings (without tips)", MONEY), Column("GST on orders from customers", MONEY),
         Column("GST on commission and fee", MONEY), Column("TDS deducted", MONEY)],
    )

    if rider is None:
        for row in await fetch(
            """
            select r.name, u.phone, count(*)::int as orders,
                   sum((e.breakdown->>'foodPaise')::bigint + (e.breakdown->>'packagingPaise')::bigint) as sales,
                   coalesce(sum(o.tax_paise), 0) as order_gst,
                   sum(coalesce((e.breakdown->>'gstOnCommissionPaise')::bigint, 0)) as fee_gst,
                   sum(coalesce((e.breakdown->>'tdsPaise')::bigint, 0)) as tds
            from earnings_entries e
            join restaurants r on r.id = e.restaurant_id
            left join users u on u.id = r.owner_id
            left join orders o on o.id = e.order_id
            where e.kind = 'order' and e.business_date between $1 and $2 and ($3::uuid is null or r.id = $3)
            group by r.id, u.phone
            order by r.name
            """,
            start, end, restaurant,
        ):
            table.rows.append(
                ["Restaurant", row["name"], row["phone"], row["orders"], row["sales"], row["order_gst"],
                 row["fee_gst"], row["tds"]]
            )

    if restaurant is None:
        for row in await tds.report_rows(start, end, rider):
            table.rows.append(
                ["Rider", row["full_name"], row["phone"], row["deliveries"], row["earnings"], 0, 0, row["tds"]]
            )

    return table


async def _riders(start, end, restaurant, rider) -> Table:
    table = Table(
        "Rider cash and incentives", "Rider cash on delivery and incentive ledger",
        [Column("Date", DATE), Column("Rider"), Column("Phone", pdf=False), Column("What"), Column("Order"),
         Column("Cash collected", MONEY), Column("Cash handed over", MONEY), Column("Incentive", MONEY),
         Column("Tip", MONEY), Column("Note")],
    )
    rows = await fetch(
        """
        select e.business_date, u.full_name, u.phone, e.kind, e.amount_paise, o.order_number, e.note,
               coalesce((e.breakdown->>'incentivePaise')::bigint, 0) as incentive,
               coalesce((e.breakdown->>'tipPaise')::bigint, 0) as tip
        from earnings_entries e
        join users u on u.id = e.partner_id
        left join orders o on o.id = e.order_id
        where e.business_date between $1 and $2 and ($3::uuid is null or e.partner_id = $3)
          and (e.kind in ('cash_collected', 'cash_deposit', 'incentive')
               or (e.kind = 'delivery' and (coalesce((e.breakdown->>'incentivePaise')::bigint, 0) > 0
                                            or coalesce((e.breakdown->>'tipPaise')::bigint, 0) > 0)))
        order by u.full_name, e.business_date, e.id
        """,
        start, end, rider,
    )
    names = {"cash_collected": "Cash collected", "cash_deposit": "Cash handed over",
             "incentive": "Shift incentive", "delivery": "Delivery"}

    for row in rows:
        table.rows.append(
            [row["business_date"], row["full_name"], row["phone"], names[row["kind"]], row["order_number"],
             -row["amount_paise"] if row["kind"] == "cash_collected" else 0,
             row["amount_paise"] if row["kind"] == "cash_deposit" else 0, row["incentive"], row["tip"], row["note"]]
        )

    return table


async def _ledger(start, end, restaurant, rider) -> Table:
    table = Table(
        "Ledger", "Earnings ledger",
        [Column("Entry", pdf=False), Column("Business date", DATE), Column("Party type"), Column("Name"),
         Column("Kind"), Column("Order"), Column("Amount", MONEY), Column("Payout id", pdf=False),
         Column("Payout status"), Column("Held out"), Column("Note"), Column("Created at", pdf=False)],
    )
    rows = await fetch(
        """
        select e.id, e.business_date, e.party_type, coalesce(r.name, u.full_name) as name, e.kind,
               o.order_number, e.amount_paise, e.payout_id, p.status as payout_status, e.excluded_reason,
               e.note, e.created_at
        from earnings_entries e
        left join restaurants r on r.id = e.restaurant_id
        left join users u on u.id = e.partner_id
        left join orders o on o.id = e.order_id
        left join payouts p on p.id = e.payout_id
        where e.business_date between $1 and $2
          and ($3::uuid is null or e.restaurant_id = $3) and ($4::uuid is null or e.partner_id = $4)
        order by e.business_date, e.id
        """,
        start, end, restaurant, rider,
    )

    for row in rows:
        table.rows.append(
            [str(row["id"]), row["business_date"], row["party_type"], row["name"], row["kind"], row["order_number"],
             row["amount_paise"], str(row["payout_id"] or ""), row["payout_status"], row["excluded_reason"],
             row["note"], row["created_at"].isoformat()]
        )

    return table


async def _tds(start, end, restaurant, rider) -> Table:
    table = Table(
        "Rider TDS", "Rider TDS",
        [Column("Rider"), Column("Phone"), Column("Deliveries", COUNT), Column("Earnings (excluding tips)", MONEY),
         Column("TDS deducted", MONEY)],
    )

    for row in await tds.report_rows(start, end, rider):
        table.rows.append([row["full_name"], row["phone"], row["deliveries"], row["earnings"], row["tds"]])

    return table


BUILDERS = {
    "collections": _collections,
    "commission": _commission,
    "payouts": _payouts,
    "refunds": _refunds,
    "tax": _tax,
    "riders": _riders,
    "ledger": _ledger,
    "tds": _tds,
}


def _filter_id(value: Optional[str]) -> Optional[uuid.UUID]:
    if not value:
        return None

    try:
        return uuid.UUID(value)
    except ValueError:
        raise bad_request("filter_invalid", "That restaurant or rider could not be read")


async def report(
    kind: str,
    format_: str,
    date_from: Optional[datetime.date],
    date_to: Optional[datetime.date],
    restaurant_id: Optional[str] = None,
    rider_id: Optional[str] = None,
) -> tuple[str, str, bytes]:
    """(filename, media type, file)."""
    if kind not in BUILDERS or format_ not in export.MEDIA_TYPES:
        raise not_found("report_not_found", "There is no such report")

    start, end = await finance.period(date_from, date_to)
    restaurant, rider = _filter_id(restaurant_id), _filter_id(rider_id)

    for value, name in ((restaurant, "restaurant"), (rider, "rider")):
        if value is not None and name not in FILTERS[kind]:
            raise bad_request("filter_not_applicable", f"This report cannot be narrowed to one {name}")

    if restaurant is not None and rider is not None and kind in ONE_PARTY:
        raise bad_request("filter_not_applicable", "Choose a restaurant or a rider, not both")

    table = await BUILDERS[kind](start, end, restaurant, rider)
    period = f"{start.strftime('%d %b %Y')} to {end.strftime('%d %b %Y')}"

    if format_ == "csv":
        content = export.to_csv(table)
    elif format_ == "xlsx":
        content = export.to_xlsx(table, period)
    else:
        content = export.to_pdf(table, period, get_settings().invoice_company_name)

    return (
        f"foodos-{kind}-{start.isoformat()}-to-{end.isoformat()}.{format_}",
        export.MEDIA_TYPES[format_],
        content,
    )
