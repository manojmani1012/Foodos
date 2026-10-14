"""Request bodies for the admin panel.

The database has its own checks on all of these. Validating here as well means
a mistake comes back as a message next to the field, not a 500.
"""

import datetime
import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

# The FSSAI licence number is 14 digits; a GSTIN is 15 characters in a fixed
# shape (state code, PAN, entity number, Z, check character).
FSSAI_PATTERN = re.compile(r"^\d{14}$")
GSTIN_PATTERN = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
PINCODE_PATTERN = re.compile(r"^[1-9]\d{5}$")
OFFER_CODE_PATTERN = re.compile(r"^[A-Z0-9]{3,20}$")

# Roughly India, so a swapped latitude and longitude, or a pin dropped in the
# sea off Africa, is caught before riders are sent there.
INDIA_LATITUDE = (6.0, 37.5)
INDIA_LONGITUDE = (68.0, 97.5)


def _blank_to_none(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None

    value = value.strip()

    return value or None


def _check_location(latitude: Optional[float], longitude: Optional[float]) -> None:
    if (latitude is None) != (longitude is None):
        raise ValueError("Set both latitude and longitude, or neither")

    if latitude is None:
        return

    if not INDIA_LATITUDE[0] <= latitude <= INDIA_LATITUDE[1] or not INDIA_LONGITUDE[0] <= longitude <= INDIA_LONGITUDE[1]:
        raise ValueError("That location is outside India. Check the pin on the map")


class RestaurantFields(BaseModel):
    """Fields shared by onboarding and editing a restaurant."""

    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    description: Optional[str] = Field(default=None, max_length=300)
    cuisines: Optional[list[str]] = Field(default=None, min_length=1, max_length=6)
    addressLine: Optional[str] = Field(default=None, min_length=2, max_length=160)
    city: Optional[str] = Field(default=None, min_length=2, max_length=60)
    pincode: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    phone: Optional[str] = Field(default=None, max_length=20)
    isVeg: Optional[bool] = None
    fssaiNumber: Optional[str] = None
    gstNumber: Optional[str] = None
    commissionPct: Optional[float] = Field(default=None, ge=0, le=100)
    avgPrepMinutes: Optional[int] = Field(default=None, ge=5, le=120)

    @field_validator("description", "phone", "pincode", "fssaiNumber", "gstNumber")
    @classmethod
    def _strip(cls, value: Optional[str]) -> Optional[str]:
        return _blank_to_none(value)

    @field_validator("cuisines")
    @classmethod
    def _clean_cuisines(cls, value: Optional[list[str]]) -> Optional[list[str]]:
        if value is None:
            return None

        cleaned: list[str] = []

        for cuisine in value:
            cuisine = cuisine.strip()

            if not cuisine:
                continue

            if len(cuisine) > 30:
                raise ValueError("Keep each cuisine under 30 characters")

            if cuisine.lower() not in (c.lower() for c in cleaned):
                cleaned.append(cuisine)

        if not cleaned:
            raise ValueError("Add at least one cuisine")

        return cleaned

    @field_validator("pincode")
    @classmethod
    def _valid_pincode(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and not PINCODE_PATTERN.match(value):
            raise ValueError("Enter the 6-digit PIN code")

        return value

    @field_validator("fssaiNumber")
    @classmethod
    def _valid_fssai(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and not FSSAI_PATTERN.match(value):
            raise ValueError("The FSSAI licence number is 14 digits")

        return value

    @field_validator("gstNumber")
    @classmethod
    def _valid_gstin(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None

        value = value.upper()

        if not GSTIN_PATTERN.match(value):
            raise ValueError("Enter a valid 15-character GSTIN, like 33ABCDE1234F1Z5")

        return value

    @model_validator(mode="after")
    def _valid_location(self) -> "RestaurantFields":
        # Only checked when either is being set: an edit that leaves both
        # untouched sends neither.
        if "latitude" in self.model_fields_set or "longitude" in self.model_fields_set:
            _check_location(self.latitude, self.longitude)

        return self


class CreateRestaurantBody(RestaurantFields):
    ownerPhone: str = Field(min_length=6, max_length=20)
    ownerName: str = Field(min_length=2, max_length=80)
    name: str = Field(min_length=2, max_length=80)
    cuisines: list[str] = Field(min_length=1, max_length=6)
    addressLine: str = Field(min_length=2, max_length=160)
    city: str = Field(min_length=2, max_length=60)
    isVeg: bool = False
    commissionPct: float = Field(default=20, ge=0, le=100)
    avgPrepMinutes: int = Field(default=30, ge=5, le=120)


class UpdateRestaurantBody(RestaurantFields):
    """Only the fields sent are changed. Sending latitude and longitude as null
    takes the restaurant off the map."""

    ownerName: Optional[str] = Field(default=None, min_length=2, max_length=80)


class RestaurantStatusBody(BaseModel):
    status: Literal["active", "suspended", "rejected"]
    reason: Optional[str] = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _reason_when_taking_away(self) -> "RestaurantStatusBody":
        self.reason = _blank_to_none(self.reason)

        if self.status != "active" and not self.reason:
            raise ValueError("Give a reason, so the team knows why later")

        return self


class RiderStatusBody(RestaurantStatusBody):
    pass


class UpdateRiderBody(BaseModel):
    fullName: Optional[str] = Field(default=None, min_length=2, max_length=80)
    city: Optional[str] = Field(default=None, min_length=2, max_length=60)
    vehicleType: Optional[Literal["bike", "scooter", "bicycle", "ev"]] = None
    vehicleNumber: Optional[str] = Field(default=None, max_length=20)

    @field_validator("vehicleNumber")
    @classmethod
    def _upper(cls, value: Optional[str]) -> Optional[str]:
        value = _blank_to_none(value)

        return value.upper() if value else None


class CancelOrderBody(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


class BlockCustomerBody(BaseModel):
    blocked: bool
    reason: Optional[str] = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _reason_when_blocking(self) -> "BlockCustomerBody":
        self.reason = _blank_to_none(self.reason)

        if self.blocked and not self.reason:
            raise ValueError("Give a reason for blocking this account")

        return self


class OfferFields(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=60)
    code: Optional[str] = None
    type: Optional[Literal["percent", "flat", "free_delivery"]] = None
    percentOff: Optional[float] = Field(default=None, gt=0, le=100)
    flatOffPaise: Optional[int] = Field(default=None, gt=0, le=10_000_00)
    maxDiscountPaise: Optional[int] = Field(default=None, gt=0, le=10_000_00)
    minOrderPaise: Optional[int] = Field(default=None, ge=0, le=100_000_00)
    firstOrderOnly: Optional[bool] = None
    restaurantId: Optional[str] = None
    usageLimit: Optional[int] = Field(default=None, gt=0, le=10_000_000)
    perUserLimit: Optional[int] = Field(default=None, ge=1, le=100)
    validFrom: Optional[datetime.datetime] = None
    validUntil: Optional[datetime.datetime] = None
    isActive: Optional[bool] = None

    @field_validator("code")
    @classmethod
    def _valid_code(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None

        value = value.strip().upper()

        if not OFFER_CODE_PATTERN.match(value):
            raise ValueError("Use 3 to 20 letters and numbers, no spaces")

        return value

    @field_validator("restaurantId")
    @classmethod
    def _blank_restaurant(cls, value: Optional[str]) -> Optional[str]:
        return _blank_to_none(value)

    @field_validator("validFrom", "validUntil")
    @classmethod
    def _aware(cls, value: Optional[datetime.datetime]) -> Optional[datetime.datetime]:
        # A browser date with no zone is taken as India time, which is what
        # the person typing it meant.
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=datetime.timezone(datetime.timedelta(hours=5, minutes=30)))

        return value


class CreateOfferBody(OfferFields):
    name: str = Field(min_length=2, max_length=60)
    code: str
    type: Literal["percent", "flat", "free_delivery"]
    minOrderPaise: int = Field(default=0, ge=0, le=100_000_00)
    firstOrderOnly: bool = False
    perUserLimit: int = Field(default=1, ge=1, le=100)
    isActive: bool = True


class UpdateOfferBody(OfferFields):
    pass


class RecordPayoutBody(BaseModel):
    partyType: Literal["restaurant", "delivery_partner"]
    partyId: str
    periodStart: datetime.date
    periodEnd: datetime.date
    reference: str = Field(min_length=4, max_length=60)

    @model_validator(mode="after")
    def _valid_period(self) -> "RecordPayoutBody":
        self.reference = self.reference.strip()

        if self.periodEnd < self.periodStart:
            raise ValueError("The period ends before it starts")

        return self
