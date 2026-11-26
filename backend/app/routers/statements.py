"""Printable payout statements, opened in the phone's browser through a
short-lived signed link (see components/payouts/statements.py). The page has
no scripts, so the policy below allows none."""

import html
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse, Response

from ..components.payouts.statements import check_link, render, render_pdf
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
async def get_statement(
    payout_id: str,
    e: int = Query(...),
    s: str = Query(..., max_length=128),
    format: Literal["html", "pdf"] = "html",
):
    try:
        identifier = check_link(payout_id, e, s)

        if format == "pdf":
            filename, content = await render_pdf(identifier)

            return Response(
                content=content,
                media_type="application/pdf",
                headers={**HEADERS, "Content-Disposition": f'attachment; filename="{filename}"'},
            )

        page = await render(identifier, f"?e={e}&s={quote(s)}&format=pdf")
    except AppError as error:
        # Opened in a browser, so the problem is a page, not JSON.
        return HTMLResponse(
            "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
            f"<title>Statement</title><p style='font:16px system-ui;margin:24px'>{html.escape(error.message)}</p>",
            status_code=error.status,
            headers=HEADERS,
        )

    return HTMLResponse(page, headers=HEADERS)
