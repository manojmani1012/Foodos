"""Help & support for every Foodos app, and the public policy pages.

Tickets act on the signed-in person only; the role the session was issued for
(customer, restaurant owner or delivery partner) keeps each app's tickets apart.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse

from ..components.auth.dependencies import CurrentUser, require_role
from ..components.legal import pages
from ..components.support import service
from ..components.support.schemas import CreateTicketBody, TicketMessageBody
from ..errors import not_found

router = APIRouter(tags=["support"])

app_user = require_role("customer", "restaurant_owner", "delivery_partner")

# Plain pages with no scripts at all; anyone may read them, including the
# Play Store and Razorpay reviewers.
PAGE_HEADERS = {
    "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": (
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    ),
}


@router.get("/legal", response_class=HTMLResponse)
async def policies():
    return HTMLResponse(pages.render_index(), headers=PAGE_HEADERS)


@router.get("/legal/{page}", response_class=HTMLResponse)
async def policy(page: str):
    if page not in pages.PAGES:
        raise not_found("page_not_found", "That page could not be found")

    return HTMLResponse(pages.render(page), headers=PAGE_HEADERS)


@router.get("/api/v1/support/info")
async def support_info():
    return {"ok": True, **service.info()}


@router.get("/api/v1/support/tickets")
async def list_tickets(user: CurrentUser = Depends(app_user)):
    return {"ok": True, "tickets": await service.list_tickets(user.id, user.role)}


@router.post("/api/v1/support/tickets", status_code=201)
async def create_ticket(body: CreateTicketBody, user: CurrentUser = Depends(app_user)):
    ticket = await service.create_ticket(user.id, user.role, body.topic, body.message, body.orderId)

    return {"ok": True, "ticket": ticket}


@router.get("/api/v1/support/tickets/{ticket_id}")
async def get_ticket(ticket_id: str, user: CurrentUser = Depends(app_user)):
    return {"ok": True, "ticket": await service.get_ticket(user.id, ticket_id)}


@router.post("/api/v1/support/tickets/{ticket_id}/messages")
async def reply(ticket_id: str, body: TicketMessageBody, user: CurrentUser = Depends(app_user)):
    return {"ok": True, "ticket": await service.reply(user.id, ticket_id, body.message)}
