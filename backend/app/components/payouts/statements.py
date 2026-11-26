"""Payout statements: a printable page listing every order, cash handover,
refund and adjustment in one payout.

Like the GST invoices, the page sits behind a signed link that lasts 15
minutes, so a phone can open it in the browser (and save it as a PDF) without
the app's sign-in header, and nobody can open another partner's statement by
guessing. The page has no scripts at all: the browser's own print menu saves it.
"""

import hashlib
import hmac
import html
import json
import time
import uuid
from typing import Any, Optional

from ...config import get_settings
from ...database import fetch, fetchrow
from ...errors import AppError, not_found
from ..orders.invoice import INDIA
from . import export
from .views import PAYOUT_SELECT, payout_breakdown

LINK_SECONDS = 15 * 60

STATUS_NAMES = {
    "scheduled": "Scheduled",
    "on_hold": "On hold",
    "processing": "Processing",
    "paid": "Paid",
    "failed": "Failed",
    "cancelled": "Cancelled",
    "pending": "Pending",
}

KIND_NAMES = {
    "order": "Order",
    "delivery": "Delivery",
    "cash_collected": "Cash collected",
    "cash_deposit": "Cash handed over",
    "incentive": "Shift incentive",
    "refund": "Refund",
    "adjustment": "Adjustment",
}

RESTAURANT_LINES = [
    ("foodPaise", "Food (item total)", 1),
    ("packagingPaise", "Packaging charges", 1),
    ("discountPaise", "Coupons paid by you", -1),
    ("commissionPaise", "Foodos commission", -1),
    ("gatewayFeePaise", "Payment gateway fee", -1),
    ("gstOnCommissionPaise", "GST on commission and gateway fee", -1),
    ("tdsPaise", "TDS (section 194-O)", -1),
    ("refundsPaise", "Refunds charged to you", -1),
    ("adjustmentsPaise", "Adjustments", 1),
]

RIDER_LINES = [
    ("basePaise", "Base pay", 1),
    ("distancePaise", "Distance pay", 1),
    ("incentivePaise", "Incentives", 1),
    ("tipsPaise", "Tips", 1),
    ("tdsPaise", "TDS deducted", -1),
    ("cashCollectedPaise", "Cash collected from customers", -1),
    ("cashDepositedPaise", "Cash handed over to Foodos", 1),
    ("refundsPaise", "Refunds charged to you", -1),
    ("adjustmentsPaise", "Adjustments", 1),
]


def _as_uuid(value: Any) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found("statement_not_found", "That statement could not be found")


def _signature(payout_id: uuid.UUID, expires: int) -> str:
    key = get_settings().jwt_access_secret.encode()

    return hmac.new(key, f"statement:{payout_id}:{expires}".encode(), hashlib.sha256).hexdigest()


def link(payout_id: uuid.UUID) -> str:
    """Relative to the API: the apps put their API base in front."""
    expires = int(time.time()) + LINK_SECONDS

    return f"/api/v1/statements/{payout_id}?e={expires}&s={_signature(payout_id, expires)}"


def check_link(payout_id: str, expires: int, signature: str) -> uuid.UUID:
    identifier = _as_uuid(payout_id)

    if not hmac.compare_digest(_signature(identifier, expires), signature or ""):
        raise not_found("statement_not_found", "That statement link is not valid")

    if expires < time.time():
        raise AppError(410, "statement_link_expired", "This link has expired. Open the statement again from the app")

    return identifier


def _money(paise: int) -> str:
    sign = "-" if paise < 0 else ""
    paise = abs(paise)

    return f"{sign}₹{paise // 100:,}.{paise % 100:02d}"


def _day(value: Optional[Any]) -> str:
    return value.strftime("%d %b %Y") if value else ""


