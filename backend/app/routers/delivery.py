"""Delivery partner app: going online, taking deliveries, and getting paid.

Every route acts on the signed-in rider only; there is no rider id in any path.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query

from ..components.auth.dependencies import CurrentUser, require_role
from ..components.delivery import service
from ..components.delivery.schemas import (
    DeliveredBody,
    LocationBody,
    OnlineBody,
    PartnerProfileBody,
)

router = APIRouter(prefix="/api/v1/delivery", tags=["delivery"])

rider_only = require_role("delivery_partner")


@router.get("/me")
async def me(user: CurrentUser = Depends(rider_only)):
    return {"ok": True, "partner": await service.profile(user.id)}


@router.patch("/me")
async def update_me(body: PartnerProfileBody, user: CurrentUser = Depends(rider_only)):
    partner = await service.update_profile(user.id, body.model_dump(exclude_unset=True))

    return {"ok": True, "partner": partner}


@router.post("/online")
async def set_online(body: OnlineBody, user: CurrentUser = Depends(rider_only)):
    return {"ok": True, "partner": await service.set_online(user.id, body.isOnline)}


@router.post("/location")
async def update_location(body: LocationBody, user: CurrentUser = Depends(rider_only)):
    await service.update_location(user.id, body.latitude, body.longitude)

    return {"ok": True}


@router.get("/requests")
async def requests(user: CurrentUser = Depends(rider_only)):
    return {"ok": True, "requests": await service.open_requests(user.id)}


@router.get("/active")
async def active(user: CurrentUser = Depends(rider_only)):
    return {"ok": True, **await service.active(user.id)}


@router.post("/deliveries/{delivery_id}/accept")
async def accept(delivery_id: str, user: CurrentUser = Depends(rider_only)):
    return {"ok": True, **await service.accept(user.id, delivery_id)}


@router.post("/deliveries/{delivery_id}/reject")
async def reject(delivery_id: str, user: CurrentUser = Depends(rider_only)):
    await service.reject(user.id, delivery_id)

    return {"ok": True}


@router.post("/deliveries/{delivery_id}/reached")
async def reached(delivery_id: str, user: CurrentUser = Depends(rider_only)):
    return {"ok": True, **await service.advance(user.id, delivery_id, "reached")}


@router.post("/deliveries/{delivery_id}/picked-up")
async def picked_up(delivery_id: str, user: CurrentUser = Depends(rider_only)):
    return {"ok": True, **await service.advance(user.id, delivery_id, "picked-up")}


@router.post("/deliveries/{delivery_id}/arrived")
async def arrived(delivery_id: str, user: CurrentUser = Depends(rider_only)):
    return {"ok": True, **await service.advance(user.id, delivery_id, "arrived")}


@router.post("/deliveries/{delivery_id}/delivered")
async def delivered(
    delivery_id: str, body: Optional[DeliveredBody] = None, user: CurrentUser = Depends(rider_only)
):
    # A prepaid order has nothing to confirm, so the body is optional.
    cash_collected = body.cashCollected if body else False

    return {
        "ok": True,
        **await service.advance(user.id, delivery_id, "delivered", cash_collected=cash_collected),
    }


@router.get("/earnings")
async def earnings(days: int = Query(default=7, ge=1, le=90), user: CurrentUser = Depends(rider_only)):
    return {"ok": True, **await service.earnings(user.id, days)}


@router.get("/history")
async def history(user: CurrentUser = Depends(rider_only)):
    return {"ok": True, "deliveries": await service.history(user.id)}
