"""GST tax invoices for delivered orders.

Food ordered through an app is taxed under section 9(5) of the CGST Act: the
app (Foodos) charges the 5% GST and issues the invoice on the restaurant's
behalf. Each delivered order gets one invoice number the first time its invoice
is opened. Numbers count up within the financial year (April to March), stay
within the 16 characters the invoice rules allow, and never change.

The invoice is a printable web page behind a short-lived signed link, so a
phone can open it in the browser (and save it as a PDF) without the app's
sign-in header, and nobody can open another person's invoice by guessing.
"""

import hashlib
import hmac
import html
import json
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from ...config import get_settings
from ...database import fetch, fetchrow, transaction
from ...errors import AppError, conflict, not_found

# India has no daylight saving, so a fixed offset is exact.
INDIA = timezone(timedelta(hours=5, minutes=30))

LINK_SECONDS = 15 * 60

# Services provided by restaurants, including takeaway and delivery.
RESTAURANT_SAC = "996331"

PAYMENT_NAMES = {"cod": "Cash on delivery", "upi": "UPI", "card": "Card", "netbanking": "Net banking"}


def _as_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found("order_not_found", "That order could not be found")


def _signature(order_id: uuid.UUID, expires: int) -> str:
    key = get_settings().jwt_access_secret.encode()

    return hmac.new(key, f"invoice:{order_id}:{expires}".encode(), hashlib.sha256).hexdigest()


async def invoice_link(order_id: str, customer_id: Optional[uuid.UUID] = None) -> str:
    """A link to the order's invoice, valid for 15 minutes. With a customer,
    only their own order; without one (an admin), any order."""
    identifier = _as_uuid(order_id)
    order = await fetchrow("select customer_id, status from orders where id = $1", identifier)

    if order is None or (customer_id is not None and order["customer_id"] != customer_id):
        raise not_found("order_not_found", "That order could not be found")

    if order["status"] != "delivered":
        raise conflict("invoice_not_ready", "The invoice is ready once the order is delivered")

    expires = int(time.time()) + LINK_SECONDS

    return f"/api/v1/invoices/{identifier}?e={expires}&s={_signature(identifier, expires)}"


def check_link(order_id: str, expires: int, signature: str) -> uuid.UUID:
    identifier = _as_uuid(order_id)

    if not hmac.compare_digest(_signature(identifier, expires), signature or ""):
        raise not_found("invoice_not_found", "That invoice link is not valid")

    if expires < time.time():
        raise AppError(410, "invoice_link_expired", "This invoice link has expired. Open the invoice again from Foodos")

    return identifier


def financial_year(moment: datetime) -> str:
    """"2627" for 1 April 2026 to 31 March 2027, by India time."""
    local = moment.astimezone(INDIA)
    start = local.year if local.month >= 4 else local.year - 1

    return f"{start % 100:02d}{(start + 1) % 100:02d}"


async def _number_for(order_id: uuid.UUID) -> str:
    """The order's invoice number, given now if it has none. The order row is
    locked first, so two opens at once cannot use up two numbers."""
    async with transaction() as connection:
        order = await connection.fetchrow(
            "select invoice_number, delivered_at, status from orders where id = $1 for update", order_id
        )

        if order is None or order["status"] != "delivered":
            raise not_found("invoice_not_found", "That invoice could not be found")

        if order["invoice_number"]:
            return order["invoice_number"]

        year = financial_year(order["delivered_at"])
        serial = await connection.fetchval(
            """
            insert into invoice_counters (financial_year, last_number) values ($1, 1)
            on conflict (financial_year) do update set last_number = invoice_counters.last_number + 1
            returning last_number
            """,
            year,
        )
        number = f"FD{year}/{serial:06d}"
        await connection.execute("update orders set invoice_number = $2 where id = $1", order_id, number)

        return number


def _money(paise: int) -> str:
    sign = "-" if paise < 0 else ""
    paise = abs(paise)

    return f"{sign}₹{paise // 100:,}.{paise % 100:02d}"


def _date(moment: Optional[datetime]) -> str:
    return moment.astimezone(INDIA).strftime("%d %b %Y, %I:%M %p") if moment else ""