async def _load(payout_id: uuid.UUID) -> tuple[Any, dict, list]:
    """The payout, its summed breakdown and its lines."""
    row = await fetchrow(f"{PAYOUT_SELECT} where p.id = $1", payout_id)

    if row is None:
        raise not_found("statement_not_found", "That statement could not be found")

    party_type = row["party_type"]
    breakdown = await payout_breakdown(payout_id, party_type)
    entries = await fetch(
        """
        select e.kind, e.amount_paise, e.business_date, e.note, e.breakdown, o.order_number
        from earnings_entries e left join orders o on o.id = e.order_id
        where e.payout_id = $1
        order by e.business_date, e.id
        """,
        payout_id,
    )

    return row, breakdown, entries


def _bank_line(row: Any) -> str:
    """Where the money goes, with the account number masked."""
    number, bank_name, upi = (
        (row["account_number"], row["bank_name"], None)
        if row["party_type"] == "restaurant"
        else (row["rider_account_number"], row["rider_bank_name"], row["rider_upi_id"])
    )

    if number:
        return f"{bank_name or 'Bank'} account XXXXXX{number[-4:]}"

    return f"UPI {upi}" if upi else ""


def _detail(entry: Any) -> str:
    b = entry["breakdown"]
    b = json.loads(b) if isinstance(b, str) else (b or {})
    parts = []

    if entry["kind"] == "order":
        parts.append(f"food {_money(b.get('foodPaise', 0))}, commission {b.get('commissionPct', 0):g}%")

        if b.get("discountPaise"):
            parts.append(f"coupon {_money(b['discountPaise'])} paid by restaurant")
        if b.get("bankOfferPaise"):
            parts.append(f"bank offer {_money(b['bankOfferPaise'])} (not charged)")
    elif entry["kind"] == "delivery" and b.get("distanceKm") is not None:
        parts.append(f"{b['distanceKm']:.1f} km")

    if entry["note"]:
        parts.append(entry["note"])

    return "; ".join(parts)


async def render_pdf(payout_id: uuid.UUID) -> tuple[str, bytes]:
    row, breakdown, entries = await _load(payout_id)
    party_type = row["party_type"]
    pdf = export.new_pdf(5)
    export.pdf_heading(pdf, "Foodos payout statement", 16)
    facts = [
        row["party_name"] or "",
        _bank_line(row),
        f"Period: {_day(row['period_start'])} to {_day(row['period_end'])}",
        f"Payout date: {_day(row['scheduled_for'])}",
        f"Status: {STATUS_NAMES.get(row['status'], row['status'])}",
    ]

    if row["status"] == "paid" and row["paid_at"]:
        facts.append(f"Paid on: {row['paid_at'].astimezone(INDIA).strftime('%d %b %Y, %I:%M %p')}")
        facts.append(f"Bank reference: {row['payout_reference'] or ''}")

    for fact in filter(None, facts):
        export.pdf_heading(pdf, fact, 10, "")

    pdf.ln(3)
    summary_lines = RESTAURANT_LINES if party_type == "restaurant" else RIDER_LINES
    summary = [
        [label, export.rupees(sign * breakdown[key])] for key, label, sign in summary_lines if breakdown.get(key)
    ]
    summary.append(["Net payout", export.rupees(row["net_paise"])])
    export.pdf_table(pdf, ["Summary", "Rupees"], summary, [False, True], [70, 30], bold_last=True, size=9)
    pdf.ln(5)
    details = [
        [
            _day(entry["business_date"]),
            KIND_NAMES.get(entry["kind"], entry["kind"]),
            f"#{entry['order_number']}" if entry["order_number"] else "",
            _detail(entry),
            export.rupees(entry["amount_paise"]),
        ]
        for entry in entries
    ]

    if details:
        export.pdf_table(
            pdf, ["Day", "What", "Order", "Details", "Rupees"], details,
            [False, False, False, False, True], [17, 18, 17, 34, 14], size=8,
        )

    pdf.ln(3)
    export.pdf_heading(
        pdf, f"Statement {row['id']} from {get_settings().invoice_company_name}. Amounts are in Indian rupees.", 8, ""
    )

    return f"foodos-statement-{row['period_end'].isoformat()}.pdf", bytes(pdf.output())


