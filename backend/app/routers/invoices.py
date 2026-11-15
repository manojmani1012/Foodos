"""Printable GST invoices, opened in the phone's browser through a short-lived
signed link (see components/orders/invoice.py)."""

import html

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

from ..components.orders.invoice import check_link, render_invoice
from ..errors import AppError

router = APIRouter(tags=["invoices"])

HEADERS = {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
}


@router.get("/api/v1/invoices/{order_id}")
async def get_invoice(order_id: str, e: int = Query(...), s: str = Query(..., max_length=128)):
    try:
        identifier = check_link(order_id, e, s)
        page, nonce = await render_invoice(identifier)
    except AppError as error:
        # Opened in a browser, so the problem is a page, not JSON.
        return HTMLResponse(
            "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
            f"<title>Invoice</title><p style='font:16px system-ui;margin:24px'>{html.escape(error.message)}</p>",
            status_code=error.status,
            headers={**HEADERS, "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"},
        )

    return HTMLResponse(
        page,
        headers={
            **HEADERS,
            "Content-Security-Policy": (
                f"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-{nonce}'; "
                "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
            ),
        },
    )
