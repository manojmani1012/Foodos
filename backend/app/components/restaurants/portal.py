"""The restaurant partner's own view: their dashboard, their order queue.

Every function here is scoped to the restaurant the signed-in owner owns. An
owner can never read or move another restaurant's orders.
"""

import uuid
from typing import Any, Optional

import datetime

from ...database import fetch, fetchrow, transaction
from ...errors import conflict, forbidden, not_found
from ..media import service as media
from ..delivery import service as delivery
from ..payments import refunds

# What the restaurant is allowed to do, and from where. The customer places the
# order (confirmed); the restaurant cooks it (preparing, ready); the delivery
# partner takes it from there.
ACCEPTABLE_FROM = {"pending", "confirmed"}
QUEUES = {
    "new": ["confirmed"],
    "preparing": ["preparing"],
    "ready": ["ready"],
    # Finished either way: the history an owner looks back through.
    "past": ["picked_up", "delivered", "cancelled"],
}


async def resolve_owned_restaurant(user_id: uuid.UUID) -> Any:
    """The restaurant this owner signs in as.

    One owner, one restaurant for now. Multi-outlet brands need a restaurant id
    on each request, which is a later change; until then the earliest is used and
    an owner with none is told to finish onboarding.
    """
    row = await fetchrow(
        """
        select id, name, description, cuisines, address_line, city, phone, image_url,
               is_veg, rating, rating_count, status, is_accepting_orders,
               avg_prep_minutes, commission_pct, opens_at, closes_at, created_at
        from restaurants
        where owner_id = $1
        order by created_at
        limit 1
        """,
        user_id,
    )

    if row is None:
        raise not_found(
            "restaurant_not_found",
            "No restaurant is linked to this account yet. Contact support to finish onboarding",
        )

    return row


def restaurant_to_dict(row: Any) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "description": row["description"],
        "cuisines": list(row["cuisines"] or []),
        "addressLine": row["address_line"],
        "city": row["city"],
        "phone": row["phone"],
        "imageUrl": row["image_url"],
        "isVeg": row["is_veg"],
        "rating": float(row["rating"]),
        "ratingCount": row["rating_count"],
        "status": row["status"],
        "isAcceptingOrders": row["is_accepting_orders"],
        "avgPrepMinutes": row["avg_prep_minutes"],
        "commissionPct": float(row["commission_pct"]),
        "opensAt": row["opens_at"].isoformat() if row["opens_at"] else None,
        "closesAt": row["closes_at"].isoformat() if row["closes_at"] else None,
    }


async def set_accepting_orders(restaurant_id: Any, accepting: bool) -> dict:
    """The toggle on the partner dashboard.

    Turning it off stops new orders; orders already in the kitchen are
    unaffected and still have to be finished.
    """
    row = await fetchrow(
        """
        update restaurants set is_accepting_orders = $2
        where id = $1
        returning id, name, description, cuisines, address_line, city, phone, image_url,
                  is_veg, rating, rating_count, status, is_accepting_orders,
                  avg_prep_minutes, commission_pct, opens_at, closes_at
        """,
        restaurant_id,
        accepting,
    )

    return restaurant_to_dict(row)


async def dashboard(restaurant_id: Any) -> dict:
    """Today's figures for the partner home screen.

    "Today" is the restaurant's own calendar day in the server's timezone, not a
    rolling 24 hours, so the numbers match what the owner counts at closing.
    """
    totals = await fetchrow(
        """
        select
          count(*) filter (where status <> 'cancelled')::int as orders_today,
          coalesce(sum(total_paise) filter (where status = 'delivered'), 0)::int as delivered_paise,
          coalesce(sum(total_paise) filter (where status not in ('cancelled', 'delivered')), 0)::int
            as in_progress_paise,
          count(*) filter (where status = 'cancelled')::int as cancelled_today
        from orders
        where restaurant_id = $1 and placed_at >= date_trunc('day', now())
        """,
        restaurant_id,
    )

    queues = await fetchrow(
        """
        select
          count(*) filter (where status = 'confirmed')::int as new_orders,
          count(*) filter (where status = 'preparing')::int as preparing,
          count(*) filter (where status = 'ready')::int as ready
        from orders
        where restaurant_id = $1 and status in ('confirmed', 'preparing', 'ready')
        """,
        restaurant_id,
    )

    menu = await fetchrow(
        """
        select
          count(*)::int as total_items,
          count(*) filter (where not is_available)::int as unavailable_items
        from menu_items
        where restaurant_id = $1 and deleted_at is null
        """,
        restaurant_id,
    )

    return {
        "ordersToday": totals["orders_today"],
        "cancelledToday": totals["cancelled_today"],
        # Revenue counts delivered orders only; anything still cooking could
        # still be cancelled, so it is reported separately.
        "revenueTodayPaise": totals["delivered_paise"],
        "inProgressPaise": totals["in_progress_paise"],
        "newOrders": queues["new_orders"],
        "preparing": queues["preparing"],
        "ready": queues["ready"],
        "menuItems": menu["total_items"],
        "unavailableItems": menu["unavailable_items"],
    }


