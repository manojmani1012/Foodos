"""The admin finance page: money in, money owed, payouts by status, the
ledger rows still waiting for a batch, and CSV reports for the accountant.

Collections and commission are counted over a period (delivered orders, by
India date). What is payable is "now": every ledger row not yet in a paid
payout. Riders who hold more cash than they have earned owe Foodos, and are
shown apart, not netted against what other riders are owed.
"""

import csv
import datetime
import io
import json
from typing import Any, Optional

from ...database import fetch, fetchrow, fetchval
from ...errors import bad_request, not_found
from . import ledger, schedule, tds
from . import settings as payment_settings
from .party import entries_of
from .views import BLOCKED_SQL, PAYOUT_SELECT, payout_row

DEFAULT_DAYS = 30
MAX_REPORT_DAYS = 366

DELIVERED_ON = "(coalesce(o.delivered_at, o.placed_at) at time zone 'Asia/Kolkata')::date"

STATUSES = ("scheduled", "processing", "on_hold", "failed", "paid", "cancelled")


async def period(date_from: Optional[datetime.date], date_to: Optional[datetime.date]) -> tuple[datetime.date, datetime.date]:
    today = await schedule.india_today()
    date_to = date_to or today
    date_from = date_from or date_to - datetime.timedelta(days=DEFAULT_DAYS - 1)

    if date_to < date_from:
        raise bad_request("period_invalid", "The period ends before it starts")

    if (date_to - date_from).days >= MAX_REPORT_DAYS:
        raise bad_request("period_too_long", "Choose a period of a year or less")

    return date_from, date_to


def _count(row: Any) -> dict:
    return {"count": row["n"], "netPaise": int(row["net"])}


async def overview(date_from: Optional[datetime.date], date_to: Optional[datetime.date]) -> dict:
    start, end = await period(date_from, date_to)
    today = await schedule.india_today()

    collections = await fetchrow(
        f"""
        select coalesce(sum(o.total_paise) filter (where o.payment_method in ('upi', 'card')), 0)::bigint as online,
               coalesce(sum(o.total_paise) filter (where o.payment_method = 'wallet'), 0)::bigint as wallet,
               coalesce(sum(o.total_paise) filter (where o.payment_method = 'cod'), 0)::bigint as cash,
               coalesce(sum(o.delivery_fee_paise), 0)::bigint as delivery_fees
        from orders o
        where o.status = 'delivered' and not o.is_test and {DELIVERED_ON} between $1 and $2
        """,
        start,
        end,
    )
    refunded = await fetchval(
        """
        select coalesce(sum(f.amount_paise), 0)::bigint
        from refunds f left join orders o on o.id = f.order_id
        where f.status <> 'failed' and not coalesce(o.is_test, false)
          and (f.created_at at time zone 'Asia/Kolkata')::date between $1 and $2
        """,
        start,
        end,
    )
    commission = await fetchrow(
        """
        select coalesce(sum((breakdown->>'commissionPaise')::bigint), 0)::bigint as commission,
               coalesce(sum((breakdown->>'gatewayFeePaise')::bigint), 0)::bigint as gateway,
               coalesce(sum((breakdown->>'gstOnCommissionPaise')::bigint), 0)::bigint as gst
        from earnings_entries
        where kind = 'order' and business_date between $1 and $2
        """,
        start,
        end,
    )

    # Owed now: rows not in a paid payout, each party netted on its own.
    owed = await fetch(
        """
        select e.party_type, coalesce(e.restaurant_id, e.partner_id) as party, sum(e.amount_paise)::bigint as total
        from earnings_entries e
        left join payouts p on p.id = e.payout_id
        where e.excluded_reason is null and (e.payout_id is null or p.status <> 'paid')
        group by 1, 2
        """
    )
    restaurants_owed = sum(int(row["total"]) for row in owed if row["party_type"] == "restaurant")
    riders_owed = sum(int(row["total"]) for row in owed if row["party_type"] != "restaurant" and row["total"] > 0)
    riders_owe = -sum(int(row["total"]) for row in owed if row["party_type"] != "restaurant" and row["total"] < 0)

    def group(where: str, *args: Any):
        return fetchrow(f"select count(*)::int as n, coalesce(sum(net_paise), 0)::bigint as net from payouts where {where}", *args)

    next_dates = await fetch(
        """
        select scheduled_for, count(*)::int as n, sum(net_paise)::bigint as net
        from payouts
        where status in ('scheduled', 'on_hold') and scheduled_for >= $1
        group by scheduled_for
        order by scheduled_for
        limit 10
        """,
        today,
    )

    online, wallet, cash = (int(collections[key]) for key in ("online", "wallet", "cash"))

    return {
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "collections": {
            "onlinePaise": online,
            "walletPaise": wallet,
            "cashPaise": cash,
            "totalPaise": online + wallet + cash,
            "refundsPaise": int(refunded),
        },
        "commission": {
            "commissionPaise": int(commission["commission"]),
            "gatewayFeePaise": int(commission["gateway"]),
            "gstOnCommissionPaise": int(commission["gst"]),
            "deliveryFeesPaise": int(collections["delivery_fees"]),
        },
        "payable": {"restaurantsPaise": restaurants_owed, "ridersPaise": riders_owed, "riderOwesPaise": riders_owe},
        "payouts": {
            "scheduled": _count(await group("status = 'scheduled'")),
            "onHold": _count(await group("status = 'on_hold'")),
            "failed": _count(await group("status = 'failed'")),
            "paid": _count(
                await group(
                    "status = 'paid' and (paid_at at time zone 'Asia/Kolkata')::date between $1 and $2", start, end
                )
            ),
            "dueToday": _count(await group("status = 'scheduled' and scheduled_for <= $1", today)),
            # Waiting on bank details that are missing or not verified yet.
            "blocked": _count(
                await fetchrow(
                    f"""
                    select count(*)::int as n, coalesce(sum(p.net_paise), 0)::bigint as net
                    from ({PAYOUT_SELECT}) p
                    where p.status in ('scheduled', 'on_hold') and {BLOCKED_SQL}
                    """
                )
            ),
        },
        "nextPayDates": [
            {"date": row["scheduled_for"].isoformat(), "count": row["n"], "netPaise": int(row["net"])}
            for row in next_dates
        ],
    }


