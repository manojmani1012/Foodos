"""Admin panel API.

Only an admin session reaches any of these: one issued by the email and
password login, never by a phone OTP. Every change is written to the activity
log with who made it and from where.
"""

import datetime
from dataclasses import dataclass
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query, Request

from ..components.admin import audit, customers, dashboard, offers, orders, payouts, restaurants, riders
from ..components.admin.schemas import (
    BlockCustomerBody,
    CancelOrderBody,
    CreateOfferBody,
    CreateRestaurantBody,
    RecordPayoutBody,
    RestaurantStatusBody,
    RiderStatusBody,
    UpdateOfferBody,
    UpdateRestaurantBody,
    UpdateRiderBody,
)
from ..components.auth.dependencies import CurrentUser, require_role

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

admin_only = require_role("admin", "super_admin")


@dataclass
class Actor:
    id: object
    ip: Optional[str]


async def acting_admin(request: Request, user: CurrentUser = Depends(admin_only)) -> Actor:
    """The admin making the change, and the address they made it from."""
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)

    return Actor(id=user.id, ip=ip)


Page = Query(default=50, ge=1, le=100)
Offset = Query(default=0, ge=0, le=100_000)


# --- Dashboard -------------------------------------------------------------


@router.get("/dashboard")
async def get_dashboard(user: CurrentUser = Depends(admin_only)):
    return {"ok": True, **await dashboard.overview()}


# --- Restaurants -----------------------------------------------------------


@router.get("/restaurants")
async def list_restaurants(
    status: Optional[Literal["pending", "active", "suspended", "rejected"]] = None,
    search: Optional[str] = Query(default=None, max_length=80),
    limit: int = Page,
    offset: int = Offset,
    user: CurrentUser = Depends(admin_only),
):
    return {"ok": True, **await restaurants.list_restaurants(status, search, limit, offset)}


@router.post("/restaurants", status_code=201)
async def create_restaurant(body: CreateRestaurantBody, actor: Actor = Depends(acting_admin)):
    return {"ok": True, "restaurant": await restaurants.create_restaurant(body, actor.id, actor.ip)}


@router.get("/restaurants/{restaurant_id}")
async def get_restaurant(restaurant_id: str, user: CurrentUser = Depends(admin_only)):
    return {"ok": True, "restaurant": await restaurants.get_restaurant(restaurant_id)}


@router.patch("/restaurants/{restaurant_id}")
async def update_restaurant(restaurant_id: str, body: UpdateRestaurantBody, actor: Actor = Depends(acting_admin)):
    return {"ok": True, "restaurant": await restaurants.update_restaurant(restaurant_id, body, actor.id, actor.ip)}


@router.post("/restaurants/{restaurant_id}/status")
async def set_restaurant_status(
    restaurant_id: str, body: RestaurantStatusBody, actor: Actor = Depends(acting_admin)
):
    restaurant = await restaurants.set_status(restaurant_id, body.status, body.reason, actor.id, actor.ip)

    return {"ok": True, "restaurant": restaurant}


@router.get("/restaurants/{restaurant_id}/menu")
async def restaurant_menu(restaurant_id: str, user: CurrentUser = Depends(admin_only)):
    return {"ok": True, "categories": await restaurants.menu(restaurant_id)}


# --- Riders ----------------------------------------------------------------


@router.get("/riders")
async def list_riders(
    status: Optional[Literal["pending", "active", "suspended", "rejected"]] = None,
    search: Optional[str] = Query(default=None, max_length=80),
    online: Optional[bool] = None,
    limit: int = Page,
    offset: int = Offset,
    user: CurrentUser = Depends(admin_only),
):
    return {"ok": True, **await riders.list_riders(status, search, online, limit, offset)}


@router.get("/riders/{rider_id}")
async def get_rider(rider_id: str, user: CurrentUser = Depends(admin_only)):
    return {"ok": True, "rider": await riders.get_rider(rider_id)}


@router.patch("/riders/{rider_id}")
async def update_rider(rider_id: str, body: UpdateRiderBody, actor: Actor = Depends(acting_admin)):
    rider = await riders.update_rider(rider_id, body.model_dump(exclude_unset=True), actor.id, actor.ip)

    return {"ok": True, "rider": rider}


@router.post("/riders/{rider_id}/status")
async def set_rider_status(rider_id: str, body: RiderStatusBody, actor: Actor = Depends(acting_admin)):
    return {"ok": True, "rider": await riders.set_status(rider_id, body.status, body.reason, actor.id, actor.ip)}