def _order_summary(row: Any) -> dict:
    return {
        "id": str(row["id"]),
        "orderNumber": row["order_number"],
        "status": row["status"],
        "totalPaise": row["total_paise"],
        "itemCount": row["item_count"],
        "paymentMethod": row["payment_method"],
        "placedAt": row["placed_at"].isoformat(),
        "customerName": row["customer_name"],
        "specialInstructions": row["special_instructions"],
    }


async def list_orders(restaurant_id: Any, queue: Optional[str] = None, limit: int = 50) -> dict:
    statuses = QUEUES.get(queue) if queue else None

    rows = await fetch(
        """
        select o.id, o.order_number, o.status, o.total_paise, o.payment_method,
               o.placed_at, o.special_instructions,
               u.full_name as customer_name,
               (select coalesce(sum(i.quantity), 0)::int from order_items i where i.order_id = o.id)
                 as item_count
        from orders o
        join users u on u.id = o.customer_id
        where o.restaurant_id = $1
          and ($2::text[] is null or o.status = any($2::text[]))
        order by o.placed_at desc
        limit $3
        """,
        restaurant_id,
        statuses,
        limit,
    )

    return {"orders": [_order_summary(row) for row in rows]}


async def get_order(restaurant_id: Any, order_id: str) -> dict:
    try:
        identifier = uuid.UUID(order_id)
    except (ValueError, TypeError):
        raise not_found("order_not_found", "That order could not be found")

    order = await fetchrow(
        """
        select o.id, o.order_number, o.status, o.restaurant_id, o.subtotal_paise,
               o.delivery_fee_paise, o.packaging_fee_paise, o.tax_paise, o.discount_paise,
               o.total_paise, o.payment_method, o.payment_status, o.placed_at,
               o.special_instructions, o.delivery_address, o.cancellation_reason,
               u.full_name as customer_name, u.phone as customer_phone
        from orders o
        join users u on u.id = o.customer_id
        where o.id = $1
        """,
        identifier,
    )

    # Another restaurant's order is reported as missing, not forbidden, so this
    # cannot be used to discover which order ids exist.
    if order is None or order["restaurant_id"] != restaurant_id:
        raise not_found("order_not_found", "That order could not be found")

    items = await fetch(
        """
        select i.id, i.name, i.is_veg, i.unit_price_paise, i.quantity, i.line_total_paise
        from order_items i
        where i.order_id = $1
        order by i.name
        """,
        identifier,
    )

    addons = await fetch(
        """
        select a.order_item_id, a.name, a.price_paise
        from order_item_addons a
        join order_items i on i.id = a.order_item_id
        where i.order_id = $1
        """,
        identifier,
    )

    addons_by_item: dict[Any, list[dict]] = {}

    for addon in addons:
        addons_by_item.setdefault(addon["order_item_id"], []).append(
            {"name": addon["name"], "pricePaise": addon["price_paise"]}
        )

    return {
        "id": str(order["id"]),
        "orderNumber": order["order_number"],
        "status": order["status"],
        "customer": {"name": order["customer_name"], "phone": order["customer_phone"]},
        "items": [
            {
                "id": str(item["id"]),
                "name": item["name"],
                "isVeg": item["is_veg"],
                "quantity": item["quantity"],
                "unitPricePaise": item["unit_price_paise"],
                "lineTotalPaise": item["line_total_paise"],
                "addons": addons_by_item.get(item["id"], []),
            }
            for item in items
        ],
        "subtotalPaise": order["subtotal_paise"],
        "packagingFeePaise": order["packaging_fee_paise"],
        "taxPaise": order["tax_paise"],
        "discountPaise": order["discount_paise"],
        "totalPaise": order["total_paise"],
        "paymentMethod": order["payment_method"],
        "paymentStatus": order["payment_status"],
        "placedAt": order["placed_at"].isoformat(),
        "specialInstructions": order["special_instructions"],
        "cancellationReason": order["cancellation_reason"],
        "refund": await refunds.refund_for_order(identifier),
        "delivery": await delivery.tracking_for_order(identifier),
    }


