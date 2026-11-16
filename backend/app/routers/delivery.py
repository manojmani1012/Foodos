"""Delivery partner app: going online, taking deliveries, and getting paid.

Every route acts on the signed-in rider only; there is no rider id in any path.
"""

from typing import Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile

from ..components.auth.dependencies import CurrentUser, require_role
from ..components.delivery import documents, service
from ..components.delivery.schemas import (
    LocationBody,
    OnlineBody,
    PartnerProfileBody,
    StepBody,
)
from ..components.media.service import MAX_IMAGE_BYTES

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
    await service.update_location(user.id, body.latitude, body.longitude, body.mocked)

    return {"ok": True}


@router.get("/documents")
async def list_documents(user: CurrentUser = Depends(rider_only)):
    return {"ok": True, "documents": await documents.list_documents(user.id)}


@router.post("/documents/{doc_type}")
async def upload_document(doc_type: str, file: UploadFile = File(...), user: CurrentUser = Depends(rider_only)):
    # One byte past the limit is enough to tell "too big" without reading it all.
    data = await file.read(MAX_IMAGE_BYTES + 1)

    return {"ok": True, "documents": await documents.upload(user.id, doc_type, data)}


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


# The four steps of a delivery. Each may carry the phone's position; "delivered"
# also carries the cash confirmation and the customer's code.
async def _step(delivery_id: str, action: str, body: Optional[StepBody], user: CurrentUser) -> dict:
    body = body or StepBody()

    return {
        "ok": True,
        **await service.advance(
            user.id,
            delivery_id,
            action,
            cash_collected=body.cashCollected,
            latitude=body.latitude,
            longitude=body.longitude,
            accuracy=body.accuracy,
            code=body.code,
            mocked=body.mocked,
        ),
    }


@router.post("/deliveries/{delivery_id}/reached")
async def reached(delivery_id: str, body: Optional[StepBody] = None, user: CurrentUser = Depends(rider_only)):
    return await _step(delivery_id, "reached", body, user)


@router.post("/deliveries/{delivery_id}/picked-up")
async def picked_up(delivery_id: str, body: Optional[StepBody] = None, user: CurrentUser = Depends(rider_only)):
    return await _step(delivery_id, "picked-up", body, user)


@router.post("/deliveries/{delivery_id}/arrived")
async def arrived(delivery_id: str, body: Optional[StepBody] = None, user: CurrentUser = Depends(rider_only)):
    return await _step(delivery_id, "arrived", body, user)


@router.post("/deliveries/{delivery_id}/delivered")
async def delivered(delivery_id: str, body: Optional[StepBody] = None, user: CurrentUser = Depends(rider_only)):
    return await _step(delivery_id, "delivered", body, user)


@router.get("/earnings")
async def earnings(days: int = Query(default=7, ge=1, le=90), user: CurrentUser = Depends(rider_only)):
    return {"ok": True, **await service.earnings(user.id, days)}


@router.get("/history")
async def history(user: CurrentUser = Depends(rider_only)):
    return {"ok": True, "deliveries": await service.history(user.id)}
