"""Push notification sign-up for the three apps.

After signing in, an app sends its Expo push token here; before signing out it
removes it, so the next person to use that phone does not get the previous
person's notifications.
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from ..components.auth.dependencies import CurrentUser, require_role
from ..components.notifications import push

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])

app_user = require_role("customer", "restaurant_owner", "delivery_partner")


class PushTokenBody(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    platform: Optional[Literal["android", "ios"]] = None

    @field_validator("token")
    @classmethod
    def _expo_token(cls, value: str) -> str:
        if not push.is_valid_token(value):
            raise ValueError("Not an Expo push token")

        return value


@router.put("/push-token")
async def register_push_token(body: PushTokenBody, user: CurrentUser = Depends(app_user)):
    await push.register(user.id, user.role, body.token, body.platform)

    return {"ok": True}


@router.post("/push-token/remove")
async def remove_push_token(body: PushTokenBody, user: CurrentUser = Depends(app_user)):
    await push.unregister(user.id, body.token)

    return {"ok": True}