async def _move_order(
    restaurant_id: Any,
    order_id: str,
    allowed_from: set[str],
    to_status: str,
    user_id: uuid.UUID,
    note: str,
    reason: Optional[str] = None,
) -> dict:
    """Advances one order, refusing any move the lifecycle does not allow."""
    try:
        identifier = uuid.UUID(order_id)
    except (ValueError, TypeError):
        raise not_found("order_not_found", "That order could not be found")

    async with transaction() as connection:
        # Locked for the transaction, so two taps on Accept cannot both succeed.
        order = await connection.fetchrow(
            "select restaurant_id, status from orders where id = $1 for update", identifier
        )

        if order is None or order["restaurant_id"] != restaurant_id:
            raise not_found("order_not_found", "That order could not be found")

        current = order["status"]

        if current == to_status:
            raise conflict("order_already_in_status", f"That order is already {to_status}")

        if current not in allowed_from:
            raise conflict(
                "order_transition_invalid",
                f"An order that is {current} cannot be moved to {to_status}",
            )

        if to_status == "cancelled":
            await connection.execute(
                """
                update orders
                set status = 'cancelled', cancelled_at = now(), cancelled_by = 'restaurant',
                    cancellation_reason = $2
                where id = $1
                """,
                identifier,
                reason,
            )
        else:
            # Each stage stamps its own timestamp column where the schema has one.
            column = {"preparing": None, "ready": "ready_at"}.get(to_status)

            if column:
                await connection.execute(
                    f"update orders set status = $2, {column} = now() where id = $1",
                    identifier,
                    to_status,
                )
            else:
                await connection.execute(
                    "update orders set status = $2 where id = $1", identifier, to_status
                )

        await connection.execute(
            """
            insert into order_status_history (order_id, status, actor_user_id, note)
            values ($1, $2, $3, $4)
            """,
            identifier,
            to_status,
            user_id,
            reason or note,
        )

    return await get_order(restaurant_id, order_id)


async def accept_order(restaurant_id: Any, order_id: str, user_id: uuid.UUID) -> dict:
    await _move_order(
        restaurant_id, order_id, ACCEPTABLE_FROM, "preparing", user_id, "Accepted by restaurant"
    )

    # Riders are sought as soon as cooking starts, not when the food is ready,
    # so one is usually waiting by the time it is.
    await delivery.open_delivery(uuid.UUID(order_id))

    return await get_order(restaurant_id, order_id)


async def reject_order(
    restaurant_id: Any, order_id: str, user_id: uuid.UUID, reason: Optional[str] = None
) -> dict:
    await _move_order(
        restaurant_id,
        order_id,
        ACCEPTABLE_FROM,
        "cancelled",
        user_id,
        "Rejected by restaurant",
        reason=reason or "Rejected by restaurant",
    )

    # After the cancellation has committed: a slow gateway must not hold the
    # order locked, and a failed refund must not un-reject the order.
    await refunds.refund_if_paid(uuid.UUID(order_id), reason or "Rejected by restaurant", user_id)

    return await get_order(restaurant_id, order_id)


async def mark_ready(restaurant_id: Any, order_id: str, user_id: uuid.UUID) -> dict:
    return await _move_order(
        restaurant_id, order_id, {"preparing"}, "ready", user_id, "Ready for pickup"
    )


RESTAURANT_COLUMNS = """
    id, name, description, cuisines, address_line, city, phone, image_url,
    is_veg, rating, rating_count, status, is_accepting_orders,
    avg_prep_minutes, commission_pct, opens_at, closes_at
"""


def _parse_time(value: Optional[str]) -> Optional[datetime.time]:
    return datetime.time.fromisoformat(value) if value else None


async def update_profile(restaurant_id: Any, changes: dict) -> dict:
    """Saves only the fields that were sent; an explicit null clears one."""
    columns = {
        "description": "description",
        "phone": "phone",
        "opensAt": "opens_at",
        "closesAt": "closes_at",
        "avgPrepMinutes": "avg_prep_minutes",
    }

    assignments = []
    args: list[Any] = [restaurant_id]

    for field, value in changes.items():
        if field in ("opensAt", "closesAt"):
            value = _parse_time(value)

        if field == "avgPrepMinutes" and value is None:
            # Not nullable: every order needs a prep-time estimate.
            continue

        args.append(value)
        assignments.append(f"{columns[field]} = ${len(args)}")

    if not assignments:
        raise conflict("nothing_to_update", "No changes were provided")

    row = await fetchrow(
        f"update restaurants set {', '.join(assignments)} where id = $1 returning {RESTAURANT_COLUMNS}",
        *args,
    )

    return restaurant_to_dict(row)


