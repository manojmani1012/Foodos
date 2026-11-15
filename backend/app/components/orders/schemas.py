"""Request bodies for cart pricing and checkout.

Note what is absent: no prices. The client sends what was chosen, never what it
costs, so a tampered request cannot change what is charged.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from ..geo import in_india


class CartItem(BaseModel):
    menuItemId: str
    quantity: int = Field(ge=1, le=20)
    addonIds: list[str] = Field(default_factory=list, max_length=10)


class QuoteBody(BaseModel):
    items: list[CartItem] = Field(min_length=1, max_length=50)
    couponCode: Optional[str] = Field(default=None, max_length=40)
    # The address the cart is heading to, so the cart can say up front when
    # the restaurant does not deliver there.
    addressId: Optional[str] = None


class AddressBody(BaseModel):
    """A delivery address. The map pin is required: it is what the rider
    navigates to, and what decides which restaurants deliver here. The text is
    for the rider at the door: house or flat, area, landmark."""

    label: str = Field(default="Home", max_length=40)
    line1: str = Field(min_length=2, max_length=200)
    line2: Optional[str] = Field(default=None, max_length=200)
    landmark: Optional[str] = Field(default=None, max_length=120)
    city: str = Field(min_length=2, max_length=80)
    pincode: Optional[str] = Field(default=None, max_length=12)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    isDefault: bool = False

    @model_validator(mode="after")
    def _pin_in_india(self) -> "AddressBody":
        if not in_india(self.latitude, self.longitude):
            raise ValueError("That pin is outside India. Move it to your address")

        return self


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


class UpdateProfileBody(BaseModel):
    """Every field optional: only what is sent is changed."""

    fullName: Optional[str] = Field(default=None, max_length=120)
    email: Optional[str] = Field(default=None, max_length=200)
    avatarUrl: Optional[str] = Field(default=None, max_length=500)


class ReviewOrderBody(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = Field(default=None, max_length=500)


class ConfirmPaymentBody(BaseModel):
    """Exactly what Razorpay's checkout hands back."""

    razorpayOrderId: str = Field(min_length=4, max_length=120)
    razorpayPaymentId: str = Field(min_length=4, max_length=120)
    razorpaySignature: str = Field(min_length=16, max_length=256)