# --- Orders ----------------------------------------------------------------


@router.get("/orders")
async def list_orders(
    view: Optional[Literal["live", "delivered", "cancelled", "refund_failed"]] = None,
    search: Optional[str] = Query(default=None, max_length=80),
    restaurantId: Optional[str] = None,
    customerId: Optional[str] = None,
    riderId: Optional[str] = None,
    dateFrom: Optional[datetime.date] = Query(default=None, alias="from"),
    dateTo: Optional[datetime.date] = Query(default=None, alias="to"),
    limit: int = Page,
    offset: int = Offset,
    user: CurrentUser = Depends(admin_only),
):
    result = await orders.list_orders(
        view, search, restaurantId, customerId, riderId, dateFrom, dateTo, limit, offset
    )

    return {"ok": True, **result}


@router.get("/orders/{order_id}")
async def get_order(order_id: str, user: CurrentUser = Depends(admin_only)):
    return {"ok": True, "order": await orders.get_order(order_id)}


@router.post("/orders/{order_id}/cancel")
async def cancel_order(order_id: str, body: CancelOrderBody, actor: Actor = Depends(acting_admin)):
    return {"ok": True, "order": await orders.cancel(order_id, body.reason, actor.id, actor.ip)}


@router.post("/orders/{order_id}/refund")
async def retry_refund(order_id: str, actor: Actor = Depends(acting_admin)):
    return {"ok": True, "order": await orders.retry_refund(order_id, actor.id, actor.ip)}


# --- Customers -------------------------------------------------------------


@router.get("/customers")
async def list_customers(
    search: Optional[str] = Query(default=None, max_length=80),
    status: Optional[Literal["active", "blocked"]] = None,
    limit: int = Page,
    offset: int = Offset,
    user: CurrentUser = Depends(admin_only),
):
    return {"ok": True, **await customers.list_customers(search, status, limit, offset)}


@router.get("/customers/{customer_id}")
async def get_customer(customer_id: str, user: CurrentUser = Depends(admin_only)):
    return {"ok": True, "customer": await customers.get_customer(customer_id)}


@router.post("/customers/{customer_id}/block")
async def block_customer(customer_id: str, body: BlockCustomerBody, actor: Actor = Depends(acting_admin)):
    customer = await customers.set_blocked(customer_id, body.blocked, body.reason, actor.id, actor.ip)

    return {"ok": True, "customer": customer}


# --- Offers ----------------------------------------------------------------


@router.get("/offers")
async def list_offers(user: CurrentUser = Depends(admin_only)):
    return {"ok": True, "offers": await offers.list_offers()}


@router.post("/offers", status_code=201)
async def create_offer(body: CreateOfferBody, actor: Actor = Depends(acting_admin)):
    return {"ok": True, "offer": await offers.create_offer(body, actor.id, actor.ip)}


@router.patch("/offers/{offer_id}")
async def update_offer(offer_id: str, body: UpdateOfferBody, actor: Actor = Depends(acting_admin)):
    return {"ok": True, "offer": await offers.update_offer(offer_id, body, actor.id, actor.ip)}


# --- Payouts ---------------------------------------------------------------


@router.get("/payouts/statement")
async def payout_statement(
    party: Literal["restaurant", "delivery_partner"],
    dateFrom: datetime.date = Query(alias="from"),
    dateTo: datetime.date = Query(alias="to"),
    user: CurrentUser = Depends(admin_only),
):
    return {"ok": True, **await payouts.statement(party, dateFrom, dateTo)}


@router.get("/payouts")
async def payout_history(
    party: Optional[Literal["restaurant", "delivery_partner"]] = None,
    limit: int = Page,
    offset: int = Offset,
    user: CurrentUser = Depends(admin_only),
):
    return {"ok": True, **await payouts.history(party, limit, offset)}


@router.post("/payouts", status_code=201)
async def record_payout(body: RecordPayoutBody, actor: Actor = Depends(acting_admin)):
    return {"ok": True, **await payouts.record(body, actor.id, actor.ip)}


# --- Activity log ----------------------------------------------------------


@router.get("/activity")
async def activity(
    module: Optional[str] = Query(default=None, max_length=40),
    entityId: Optional[str] = Query(default=None, max_length=60),
    limit: int = Page,
    offset: int = Offset,
    user: CurrentUser = Depends(admin_only),
):
    return {"ok": True, **await audit.list_activity(module, entityId, limit, offset)}
