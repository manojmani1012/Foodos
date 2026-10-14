"""Who is told what, as an order moves.

Each function is called after the change it reports has been committed, and
never raises: a notification that cannot be sent must not undo or fail the
order step that triggered it.

Restaurants and riders get the loud "orders" channel for things they must act
on (a new order, a new delivery, food ready). Customers get ordinary updates.
"""

import functools
import logging
import uuid
from typing import Any, Optional

from ...database import fetch, fetchrow
from ..payments import refunds
from . import push

logger = logging.getLogger("foodos.push")

ACTIVE_DELIVERY = ("accepted", "reached_restaurant", "picked_up", "arrived")


def _quietly(handler):
    @functools.wraps(handler)
    async def wrapper(*args, **kwargs):
        try:
            await handler(*args, **kwargs)
        except Exception:  # noqa: BLE001 - see the module docstring
            logger.exception("[push] %s failed", handler.__name__)

    return wrapper


def _rupees(paise: int) -> str:
    value = paise / 100
    return f"₹{value:,.0f}" if value == int(value) else f"₹{value:,.2f}"


def _first_name(full_name: Optional[str]) -> str:
    return (full_name or "").strip().split(" ")[0] or "Your rider"


async def _order(order_id: uuid.UUID) -> Optional[Any]:
    return await fetchrow(
        """
        select o.id, o.order_number, o.customer_id, o.status, o.total_paise, o.payment_method,
               o.payment_status, o.cancellation_reason,
               r.id as restaurant_id, r.name as restaurant_name, r.owner_id, r.address_line, r.city,
               d.status as delivery_status, d.partner_id, u.full_name as rider_name,
               (select coalesce(sum(i.quantity), 0)::int from order_items i where i.order_id = o.id) as items
        from orders o
        join restaurants r on r.id = o.restaurant_id
        left join deliveries d on d.order_id = o.id
        left join users u on u.id = d.partner_id
        where o.id = $1
        """,
        order_id,
    )


def _order_link(order: Any) -> dict:
    return {"type": "order", "orderId": str(order["id"])}


# --- Restaurant -------------------------------------------------------------


@_quietly
async def new_order(order_id: uuid.UUID) -> None:
    """The restaurant can now see the order: placed (cash) or paid (online)."""
    order = await _order(order_id)

    if order is None or order["status"] != "confirmed":
        return

    items = order["items"]
    payment = "Cash on delivery" if order["payment_method"] == "cod" else "Paid online"

    await push.notify(
        [order["owner_id"]],
        "restaurant",
        f"New order #{order['order_number']}",
        f"{items} item{'' if items == 1 else 's'} · {_rupees(order['total_paise'])} · {payment}. Tap to accept.",
        _order_link(order),
        urgent=True,
    )


@_quietly
async def rider_at_restaurant(order_id: uuid.UUID) -> None:
    order = await _order(order_id)

    if order is None:
        return

    await push.notify(
        [order["owner_id"]],
        "restaurant",
        "Rider has arrived",
        f"{_first_name(order['rider_name'])} is at your counter for #{order['order_number']}.",
        _order_link(order),
        urgent=True,
    )


# --- Riders -----------------------------------------------------------------


@_quietly
async def delivery_available(order_id: uuid.UUID) -> None:
    """Every rider who would see this order in their app right now: active,
    online, not carrying an order, and in the restaurant's city (or with no
    city set, the same rule the offer list uses)."""
    order = await _order(order_id)

    if order is None:
        return

    riders = await fetch(
        """
        select p.user_id
        from delivery_partners p
        where p.status = 'active' and p.is_online
          and (p.city is null or lower(p.city) = lower($1))
          and not exists (
            select 1 from deliveries d where d.partner_id = p.user_id and d.status = any($2::text[])
          )
        """,
        order["city"],
        list(ACTIVE_DELIVERY),
    )

    await push.notify(
        [row["user_id"] for row in riders],
        "delivery",
        "New delivery request",
        f"Pickup from {order['restaurant_name']}, {order['address_line']}. Open the app to see your pay and accept.",
        {"type": "offer"},
        urgent=True,
    )


