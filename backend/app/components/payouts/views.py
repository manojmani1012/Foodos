"""How payouts and their breakdowns are shown: the admin's PayoutRow and the
apps' PayoutSummary, built from the same query so the two never disagree."""

from typing import Any, Optional

from ...database import fetchrow

PAYOUT_SELECT = """
    select p.id, p.party_type, p.status, p.scheduled_for, p.period_start, p.period_end, p.gross_paise,
           p.commission_paise, p.adjustments_paise, p.net_paise, p.payout_reference, p.paid_at,
           p.hold_reason, p.failure_reason, p.created_at, p.batch_id,
           coalesce(p.restaurant_id, p.partner_id) as party_id,
           coalesce(r.name, pu.full_name) as party_name,
           coalesce(ou.full_name, pu.full_name) as contact_name,
           coalesce(ou.phone, pu.phone) as contact_phone,
           a.status as account_status, a.bank_name, a.account_number, a.account_holder_name, a.ifsc,
           a.upi_id, dp.payout_upi_id, dp.payout_account_masked,
           (select count(*) from earnings_entries e where e.payout_id = p.id)::int as entry_count
    from payouts p
    left join restaurants r on r.id = p.restaurant_id
    left join users ou on ou.id = r.owner_id
    left join restaurant_payout_accounts a on a.restaurant_id = p.restaurant_id
    left join users pu on pu.id = p.partner_id
    left join delivery_partners dp on dp.user_id = p.partner_id
"""


def _iso(value: Any) -> Optional[str]:
    return value.isoformat() if value is not None else None


def bank_summary(row: Any) -> dict:
    """Where the money goes, in a few words. Restaurants: their verified bank
    details. Riders have no verification step yet, so any saved UPI id or
    account counts."""
    if row["party_type"] == "restaurant":
        summary = None

        if row["account_number"]:
            summary = f"{row['bank_name'] or 'Bank'} ...{row['account_number'][-4:]}"
        elif row["upi_id"]:
            summary = row["upi_id"]

        return {"verified": row["account_status"] == "verified", "summary": summary}

    summary = row["payout_upi_id"] or row["payout_account_masked"]

    return {"verified": summary is not None, "summary": summary}


def payout_row(row: Any) -> dict:
    """The admin's PayoutRow."""
    return {
        "id": str(row["id"]),
        "partyType": row["party_type"],
        "partyId": str(row["party_id"]),
        "partyName": row["party_name"],
        "contact": {"name": row["contact_name"], "phone": row["contact_phone"]},
        "status": row["status"],
        "scheduledFor": _iso(row["scheduled_for"]),
        "periodStart": _iso(row["period_start"]),
        "periodEnd": _iso(row["period_end"]),
        "grossPaise": row["gross_paise"],
        "commissionPaise": row["commission_paise"],
        "adjustmentsPaise": row["adjustments_paise"],
        "netPaise": row["net_paise"],
        "reference": row["payout_reference"],
        "paidAt": _iso(row["paid_at"]),
        "holdReason": row["hold_reason"],
        "failureReason": row["failure_reason"],
        "bank": bank_summary(row),
        "entryCount": row["entry_count"],
    }


def payout_summary(row: Any, breakdown: dict) -> dict:
    """What the restaurant and rider apps show for one payout."""
    return {
        "id": str(row["id"]),
        "status": row["status"],
        "scheduledFor": _iso(row["scheduled_for"]),
        "periodStart": _iso(row["period_start"]),
        "periodEnd": _iso(row["period_end"]),
        "grossPaise": row["gross_paise"],
        "commissionPaise": row["commission_paise"],
        "adjustmentsPaise": row["adjustments_paise"],
        "netPaise": row["net_paise"],
        "reference": row["payout_reference"],
        "paidAt": _iso(row["paid_at"]),
        "holdReason": row["hold_reason"],
        "failureReason": row["failure_reason"] if row["status"] == "failed" else None,
        "breakdown": breakdown,
    }


