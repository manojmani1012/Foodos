"""Restaurant partner app: dashboard, order queue and menu management.

Every route is scoped to the restaurant the signed-in owner owns, resolved once
by the `owned_restaurant` dependency.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile

from ..components.auth.dependencies import CurrentUser, require_role
from ..components.media.service import MAX_IMAGE_BYTES
from ..components.restaurants import menu as menu_service
from ..components.restaurants import portal
from ..components.restaurants.portal_schemas import (
    AcceptingOrdersBody,
    AddonsBody,
    CategoryBody,
    CreateItemBody,
    OutletProfileBody,
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
    queue: Optional[str] = Query(default=None, pattern="^(new|preparing|ready|past)$"),
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


@router.put("/menu/items/{item_id}/image")
async def upload_item_image(
    item_id: str,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(owner_only),
    restaurant: Any = Depends(owned_restaurant),
):
    # Read one byte past the limit: enough to tell "too big" without pulling a
    # huge upload into memory.
    data = await file.read(MAX_IMAGE_BYTES + 1)
    item = await menu_service.set_item_image(restaurant["id"], user.id, item_id, data)

    return {"ok": True, "item": item}


@router.delete("/menu/items/{item_id}/image")
async def remove_item_image(
    item_id: str,
    user: CurrentUser = Depends(owner_only),
    restaurant: Any = Depends(owned_restaurant),
):
    item = await menu_service.clear_item_image(restaurant["id"], user.id, item_id)

    return {"ok": True, "item": item}


# --- Outlet --------------------------------------------------------------


@router.patch("/profile")
async def update_profile(body: OutletProfileBody, restaurant: Any = Depends(owned_restaurant)):
    updated = await portal.update_profile(restaurant["id"], body.model_dump(exclude_unset=True))

    return {"ok": True, "restaurant": updated}


@router.put("/image")
async def upload_cover(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(owner_only),
    restaurant: Any = Depends(owned_restaurant),
):
    data = await file.read(MAX_IMAGE_BYTES + 1)
    updated = await portal.set_cover_image(restaurant["id"], user.id, data)

    return {"ok": True, "restaurant": updated}


@router.delete("/image")
async def remove_cover(user: CurrentUser = Depends(owner_only), restaurant: Any = Depends(owned_restaurant)):
    updated = await portal.set_cover_image(restaurant["id"], user.id, None)

    return {"ok": True, "restaurant": updated}


@router.get("/reviews")
async def get_reviews(restaurant: Any = Depends(owned_restaurant)):
    return {"ok": True, **await portal.reviews(restaurant["id"])}


@router.get("/earnings")
async def get_earnings(
    days: int = Query(default=7, ge=1, le=90),
    restaurant: Any = Depends(owned_restaurant),
):
    return {"ok": True, **await portal.earnings(restaurant["id"], float(restaurant["commission_pct"]), days)}


@router.put("/menu/items/{item_id}/addons")
async def replace_item_addons(
    item_id: str, body: AddonsBody, restaurant: Any = Depends(owned_restaurant)
):
    item = await menu_service.replace_addons(restaurant["id"], item_id, body.addons)

    return {"ok": True, "item": item}
