"""Request bodies for the delivery partner app."""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class OnlineBody(BaseModel):
    isOnline: bool


class LocationBody(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    # Android says when the position comes from a fake GPS app.
    mocked: bool = False


class PartnerProfileBody(BaseModel):
    fullName: Optional[str] = Field(default=None, min_length=1, max_length=80)
    vehicleType: Optional[Literal["bike", "scooter", "bicycle", "ev"]] = None
    vehicleNumber: Optional[str] = Field(default=None, max_length=20)
    city: Optional[str] = Field(default=None, max_length=60)


class StepBody(BaseModel):
    """Sent with each delivery step. All optional, so an older app that sends
    nothing still gets a clear answer rather than a validation error."""

    # Where the phone is right now: "reached" and "arrived" are only accepted
    # near the pin. Accuracy is the phone's own estimate, in metres.
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    accuracy: Optional[float] = Field(default=None, ge=0, le=5000)
    # The position came from a fake GPS app (Android tells the app so).
    mocked: bool = False
    # "Delivered" only: cash orders confirm the money was taken at the door,
    # and the customer's 4-digit code proves the food reached them.
    cashCollected: bool = False
    code: Optional[str] = Field(default=None, max_length=8)
