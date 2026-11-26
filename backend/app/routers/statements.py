"""Printable payout statements, opened in the phone's browser through a
short-lived signed link (see components/payouts/statements.py). The page has
no scripts, so the policy below allows none."""

import html

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

from ..components.payouts.statements import check_link, render
from ..errors import AppError

router = APIRouter(tags=["statements"])

HEADERS = {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
    "Content-Security-Policy": (
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    ),
}


@router.get("/api/v1/statements/{payout_id}")
async def get_statement(payout_id: str, e: int = Query(...), s: str = Query(..., max_length=128)):
    try:
        page = await render(check_link(payout_id, e, s))
    except AppError as error:
        # Opened in a browser, so the problem is a page, not JSON.
        return HTMLResponse(
            "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
            f"<title>Statement</title><p style='font:16px system-ui;margin:24px'>{html.escape(error.message)}</p>",
            status_code=error.status,
            headers=HEADERS,
        )

    return HTMLResponse(page, headers=HEADERS)
