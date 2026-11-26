"""Placing and tracking orders."""

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from ...database import fetch, fetchrow, fetchval, transaction
from ...errors import AppError, bad_request, conflict, forbidden, not_found
from ..delivery import service as delivery
from ..geo import distance_km, ride_minutes
from ..notifications import events
from ..payouts import settings as payment_settings
from ..payments import refunds
from ..wallet import service as wallet_service
from .delivery_code import code_required, new_code
from ..test_accounts import is_test_account
from .pricing import quote_cart, quote_serviceability

# What the customer may do, and when. The restaurant and delivery apps drive the
# rest of the lifecycle; those transitions arrive in a later phase.
CUSTOMER_CANCELLABLE = {"pending", "confirmed"}

# Mirrors the tracking timeline in the app.
TIMELINE = ["confirmed", "preparing", "ready", "picked_up", "on_the_way", "delivered"]

LIVE = {"confirmed", "preparing", "ready", "picked_up", "on_the_way"}

# India has one time zone and no daylight saving, so a fixed offset is exact.
INDIA = timezone(timedelta(hours=5, minutes=30))

# Riders may call ahead late at night, when the customer could be asleep.
LATE_NIGHT_FROM_HOUR = 23
LATE_NIGHT_UNTIL_HOUR = 5


def _address_to_dict(address: Any) -> dict:
    return {
        "label": address.label,
        "line1": address.line1,
        "line2": address.line2,
        "landmark": getattr(address, "landmark", None),
        "city": address.city,
        "pincode": address.pincode,
        "latitude": float(address.latitude) if address.latitude is not None else None,
        "longitude": float(address.longitude) if address.longitude is not None else None,
    }


async def _resolve_address(user_id: uuid.UUID, address_id: Optional[str], inline: Any) -> dict:
    """Orders keep a snapshot of where they were sent, because a saved address
    can be edited or deleted later and the delivery record must not change."""
    if inline is not None:
        return _address_to_dict(inline)

    if address_id is None:
        raise bad_request("address_required", "Choose a delivery address")

    try:
        identifier = uuid.UUID(address_id)
    except (ValueError, TypeError):
        raise not_found("address_not_found", "That address is no longer saved")

    row = await fetchrow(
        """
        select label, line1, line2, landmark, city, pincode, latitude, longitude
        from customer_addresses
        where id = $1 and user_id = $2
        """,
        identifier,
        user_id,
    )

    if row is None:
        raise not_found("address_not_found", "That address is no longer saved")

    return {
        "label": row["label"],
        "line1": row["line1"],
        "line2": row["line2"],
        "landmark": row["landmark"],
        "city": row["city"],
        "pincode": row["pincode"],
        "latitude": float(row["latitude"]) if row["latitude"] is not None else None,
        "longitude": float(row["longitude"]) if row["longitude"] is not None else None,
    }


def _point(latitude: Any, longitude: Any) -> Optional[tuple[float, float]]:
    if latitude is None or longitude is None:
        return None

    return float(latitude), float(longitude)


def _eta_minutes(
    status: str,
    prep_minutes: int,
    accepted_at: Optional[datetime],
    restaurant: Optional[tuple[float, float]],
    home: Optional[tuple[float, float]],
    tracking: Optional[dict],
    now: datetime,
) -> Optional[int]:
    """Minutes until the food reaches the door, worked out afresh on every read.

    Before pickup it is whichever is later, the kitchen or the rider reaching
    the counter, then the ride to the customer. After pickup it is the rider's
    own distance to the customer. 0 means the rider is at the door.
    """
    if status not in LIVE:
        return None

    rider_status = tracking["status"] if tracking else None
    rider = (
        _point(tracking["location"]["latitude"], tracking["location"]["longitude"])
        if tracking and tracking.get("location")
        else None
    )

    def ride(a, b) -> Optional[int]:
        return ride_minutes(distance_km(*a, *b)) if a and b else None

    if rider_status == "arrived":
        return 0

    last_leg = ride(restaurant, home)

    if status in ("picked_up", "on_the_way"):
        from_rider = ride(rider, home)

        return max(1, (from_rider if from_rider is not None else last_leg or 15) + 1)

    if status == "confirmed":
        kitchen = prep_minutes + 2  # the restaurant still has to accept
    elif status == "preparing" and accepted_at is not None:
        cooked_for = (now - accepted_at).total_seconds() / 60
        kitchen = max(0, round(prep_minutes - cooked_for))
    elif status == "preparing":
        kitchen = prep_minutes
    else:
        kitchen = 0

    if rider_status == "reached_restaurant":
        to_counter = 0
    elif rider_status == "accepted":
        to_counter = ride(rider, restaurant) or 5
    else:
        to_counter = 5  # still finding a rider

    return max(1, max(kitchen, to_counter) + (last_leg if last_leg is not None else 15) + 2)


