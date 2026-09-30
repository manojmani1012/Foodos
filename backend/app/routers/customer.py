"""Customer-facing browsing: restaurants, menus, offers and favourites.

Browsing is open to anyone so the app is useful before signing in. Favourites
belong to a person, so they require a customer session.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query

from ..components.auth.dependencies import CurrentUser, optional_authenticate, require_role
from ..components.orders import addresses as address_service
from ..components.orders import service as order_service
from ..components.orders.pricing import quote_cart
from ..components.orders.schemas import (
    AddressBody,
    CancelOrderBody,
    PlaceOrderBody,
    QuoteBody,
)
from ..components.restaurants import service
from ..components.restaurants.schemas import Offer, RestaurantDetail, RestaurantList, RestaurantSummary

router = APIRouter(prefix="/api/v1/customer", tags=["customer"])

customer_only = require_role("customer")


@router.get("/restaurants", response_model=RestaurantList)
async def list_restaurants(
    city: Optional[str] = Query(default=None, description="Exact city name, e.g. Chennai"),
    search: Optional[str] = Query(default=None, description="Matches restaurant name or cuisine"),
    cuisine: Optional[str] = Query(default=None, description="Filter by a single cuisine"),
    vegOnly: bool = Query(default=False, description="Only pure-veg restaurants"),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    user: Optional[CurrentUser] = Depends(optional_authenticate),
):
    result = await service.list_restaurants(
        city=city,
        search=search,
        cuisine=cuisine,
        veg_only=vegOnly,
        limit=limit,
        offset=offset,
        user_id=user.id if user else None,
    )

    return RestaurantList(**result)


@router.get("/cuisines")
async def list_cuisines(city: Optional[str] = Query(default=None)):
    return {"ok": True, "cuisines": await service.list_cuisines(city)}


@router.get("/offers", response_model=None)
async def list_offers(restaurantId: Optional[str] = Query(default=None)) -> dict:
    offers: list[Offer] = await service.list_offers(restaurantId)

    return {"ok": True, "offers": offers}


@router.get("/favourites")
async def list_favourites(user: CurrentUser = Depends(customer_only)):
    favourites: list[RestaurantSummary] = await service.list_favourites(user.id)

    return {"ok": True, "restaurants": favourites}


@router.put("/favourites/{restaurant_id}")
async def add_favourite(restaurant_id: str, user: CurrentUser = Depends(customer_only)):
    await service.set_favourite(user.id, restaurant_id, True)

    return {"ok": True, "isFavourite": True}


@router.delete("/favourites/{restaurant_id}")
async def remove_favourite(restaurant_id: str, user: CurrentUser = Depends(customer_only)):
    await service.set_favourite(user.id, restaurant_id, False)

    return {"ok": True, "isFavourite": False}


# Declared after /favourites and /cuisines so those literal paths are matched
# first rather than being captured as a restaurant id.
@router.get("/restaurants/{restaurant_id}", response_model=RestaurantDetail)
async def get_restaurant(
    restaurant_id: str,
    user: Optional[CurrentUser] = Depends(optional_authenticate),
):
    return await service.get_restaurant(restaurant_id, user.id if user else None)


# --- Addresses -------------------------------------------------------------


@router.get("/addresses")
async def list_addresses(user: CurrentUser = Depends(customer_only)):
    return {"ok": True, "addresses": await address_service.list_addresses(user.id)}


@router.post("/addresses", status_code=201)
async def add_address(body: AddressBody, user: CurrentUser = Depends(customer_only)):
    return {"ok": True, "address": await address_service.add_address(user.id, body)}


@router.delete("/addresses/{address_id}")
async def delete_address(address_id: str, user: CurrentUser = Depends(customer_only)):
    await address_service.delete_address(user.id, address_id)

    return {"ok": True}


# --- Cart and orders -------------------------------------------------------


@router.post("/cart/quote")
async def quote_cart_endpoint(
    body: QuoteBody,
    user: Optional[CurrentUser] = Depends(optional_authenticate),
):
    """Prices a cart without placing it.

    Open to anyone so the cart totals before signing in; coupons that depend on
    who is ordering report why they cannot apply rather than failing the quote.
    """
    quote = await quote_cart(body.items, body.couponCode, user.id if user else None)

    return {"ok": True, **quote.to_dict()}


@router.post("/orders", status_code=201)
async def place_order(body: PlaceOrderBody, user: CurrentUser = Depends(customer_only)):
    order = await order_service.place_order(
        user_id=user.id,
        items=body.items,
        payment_method=body.paymentMethod,
        coupon_code=body.couponCode,
        address_id=body.addressId,
        address=body.address,
        special_instructions=body.specialInstructions,
        tip_paise=body.tipPaise,
        idempotency_key=body.idempotencyKey,
    )

    return {"ok": True, "order": order}


@router.get("/orders")
async def list_orders(
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(customer_only),
):
    return {"ok": True, **await order_service.list_orders(user.id, limit, offset)}


@router.get("/orders/{order_id}")
async def get_order(order_id: str, user: CurrentUser = Depends(customer_only)):
    return {"ok": True, "order": await order_service.get_order(user.id, order_id)}


@router.post("/orders/{order_id}/cancel")
async def cancel_order(
    order_id: str,
    body: CancelOrderBody,
    user: CurrentUser = Depends(customer_only),
):
    order = await order_service.cancel_order(user.id, order_id, body.reason)

    return {"ok": True, "order": order}
