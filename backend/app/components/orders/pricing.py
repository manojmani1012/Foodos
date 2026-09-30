"""Cart pricing.

The server is the authority on price. Nothing the client sends about money is
trusted: only menu item ids, add-on ids and quantities are read from the request,
and every amount is looked up fresh from the database. The app's own total is for
display, and this calculation is what gets charged.

All amounts are integer paise, so there is no floating-point drift.
"""

import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from ...database import fetch, fetchrow
from ...errors import bad_request, conflict, not_found

# Until delivery zones and distance are wired up, every order quotes the same
# fee. Deliberately mirrors DEFAULT_DELIVERY_FEE_PAISE in the restaurants
# service, which is what the browse screens show.
DELIVERY_FEE_PAISE = 2000
PACKAGING_FEE_PAISE = 1000

# GST on restaurant food in India is 5%. Kept here as one constant so it moves to
# app_settings in one edit when rates need to be configurable.
GST_RATE = 0.05

MAX_LINE_QUANTITY = 20


@dataclass
class QuotedAddon:
    id: str
    name: str
    price_paise: int


@dataclass
class QuotedLine:
    menu_item_id: str
    name: str
    is_veg: bool
    unit_price_paise: int
    quantity: int
    addons: list[QuotedAddon] = field(default_factory=list)

    @property
    def addons_paise(self) -> int:
        return sum(addon.price_paise for addon in self.addons)

    @property
    def line_total_paise(self) -> int:
        return (self.unit_price_paise + self.addons_paise) * self.quantity


@dataclass
class CouponResult:
    code: Optional[str] = None
    applied: bool = False
    reason: Optional[str] = None
    discount_paise: int = 0
    offer_id: Optional[Any] = None


@dataclass
class Quote:
    restaurant_id: str
    restaurant_name: str
    lines: list[QuotedLine]
    subtotal_paise: int
    delivery_fee_paise: int
    packaging_fee_paise: int
    tax_paise: int
    discount_paise: int
    total_paise: int
    coupon: CouponResult

    def to_dict(self) -> dict:
        return {
            "restaurantId": self.restaurant_id,
            "restaurantName": self.restaurant_name,
            "items": [
                {
                    "menuItemId": line.menu_item_id,
                    "name": line.name,
                    "isVeg": line.is_veg,
                    "unitPricePaise": line.unit_price_paise,
                    "quantity": line.quantity,
                    "addons": [
                        {"id": a.id, "name": a.name, "pricePaise": a.price_paise} for a in line.addons
                    ],
                    "lineTotalPaise": line.line_total_paise,
                }
                for line in self.lines
            ],
            "subtotalPaise": self.subtotal_paise,
            "deliveryFeePaise": self.delivery_fee_paise,
            "packagingFeePaise": self.packaging_fee_paise,
            "taxPaise": self.tax_paise,
            "discountPaise": self.discount_paise,
            "totalPaise": self.total_paise,
            "coupon": {
                "code": self.coupon.code,
                "applied": self.coupon.applied,
                "reason": self.coupon.reason,
                "discountPaise": self.coupon.discount_paise,
            },
        }


