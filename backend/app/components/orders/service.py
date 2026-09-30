"""Placing and tracking orders."""

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from ...database import fetch, fetchrow, transaction
from ...errors import bad_request, conflict, forbidden, not_found
from .pricing import quote_cart

# What the customer may do, and when. The restaurant and delivery apps drive the
# rest of the lifecycle; those transitions arrive in a later phase.
CUSTOMER_CANCELLABLE = {"pending", "confirmed"}

# Mirrors the tracking timeline in the app.
TIMELINE = ["confirmed", "preparing", "ready", "picked_up", "on_the_way", "delivered"]


def _address_to_json(address: Any) -> str:
    return json.dumps(
        {
            "label": address.label,
            "line1": address.line1,
            "line2": address.line2,
            "city": address.city,
            "pincode": address.pincode,
            "latitude": float(address.latitude) if address.latitude is not None else None,
            "longitude": float(address.longitude) if address.longitude is not None else None,
        }
    )


async def _resolve_address(user_id: uuid.UUID, address_id: Optional[str], inline: Any) -> str:
    """Orders keep a snapshot of where they were sent, because a saved address
    can be edited or deleted later and the delivery record must not change."""
    if inline is not None:
        return _address_to_json(inline)

    if address_id is None:
        raise bad_request("address_required", "Choose a delivery address")

    try:
        identifier = uuid.UUID(address_id)
    except (ValueError, TypeError):
        raise not_found("address_not_found", "That address is no longer saved")

    row = await fetchrow(
        """
        select label, line1, line2, city, pincode, latitude, longitude
        from customer_addresses
        where id = $1 and user_id = $2
        """,
        identifier,
        user_id,
    )

    if row is None:
        raise not_found("address_not_found", "That address is no longer saved")

    return json.dumps(
        {
            "label": row["label"],
            "line1": row["line1"],
            "line2": row["line2"],
            "city": row["city"],
            "pincode": row["pincode"],
            "latitude": float(row["latitude"]) if row["latitude"] is not None else None,
            "longitude": float(row["longitude"]) if row["longitude"] is not None else None,
        }
    )


async def _order_response(order_id: uuid.UUID) -> dict:
    order = await fetchrow(
        """
        select o.id, o.order_number, o.restaurant_id, o.status, o.subtotal_paise,
               o.delivery_fee_paise, o.packaging_fee_paise, o.tax_paise, o.tip_paise,
               o.discount_paise, o.total_paise, o.payment_method, o.payment_status,
               o.delivery_address, o.special_instructions, o.estimated_delivery_at,
               o.placed_at, o.delivered_at, o.cancelled_at, o.cancellation_reason,
               r.name as restaurant_name, r.address_line as restaurant_address,
               r.city as restaurant_city, r.phone as restaurant_phone
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

    return {
        "id": str(order["id"]),
        "orderNumber": order["order_number"],
        "status": order["status"],
        "restaurant": {
            "id": str(order["restaurant_id"]),
            "name": order["restaurant_name"],
            "address": ", ".join(filter(None, [order["restaurant_address"], order["restaurant_city"]])),
            "phone": order["restaurant_phone"],
        },
        "deliveryAddress": json.loads(address) if isinstance(address, str) else address,
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
        "totalPaise": order["total_paise"],
        "paymentMethod": order["payment_method"],
        "paymentStatus": order["payment_status"],
        "specialInstructions": order["special_instructions"],
        "estimatedDeliveryAt": order["estimated_delivery_at"].isoformat()
        if order["estimated_delivery_at"]
        else None,
        "placedAt": order["placed_at"].isoformat(),
        "deliveredAt": order["delivered_at"].isoformat() if order["delivered_at"] else None,
        "cancelledAt": order["cancelled_at"].isoformat() if order["cancelled_at"] else None,
        "cancellationReason": order["cancellation_reason"],
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

    if payment_method != "cod":
        # Card, UPI and wallet arrive with the payment provider in the next phase.
        raise bad_request(
            "payment_method_unavailable",
            "Only cash on delivery is available at the moment",
        )

    if tip_paise < 0:
        raise bad_request("invalid_tip", "A tip cannot be negative")

    # Priced from the database, never from what the client sent.
    quote = await quote_cart(items, coupon_code, user_id)

    if coupon_code and not quote.coupon.applied:
        raise bad_request("coupon_invalid", quote.coupon.reason or "That code is not valid")

    delivery_address = await _resolve_address(user_id, address_id, address)
    total = quote.total_paise + tip_paise

    async with transaction() as connection:
        order_id = await connection.fetchval(
            """
            insert into orders
              (customer_id, restaurant_id, delivery_address, status, subtotal_paise,
               delivery_fee_paise, packaging_fee_paise, tax_paise, tip_paise,
               discount_paise, total_paise, offer_id, payment_method, payment_status,
               special_instructions, estimated_delivery_at, confirmed_at, idempotency_key)
            values ($1, $2, $3::jsonb, 'confirmed', $4, $5, $6, $7, $8, $9, $10, $11,
                    $12, 'pending', $13, $14, now(), $15)
            returning id
            """,
            user_id,
            uuid.UUID(quote.restaurant_id),
            delivery_address,
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
        )

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
            values ($1, 'confirmed', $2, 'Order placed')
            """,
            order_id,
            user_id,
        )

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

    return await _order_response(identifier)
