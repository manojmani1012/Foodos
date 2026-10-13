"""Delivery: getting a cooked order from the restaurant to the customer.

The life of a delivery:

    restaurant accepts the order  ->  delivery opens as `searching`
    a rider accepts               ->  accepted
    rider at the restaurant       ->  reached_restaurant
    rider has the food            ->  picked_up    (order: picked_up)
    rider at the customer         ->  arrived      (order: on_the_way)
    handed over                   ->  delivered    (order: delivered)

Dispatch is first come, first served: every online rider in the city sees an
open delivery, and the first to accept gets it. The delivery row is locked for
that decision, so two riders tapping Accept together cannot both win.

A rider who signs up starts as `pending` and cannot take orders until an admin
approves them. Only `active` riders can go online.
"""

import json
import math
import uuid
from typing import Any, Optional

from ...config import get_settings
from ...database import fetch, fetchrow, fetchval, transaction
from ...errors import bad_request, conflict, forbidden, not_found

# Statuses where the rider still has the order in hand.
ACTIVE = ("accepted", "reached_restaurant", "picked_up", "arrived")

# Each rider action: which delivery statuses it may follow, the status it sets,
# the timestamp it stamps, and what the customer's order becomes (if anything).
#
# The "reached restaurant" tap is informational, so picking up straight from
# accepted is allowed; likewise "arrived" may be skipped. A rider who forgets a
# tap should not be stuck unable to finish the delivery.
ACTIONS = {
    "reached": ({"accepted"}, "reached_restaurant", "reached_restaurant_at", None),
    "picked-up": ({"accepted", "reached_restaurant"}, "picked_up", "picked_up_at", "picked_up"),
    "arrived": ({"picked_up"}, "arrived", "arrived_at", "on_the_way"),
    "delivered": ({"picked_up", "arrived"}, "delivered", "delivered_at", "delivered"),
}

ORDER_NOTES = {
    "picked_up": "Picked up by the delivery partner",
    "on_the_way": "Delivery partner has arrived",
    "delivered": "Delivered",
}


# --- Helpers ---------------------------------------------------------------


def _as_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found("delivery_not_found", "That delivery could not be found")


def distance_km(a_lat: Any, a_lng: Any, b_lat: Any, b_lng: Any) -> Optional[float]:
    """Straight-line distance between two points, or None if either is unknown.

    Roads are longer than a straight line, so this slightly underestimates;
    road distance needs a routing service and is a later change.
    """
    if None in (a_lat, a_lng, b_lat, b_lng):
        return None

    lat1, lng1, lat2, lng2 = map(math.radians, map(float, (a_lat, a_lng, b_lat, b_lng)))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2

    return round(2 * 6371 * math.asin(math.sqrt(h)), 2)


def rider_pay(total_km: Optional[float]) -> int:
    settings = get_settings()

    return settings.rider_base_pay_paise + round((total_km or 0) * settings.rider_pay_per_km_paise)


def _address(order_address: Any) -> dict:
    if isinstance(order_address, str):
        return json.loads(order_address)

    return dict(order_address or {})


def _first_name(full_name: Optional[str]) -> str:
    return (full_name or "").split(" ")[0] or "Customer"


# --- Opening a delivery ----------------------------------------------------


async def open_delivery(order_id: uuid.UUID) -> None:
    """Called once the restaurant accepts an order. Safe to call twice."""
    await fetchval(
        """
        insert into deliveries (order_id) values ($1)
        on conflict (order_id) do nothing
        returning id
        """,
        order_id,
    )


# --- The rider -------------------------------------------------------------


async def _partner(user_id: uuid.UUID) -> Any:
    row = await fetchrow(
        """
        select p.user_id, p.vehicle_type, p.vehicle_number, p.city, p.status, p.is_online,
               p.current_latitude, p.current_longitude, p.last_location_at, p.rating, p.rating_count,
               u.full_name, u.phone
        from delivery_partners p
        join users u on u.id = p.user_id
        where p.user_id = $1
        """,
        user_id,
    )

    if row is None:
        raise not_found("partner_not_found", "No delivery partner profile exists for this account")

    return row


def _partner_to_dict(row: Any) -> dict:
    return {
        "name": row["full_name"],
        "phone": row["phone"],
        "status": row["status"],
        "isOnline": row["is_online"],
        "vehicleType": row["vehicle_type"],
        "vehicleNumber": row["vehicle_number"],
        "city": row["city"],
        "rating": float(row["rating"]),
        "ratingCount": row["rating_count"],
    }


