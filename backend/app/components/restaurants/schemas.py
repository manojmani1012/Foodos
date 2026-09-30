"""Response shapes for restaurant and menu browsing.

Money is always paise (integer), matching the database and Razorpay. Clients
divide by 100 for display, so no rounding error creeps in over the wire.
"""

from typing import Optional

from pydantic import BaseModel


class MenuAddon(BaseModel):
    id: str
    name: str
    pricePaise: int
    isAvailable: bool


class MenuItem(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    pricePaise: int
    imageUrl: Optional[str] = None
    isVeg: bool
    isAvailable: bool
    rating: Optional[float] = None
    ratingCount: int
    addons: list[MenuAddon] = []


class MenuCategory(BaseModel):
    id: str
    name: str
    items: list[MenuItem] = []


class RestaurantSummary(BaseModel):
    id: str
    name: str
    cuisines: list[str]
    rating: float
    ratingCount: int
    imageUrl: Optional[str] = None
    isVeg: bool
    addressLine: str
    city: str
    # The screens show a range ("30-40 min"), derived from the kitchen's average
    # preparation time plus an allowance for the ride.
    etaMinMinutes: int
    etaMaxMinutes: int
    deliveryFeePaise: int
    isAcceptingOrders: bool
    isFavourite: bool = False


class RestaurantDetail(RestaurantSummary):
    description: Optional[str] = None
    phone: Optional[str] = None
    opensAt: Optional[str] = None
    closesAt: Optional[str] = None
    categories: list[MenuCategory] = []


class RestaurantList(BaseModel):
    ok: bool = True
    restaurants: list[RestaurantSummary]
    total: int
    limit: int
    offset: int


class Offer(BaseModel):
    id: str
    name: str
    code: str
    type: str
    percentOff: Optional[float] = None
    flatOffPaise: Optional[int] = None
    maxDiscountPaise: Optional[int] = None
    minOrderPaise: int
    firstOrderOnly: bool
    restaurantId: Optional[str] = None