def _search_filter(search: Optional[str], args: list) -> Optional[str]:
    if not search or not search.strip():
        return None

    args.append(f"%{search.strip()}%")
    n = len(args)
    clause = f"(r.name ilike ${n} or pu.full_name ilike ${n} or ou.full_name ilike ${n}"
    digits = "".join(ch for ch in search if ch.isdigit())

    if len(digits) >= 4:
        args.append(f"%{digits}%")
        clause += f" or ou.phone like ${len(args)} or pu.phone like ${len(args)}"

    return clause + ")"


async def list_payouts(
    status: Optional[str], party: Optional[str], search: Optional[str], limit: int, offset: int
) -> dict:
    conditions, args = [], []

    if party:
        args.append(party)
        conditions.append(f"p.party_type = ${len(args)}")

    clause = _search_filter(search, args)

    if clause:
        conditions.append(clause)

    base_where = f"where {' and '.join(conditions)}" if conditions else ""
    today = await schedule.india_today()
    args.append(today)

    counts_row = await fetchrow(
        f"""
        select {", ".join(f"count(*) filter (where p.status = '{s}')::int as {s}" for s in STATUSES)},
               count(*) filter (where p.status = 'scheduled' and p.scheduled_for <= ${len(args)})::int as due_today
        from ({PAYOUT_SELECT} {base_where}) p
        """,
        *args,
    )
    args.pop()
    counts = {s: counts_row[s] for s in STATUSES}
    counts["dueToday"] = counts_row["due_today"]

    if status and status != "all":
        args.append(status)
        conditions.append(f"p.status = ${len(args)}")

    where = f"where {' and '.join(conditions)}" if conditions else ""
    total = await fetchval(f"select count(*)::int from ({PAYOUT_SELECT} {where}) p", *args)
    rows = await fetch(
        f"""
        {PAYOUT_SELECT}
        {where}
        order by p.scheduled_for desc nulls last, p.created_at desc
        limit ${len(args) + 1} offset ${len(args) + 2}
        """,
        *args,
        limit,
        offset,
    )

    return {"total": total, "counts": counts, "payouts": [payout_row(row) for row in rows]}


