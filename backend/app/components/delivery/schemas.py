"""Request bodies for the delivery partner app."""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class OnlineBody(BaseModel):
    isOnline: bool


class LocationBody(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class PartnerProfileBody(BaseModel):
    fullName: Optional[str] = Field(default=None, min_length=1, max_length=80)
    vehicleType: Optional[Literal["bike", "scooter", "bicycle", "ev"]] = None
    vehicleNumber: Optional[str] = Field(default=None, max_length=20)
    city: Optional[str] = Field(default=None, max_length=60)


class DeliveredBody(BaseModel):
    # Cash orders only: the rider confirms the money was taken at the door.
    cashCollected: bool = False