async def profile(user_id: uuid.UUID) -> dict:
    partner = await _partner(user_id)

    today = await fetchrow(
        """
        select count(*)::int as deliveries,
               coalesce(sum(base_earning_paise + incentive_paise + tip_paise), 0)::int as earnings
        from deliveries
        where partner_id = $1 and status = 'delivered' and delivered_at::date = current_date
        """,
        user_id,
    )

    return {
        **_partner_to_dict(partner),
        "today": {"deliveries": today["deliveries"], "earningsPaise": today["earnings"]},
    }


async def update_profile(user_id: uuid.UUID, changes: dict) -> dict:
    async with transaction() as connection:
        if "fullName" in changes and changes["fullName"]:
            await connection.execute(
                "update users set full_name = $2 where id = $1", user_id, changes["fullName"].strip()
            )

        columns = {"vehicleType": "vehicle_type", "vehicleNumber": "vehicle_number", "city": "city"}
        assignments, args = [], [user_id]

        for field, column in columns.items():
            if field in changes:
                args.append(changes[field])
                assignments.append(f"{column} = ${len(args)}")

        if assignments:
            await connection.execute(
                f"update delivery_partners set {', '.join(assignments)} where user_id = $1", *args
            )

    return await profile(user_id)


async def set_online(user_id: uuid.UUID, online: bool) -> dict:
    partner = await _partner(user_id)

    if online and partner["status"] != "active":
        raise forbidden(
            "partner_not_approved",
            "Your account is waiting for approval. You can go online once Foodos has verified it",
        )

    await fetchval(
        "update delivery_partners set is_online = $2 where user_id = $1 returning 1", user_id, online
    )

    return await profile(user_id)


async def update_location(user_id: uuid.UUID, latitude: float, longitude: float) -> None:
    await fetchval(
        """
        update delivery_partners
        set current_latitude = $2, current_longitude = $3, last_location_at = now()
        where user_id = $1
        returning 1
        """,
        user_id,
        latitude,
        longitude,
    )


# --- Finding work ----------------------------------------------------------


async def open_requests(user_id: uuid.UUID) -> list[dict]:
    """The deliveries this rider could take right now.

    Empty unless the rider is approved, online and not already carrying an
    order: one delivery at a time.
    """
    partner = await _partner(user_id)

    if partner["status"] != "active" or not partner["is_online"]:
        return []

    busy = await fetchval(
        "select 1 from deliveries where partner_id = $1 and status = any($2::text[])",
        user_id,
        list(ACTIVE),
    )

    if busy:
        return []

    rows = await fetch(
        """
        select d.id, d.created_at, o.order_number, o.status as order_status, o.payment_method,
               o.payment_status, o.total_paise, o.tip_paise, o.delivery_address,
               r.name as restaurant_name, r.address_line as restaurant_area, r.city as restaurant_city,
               r.latitude as restaurant_lat, r.longitude as restaurant_lng,
               (select coalesce(sum(i.quantity), 0)::int from order_items i where i.order_id = o.id) as item_count
        from deliveries d
        join orders o on o.id = d.order_id
        join restaurants r on r.id = o.restaurant_id
        where d.status = 'searching'
          and o.status in ('preparing', 'ready')
          and ($2::text is null or lower(r.city) = lower($2))
          and not exists (
            select 1 from delivery_requests q
            where q.delivery_id = d.id and q.partner_id = $1 and q.status = 'rejected'
          )
        order by d.created_at
        limit 10
        """,
        user_id,
        partner["city"],
    )

    offers = []

    for row in rows:
        address = _address(row["delivery_address"])
        pickup = distance_km(
            partner["current_latitude"], partner["current_longitude"], row["restaurant_lat"], row["restaurant_lng"]
        )
        drop = distance_km(
            row["restaurant_lat"], row["restaurant_lng"], address.get("latitude"), address.get("longitude")
        )
        total = None if pickup is None and drop is None else round((pickup or 0) + (drop or 0), 2)

        offers.append(
            {
                "id": str(row["id"]),
                "orderNumber": row["order_number"],
                "foodReady": row["order_status"] == "ready",
                "restaurant": {"name": row["restaurant_name"], "area": row["restaurant_area"]},
                "dropArea": ", ".join(filter(None, [address.get("line2") or address.get("line1"), address.get("city")])),
                "itemCount": row["item_count"],
                "pickupKm": pickup,
                "dropKm": drop,
                "earningPaise": rider_pay(total) + row["tip_paise"],
                # Cash orders: what the rider must collect at the door.
                "collectPaise": row["total_paise"]
                if row["payment_method"] == "cod" and row["payment_status"] != "paid"
                else 0,
                "openedAt": row["created_at"].isoformat(),
            }
        )

    return offers