async def _order_response(order_id: uuid.UUID) -> dict:
    order = await fetchrow(
        """
        select o.id, o.order_number, o.restaurant_id, o.status, o.subtotal_paise,
               o.delivery_fee_paise, o.packaging_fee_paise, o.tax_paise, o.tip_paise,
               o.discount_paise, o.round_off_paise, o.total_paise, o.payment_method, o.payment_status,
               o.delivery_address, o.special_instructions, o.estimated_delivery_at,
               o.placed_at, o.delivered_at, o.cancelled_at, o.cancellation_reason, o.delivery_code,
               o.cooking_instructions, o.no_cutlery, o.delivery_preferences,
               (select row(d.rider_rating, d.rider_rating_comment) from deliveries d
                 where d.order_id = o.id and d.rider_rating is not null) as rider_review,
               exists (select 1 from deliveries d where d.order_id = o.id and d.tip_thanked_at is not null)
                 as tip_thanked,
               r.name as restaurant_name, r.address_line as restaurant_address,
               r.city as restaurant_city, r.phone as restaurant_phone,
               r.latitude as restaurant_lat, r.longitude as restaurant_lng,
               coalesce(o.prep_minutes, r.avg_prep_minutes) as prep_minutes, o.accepted_at
        from orders o
        join restaurants r on r.id = o.restaurant_id
        where o.id = $1
        """,
        order_id,
    )

    items = await fetch(
        """
        select i.id, i.menu_item_id, i.name, i.is_veg, i.unit_price_paise, i.quantity,
               i.line_total_paise
        from order_items i
        where i.order_id = $1
        order by i.name
        """,
        order_id,
    )

    addons = await fetch(
        """
        select a.order_item_id, a.name, a.price_paise
        from order_item_addons a
        join order_items i on i.id = a.order_item_id
        where i.order_id = $1
        """,
        order_id,
    )

    addons_by_item: dict[Any, list[dict]] = {}

    for addon in addons:
        addons_by_item.setdefault(addon["order_item_id"], []).append(
            {"name": addon["name"], "pricePaise": addon["price_paise"]}
        )

    history = await fetch(
        "select status, note, created_at from order_status_history where order_id = $1 order by created_at",
        order_id,
    )

    address = order["delivery_address"]
    address = json.loads(address) if isinstance(address, str) else address
    tracking = await delivery.tracking_for_order(order_id)
    accepted_at = order["accepted_at"] or next(
        (row["created_at"] for row in history if row["status"] == "preparing"), None
    )
    now = datetime.now(timezone.utc)
    live = order["status"] in LIVE
    india_hour = now.astimezone(INDIA).hour

    return {
        "id": str(order["id"]),
        "orderNumber": order["order_number"],
        "status": order["status"],
        "restaurant": {
            "id": str(order["restaurant_id"]),
            "name": order["restaurant_name"],
            "address": ", ".join(filter(None, [order["restaurant_address"], order["restaurant_city"]])),
            "phone": order["restaurant_phone"],
            # For the tracking map; null for restaurants not yet placed on it.
            "latitude": float(order["restaurant_lat"]) if order["restaurant_lat"] is not None else None,
            "longitude": float(order["restaurant_lng"]) if order["restaurant_lng"] is not None else None,
        },
        "deliveryAddress": address,
        "items": [
            {
                "id": str(item["id"]),
                "menuItemId": str(item["menu_item_id"]) if item["menu_item_id"] else None,
                "name": item["name"],
                "isVeg": item["is_veg"],
                "unitPricePaise": item["unit_price_paise"],
                "quantity": item["quantity"],
                "lineTotalPaise": item["line_total_paise"],
                "addons": addons_by_item.get(item["id"], []),
            }
            for item in items
        ],
        "subtotalPaise": order["subtotal_paise"],
        "deliveryFeePaise": order["delivery_fee_paise"],
        "packagingFeePaise": order["packaging_fee_paise"],
        "taxPaise": order["tax_paise"],
        "tipPaise": order["tip_paise"],
        "discountPaise": order["discount_paise"],
        "roundOffPaise": order["round_off_paise"],
        "totalPaise": order["total_paise"],
        "paymentMethod": order["payment_method"],
        "paymentStatus": order["payment_status"],
        "specialInstructions": order["special_instructions"],
        "cookingInstructions": order["cooking_instructions"],
        "noCutlery": order["no_cutlery"],
        "deliveryPreferences": list(order["delivery_preferences"] or []),
        # The rider said thanks for the tip.
        "tipThanked": order["tip_thanked"],
        # The customer's rating of the delivery, once given.
        "riderReview": {"rating": order["rider_review"][0], "comment": order["rider_review"][1]}
        if order["rider_review"]
        else None,
        "estimatedDeliveryAt": order["estimated_delivery_at"].isoformat()
        if order["estimated_delivery_at"]
        else None,
        # "Arriving in X mins", recalculated on every read; 0 = at the door.
        "etaMinutes": _eta_minutes(
            order["status"],
            order["prep_minutes"],
            accepted_at,
            _point(order["restaurant_lat"], order["restaurant_lng"]),
            _point(address.get("latitude"), address.get("longitude")),
            tracking,
            now,
        ),
        # The code the customer tells the rider at the door, while it is needed.
        "deliveryCode": order["delivery_code"]
        if live and order["delivery_code"] and code_required(order["payment_method"])
        else None,
        "lateNight": live and (india_hour >= LATE_NIGHT_FROM_HOUR or india_hour < LATE_NIGHT_UNTIL_HOUR),
        "placedAt": order["placed_at"].isoformat(),
        "deliveredAt": order["delivered_at"].isoformat() if order["delivered_at"] else None,
        "cancelledAt": order["cancelled_at"].isoformat() if order["cancelled_at"] else None,
        "cancellationReason": order["cancellation_reason"],
        # Present once a paid order has been cancelled, so the app can say
        # "refund of Rs X started" rather than leaving the customer guessing.
        "refund": await refunds.refund_for_order(order_id),
        # The rider, once one has the order: name, vehicle, and while it is on
        # its way, their phone and live position.
        "delivery": tracking,
        "timeline": [
            {"status": row["status"], "note": row["note"], "at": row["created_at"].isoformat()}
            for row in history
        ],
    }