async def render_invoice(order_id: uuid.UUID) -> tuple[str, str]:
    """The invoice page, and the nonce its one script (the print button) runs under."""
    number = await _number_for(order_id)
    order = await fetchrow(
        """
        select o.order_number, o.placed_at, o.delivered_at, o.delivery_address, o.payment_method,
               o.subtotal_paise, o.delivery_fee_paise, o.packaging_fee_paise, o.tax_paise, o.tip_paise,
               o.discount_paise, o.round_off_paise, o.total_paise,
               r.name as restaurant_name, r.address_line, r.city, r.pincode, r.gst_number, r.fssai_number,
               u.full_name as customer_name
        from orders o
        join restaurants r on r.id = o.restaurant_id
        join users u on u.id = o.customer_id
        where o.id = $1
        """,
        order_id,
    )
    items = await fetch(
        """
        select i.name, i.quantity, i.unit_price_paise, i.line_total_paise,
               array(select a.name from order_item_addons a where a.order_item_id = i.id order by a.name) as addons
        from order_items i where i.order_id = $1 order by i.name
        """,
        order_id,
    )
    settings = get_settings()
    address = order["delivery_address"]

    if isinstance(address, str):
        address = json.loads(address)

    e = html.escape
    central = order["tax_paise"] // 2
    state = order["tax_paise"] - central

    lines = "".join(
        f"<tr><td>{e(item['name'])}"
        + (f"<div class='sub'>{e(', '.join(item['addons']))}</div>" if item["addons"] else "")
        + f"</td><td class='n'>{item['quantity']}</td><td class='n'>{_money(item['unit_price_paise'])}</td>"
        f"<td class='n'>{_money(item['line_total_paise'])}</td></tr>"
        for item in items
    )

    def row(label: str, paise: int, strong: bool = False) -> str:
        tag = "th" if strong else "td"
        return f"<tr><{tag}>{e(label)}</{tag}><{tag} class='n'>{_money(paise)}</{tag}></tr>"

    totals = row("Item total (taxable value)", order["subtotal_paise"])
    totals += row("CGST @ 2.5%", central) + row("SGST @ 2.5%", state)

    if order["packaging_fee_paise"]:
        totals += row("Packaging charges", order["packaging_fee_paise"])

    if order["delivery_fee_paise"]:
        totals += row("Delivery fee", order["delivery_fee_paise"])

    if order["discount_paise"]:
        totals += row("Discount", -order["discount_paise"])

    if order["tip_paise"]:
        totals += row("Delivery partner tip (not taxed, paid in full to the partner)", order["tip_paise"])

    if order["round_off_paise"]:
        totals += row("Round off", order["round_off_paise"])

    totals += row("Total paid", order["total_paise"], strong=True)

    restaurant_place = ", ".join(filter(None, [order["address_line"], order["city"], order["pincode"]]))
    customer_place = ", ".join(
        filter(None, [address.get("line1"), address.get("line2"), address.get("city"), address.get("pincode")])
    )
    operator = [e(settings.invoice_company_name)]

    if settings.invoice_company_address:
        operator.append(e(settings.invoice_company_address))

    if settings.invoice_company_gstin:
        operator.append(f"GSTIN: {e(settings.invoice_company_gstin)}")

    nonce = secrets.token_urlsafe(16)
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Invoice {e(number)} · Foodos</title>
<style>
  :root {{ color-scheme: light; }}
  body {{ margin: 0; background: #f3f5f4; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #17211c; }}
  main {{ max-width: 760px; margin: 16px auto; background: #fff; padding: 24px 20px; border-radius: 12px; }}
  h1 {{ font-size: 20px; margin: 0; }} h2 {{ font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #5b6b63; margin: 0 0 4px; }}
  .head {{ display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; border-bottom: 2px solid #1c5e3a; padding-bottom: 12px; }}
  .brand {{ color: #1c5e3a; font-weight: 800; font-size: 22px; }}
  .meta {{ text-align: right; }} .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 16px 0; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 8px; }} td, th {{ padding: 7px 4px; border-bottom: 1px solid #e3e8e5; text-align: left; vertical-align: top; }}
  th {{ font-weight: 700; }} .n {{ text-align: right; white-space: nowrap; }} .sub {{ color: #5b6b63; font-size: 12px; }}
  .totals {{ margin-left: auto; max-width: 420px; }} .note {{ color: #5b6b63; font-size: 12px; margin-top: 16px; }}
  button {{ margin: 0 auto 16px; display: block; font: inherit; font-weight: 700; color: #fff; background: #1c5e3a; border: 0; border-radius: 8px; padding: 10px 18px; }}
  @media print {{ body {{ background: #fff; }} main {{ margin: 0; max-width: none; }} button {{ display: none; }} }}
</style></head>
<body><main>
  <div class="head">
    <div><div class="brand">Foodos</div><h1>Tax invoice</h1></div>
    <div class="meta"><div><strong>Invoice no.</strong> {e(number)}</div><div><strong>Date</strong> {_date(order['delivered_at'])}</div>
      <div><strong>Order</strong> #{e(order['order_number'])}</div></div>
  </div>
  <div class="grid">
    <div><h2>Sold by (restaurant)</h2><strong>{e(order['restaurant_name'])}</strong><div>{e(restaurant_place)}</div>
      {f"<div>GSTIN: {e(order['gst_number'])}</div>" if order['gst_number'] else ""}
      {f"<div>FSSAI licence: {e(order['fssai_number'])}</div>" if order['fssai_number'] else ""}</div>
    <div><h2>Through (e-commerce operator)</h2>{"<br>".join(operator)}</div>
    <div><h2>Billed to</h2><strong>{e(order['customer_name'] or 'Customer')}</strong><div>{e(customer_place)}</div>
      <div>Place of supply: {e(settings.invoice_place_of_supply)}</div></div>
  </div>
  <table><thead><tr><th>Item (SAC {RESTAURANT_SAC})</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead>
    <tbody>{lines}</tbody></table>
  <table class="totals"><tbody>{totals}</tbody></table>
  <p class="note">Paid by {e(PAYMENT_NAMES.get(order['payment_method'], order['payment_method']))}. Ordered {_date(order['placed_at'])}.
    GST on restaurant services is paid by {e(settings.invoice_company_name)} under section 9(5) of the CGST Act, 2017.
    This is a computer-generated invoice and needs no signature.</p>
</main>
<button id="print" type="button">Print or save as PDF</button>
<script nonce="{nonce}">document.getElementById('print').addEventListener('click', function () {{ window.print() }})</script>
</body></html>"""

    return page, nonce