async def accept(user_id: uuid.UUID, delivery_id: str) -> dict:
    identifier = _as_uuid(delivery_id)

    async with transaction() as connection:
        # Rider first, then delivery: always the same order, so two accepts
        # can never deadlock against each other.
        partner = await connection.fetchrow(
            """
            select status, is_online, current_latitude, current_longitude
            from delivery_partners where user_id = $1 for update
            """,
            user_id,
        )

        if partner is None or partner["status"] != "active":
            raise forbidden("partner_not_approved", "Your account is not approved for deliveries yet")

        if not partner["is_online"]:
            raise conflict("partner_offline", "Go online to accept deliveries")

        busy = await connection.fetchval(
            "select 1 from deliveries where partner_id = $1 and status = any($2::text[])",
            user_id,
            list(ACTIVE),
        )

        if busy:
            raise conflict("partner_busy", "Finish your current delivery before taking another")

        delivery = await connection.fetchrow(
            """
            select d.id, d.status, o.tip_paise, o.delivery_address,
                   r.latitude as restaurant_lat, r.longitude as restaurant_lng
            from deliveries d
            join orders o on o.id = d.order_id
            join restaurants r on r.id = o.restaurant_id
            where d.id = $1
            for update of d
            """,
            identifier,
        )

        if delivery is None:
            raise not_found("delivery_not_found", "That delivery could not be found")

        if delivery["status"] != "searching":
            raise conflict("delivery_taken", "Another delivery partner has already taken this order")

        address = _address(delivery["delivery_address"])
        pickup = distance_km(
            partner["current_latitude"], partner["current_longitude"],
            delivery["restaurant_lat"], delivery["restaurant_lng"],
        )
        drop = distance_km(
            delivery["restaurant_lat"], delivery["restaurant_lng"], address.get("latitude"), address.get("longitude")
        )
        total = None if pickup is None and drop is None else round((pickup or 0) + (drop or 0), 2)

        await connection.execute(
            """
            update deliveries
            set partner_id = $2, status = 'accepted', accepted_at = now(),
                pickup_distance_km = $3, drop_distance_km = $4, total_distance_km = $5,
                base_earning_paise = $6, tip_paise = $7
            where id = $1
            """,
            identifier,
            user_id,
            pickup,
            drop,
            total,
            rider_pay(total),
            delivery["tip_paise"],
        )

        await connection.execute(
            """
            insert into delivery_requests (delivery_id, partner_id, status, expected_earning_paise,
                                           expires_at, responded_at)
            values ($1, $2, 'accepted', $3, now(), now())
            on conflict (delivery_id, partner_id)
            do update set status = 'accepted', responded_at = now()
            """,
            identifier,
            user_id,
            rider_pay(total) + delivery["tip_paise"],
        )

    return await active(user_id)


async def reject(user_id: uuid.UUID, delivery_id: str) -> None:
    """Hides an offer from this rider. Other riders still see it."""
    identifier = _as_uuid(delivery_id)

    exists = await fetchval("select 1 from deliveries where id = $1", identifier)

    if not exists:
        raise not_found("delivery_not_found", "That delivery could not be found")

    await fetchval(
        """
        insert into delivery_requests (delivery_id, partner_id, status, expected_earning_paise,
                                       expires_at, responded_at)
        values ($1, $2, 'rejected', 0, now(), now())
        on conflict (delivery_id, partner_id)
        do update set status = 'rejected', responded_at = now()
        returning 1
        """,
        identifier,
        user_id,
    )


# --- Doing the delivery ----------------------------------------------------