@_quietly
async def food_ready(order_id: uuid.UUID) -> None:
    order = await _order(order_id)

    if order is None or not order["partner_id"] or order["delivery_status"] not in ACTIVE_DELIVERY:
        return

    await push.notify(
        [order["partner_id"]],
        "delivery",
        "Food is ready",
        f"#{order['order_number']} is packed and ready at {order['restaurant_name']}.",
        {"type": "delivery"},
        urgent=True,
    )


# --- Customer ---------------------------------------------------------------


@_quietly
async def order_accepted(order_id: uuid.UUID) -> None:
    order = await _order(order_id)

    if order is None:
        return

    await push.notify(
        [order["customer_id"]],
        "customer",
        "Order confirmed",
        f"{order['restaurant_name']} has accepted your order and is preparing it.",
        _order_link(order),
    )


@_quietly
async def rider_assigned(order_id: uuid.UUID) -> None:
    order = await _order(order_id)

    if order is None:
        return

    await push.notify(
        [order["customer_id"]],
        "customer",
        "Delivery partner assigned",
        f"{_first_name(order['rider_name'])} is heading to {order['restaurant_name']} to collect your order.",
        _order_link(order),
    )


@_quietly
async def picked_up(order_id: uuid.UUID) -> None:
    order = await _order(order_id)

    if order is None:
        return

    await push.notify(
        [order["customer_id"]],
        "customer",
        "Your order is on the way",
        f"{_first_name(order['rider_name'])} has picked up your food from {order['restaurant_name']}.",
        _order_link(order),
    )


@_quietly
async def rider_arrived(order_id: uuid.UUID) -> None:
    order = await _order(order_id)

    if order is None:
        return

    cash = order["payment_method"] == "cod" and order["payment_status"] != "paid"
    body = f"{_first_name(order['rider_name'])} has arrived with your order."

    if cash:
        body += f" Please keep {_rupees(order['total_paise'])} ready."

    await push.notify([order["customer_id"]], "customer", "Your order is here", body, _order_link(order))


@_quietly
async def delivered(order_id: uuid.UUID) -> None:
    order = await _order(order_id)

    if order is None:
        return

    await push.notify(
        [order["customer_id"]],
        "customer",
        "Order delivered",
        f"Enjoy your meal! You can rate {order['restaurant_name']} from your order.",
        _order_link(order),
    )


@_quietly
async def refund_processed(order_id: uuid.UUID) -> None:
    order = await _order(order_id)
    refund = await refunds.refund_for_order(order_id)

    if order is None or refund is None or refund["status"] != "processed":
        return

    await push.notify(
        [order["customer_id"]],
        "customer",
        "Refund processed",
        f"{_rupees(refund['amountPaise'])} for #{order['order_number']} is on its way back to you. "
        "Banks usually take 5–7 working days.",
        _order_link(order),
    )


# --- Cancellations ----------------------------------------------------------


@_quietly
async def cancelled(
    order_id: uuid.UUID,
    by: str,
    restaurant_saw_it: bool,
    rider_id: Optional[uuid.UUID] = None,
) -> None:
    """Tells everyone involved except whoever cancelled.

    `restaurant_saw_it`: an unpaid online order never reached the restaurant,
    so there is nothing to tell them. `rider_id`: the rider who had the order
    in hand when it was cancelled, if any.
    """
    order = await _order(order_id)

    if order is None:
        return

    reason = order["cancellation_reason"]

    if by != "customer":
        if by == "restaurant":
            body = f"{order['restaurant_name']} could not take your order."
        else:
            body = f"Foodos cancelled your order{f': {reason}' if reason else '.'}"

        refund = await refunds.refund_for_order(order_id)

        if refund and refund["status"] in ("pending", "processed"):
            body += f" Your refund of {_rupees(refund['amountPaise'])} has been started."

        await push.notify([order["customer_id"]], "customer", "Order cancelled", body, _order_link(order))

    if by != "restaurant" and restaurant_saw_it:
        who = "the customer" if by == "customer" else "Foodos"

        await push.notify(
            [order["owner_id"]],
            "restaurant",
            f"Order #{order['order_number']} cancelled",
            f"Cancelled by {who}{f': {reason}' if reason else '.'}",
            _order_link(order),
            urgent=True,
        )

    if rider_id:
        await push.notify(
            [rider_id],
            "delivery",
            "Delivery cancelled",
            f"#{order['order_number']} was cancelled. You are free to take the next order.",
            {"type": "offer"},
            urgent=True,
        )