async def place_order(
    user_id: uuid.UUID,
    items: list[Any],
    payment_method: str,
    coupon_code: Optional[str] = None,
    address_id: Optional[str] = None,
    address: Any = None,
    special_instructions: Optional[str] = None,
    tip_paise: int = 0,
    idempotency_key: Optional[str] = None,
    cooking_instructions: Optional[str] = None,
    no_cutlery: bool = False,
    delivery_preferences: Optional[list[str]] = None,
) -> dict:
    # A retry of the same checkout returns the original order rather than
    # placing a second one.
    if idempotency_key:
        existing = await fetchrow(
            "select id from orders where customer_id = $1 and idempotency_key = $2",
            user_id,
            idempotency_key,
        )

        if existing is not None:
            return await _order_response(existing["id"])

    from ..payments import razorpay as razorpay_client

    if payment_method == "cod" and not payment_settings.current()["codEnabled"]:
        raise bad_request(
            "cod_unavailable", "Cash on delivery is not available. Please pay online or from your Foodos wallet"
        )

    if payment_method not in ("cod", "wallet") and not razorpay_client.is_configured():
        raise bad_request(
            "payment_method_unavailable",
            "Online payment is not available right now. Please try again later",
        )

    if tip_paise < 0:
        raise bad_request("invalid_tip", "A tip cannot be negative")

    # Priced from the database, never from what the client sent.
    quote = await quote_cart(items, coupon_code, user_id, tip_paise)

    if coupon_code and not quote.coupon.applied:
        raise bad_request("coupon_invalid", quote.coupon.reason or "That code is not valid")

    delivery_address = await _resolve_address(user_id, address_id, address)

    # The restaurant must deliver to this pin: no pin, no order, and nothing
    # beyond the restaurant's radius (an order once went 340 km).
    reach = quote_serviceability(
        quote, delivery_address["latitude"], delivery_address["longitude"], await is_test_account(user_id)
    )

    if not reach.ok:
        raise AppError(
            400 if reach.code == "address_needs_pin" else 409, reach.code, reach.reason, reach.to_dict()
        )

    total = quote.total_paise

    async with transaction() as connection:
        # Cash and the wallet need nothing more from a gateway, so the order
        # goes straight to the kitchen. The wallet is charged below.
        is_cash = payment_method == "cod"
        is_wallet = payment_method == "wallet"
        confirmed_now = is_cash or is_wallet

        order_id = await connection.fetchval(
            """
            insert into orders
              (customer_id, restaurant_id, delivery_address, status, subtotal_paise,
               delivery_fee_paise, packaging_fee_paise, tax_paise, tip_paise,
               discount_paise, total_paise, offer_id, payment_method, payment_status,
               special_instructions, estimated_delivery_at, confirmed_at, idempotency_key,
               round_off_paise, delivery_code, is_test,
               cooking_instructions, no_cutlery, delivery_preferences, discount_funded_by)
            values ($1, $2, $3::jsonb, $16, $4, $5, $6, $7, $8, $9, $10, $11,
                    $12, $23, $13, $14, $17, $15, $18, $19,
                    (select is_test from users where id = $1), $20, $21, $22::text[],
                    -- Who pays for the coupon, copied so editing the offer later
                    -- never changes an old order.
                    coalesce((select funded_by from offers where id = $11::uuid), 'restaurant'))
            returning id
            """,
            user_id,
            uuid.UUID(quote.restaurant_id),
            json.dumps(delivery_address),
            quote.subtotal_paise,
            quote.delivery_fee_paise,
            quote.packaging_fee_paise,
            quote.tax_paise,
            tip_paise,
            quote.discount_paise,
            total,
            quote.coupon.offer_id,
            payment_method,
            special_instructions,
            datetime.now(timezone.utc) + timedelta(minutes=45),
            idempotency_key,
            "confirmed" if confirmed_now else "pending",
            datetime.now(timezone.utc) if confirmed_now else None,
            quote.round_off_paise,
            new_code(),
            (cooking_instructions or "").strip() or None,
            no_cutlery,
            list(dict.fromkeys(delivery_preferences or [])),
            "paid" if is_wallet else "pending",
        )

        if is_wallet:
            # Inside this transaction: if the balance is short, nothing is placed.
            await wallet_service.pay_for_order(connection, user_id, order_id, total)

        for line in quote.lines:
            order_item_id = await connection.fetchval(
                """
                insert into order_items
                  (order_id, menu_item_id, name, is_veg, unit_price_paise, quantity, line_total_paise)
                values ($1, $2, $3, $4, $5, $6, $7)
                returning id
                """,
                order_id,
                uuid.UUID(line.menu_item_id),
                line.name,
                line.is_veg,
                line.unit_price_paise,
                line.quantity,
                line.line_total_paise,
            )

            for addon in line.addons:
                await connection.execute(
                    "insert into order_item_addons (order_item_id, name, price_paise) values ($1, $2, $3)",
                    order_item_id,
                    addon.name,
                    addon.price_paise,
                )

        if quote.coupon.applied and quote.coupon.offer_id is not None:
            await connection.execute(
                """
                insert into offer_redemptions (offer_id, user_id, order_id, discount_paise)
                values ($1, $2, $3, $4)
                """,
                quote.coupon.offer_id,
                user_id,
                order_id,
                quote.discount_paise,
            )

        await connection.execute(
            """
            insert into order_status_history (order_id, status, actor_user_id, note)
            values ($1, $3, $2, $4)
            """,
            order_id,
            user_id,
            "confirmed" if confirmed_now else "pending",
            "Order placed" if is_cash else "Paid from the Foodos wallet" if is_wallet else "Awaiting payment",
        )

    # A cash order goes straight to the restaurant; an online one waits until
    # it is paid (see payments).
    if confirmed_now:
        await events.new_order(order_id)

    return await _order_response(order_id)


