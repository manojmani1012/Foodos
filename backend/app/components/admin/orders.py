"""Orders, from the Foodos side: finding one, seeing everything about it,
cancelling it when a customer calls, and getting a stuck refund through.

Cancelling here follows the same rules as everywhere else: the cancellation
commits first, then a paid order is refunded in full, and a gateway failure is
recorded rather than raised so it can be retried from this screen.
"""

import datetime
import uuid
from typing import Any, Optional

from ...database import fetch, fetchrow, fetchval, transaction
from ...errors import conflict, not_found
from ..notifications import events
from ..orders import service as orders_service
from ..payments import refunds
from . import audit

LIVE = ("pending", "confirmed", "preparing", "ready", "picked_up", "on_the_way")
RIDER_DONE = ("delivered", "cancelled")

VIEWS = {
    "live": "o.status = any(array['pending','confirmed','preparing','ready','picked_up','on_the_way'])",
    "delivered": "o.status = 'delivered'",
    "cancelled": "o.status = 'cancelled'",
    # The latest refund failed and the money is still with Foodos.
    "refund_failed": """o.status = 'cancelled' and o.payment_status = 'paid' and (
        select f.status from refunds f where f.order_id = o.id order by f.created_at desc limit 1
      ) = 'failed'""",
}


def as_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found("order_not_found", "That order could not be found")


def _filters(
    search: Optional[str],
    restaurant_id: Optional[str],
    customer_id: Optional[str],
    rider_id: Optional[str],
    date_from: Optional[datetime.date],
    date_to: Optional[datetime.date],
) -> tuple[list[str], list[Any]]:
    conditions: list[str] = []
    args: list[Any] = []

    if search:
        term = search.strip()
        args.append(f"%{term}%")
        clause = (
            f"(o.order_number ilike ${len(args)} or r.name ilike ${len(args)} or u.full_name ilike ${len(args)}"
        )
        digits = "".join(ch for ch in term if ch.isdigit())

        # A phone number, not an order number: FD125487 has digits too.
        if len(digits) >= 4 and not term.upper().startswith("FD"):
            args.append(f"%{digits}%")
            clause += f" or u.phone like ${len(args)}"

        conditions.append(clause + ")")

    for value, column in ((restaurant_id, "o.restaurant_id"), (customer_id, "o.customer_id")):
        if value:
            args.append(as_uuid(value))
            conditions.append(f"{column} = ${len(args)}")

    if rider_id:
        args.append(as_uuid(rider_id))
        conditions.append(f"exists (select 1 from deliveries d where d.order_id = o.id and d.partner_id = ${len(args)})")

    if date_from:
        args.append(date_from)
        conditions.append(f"o.placed_at::date >= ${len(args)}")

    if date_to:
        args.append(date_to)
        conditions.append(f"o.placed_at::date <= ${len(args)}")

    return conditions, args


async def list_orders(
    view: Optional[str],
    search: Optional[str],
    restaurant_id: Optional[str],
    customer_id: Optional[str],
    rider_id: Optional[str],
    date_from: Optional[datetime.date],
    date_to: Optional[datetime.date],
    limit: int,
    offset: int,
) -> dict:
    conditions, args = _filters(search, restaurant_id, customer_id, rider_id, date_from, date_to)
    base_from = "from orders o join restaurants r on r.id = o.restaurant_id join users u on u.id = o.customer_id"
    base_where = f"where {' and '.join(conditions)}" if conditions else ""

    counts_row = await fetchrow(
        f"""
        select count(*)::int as everything,
               {", ".join(f"count(*) filter (where {sql})::int as {name}" for name, sql in VIEWS.items())}
        {base_from}
        {base_where}
        """,
        *args,
    )
    counts = {"all": counts_row["everything"], **{name: counts_row[name] for name in VIEWS}}

    if view:
        conditions.append(VIEWS[view])

    where = f"where {' and '.join(conditions)}" if conditions else ""

    rows = await fetch(
        f"""
        select o.id, o.order_number, o.status, o.total_paise, o.payment_method, o.payment_status,
               o.placed_at, o.cancelled_by,
               r.id as restaurant_id, r.name as restaurant_name,
               u.id as customer_id, u.full_name as customer_name, u.phone as customer_phone,
               d.status as delivery_status, ru.full_name as rider_name,
               (select f.status from refunds f where f.order_id = o.id order by f.created_at desc limit 1)
                 as refund_status,
               (select coalesce(sum(i.quantity), 0)::int from order_items i where i.order_id = o.id) as item_count
        {base_from}
        left join deliveries d on d.order_id = o.id
        left join users ru on ru.id = d.partner_id
        {where}
        order by o.placed_at desc
        limit ${len(args) + 1} offset ${len(args) + 2}
        """,
        *args,
        limit,
        offset,
    )

    total = counts[view] if view else counts["all"]

    return {
        "total": total,
        "counts": counts,
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
                "cancelledBy": row["cancelled_by"],
                "restaurant": {"id": str(row["restaurant_id"]), "name": row["restaurant_name"]},
                "customer": {
                    "id": str(row["customer_id"]),
                    "name": row["customer_name"],
                    "phone": row["customer_phone"],
                },
                "deliveryStatus": row["delivery_status"],
                "riderName": row["rider_name"],
                "refundStatus": row["refund_status"],
            }
            for row in rows
        ],
    }


