"""Request bodies for the restaurant partner app."""

from typing import Optional

from pydantic import BaseModel, Field


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