async def advance(user_id: uuid.UUID, delivery_id: str, action: str, cash_collected: bool = False) -> dict:
    if action not in ACTIONS:
        raise not_found("action_not_found", "Unknown delivery step")

    allowed_from, to_status, stamp, order_status = ACTIONS[action]
    identifier = _as_uuid(delivery_id)

    async with transaction() as connection:
        delivery = await connection.fetchrow(
            """
            select d.id, d.status, d.partner_id, d.order_id, o.status as order_status,
                   o.payment_method, o.payment_status
            from deliveries d
            join orders o on o.id = d.order_id
            where d.id = $1
            for update of d, o
            """,
            identifier,
        )

        # Another rider's delivery is reported as missing, not forbidden.
        if delivery is None or delivery["partner_id"] != user_id:
            raise not_found("delivery_not_found", "That delivery could not be found")

        if delivery["status"] == to_status:
            raise conflict("delivery_already_in_status", "That step is already done")

        if delivery["status"] not in allowed_from:
            raise conflict(
                "delivery_step_invalid",
                f"This delivery is {delivery['status'].replace('_', ' ')}; that step does not come next",
            )

        if action == "picked-up" and delivery["order_status"] != "ready":
            raise conflict(
                "order_not_ready",
                "The restaurant has not marked this order ready yet. Wait for them to hand it over",
            )

        cash_order = delivery["payment_method"] == "cod" and delivery["payment_status"] != "paid"

        if action == "delivered" and cash_order and not cash_collected:
            raise bad_request(
                "cash_not_confirmed", "This is a cash order. Confirm you collected the cash first"
            )

        await connection.execute(
            f"update deliveries set status = $2, {stamp} = now() where id = $1", identifier, to_status
        )

        if order_status:
            order_stamp = {"picked_up": "picked_up_at", "delivered": "delivered_at"}.get(order_status)
            stamp_sql = f", {order_stamp} = now()" if order_stamp else ""
            paid_sql = ", payment_status = 'paid'" if order_status == "delivered" and cash_order else ""

            await connection.execute(
                f"update orders set status = $2{stamp_sql}{paid_sql} where id = $1",
                delivery["order_id"],
                order_status,
            )

            await connection.execute(
                """
                insert into order_status_history (order_id, status, actor_user_id, note)
                values ($1, $2, $3, $4)
                """,
                delivery["order_id"],
                order_status,
                user_id,
                ORDER_NOTES[order_status],
            )

    if to_status == "delivered":
        return {"delivered": True, "delivery": await _delivery_detail(identifier)}

    return await active(user_id)


async def active(user_id: uuid.UUID) -> dict:
    """The delivery this rider is on now, or {"delivery": None}."""
    identifier = await fetchval(
        """
        select id from deliveries
        where partner_id = $1 and status = any($2::text[])
        order by accepted_at desc
        limit 1
        """,
        user_id,
        list(ACTIVE),
    )

    return {"delivery": await _delivery_detail(identifier) if identifier else None}


async def _delivery_detail(identifier: uuid.UUID) -> dict:
    row = await fetchrow(
        """
        select d.id, d.status, d.pickup_distance_km, d.drop_distance_km, d.total_distance_km,
               d.base_earning_paise, d.incentive_paise, d.tip_paise,
               d.accepted_at, d.picked_up_at, d.delivered_at,
               o.id as order_id, o.order_number, o.status as order_status, o.payment_method,
               o.payment_status, o.total_paise, o.delivery_address, o.special_instructions,
               r.name as restaurant_name, r.address_line as restaurant_address, r.city as restaurant_city,
               r.phone as restaurant_phone, r.latitude as restaurant_lat, r.longitude as restaurant_lng,
               u.full_name as customer_name, u.phone as customer_phone
        from deliveries d
        join orders o on o.id = d.order_id
        join restaurants r on r.id = o.restaurant_id
        join users u on u.id = o.customer_id
        where d.id = $1
        """,
        identifier,
    )

    items = await fetch(
        "select name, quantity from order_items where order_id = $1 order by name", row["order_id"]
    )
    address = _address(row["delivery_address"])
    cash_due = row["payment_method"] == "cod" and row["payment_status"] != "paid"

    return {
        "id": str(row["id"]),
        "status": row["status"],
        "orderNumber": row["order_number"],
        "orderStatus": row["order_status"],
        "foodReady": row["order_status"] in ("ready", "picked_up", "on_the_way", "delivered"),
        "restaurant": {
            "name": row["restaurant_name"],
            "address": ", ".join(filter(None, [row["restaurant_address"], row["restaurant_city"]])),
            "phone": row["restaurant_phone"],
            "latitude": float(row["restaurant_lat"]) if row["restaurant_lat"] is not None else None,
            "longitude": float(row["restaurant_lng"]) if row["restaurant_lng"] is not None else None,
        },
        "customer": {
            # First name only: the rider needs to ask for someone, not know them.
            "name": _first_name(row["customer_name"]),
            "phone": row["customer_phone"],
            "address": ", ".join(
                filter(None, [address.get("line1"), address.get("line2"), address.get("city"), address.get("pincode")])
            ),
            "latitude": address.get("latitude"),
            "longitude": address.get("longitude"),
            "instructions": row["special_instructions"],
        },
        "items": [{"name": item["name"], "quantity": item["quantity"]} for item in items],
        "paymentMethod": row["payment_method"],
        "collectPaise": row["total_paise"] if cash_due else 0,
        "distanceKm": float(row["total_distance_km"]) if row["total_distance_km"] is not None else None,
        "earningPaise": row["base_earning_paise"] + row["incentive_paise"] + row["tip_paise"],
        "tipPaise": row["tip_paise"],
        "acceptedAt": row["accepted_at"].isoformat() if row["accepted_at"] else None,
        "deliveredAt": row["delivered_at"].isoformat() if row["delivered_at"] else None,
    }


