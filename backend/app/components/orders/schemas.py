"""Request bodies for cart pricing and checkout.

Note what is absent: no prices. The client sends what was chosen, never what it
costs, so a tampered request cannot change what is charged.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class CartItem(BaseModel):
    menuItemId: str
    quantity: int = Field(ge=1, le=20)
    addonIds: list[str] = Field(default_factory=list, max_length=10)


class QuoteBody(BaseModel):
    items: list[CartItem] = Field(min_length=1, max_length=50)
    couponCode: Optional[str] = Field(default=None, max_length=40)


class AddressBody(BaseModel):
    label: str = Field(default="Home", max_length=40)
    line1: str = Field(min_length=1, max_length=200)
    line2: Optional[str] = Field(default=None, max_length=200)
    city: str = Field(min_length=1, max_length=80)
    pincode: Optional[str] = Field(default=None, max_length=12)
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    isDefault: bool = False


class PlaceOrderBody(BaseModel):
    items: list[CartItem] = Field(min_length=1, max_length=50)
    paymentMethod: Literal["cod", "upi", "card", "wallet"] = "cod"
    couponCode: Optional[str] = Field(default=None, max_length=40)
    addressId: Optional[str] = None
    address: Optional[AddressBody] = None
    specialInstructions: Optional[str] = Field(default=None, max_length=500)
    tipPaise: int = Field(default=0, ge=0, le=100000)
    # Generated per checkout attempt by the client, so a retry after a dropped
    # connection returns the original order instead of placing a second one.
    idempotencyKey: Optional[str] = Field(default=None, min_length=8, max_length=100)


class CancelOrderBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=300)
