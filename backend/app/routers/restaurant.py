"""Restaurant partner app: dashboard, order queue and menu management.

Every route is scoped to the restaurant the signed-in owner owns, resolved once
by the `owned_restaurant` dependency.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query

from ..components.auth.dependencies import CurrentUser, require_role
from ..components.restaurants import menu as menu_service
from ..components.restaurants import portal
from ..components.restaurants.portal_schemas import (
    AcceptingOrdersBody,
    CategoryBody,
    CreateItemBody,
    RejectOrderBody,
    UpdateItemBody,
)

router = APIRouter(prefix="/api/v1/restaurant", tags=["restaurant"])

owner_only = require_role("restaurant_owner")


async def owned_restaurant(user: CurrentUser = Depends(owner_only)) -> Any:
    """Resolves the caller's restaurant, so no route takes an id from the client
    and no owner can reach another restaurant's data."""
    return await portal.resolve_owned_restaurant(user.id)


@router.get("/me")
async def me(restaurant: Any = Depends(owned_restaurant)):
    return {"ok": True, "restaurant": portal.restaurant_to_dict(restaurant)}


@router.patch("/settings")
async def update_settings(body: AcceptingOrdersBody, restaurant: Any = Depends(owned_restaurant)):
    updated = await portal.set_accepting_orders(restaurant["id"], body.isAcceptingOrders)

    return {"ok": True, "restaurant": updated}


@router.get("/dashboard")
async def dashboard(restaurant: Any = Depends(owned_restaurant)):
    return {"ok": True, **await portal.dashboard(restaurant["id"])}


# --- Order queue -----------------------------------------------------------


@router.get("/orders")
async def list_orders(
    queue: Optional[str] = Query(default=None, pattern="^(new|preparing|ready)$"),
    limit: int = Query(default=50, ge=1, le=100),
    restaurant: Any = Depends(owned_restaurant),
):
    return {"ok": True, **await portal.list_orders(restaurant["id"], queue, limit)}


@router.get("/orders/{order_id}")
async def get_order(order_id: str, restaurant: Any = Depends(owned_restaurant)):
    return {"ok": True, "order": await portal.get_order(restaurant["id"], order_id)}


@router.post("/orders/{order_id}/accept")
async def accept_order(
    order_id: str,
    user: CurrentUser = Depends(owner_only),
    restaurant: Any = Depends(owned_restaurant),
):
    order = await portal.accept_order(restaurant["id"], order_id, user.id)

    return {"ok": True, "order": order}


@router.post("/orders/{order_id}/reject")
async def reject_order(
    order_id: str,
    body: RejectOrderBody,
    user: CurrentUser = Depends(owner_only),
    restaurant: Any = Depends(owned_restaurant),
):
    order = await portal.reject_order(restaurant["id"], order_id, user.id, body.reason)

    return {"ok": True, "order": order}


@router.post("/orders/{order_id}/ready")
async def mark_ready(
    order_id: str,
    user: CurrentUser = Depends(owner_only),
    restaurant: Any = Depends(owned_restaurant),
):
    order = await portal.mark_ready(restaurant["id"], order_id, user.id)

    return {"ok": True, "order": order}


# --- Menu ------------------------------------------------------------------


@router.get("/menu")
async def get_menu(restaurant: Any = Depends(owned_restaurant)):
    return {"ok": True, **await menu_service.list_menu(restaurant["id"])}


@router.post("/menu/categories", status_code=201)
async def create_category(body: CategoryBody, restaurant: Any = Depends(owned_restaurant)):
    category = await menu_service.create_category(restaurant["id"], body.name, body.sortOrder)

    return {"ok": True, "category": category}


@router.post("/menu/items", status_code=201)
async def create_item(body: CreateItemBody, restaurant: Any = Depends(owned_restaurant)):
    item = await menu_service.create_item(restaurant["id"], body)

    return {"ok": True, "item": item}


@router.patch("/menu/items/{item_id}")
async def update_item(
    item_id: str, body: UpdateItemBody, restaurant: Any = Depends(owned_restaurant)
):
    item = await menu_service.update_item(restaurant["id"], item_id, body)

    return {"ok": True, "item": item}


@router.delete("/menu/items/{item_id}")
async def delete_item(item_id: str, restaurant: Any = Depends(owned_restaurant)):
    await menu_service.delete_item(restaurant["id"], item_id)

    return {"ok": True}