# --- Earnings and history --------------------------------------------------


async def earnings(user_id: uuid.UUID, days: int) -> dict:
    rows = await fetch(
        """
        with days as (
          select generate_series(current_date - ($2::int - 1), current_date, interval '1 day')::date as day
        )
        select d.day,
               count(x.id)::int as deliveries,
               coalesce(sum(x.base_earning_paise), 0)::int as base,
               coalesce(sum(x.incentive_paise), 0)::int as incentive,
               coalesce(sum(x.tip_paise), 0)::int as tips,
               coalesce(sum(x.total_distance_km), 0)::float as km
        from days d
        left join deliveries x
          on x.partner_id = $1 and x.status = 'delivered' and x.delivered_at::date = d.day
        group by d.day
        order by d.day
        """,
        user_id,
        days,
    )

    cash = await fetchval(
        """
        select coalesce(sum(o.total_paise), 0)::int
        from deliveries d join orders o on o.id = d.order_id
        where d.partner_id = $1 and d.status = 'delivered' and o.payment_method = 'cod'
          and d.delivered_at::date = current_date
        """,
        user_id,
    )

    daily = [
        {
            "date": row["day"].isoformat(),
            "deliveries": row["deliveries"],
            "basePaise": row["base"],
            "incentivePaise": row["incentive"],
            "tipsPaise": row["tips"],
            "earningsPaise": row["base"] + row["incentive"] + row["tips"],
            "distanceKm": round(row["km"], 1),
        }
        for row in rows
    ]

    def total(key: str):
        return sum(day[key] for day in daily)

    return {
        "days": days,
        "totals": {
            "deliveries": total("deliveries"),
            "basePaise": total("basePaise"),
            "incentivePaise": total("incentivePaise"),
            "tipsPaise": total("tipsPaise"),
            "earningsPaise": total("earningsPaise"),
            "distanceKm": round(total("distanceKm"), 1),
        },
        "daily": daily,
        # Cash taken from customers today, which the rider owes Foodos.
        "cashCollectedTodayPaise": cash,
    }


async def history(user_id: uuid.UUID, limit: int = 30) -> list[dict]:
    ids = await fetch(
        """
        select id from deliveries
        where partner_id = $1 and status = 'delivered'
        order by delivered_at desc
        limit $2
        """,
        user_id,
        limit,
    )

    return [await _delivery_detail(row["id"]) for row in ids]


# --- What customers and restaurants see ------------------------------------


async def tracking_for_order(order_id: uuid.UUID) -> Optional[dict]:
    """The rider on an order, for the customer and restaurant screens."""
    row = await fetchrow(
        """
        select d.status, d.accepted_at, d.picked_up_at,
               u.full_name, u.phone, p.vehicle_type, p.vehicle_number,
               p.current_latitude, p.current_longitude, p.last_location_at
        from deliveries d
        left join delivery_partners p on p.user_id = d.partner_id
        left join users u on u.id = d.partner_id
        where d.order_id = $1
        """,
        order_id,
    )

    if row is None:
        return None

    carrying = row["status"] in ACTIVE

    return {
        "status": row["status"],
        "partner": None
        if row["full_name"] is None and row["phone"] is None
        else {
            "name": _first_name(row["full_name"]),
            # The number only while the order is on its way; afterwards there
            # is no reason for either side to keep calling.
            "phone": row["phone"] if carrying else None,
            "vehicleType": row["vehicle_type"],
            "vehicleNumber": row["vehicle_number"],
        },
        # Live position only while the rider has the order.
        "location": {
            "latitude": float(row["current_latitude"]),
            "longitude": float(row["current_longitude"]),
            "updatedAt": row["last_location_at"].isoformat() if row["last_location_at"] else None,
        }
        if carrying and row["current_latitude"] is not None
        else None,
    }