# Sums over a set of ledger rows (the WHERE clause decides which), split the
# way each app shows them. Cash collected and refunds are reported as
# positive amounts taken off; adjustments keep their sign.
RESTAURANT_BREAKDOWN = """
    select coalesce(sum((e.breakdown->>'foodPaise')::bigint) filter (where e.kind = 'order'), 0)::bigint as food,
           coalesce(sum((e.breakdown->>'packagingPaise')::bigint) filter (where e.kind = 'order'), 0)::bigint as packaging,
           coalesce(sum((e.breakdown->>'commissionPaise')::bigint) filter (where e.kind = 'order'), 0)::bigint as commission,
           coalesce(sum((e.breakdown->>'gstOnCommissionPaise')::bigint) filter (where e.kind = 'order'), 0)::bigint as gst,
           coalesce(sum((e.breakdown->>'tdsPaise')::bigint) filter (where e.kind = 'order'), 0)::bigint as tds,
           coalesce(-sum(e.amount_paise) filter (where e.kind = 'refund'), 0)::bigint as refunds,
           coalesce(sum(e.amount_paise) filter (where e.kind = 'adjustment'), 0)::bigint as adjustments,
           coalesce(sum(e.amount_paise), 0)::bigint as total,
           count(*)::int as entries
    from earnings_entries e
"""

RIDER_BREAKDOWN = """
    select coalesce(sum((e.breakdown->>'basePaise')::bigint) filter (where e.kind = 'delivery'), 0)::bigint as base,
           coalesce(sum((e.breakdown->>'distancePaise')::bigint) filter (where e.kind = 'delivery'), 0)::bigint as distance,
           coalesce(sum((e.breakdown->>'incentivePaise')::bigint) filter (where e.kind = 'delivery'), 0)::bigint as incentive,
           coalesce(sum((e.breakdown->>'tipPaise')::bigint) filter (where e.kind = 'delivery'), 0)::bigint as tips,
           coalesce(-sum(e.amount_paise) filter (where e.kind = 'cash_collected'), 0)::bigint as cash_collected,
           coalesce(sum(e.amount_paise) filter (where e.kind = 'cash_deposit'), 0)::bigint as cash_deposited,
           coalesce(-sum(e.amount_paise) filter (where e.kind = 'refund'), 0)::bigint as refunds,
           coalesce(sum(e.amount_paise) filter (where e.kind = 'adjustment'), 0)::bigint as adjustments,
           coalesce(sum(e.amount_paise), 0)::bigint as total,
           count(*)::int as entries
    from earnings_entries e
"""


def breakdown_to_dict(party_type: str, row: Any) -> dict:
    if party_type == "restaurant":
        return {
            "foodPaise": int(row["food"]),
            "packagingPaise": int(row["packaging"]),
            "commissionPaise": int(row["commission"]),
            "gstOnCommissionPaise": int(row["gst"]),
            "tdsPaise": int(row["tds"]),
            "refundsPaise": int(row["refunds"]),
            "adjustmentsPaise": int(row["adjustments"]),
        }

    return {
        "basePaise": int(row["base"]),
        "distancePaise": int(row["distance"]),
        "incentivePaise": int(row["incentive"]),
        "tipsPaise": int(row["tips"]),
        "cashCollectedPaise": int(row["cash_collected"]),
        "cashDepositedPaise": int(row["cash_deposited"]),
        "adjustmentsPaise": int(row["adjustments"]),
        "refundsPaise": int(row["refunds"]),
    }


async def breakdown(party_type: str, where: str, *args: Any) -> tuple[dict, int, int]:
    """(breakdown, total paise, row count) over the ledger rows `where` picks
    (it may use the alias e)."""
    sql = RESTAURANT_BREAKDOWN if party_type == "restaurant" else RIDER_BREAKDOWN
    row = await fetchrow(f"{sql} where {where}", *args)

    return breakdown_to_dict(party_type, row), int(row["total"]), row["entries"]


async def payout_breakdown(payout_id: Any, party_type: str) -> dict:
    return (await breakdown(party_type, "e.payout_id = $1", payout_id))[0]