async def list_orders(user_id: uuid.UUID, limit: int = 20, offset: int = 0) -> dict:
    total = await fetchrow(
        "select count(*)::int as n from orders where customer_id = $1", user_id
    )

    rows = await fetch(
        """
        select o.id, o.order_number, o.status, o.total_paise, o.placed_at,
               o.payment_method, o.payment_status,
               r.name as restaurant_name, r.id as restaurant_id,
               -- Total dishes, not distinct lines: three of one dish reads
               -- as "3 items", which is what the order list should say.
               (select coalesce(sum(i.quantity), 0)::int from order_items i where i.order_id = o.id)
                 as item_count
        from orders o
        join restaurants r on r.id = o.restaurant_id
        where o.customer_id = $1
        order by o.placed_at desc
        limit $2 offset $3
        """,
        user_id,
        limit,
        offset,
    )

    return {
        "orders": [
            {
                "id": str(row["id"]),
                "orderNumber": row["order_number"],
                "status": row["status"],
                "totalPaise": row["total_paise"],
                "itemCount": row["item_count"],
                "paymentMethod": row["payment_method"],
                "paymentStatus": row["payment_status"],
                "placedAt": row["placed_at"].isoformat(),
                "restaurant": {"id": str(row["restaurant_id"]), "name": row["restaurant_name"]},
            }
            for row in rows
        ],
        "total": total["n"],
        "limit": limit,
        "offset": offset,
    }


