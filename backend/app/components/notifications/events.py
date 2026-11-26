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

from ...config import get_settings
from ...database import fetchrow
from ..orders.delivery_code import code_required
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
               o.payment_status, o.cancellation_reason, o.delivery_code,
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
async def delivery_offered(order_id: uuid.UUID, rider_id: uuid.UUID) -> None:
    """The one rider this delivery is being offered to right now. Dispatch
    picks them; nobody else is told, so two riders never race for one order."""
    order = await _order(order_id)

    if order is None:
        return

    seconds = get_settings().dispatch_offer_seconds

    await push.notify(
        [rider_id],
        "delivery",
        "New delivery request",
        f"Pickup from {order['restaurant_name']}, {order['address_line']}. "
        f"Open the app within {seconds} seconds to see your pay and accept.",
        {"type": "offer"},
        urgent=True,
    )


@_quietly
async def delivery_assigned(order_id: uuid.UUID, rider_id: uuid.UUID) -> None:
    """Foodos gave this rider the order directly, from the admin panel."""
    order = await _order(order_id)

    if order is None:
        return

    await push.notify(
        [rider_id],
        "delivery",
        f"Foodos assigned you #{order['order_number']}",
        f"Pick up from {order['restaurant_name']}, {order['address_line']}. Open the app to start.",
        {"type": "delivery"},
        urgent=True,
    )


@_quietly
async def delivery_taken_away(order_id: uuid.UUID, rider_id: uuid.UUID) -> None:
    """Foodos moved this order to another rider."""
    order = await _order(order_id)

    if order is None:
        return

    await push.notify(
        [rider_id],
        "delivery",
        "Delivery reassigned",
        f"#{order['order_number']} has been given to another rider. You are free to take the next order.",
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
async def prep_delayed(order_id: uuid.UUID, minutes: int) -> None:
    """The kitchen asked for more time; the arrival time in the app moves too."""
    order = await _order(order_id)

    if order is None:
        return

    await push.notify(
        [order["customer_id"]],
        "customer",
        "Your food needs a little longer",
        f"{order['restaurant_name']} is taking about {minutes} more minutes to prepare your order.",
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

    if order["delivery_code"] and code_required(order["payment_method"]):
        body += f" Share code {order['delivery_code']} with them."

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
async def tip_thanks(order_id: uuid.UUID, rider_name: Optional[str], tip_paise: int) -> None:
    order = await _order(order_id)

    if order is None:
        return

    await push.notify(
        [order["customer_id"]],
        "customer",
        "Thanks for the tip",
        f"{_first_name(rider_name) or 'Your delivery partner'} says thank you for the {_rupees(tip_paise)} tip.",
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
            if order["payment_method"] == "wallet":
                body += f" {_rupees(refund['amountPaise'])} is back in your Foodos wallet."
            else:
                body += f" Your refund of {_rupees(refund['amountPaise'])} has been started."

        await push.notify([order["customer_id"]], "customer", "Order cancelled", body, _order_link(order))

    if by != "restaurant" and restaurant_saw_it:
        who = "the customer" if by == "customer" else "Foodos"

        if by == "system":
            body = "It was not accepted in time, so it was cancelled and the customer was told."
        else:
            body = f"Cancelled by {who}{f': {reason}' if reason else '.'}"

        await push.notify(
            [order["owner_id"]],
            "restaurant",
            f"Order #{order['order_number']} cancelled",
            body,
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


# --- Support ------------------------------------------------------------------

# Which app a ticket was raised from, by the role its session had.
SUPPORT_APP = {"customer": "customer", "restaurant_owner": "restaurant", "delivery_partner": "delivery"}


@_quietly
async def support_replied(ticket_id: uuid.UUID, message: str) -> None:
    """Foodos answered a ticket; internal notes never come here."""
    ticket = await fetchrow(
        "select raised_by, raised_by_role, ticket_number from support_tickets where id = $1", ticket_id
    )

    if ticket is None:
        return

    preview = message if len(message) <= 120 else message[:117].rstrip() + "…"

    await push.notify(
        [ticket["raised_by"]],
        SUPPORT_APP[ticket["raised_by_role"]],
        f"Foodos support replied ({ticket['ticket_number']})",
        preview,
        {"type": "support", "ticketId": str(ticket_id)},
    )