def _as_uuid(value: Any, message: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise bad_request("invalid_id", message)


async def _load_lines(items: list[Any]) -> tuple[list[QuotedLine], Any]:
    """Reads every item and add-on from the database and checks the cart is
    coherent: one restaurant, real items, nothing sold out."""
    if not items:
        raise bad_request("cart_empty", "Your cart is empty")

    item_ids = [_as_uuid(item.menuItemId, "That dish is no longer on the menu") for item in items]

    rows = await fetch(
        """
        select i.id, i.restaurant_id, i.name, i.price_paise, i.is_veg, i.is_available,
               r.name as restaurant_name, r.status as restaurant_status,
               r.is_accepting_orders
        from menu_items i
        join restaurants r on r.id = i.restaurant_id
        where i.id = any($1::uuid[]) and i.deleted_at is null
        """,
        item_ids,
    )

    by_id = {row["id"]: row for row in rows}

    missing = [str(i) for i in item_ids if i not in by_id]

    if missing:
        raise bad_request("item_unavailable", "Something in your cart is no longer on the menu")

    restaurant_ids = {row["restaurant_id"] for row in rows}

    if len(restaurant_ids) > 1:
        raise bad_request("multiple_restaurants", "An order can only contain dishes from one restaurant")

    restaurant = rows[0]

    if restaurant["restaurant_status"] != "active":
        raise conflict("restaurant_unavailable", "That restaurant is not taking orders right now")

    if not restaurant["is_accepting_orders"]:
        raise conflict("restaurant_closed", f"{restaurant['restaurant_name']} is not accepting orders right now")

    sold_out = [row["name"] for row in rows if not row["is_available"]]

    if sold_out:
        raise conflict("item_sold_out", f"{sold_out[0]} is sold out")

    # Add-ons are validated against the dish they were chosen for, so an add-on
    # from a cheaper dish cannot be attached to an expensive one.
    requested_addon_ids = [
        _as_uuid(addon_id, "That add-on is no longer available")
        for item in items
        for addon_id in (item.addonIds or [])
    ]

    addons_by_item: dict[Any, dict[Any, Any]] = {}

    if requested_addon_ids:
        addon_rows = await fetch(
            """
            select a.id, a.menu_item_id, a.name, a.price_paise, a.is_available
            from menu_item_addons a
            where a.id = any($1::uuid[])
            """,
            requested_addon_ids,
        )

        for addon in addon_rows:
            addons_by_item.setdefault(addon["menu_item_id"], {})[addon["id"]] = addon

    lines: list[QuotedLine] = []

    for item, item_id in zip(items, item_ids):
        row = by_id[item_id]

        if item.quantity < 1 or item.quantity > MAX_LINE_QUANTITY:
            raise bad_request("invalid_quantity", f"Choose between 1 and {MAX_LINE_QUANTITY} of each dish")

        chosen: list[QuotedAddon] = []

        for raw_addon_id in item.addonIds or []:
            addon_id = _as_uuid(raw_addon_id, "That add-on is no longer available")
            addon = addons_by_item.get(item_id, {}).get(addon_id)

            if addon is None:
                raise bad_request("addon_unavailable", "An add-on you chose is no longer available")

            if not addon["is_available"]:
                raise conflict("addon_sold_out", f"{addon['name']} is sold out")

            chosen.append(QuotedAddon(id=str(addon["id"]), name=addon["name"], price_paise=addon["price_paise"]))

        lines.append(
            QuotedLine(
                menu_item_id=str(item_id),
                name=row["name"],
                is_veg=row["is_veg"],
                unit_price_paise=row["price_paise"],
                quantity=item.quantity,
                addons=chosen,
            )
        )

    return lines, restaurant


async def _apply_coupon(
    code: Optional[str],
    subtotal_paise: int,
    delivery_fee_paise: int,
    restaurant_id: Any,
    user_id: Optional[uuid.UUID],
) -> CouponResult:
    """Checks a coupon and works out what it is worth.

    An invalid coupon is reported rather than raised: the cart should still
    price, with an explanation of why the code did not apply.
    """
    if not code:
        return CouponResult()

    normalised = code.strip().upper()

    offer = await fetchrow(
        """
        select id, name, code, type, percent_off, flat_off_paise, max_discount_paise,
               min_order_paise, first_order_only, restaurant_id, usage_limit,
               per_user_limit, valid_from, valid_until, is_active
        from offers
        where upper(code) = $1
        """,
        normalised,
    )

    def rejected(reason: str) -> CouponResult:
        return CouponResult(code=normalised, applied=False, reason=reason)

    if offer is None:
        return rejected("That code is not valid")

    if not offer["is_active"]:
        return rejected("That offer has ended")

    if offer["valid_until"] is not None or offer["valid_from"] is not None:
        window = await fetchrow(
            "select ($1::timestamptz <= now()) as started, ($2::timestamptz is null or $2::timestamptz > now()) as live",
            offer["valid_from"],
            offer["valid_until"],
        )

        if not window["started"]:
            return rejected("That offer has not started yet")

        if not window["live"]:
            return rejected("That offer has expired")

    if offer["restaurant_id"] is not None and offer["restaurant_id"] != restaurant_id:
        return rejected("That code does not apply to this restaurant")

    if subtotal_paise < offer["min_order_paise"]:
        short = (offer["min_order_paise"] - subtotal_paise) / 100
        return rejected(f"Add ₹{short:.0f} more to use this code")

    if user_id is None:
        return rejected("Sign in to use this code")

    if offer["first_order_only"]:
        previous = await fetchrow(
            "select 1 from orders where customer_id = $1 and status <> 'cancelled' limit 1",
            user_id,
        )

        if previous is not None:
            return rejected("That code is only for your first order")

    used_by_user = await fetchrow(
        "select count(*)::int as n from offer_redemptions where offer_id = $1 and user_id = $2",
        offer["id"],
        user_id,
    )

    if used_by_user["n"] >= offer["per_user_limit"]:
        return rejected("You have already used that code")

    if offer["usage_limit"] is not None:
        used_total = await fetchrow(
            "select count(*)::int as n from offer_redemptions where offer_id = $1", offer["id"]
        )

        if used_total["n"] >= offer["usage_limit"]:
            return rejected("That offer has been fully claimed")

    if offer["type"] == "percent":
        discount = int(subtotal_paise * float(offer["percent_off"]) / 100)

        if offer["max_discount_paise"] is not None:
            discount = min(discount, offer["max_discount_paise"])
    elif offer["type"] == "flat":
        discount = offer["flat_off_paise"]
    else:  # free_delivery
        discount = delivery_fee_paise

    # Never discount more than the items are worth.
    discount = max(0, min(discount, subtotal_paise + delivery_fee_paise))

    return CouponResult(
        code=normalised,
        applied=True,
        discount_paise=discount,
        offer_id=offer["id"],
    )


async def quote_cart(items: list[Any], coupon_code: Optional[str], user_id: Optional[uuid.UUID]) -> Quote:
    lines, restaurant = await _load_lines(items)

    subtotal = sum(line.line_total_paise for line in lines)
    delivery_fee = DELIVERY_FEE_PAISE
    packaging_fee = PACKAGING_FEE_PAISE
    tax = round(subtotal * GST_RATE)

    coupon = await _apply_coupon(coupon_code, subtotal, delivery_fee, restaurant["restaurant_id"], user_id)
    discount = coupon.discount_paise

    total = subtotal + delivery_fee + packaging_fee + tax - discount

    # The orders table enforces this same arithmetic, so a negative total would
    # be rejected by the database anyway; catching it here keeps the message kind.
    if total < 0:
        discount = subtotal + delivery_fee + packaging_fee + tax
        total = 0
        coupon.discount_paise = discount

    return Quote(
        restaurant_id=str(restaurant["restaurant_id"]),
        restaurant_name=restaurant["restaurant_name"],
        lines=lines,
        subtotal_paise=subtotal,
        delivery_fee_paise=delivery_fee,
        packaging_fee_paise=packaging_fee,
        tax_paise=tax,
        discount_paise=discount,
        total_paise=total,
        coupon=coupon,
    )