async def set_cover_image(restaurant_id: Any, owner_id: Any, data: Optional[bytes]) -> dict:
    """Replaces (or, with no data, removes) the restaurant's cover photo."""
    previous = await fetchrow("select image_url from restaurants where id = $1", restaurant_id)
    image_url = await media.store_image(owner_id, data) if data is not None else None

    row = await fetchrow(
        f"update restaurants set image_url = $2 where id = $1 returning {RESTAURANT_COLUMNS}",
        restaurant_id,
        image_url,
    )

    await media.delete_image(previous["image_url"] if previous else None, owner_id)

    return restaurant_to_dict(row)


async def reviews(restaurant_id: Any, limit: int = 50) -> dict:
    summary = await fetchrow(
        """
        select count(*)::int as total,
               coalesce(round(avg(rating)::numeric, 1), 0)::float as average,
               count(*) filter (where rating = 5)::int as five,
               count(*) filter (where rating = 4)::int as four,
               count(*) filter (where rating = 3)::int as three,
               count(*) filter (where rating = 2)::int as two,
               count(*) filter (where rating = 1)::int as one
        from restaurant_reviews
        where restaurant_id = $1
        """,
        restaurant_id,
    )

    rows = await fetch(
        """
        select rv.rating, rv.comment, rv.created_at, o.order_number,
               split_part(coalesce(u.full_name, ''), ' ', 1) as first_name
        from restaurant_reviews rv
        join orders o on o.id = rv.order_id
        join users u on u.id = rv.user_id
        where rv.restaurant_id = $1
        order by rv.created_at desc
        limit $2
        """,
        restaurant_id,
        limit,
    )

    return {
        "summary": {
            "total": summary["total"],
            "average": summary["average"],
            # Index 0 is one star.
            "distribution": [
                summary["one"],
                summary["two"],
                summary["three"],
                summary["four"],
                summary["five"],
            ],
        },
        "reviews": [
            {
                "rating": row["rating"],
                "comment": row["comment"],
                "createdAt": row["created_at"].isoformat(),
                "orderNumber": row["order_number"],
                # First name only: enough to recognise a regular, no more.
                "customerName": row["first_name"] or "Customer",
            }
            for row in rows
        ],
    }


async def earnings(restaurant_id: Any, commission_pct: float, days: int) -> dict:
    """Day-by-day takings for the last `days` days.

    The restaurant's share of an order is its food plus packaging, less the
    Foodos commission on the food. Tax goes to the government and the delivery
    fee and tip to Foodos and the rider, so neither counts here. Only delivered
    orders are earned; orders still moving are reported separately.
    """
    rows = await fetch(
        """
        with days as (
          select generate_series(current_date - ($2::int - 1), current_date, interval '1 day')::date as day
        )
        select d.day,
               count(o.id) filter (where o.status = 'delivered')::int as orders,
               coalesce(sum(o.subtotal_paise) filter (where o.status = 'delivered'), 0)::bigint as food,
               coalesce(sum(o.packaging_fee_paise) filter (where o.status = 'delivered'), 0)::bigint as packaging
        from days d
        left join orders o
          on o.restaurant_id = $1 and o.placed_at::date = d.day
        group by d.day
        order by d.day
        """,
        restaurant_id,
        days,
    )

    in_progress = await fetchrow(
        """
        select count(*)::int as orders, coalesce(sum(subtotal_paise), 0)::bigint as food
        from orders
        where restaurant_id = $1
          and status in ('confirmed', 'preparing', 'ready', 'picked_up')
          and placed_at::date > current_date - $2::int
        """,
        restaurant_id,
        days,
    )

    rate = commission_pct / 100

    def share(food: int, packaging: int) -> dict:
        commission = round(food * rate)

        return {
            "foodPaise": int(food),
            "packagingPaise": int(packaging),
            "commissionPaise": commission,
            "earningsPaise": int(food + packaging - commission),
        }

    daily = [
        {"date": row["day"].isoformat(), "orders": row["orders"], **share(row["food"], row["packaging"])}
        for row in rows
    ]

    return {
        "days": days,
        "commissionPct": commission_pct,
        "totals": {
            "orders": sum(d["orders"] for d in daily),
            **share(sum(d["foodPaise"] for d in daily), sum(d["packagingPaise"] for d in daily)),
        },
        "daily": daily,
        "inProgress": {"orders": in_progress["orders"], "foodPaise": int(in_progress["food"])},
    }