async def get_order(order_id: str) -> dict:
    identifier = as_uuid(order_id)

    row = await fetchrow(
        """
        select o.id, o.status, o.payment_method, o.payment_status, o.cancelled_by, o.subtotal_paise,
               o.confirmed_at, o.ready_at, o.picked_up_at,
               u.id as customer_id, u.full_name as customer_name, u.phone as customer_phone,
               u.status as customer_status,
               r.id as restaurant_id, r.commission_pct, ou.phone as owner_phone, ou.full_name as owner_name,
               d.id as delivery_id, d.status as delivery_status, d.partner_id, d.total_distance_km,
               d.base_earning_paise + d.incentive_paise + d.tip_paise as rider_pay,
               d.accepted_at, d.delivered_at as rider_delivered_at,
               pu.full_name as rider_name, pu.phone as rider_phone
        from orders o
        join users u on u.id = o.customer_id
        join restaurants r on r.id = o.restaurant_id
        join users ou on ou.id = r.owner_id
        left join deliveries d on d.order_id = o.id
        left join users pu on pu.id = d.partner_id
        where o.id = $1
        """,
        identifier,
    )

    if row is None:
        raise not_found("order_not_found", "That order could not be found")

    view = await orders_service.order_view(identifier)

    payments = await fetch(
        """
        select provider, method, amount_paise, status, provider_order_id, provider_payment_id,
               failure_reason, created_at
        from payments where order_id = $1 order by created_at
        """,
        identifier,
    )

    refund_rows = await fetch(
        """
        select f.status, f.amount_paise, f.reason, f.provider_refund_id, f.created_at, f.processed_at,
               u.full_name as requested_by_name, u.email as requested_by_email
        from refunds f
        left join users u on u.id = f.requested_by
        where f.order_id = $1
        order by f.created_at
        """,
        identifier,
    )

    latest_refund = refund_rows[-1]["status"] if refund_rows else None
    captured = any(p["provider"] == "razorpay" and p["status"] == "captured" for p in payments)

    # The restaurant's commission is worked out at today's rate, the same way
    # the restaurant app shows it.
    commission = round(row["subtotal_paise"] * float(row["commission_pct"]) / 100)

    return {
        **view,
        "cancelledBy": row["cancelled_by"],
        "customer": {
            "id": str(row["customer_id"]),
            "name": row["customer_name"],
            "phone": row["customer_phone"],
            "blocked": row["customer_status"] == "blocked",
        },
        "restaurantOwner": {"name": row["owner_name"], "phone": row["owner_phone"]},
        "rider": {
            "id": str(row["partner_id"]),
            "name": row["rider_name"],
            "phone": row["rider_phone"],
            "deliveryStatus": row["delivery_status"],
            "payPaise": row["rider_pay"],
            "distanceKm": float(row["total_distance_km"]) if row["total_distance_km"] is not None else None,
            "acceptedAt": row["accepted_at"].isoformat() if row["accepted_at"] else None,
        }
        if row["partner_id"]
        else None,
        "deliveryStatus": row["delivery_status"],
        "commissionPaise": commission,
        "commissionPct": float(row["commission_pct"]),
        "payments": [
            {
                "provider": p["provider"],
                "method": p["method"],
                "amountPaise": p["amount_paise"],
                "status": p["status"],
                "providerOrderId": p["provider_order_id"],
                "providerPaymentId": p["provider_payment_id"],
                "failureReason": p["failure_reason"],
                "createdAt": p["created_at"].isoformat(),
            }
            for p in payments
        ],
        "refunds": [
            {
                "status": f["status"],
                "amountPaise": f["amount_paise"],
                "reason": f["reason"],
                "providerRefundId": f["provider_refund_id"],
                "requestedBy": f["requested_by_name"] or f["requested_by_email"],
                "requestedAt": f["created_at"].isoformat(),
                "processedAt": f["processed_at"].isoformat() if f["processed_at"] else None,
            }
            for f in refund_rows
        ],
        "actions": {
            "canCancel": row["status"] in LIVE,
            # A cancelled order whose money is still captured, with no refund
            # under way: the gateway refused it, or the server died mid-call.
            "canRetryRefund": row["status"] == "cancelled"
            and captured
            and latest_refund in (None, "failed"),
        },
    }


