"""Request bodies for the restaurant partner app."""

import re
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class AcceptingOrdersBody(BaseModel):
    isAcceptingOrders: bool


class RejectOrderBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=300)


class CategoryBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    sortOrder: int = Field(default=0, ge=0, le=999)


class AddonBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    pricePaise: int = Field(ge=0, le=10_000_00)


class CreateItemBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    pricePaise: int = Field(ge=0, le=10_000_00)
    categoryId: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=500)
    imageUrl: Optional[str] = Field(default=None, max_length=500)
    isVeg: bool = False
    isAvailable: bool = True
    sortOrder: int = Field(default=0, ge=0, le=999)
    addons: list[AddonBody] = Field(default_factory=list, max_length=10)


class UpdateItemBody(BaseModel):
    """Every field is optional: only what is sent gets changed.

    `exclude_unset` in the service distinguishes "not mentioned" from
    "explicitly set to null", so clearing a description is possible.
    """

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    pricePaise: Optional[int] = Field(default=None, ge=0, le=10_000_00)
    categoryId: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=500)
    imageUrl: Optional[str] = Field(default=None, max_length=500)
    isVeg: Optional[bool] = None
    isAvailable: Optional[bool] = None
    sortOrder: Optional[int] = Field(default=None, ge=0, le=999)


TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class OutletProfileBody(BaseModel):
    """What an owner may change themselves. Name, address and cuisines change
    what customers search for and where riders go, so those stay with Foodos."""

    description: Optional[str] = Field(default=None, max_length=300)
    phone: Optional[str] = Field(default=None, max_length=20)
    # "HH:MM", 24-hour. Both null means "no fixed hours".
    opensAt: Optional[str] = None
    closesAt: Optional[str] = None
    avgPrepMinutes: Optional[int] = Field(default=None, ge=5, le=120)

    @field_validator("opensAt", "closesAt")
    @classmethod
    def _valid_time(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value == "":
            return None

        if not TIME_PATTERN.match(value):
            raise ValueError("Use a 24-hour time like 09:30")

        return value


class AddonsBody(BaseModel):
    """The complete add-on list for a dish; it replaces what was there."""

    addons: list[AddonBody] = Field(default_factory=list, max_length=15)