async def active_order(user_id: uuid.UUID) -> Optional[dict]:
    """The customer's latest order still on its way, for the bar at the bottom
    of the app; None when there is none."""
    order_id = await fetchval(
        """
        select id from orders
        where customer_id = $1 and status = any($2::text[])
        order by placed_at desc
        limit 1
        """,
        user_id,
        list(LIVE),
    )

    return await _order_response(order_id) if order_id else None


async def review_rider(user_id: uuid.UUID, order_id: str, rating: int, comment: Optional[str]) -> dict:
    """The customer's rating of the delivery, once per order, after it arrived.
    The rider's average is worked out again from all their ratings."""
    try:
        identifier = uuid.UUID(order_id)
    except (ValueError, TypeError):
        raise not_found("order_not_found", "That order could not be found")

    comment = (comment or "").strip() or None

    async with transaction() as connection:
        row = await connection.fetchrow(
            """
            select o.customer_id, o.status, d.id as delivery_id, d.partner_id, d.rider_rating
            from orders o left join deliveries d on d.order_id = o.id
            where o.id = $1
            for update of o
            """,
            identifier,
        )

        if row is None or row["customer_id"] != user_id:
            raise not_found("order_not_found", "That order could not be found")

        if row["status"] != "delivered" or row["partner_id"] is None:
            raise conflict("rider_review_not_ready", "You can rate the delivery once it has reached you")

        if row["rider_rating"] is not None:
            raise conflict("rider_already_rated", "You have already rated this delivery")

        await connection.execute(
            """
            update deliveries set rider_rating = $2, rider_rating_comment = $3, rider_rated_at = now()
            where id = $1
            """,
            row["delivery_id"],
            rating,
            comment,
        )
        await connection.execute(
            """
            update delivery_partners p
            set rating = coalesce(s.average, 0), rating_count = s.n
            from (
              select round(avg(rider_rating)::numeric, 2) as average, count(*)::int as n
              from deliveries where partner_id = $1 and rider_rating is not null
            ) s
            where p.user_id = $1
            """,
            row["partner_id"],
        )

    return {"rating": rating, "comment": comment}


async def get_order(user_id: uuid.UUID, order_id: str) -> dict:
    try:
        identifier = uuid.UUID(order_id)
    except (ValueError, TypeError):
        raise not_found("order_not_found", "That order could not be found")

    owner = await fetchrow("select customer_id from orders where id = $1", identifier)

    if owner is None:
        raise not_found("order_not_found", "That order could not be found")

    # Someone else's order is reported as missing rather than forbidden, so the
    # API cannot be used to discover which order ids exist.
    if owner["customer_id"] != user_id:
        raise not_found("order_not_found", "That order could not be found")

    return await _order_response(identifier)


async def order_view(order_id: uuid.UUID) -> dict:
    """An order exactly as the customer sees it, for the admin panel to show
    alongside its own details. The caller checks the order exists."""
    return await _order_response(order_id)


async def cancel_order(user_id: uuid.UUID, order_id: str, reason: Optional[str] = None) -> dict:
    try:
        identifier = uuid.UUID(order_id)
    except (ValueError, TypeError):
        raise not_found("order_not_found", "That order could not be found")

    async with transaction() as connection:
        # Locked for the transaction so two taps cannot both pass the check.
        order = await connection.fetchrow(
            "select customer_id, status from orders where id = $1 for update", identifier
        )

        if order is None or order["customer_id"] != user_id:
            raise not_found("order_not_found", "That order could not be found")

        if order["status"] == "cancelled":
            raise conflict("order_already_cancelled", "That order is already cancelled")

        if order["status"] not in CUSTOMER_CANCELLABLE:
            raise conflict(
                "order_not_cancellable",
                "The restaurant has started preparing this order. Contact support to cancel",
            )

        await connection.execute(
            """
            update orders
            set status = 'cancelled', cancelled_at = now(), cancelled_by = 'customer',
                cancellation_reason = $2
            where id = $1
            """,
            identifier,
            reason,
        )

        await connection.execute(
            """
            insert into order_status_history (order_id, status, actor_user_id, note)
            values ($1, 'cancelled', $2, $3)
            """,
            identifier,
            user_id,
            reason or "Cancelled by customer",
        )

    # After the cancellation has committed, never inside it.
    await refunds.refund_if_paid(identifier, reason or "Cancelled by customer", user_id)

    # An unpaid online order never reached the restaurant.
    await events.cancelled(identifier, "customer", restaurant_saw_it=order["status"] != "pending")

    return await _order_response(identifier)