async def render(payout_id: uuid.UUID, pdf_href: Optional[str] = None) -> str:
    row, breakdown, entries = await _load(payout_id)
    party_type = row["party_type"]
    settings = get_settings()
    e = html.escape

    summary_lines = RESTAURANT_LINES if party_type == "restaurant" else RIDER_LINES
    summary = "".join(
        f"<tr><td>{e(label)}</td><td class='n'>{_money(sign * breakdown[key])}</td></tr>"
        for key, label, sign in summary_lines
        if breakdown.get(key)
    )
    summary += f"<tr><th>Net payout</th><th class='n'>{_money(row['net_paise'])}</th></tr>"

    lines = "".join(
        f"<tr><td>{_day(entry['business_date'])}</td><td>{e(KIND_NAMES.get(entry['kind'], entry['kind']))}</td>"
        f"<td>{'#' + e(entry['order_number']) if entry['order_number'] else ''}</td>"
        f"<td class='sub'>{e(_detail(entry))}</td><td class='n'>{_money(entry['amount_paise'])}</td></tr>"
        for entry in entries
    )

    paid = ""

    if row["status"] == "paid" and row["paid_at"]:
        paid = (
            f"<div><strong>Paid on</strong> {row['paid_at'].astimezone(INDIA).strftime('%d %b %Y, %I:%M %p')}</div>"
            f"<div><strong>Bank reference</strong> {e(row['payout_reference'] or '')}</div>"
        )

    bank = e(_bank_line(row))

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Payout statement · Foodos</title>
<style>
  :root {{ color-scheme: light; }}
  body {{ margin: 0; background: #f3f5f4; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #17211c; }}
  main {{ max-width: 760px; margin: 16px auto; background: #fff; padding: 24px 20px; border-radius: 12px; }}
  h1 {{ font-size: 20px; margin: 0; }} h2 {{ font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #5b6b63; margin: 16px 0 4px; }}
  .head {{ display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; border-bottom: 2px solid #1c5e3a; padding-bottom: 12px; }}
  .brand {{ color: #1c5e3a; font-weight: 800; font-size: 22px; }} .meta {{ text-align: right; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 8px; }} td, th {{ padding: 7px 4px; border-bottom: 1px solid #e3e8e5; text-align: left; vertical-align: top; }}
  th {{ font-weight: 700; }} .n {{ text-align: right; white-space: nowrap; }} .sub {{ color: #5b6b63; font-size: 12px; }}
  .summary {{ max-width: 420px; }} .note {{ color: #5b6b63; font-size: 12px; margin-top: 16px; }}
  @media print {{ body {{ background: #fff; }} main {{ margin: 0; max-width: none; }} }}
</style></head>
<body><main>
  <div class="head">
    <div><div class="brand">Foodos</div><h1>Payout statement</h1>
      <div><strong>{e(row['party_name'] or '')}</strong></div>{f"<div>{bank}</div>" if bank else ""}</div>
    <div class="meta"><div><strong>Period</strong> {_day(row['period_start'])} to {_day(row['period_end'])}</div>
      <div><strong>Payout date</strong> {_day(row['scheduled_for'])}</div>
      <div><strong>Status</strong> {e(STATUS_NAMES.get(row['status'], row['status']))}</div>{paid}</div>
  </div>
  <h2>Summary</h2>
  <table class="summary"><tbody>{summary}</tbody></table>
  <h2>Details</h2>
  <table><thead><tr><th>Day</th><th>What</th><th>Order</th><th>Details</th><th class="n">Amount</th></tr></thead>
    <tbody>{lines}</tbody></table>
  <p class="note">Statement {e(str(row['id']))} from {e(settings.invoice_company_name)}. Amounts are in Indian rupees.
    To print it, use your browser's Print or Share menu.</p>
  {f'<p><a href="{e(pdf_href)}">Download as PDF</a></p>' if pdf_href else ''}
</main></body></html>"""