async def payout_detail(payout_id: str) -> dict:
    identifier = schedule.as_uuid(payout_id)
    row = await fetchrow(f"{PAYOUT_SELECT} where p.id = $1", identifier)

    if row is None:
        raise not_found("payout_not_found", "That payout could not be found")

    bank_details = None

    if row["party_type"] == "restaurant" and row["account_number"]:
        bank_details = {
            "holder": row["account_holder_name"],
            "accountNumber": row["account_number"],
            "ifsc": row["ifsc"],
            "bankName": row["bank_name"],
            "upiId": None,
        }
    elif row["party_type"] == "delivery_partner" and (row["rider_account_number"] or row["rider_upi_id"]):
        bank_details = {
            "holder": row["rider_holder"] or row["party_name"],
            "accountNumber": row["rider_account_number"],
            "ifsc": row["rider_ifsc"],
            "bankName": row["rider_bank_name"],
            "upiId": row["rider_upi_id"],
        }

    logs = await fetch(
        """
        select a.action, a.metadata, a.created_at, coalesce(u.full_name, u.email) as actor
        from audit_logs a left join users u on u.id = a.actor_user_id
        where a.module = 'Payouts' and a.entity_type = 'payout' and a.entity_id = $1
        order by a.created_at
        """,
        str(identifier),
    )

    history = []

    if row["batch_id"] is not None:
        history.append(
            {"action": "Scheduled", "by": "Foodos", "at": row["created_at"].isoformat(), "note": None}
        )

    for log in logs:
        meta = log["metadata"]
        meta = json.loads(meta) if isinstance(meta, str) else (meta or {})
        note = meta.get("reason") or meta.get("reference") or (f"New date {meta['date']}" if meta.get("date") else None)
        history.append({"action": log["action"], "by": log["actor"], "at": log["created_at"].isoformat(), "note": note})

    return {
        **payout_row(row),
        "bankDetails": bank_details,
        "entries": await entries_of(identifier),
        "history": history,
    }


async def unpaid(party: Optional[str]) -> dict:
    minimum = payment_settings.current()["minPayoutPaise"]
    rows = await fetch(
        """
        select e.party_type, coalesce(e.restaurant_id, e.partner_id) as party_id,
               coalesce(r.name, u.full_name) as party_name,
               sum(e.amount_paise)::bigint as due, count(*)::int as entries, min(e.business_date) as oldest
        from earnings_entries e
        left join restaurants r on r.id = e.restaurant_id
        left join users u on u.id = e.partner_id
        where e.payout_id is null and e.excluded_reason is null and ($1::text is null or e.party_type = $1)
        group by 1, 2, 3
        order by min(e.business_date), 3
        """,
        party,
    )
    excluded = await fetchrow(
        """
        select count(*)::int as n, coalesce(sum(amount_paise), 0)::bigint as amount
        from earnings_entries
        where payout_id is null and excluded_reason is not null and ($1::text is null or party_type = $1)
        """,
        party,
    )

    return {
        "parties": [
            {
                "partyType": row["party_type"],
                "partyId": str(row["party_id"]),
                "partyName": row["party_name"],
                "duePaise": int(row["due"]),
                "entryCount": row["entries"],
                "oldestDate": row["oldest"].isoformat(),
                "belowMinimum": int(row["due"]) < minimum,
            }
            for row in rows
        ],
        "excluded": {"count": excluded["n"], "amountPaise": int(excluded["amount"])},
    }


async def run_now() -> int:
    """The sweeper, then the scheduler: what the background loop does."""
    await payment_settings.load()
    await ledger.sweep()
    created = await schedule.run()
    await schedule.send_reminders()

    return created


# --- CSV reports -------------------------------------------------------------


def _rupees(paise: Any) -> str:
    paise = int(paise or 0)
    sign = "-" if paise < 0 else ""
    paise = abs(paise)

    return f"{sign}{paise // 100}.{paise % 100:02d}"


def _iso(value: Any) -> str:
    return value.isoformat() if value is not None else ""