async def cancel(order_id: str, reason: str, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    identifier = as_uuid(order_id)
    reason = reason.strip()

    async with transaction() as connection:
        # Locked in the same order as a rider's step (delivery, then order),
        # so a rider tapping "Picked up" at this moment waits rather than
        # deadlocks.
        held = await connection.fetchrow(
            """
            select d.id, d.status, d.partner_id from deliveries d join orders o on o.id = d.order_id
            where d.order_id = $1
            for update of d, o
            """,
            identifier,
        )
        order = await connection.fetchrow(
            "select status, order_number from orders where id = $1 for update", identifier
        )

        if order is None:
            raise not_found("order_not_found", "That order could not be found")

        if order["status"] == "cancelled":
            raise conflict("order_already_cancelled", "That order is already cancelled")

        if order["status"] not in LIVE:
            raise conflict("order_not_cancellable", "This order has been delivered and cannot be cancelled")

        await connection.execute(
            """
            update orders
            set status = 'cancelled', cancelled_at = now(), cancelled_by = 'admin', cancellation_reason = $2
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
            actor_id,
            f"Cancelled by Foodos: {reason}",
        )

        # The rider, if any, is freed for the next order straight away.
        await connection.execute(
            "update deliveries set status = 'cancelled' where order_id = $1 and status <> all($2::text[])",
            identifier,
            list(RIDER_DONE),
        )

        await audit.record(
            actor_id,
            "Cancelled order",
            "Orders",
            "order",
            identifier,
            {"orderNumber": order["order_number"], "from": order["status"], "reason": reason},
            ip,
            connection,
        )

    # After the cancellation has committed, never inside it.
    await refunds.refund_if_paid(identifier, reason, actor_id)

    carrying = held is not None and held["status"] in ("accepted", "reached_restaurant", "picked_up", "arrived")
    await events.cancelled(
        identifier,
        "admin",
        restaurant_saw_it=order["status"] != "pending",
        rider_id=held["partner_id"] if carrying else None,
    )

    return await get_order(str(identifier))


async def retry_refund(order_id: str, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    identifier = as_uuid(order_id)
    detail = await get_order(str(identifier))

    if not detail["actions"]["canRetryRefund"]:
        if detail["status"] != "cancelled":
            raise conflict("order_not_cancelled", "Only a cancelled order can be refunded")

        if detail["refund"] and detail["refund"]["status"] in ("pending", "processed"):
            raise conflict("refund_in_progress", "A refund for this order is already under way")

        raise conflict("nothing_to_refund", "No online payment on this order is waiting to be refunded")

    refund = await refunds.refund_if_paid(identifier, "Refund retried by Foodos", actor_id)

    await audit.record(
        actor_id,
        "Retried refund",
        "Orders",
        "order",
        identifier,
        {"orderNumber": detail["orderNumber"], "result": refund["status"] if refund else None},
        ip,
    )

    return await get_order(str(identifier))