async def report(kind: str, date_from: Optional[datetime.date], date_to: Optional[datetime.date]) -> tuple[str, str]:
    """(filename, CSV text). Amounts are in rupees with two decimals, which is
    what a spreadsheet and an accountant expect."""
    start, end = await period(date_from, date_to)
    out = io.StringIO()
    writer = csv.writer(out)

    if kind == "collections":
        writer.writerow(
            ["Delivered on", "Order", "Restaurant", "Payment method", "Food", "Packaging", "Delivery fee", "Tax",
             "Tip", "Discount", "Total", "Refunded"]
        )
        rows = await fetch(
            f"""
            select {DELIVERED_ON} as day, o.order_number, r.name, o.payment_method, o.subtotal_paise,
                   o.packaging_fee_paise, o.delivery_fee_paise, o.tax_paise, o.tip_paise, o.discount_paise,
                   o.total_paise,
                   (select coalesce(sum(f.amount_paise), 0) from refunds f
                     where f.order_id = o.id and f.status <> 'failed') as refunded
            from orders o join restaurants r on r.id = o.restaurant_id
            where o.status = 'delivered' and not o.is_test and {DELIVERED_ON} between $1 and $2
            order by 1, o.order_number
            """,
            start,
            end,
        )

        for row in rows:
            writer.writerow(
                [_iso(row["day"]), row["order_number"], row["name"], row["payment_method"]]
                + [_rupees(row[k]) for k in ("subtotal_paise", "packaging_fee_paise", "delivery_fee_paise",
                                              "tax_paise", "tip_paise", "discount_paise", "total_paise", "refunded")]
            )
    elif kind == "payouts":
        writer.writerow(
            ["Payout id", "Party type", "Name", "Phone", "Status", "Payout date", "Period start", "Period end",
             "Gross", "Commission", "Adjustments", "Net", "Bank reference", "Paid at", "Bank verified", "Pay to"]
        )
        rows = await fetch(
            f"""
            {PAYOUT_SELECT}
            where coalesce(p.scheduled_for, p.period_end) between $1 and $2
            order by coalesce(p.scheduled_for, p.period_end), party_name
            """,
            start,
            end,
        )

        for row in rows:
            item = payout_row(row)
            writer.writerow(
                [item["id"], item["partyType"], item["partyName"], item["contact"]["phone"], item["status"],
                 item["scheduledFor"] or "", item["periodStart"], item["periodEnd"], _rupees(item["grossPaise"]),
                 _rupees(item["commissionPaise"]), _rupees(item["adjustmentsPaise"]), _rupees(item["netPaise"]),
                 item["reference"] or "", item["paidAt"] or "", "yes" if item["bank"]["verified"] else "no",
                 item["bank"]["summary"] or ""]
            )
    elif kind == "ledger":
        writer.writerow(
            ["Entry", "Business date", "Party type", "Name", "Kind", "Order", "Amount", "Payout id", "Payout status",
             "Held out", "Note", "Created at"]
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
            order by e.business_date, e.id
            """,
            start,
            end,
        )

        for row in rows:
            writer.writerow(
                [row["id"], _iso(row["business_date"]), row["party_type"], row["name"], row["kind"],
                 row["order_number"] or "", _rupees(row["amount_paise"]), str(row["payout_id"] or ""),
                 row["payout_status"] or "", row["excluded_reason"] or "", row["note"] or "", _iso(row["created_at"])]
            )
    elif kind == "commission":
        writer.writerow(
            ["Restaurant", "Plan", "Orders", "Food", "Packaging", "Commission", "Gateway fee",
             "GST on commission and gateway fee", "TDS", "Coupons paid by restaurant", "Bank offers (not charged)",
             "Restaurant share"]
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
            where e.kind = 'order' and e.business_date between $1 and $2
            group by r.id
            order by r.name
            """,
            start,
            end,
        )

        for row in rows:
            writer.writerow(
                [row["name"], row["commission_plan"], row["orders"]]
                + [_rupees(row[k]) for k in ("food", "packaging", "commission", "gateway", "gst", "tds", "discount",
                                              "bank_offer", "share")]
            )
    elif kind == "tds":
        writer.writerow(["Rider", "Phone", "Deliveries", "Earnings (excluding tips)", "TDS deducted"])

        for row in await tds.report_rows(start, end):
            writer.writerow(
                [row["full_name"], row["phone"] or "", row["deliveries"], _rupees(row["earnings"]), _rupees(row["tds"])]
            )
    else:
        raise not_found("report_not_found", "There is no such report")

    return f"foodos-{kind}-{start.isoformat()}-to-{end.isoformat()}.csv", out.getvalue()
