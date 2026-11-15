"""Delivery: getting a cooked order from the restaurant to the customer.

The life of a delivery:

    restaurant accepts the order  ->  delivery opens as `searching`
    a rider accepts               ->  accepted
    rider at the restaurant       ->  reached_restaurant
    rider has the food            ->  picked_up    (order: picked_up)
    rider at the customer         ->  arrived      (order: on_the_way)
    handed over                   ->  delivered    (order: delivered)

Dispatch (see dispatch.py) offers each open delivery to one rider at a time,
nearest first, for a few seconds each. Only the rider holding the offer can
accept it, and the delivery row is locked for that decision.

"Reached the restaurant" and "arrived at the customer" are only accepted
within `geofence_metres` of the pin, and the steps cannot be skipped. The order
is only delivered when the rider enters the customer's 4-digit code.

A rider who signs up starts as `pending` and cannot take orders until an admin
approves them. Only `active` riders can go online.
"""

import uuid
from typing import Any, Optional

from ...config import get_settings
from ...database import fetch, fetchrow, fetchval, transaction
from ...errors import AppError, bad_request, conflict, forbidden, not_found
from ..geo import distance_km
from ..notifications import events
from ..orders.delivery_code import LOCK_SECONDS, MAX_ATTEMPTS, code_required
from . import dispatch
from .dispatch import ACTIVE, as_address as _address, rider_pay, trip

# Each rider action: which delivery statuses it may follow, the status it sets,
# the timestamp it stamps, and what the customer's order becomes (if anything).
#
# No step can be skipped. "Reached" and "arrived" are checked against the map
# (a rider once marked "reached the restaurant" from 18 km away), so picking up
# without reaching, or delivering without arriving, would undo that check.
ACTIONS = {
    "reached": ({"accepted"}, "reached_restaurant", "reached_restaurant_at", None),
    "picked-up": ({"reached_restaurant"}, "picked_up", "picked_up_at", "picked_up"),
    "arrived": ({"picked_up"}, "arrived", "arrived_at", "on_the_way"),
    "delivered": ({"arrived"}, "delivered", "delivered_at", "delivered"),
}

# The two steps that must happen at a place, and which place.
AT_PLACE = {"reached": "pickup location", "arrived": "customer's location"}

# A position older than this is not proof of where the rider is now.
STEP_LOCATION_FRESH_SECONDS = 120

# Phone GPS can be off by tens of metres indoors. Up to this much of the
# reported accuracy is given the rider the benefit of the doubt.
MAX_ACCURACY_SLACK_METRES = 50

# Who hears about each rider step: the restaurant when the rider is at the
# counter, the customer for everything after.
STEP_EVENTS = {
    "reached": events.rider_at_restaurant,
    "picked-up": events.picked_up,
    "arrived": events.rider_arrived,
    "delivered": events.delivered,
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


def _format_distance(km: float) -> str:
    return f"{round(km * 1000)} m" if km < 1 else f"{km:.1f} km"


def _first_name(full_name: Optional[str]) -> str:
    return (full_name or "").split(" ")[0] or "Customer"


# --- Opening a delivery ----------------------------------------------------


async def open_delivery(order_id: uuid.UUID) -> None:
    """Called once the restaurant accepts an order, and offers it to the
    nearest free rider straight away. Safe to call twice."""
    await fetchval(
        """
        insert into deliveries (order_id) values ($1)
        on conflict (order_id) do nothing
        returning id
        """,
        order_id,
    )

    delivery_id = await fetchval("select id from deliveries where order_id = $1", order_id)

    await dispatch.offer_next(delivery_id)


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
    """The delivery offered to this rider right now, if any.

    Empty unless the rider is approved, online and not already carrying an
    order. Dispatch puts an offer on one rider's screen at a time; this lists
    it with the seconds left to accept.
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
        select d.id, d.created_at, q.expires_at,
               greatest(0, extract(epoch from q.expires_at - now()))::int as seconds_left,
               o.order_number, o.status as order_status, o.payment_method,
               o.payment_status, o.total_paise, o.tip_paise, o.delivery_address, o.is_test,
               r.name as restaurant_name, r.address_line as restaurant_area, r.city as restaurant_city,
               r.latitude as restaurant_lat, r.longitude as restaurant_lng,
               (select coalesce(sum(i.quantity), 0)::int from order_items i where i.order_id = o.id) as item_count
        from delivery_requests q
        join deliveries d on d.id = q.delivery_id
        join orders o on o.id = d.order_id
        join restaurants r on r.id = o.restaurant_id
        where q.partner_id = $1 and q.status = 'sent' and q.expires_at > now()
          and d.status = 'searching'
          and o.status in ('preparing', 'ready')
        order by q.sent_at
        """,
        user_id,
    )

    offers = []

    for row in rows:
        address = _address(row["delivery_address"])
        pickup, drop, total = trip(
            partner["current_latitude"],
            partner["current_longitude"],
            row["restaurant_lat"],
            row["restaurant_lng"],
            address,
        )

        offers.append(
            {
                "id": str(row["id"]),
                "orderNumber": row["order_number"],
                "isTest": row["is_test"],
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
                # The offer moves to the next rider when this runs out.
                "expiresAt": row["expires_at"].isoformat(),
                "secondsLeft": row["seconds_left"],
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
            select d.id, d.status, d.order_id, o.tip_paise, o.delivery_address,
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

        # Only the rider this order is offered to can take it. A few seconds
        # of grace cover a tap made just as the countdown reached zero.
        offer = await connection.fetchrow(
            """
            select status, expires_at > now() - interval '5 seconds' as live
            from delivery_requests where delivery_id = $1 and partner_id = $2
            """,
            identifier,
            user_id,
        )

        if offer is None or offer["status"] != "sent" or not offer["live"]:
            raise conflict(
                "offer_expired",
                "This request has expired. Stay online: the next order near you comes straight to your screen",
            )

        pickup, drop, total = trip(
            partner["current_latitude"],
            partner["current_longitude"],
            delivery["restaurant_lat"],
            delivery["restaurant_lng"],
            _address(delivery["delivery_address"]),
        )

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

    await events.rider_assigned(delivery["order_id"])

    return await active(user_id)


async def reject(user_id: uuid.UUID, delivery_id: str) -> None:
    """Skips an offer. It goes straight to the next nearest rider, and this
    rider is not offered it again."""
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

    await dispatch.offer_next(identifier)


# --- Doing the delivery ----------------------------------------------------


async def _check_code(user_id: uuid.UUID, identifier: uuid.UUID, code: Optional[str]) -> None:
    """The customer's code, before "delivered" is allowed.

    Its own transaction, so a wrong guess is counted even though the step then
    fails. Five wrong guesses lock it for two minutes.
    """
    problem: Optional[AppError] = None

    async with transaction() as connection:
        row = await connection.fetchrow(
            """
            select d.partner_id, d.code_attempts, d.code_locked_until > now() as locked,
                   ceil(extract(epoch from d.code_locked_until - now()) / 60)::int as wait_minutes,
                   o.delivery_code, o.payment_method
            from deliveries d
            join orders o on o.id = d.order_id
            where d.id = $1
            for update of d
            """,
            identifier,
        )

        if row is None or row["partner_id"] != user_id:
            raise not_found("delivery_not_found", "That delivery could not be found")

        if not row["delivery_code"] or not code_required(row["payment_method"]):
            return

        entered = (code or "").strip()

        if row["locked"]:
            problem = AppError(
                429,
                "code_locked",
                f"Too many wrong codes. Try again in {row['wait_minutes']} min, or call Foodos support",
            )
        elif not entered:
            problem = bad_request("code_required", "Ask the customer for their 4-digit delivery code")
        elif entered != row["delivery_code"]:
            attempts = row["code_attempts"] + 1
            locked = attempts >= MAX_ATTEMPTS

            await connection.execute(
                """
                update deliveries
                set code_attempts = $2,
                    code_locked_until = case when $3 then now() + make_interval(secs => $4) end
                where id = $1
                """,
                identifier,
                0 if locked else attempts,
                locked,
                LOCK_SECONDS,
            )

            problem = bad_request(
                "code_wrong",
                "That code is not right. Check it with the customer"
                if not locked
                else f"Too many wrong codes. Try again in {LOCK_SECONDS // 60} min, or call Foodos support",
            )
        elif row["code_attempts"]:
            await connection.execute("update deliveries set code_attempts = 0 where id = $1", identifier)

    if problem:
        raise problem


def _check_place(action: str, delivery: Any, here: Optional[tuple[float, float]], accuracy: Optional[float]) -> None:
    """Refuses "reached" and "arrived" away from the pin, like Swiggy does."""
    place = AT_PLACE.get(action)

    if place is None:
        return

    if action == "reached":
        target = (delivery["restaurant_lat"], delivery["restaurant_lng"])
    else:
        address = _address(delivery["delivery_address"])
        target = (address.get("latitude"), address.get("longitude"))

    # Orders from before pins were required have nothing to check against.
    if None in target:
        return

    if here is None:
        raise bad_request(
            "location_needed", f"Turn on location so Foodos can confirm you are at the {place}"
        )

    km = distance_km(here[0], here[1], target[0], target[1])
    slack = min(accuracy or 0, MAX_ACCURACY_SLACK_METRES) / 1000

    if km - slack > get_settings().geofence_metres / 1000:
        raise AppError(
            409,
            "too_far",
            f"You seem to be far away from the {place}. You are {_format_distance(km)} away. "
            "Move closer to update the status",
            {"distanceMetres": round(km * 1000)},
        )


async def advance(
    user_id: uuid.UUID,
    delivery_id: str,
    action: str,
    cash_collected: bool = False,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    accuracy: Optional[float] = None,
    code: Optional[str] = None,
) -> dict:
    if action not in ACTIONS:
        raise not_found("action_not_found", "Unknown delivery step")

    allowed_from, to_status, stamp, order_status = ACTIONS[action]
    identifier = _as_uuid(delivery_id)

    # The position the app sent with the step is the freshest there is: keep it.
    if latitude is not None and longitude is not None:
        await update_location(user_id, latitude, longitude)

    if action == "delivered":
        await _check_code(user_id, identifier, code)

    async with transaction() as connection:
        delivery = await connection.fetchrow(
            """
            select d.id, d.status, d.partner_id, d.order_id, o.status as order_status,
                   o.payment_method, o.payment_status, o.delivery_address, o.is_test,
                   r.latitude as restaurant_lat, r.longitude as restaurant_lng,
                   p.current_latitude, p.current_longitude,
                   p.last_location_at > now() - make_interval(secs => $2) as position_fresh
            from deliveries d
            join orders o on o.id = d.order_id
            join restaurants r on r.id = o.restaurant_id
            left join delivery_partners p on p.user_id = d.partner_id
            where d.id = $1
            for update of d, o
            """,
            identifier,
            STEP_LOCATION_FRESH_SECONDS,
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

        here = None

        if latitude is not None and longitude is not None:
            here = (latitude, longitude)
        elif delivery["position_fresh"] and delivery["current_latitude"] is not None:
            here = (float(delivery["current_latitude"]), float(delivery["current_longitude"]))

        # Test orders are run from home or the office, far from any pin.
        if not delivery["is_test"]:
            _check_place(action, delivery, here, accuracy)

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

    # Told after the step has committed.
    await STEP_EVENTS[action](delivery["order_id"])

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
               o.delivery_code is not null as has_code, o.is_test,
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
            "landmark": address.get("landmark"),
            "latitude": address.get("latitude"),
            "longitude": address.get("longitude"),
            "instructions": row["special_instructions"],
        },
        "items": [{"name": item["name"], "quantity": item["quantity"]} for item in items],
        "paymentMethod": row["payment_method"],
        "collectPaise": row["total_paise"] if cash_due else 0,
        "distanceKm": float(row["total_distance_km"]) if row["total_distance_km"] is not None else None,
        "pickupKm": float(row["pickup_distance_km"]) if row["pickup_distance_km"] is not None else None,
        "dropKm": float(row["drop_distance_km"]) if row["drop_distance_km"] is not None else None,
        # "Delivered" needs the customer's code; the app shows a code box.
        "codeRequired": row["has_code"] and code_required(row["payment_method"]),
        # How close the rider must be for "reached" and "arrived".
        "geofenceMetres": get_settings().geofence_metres,
        # A test order: no location check, so the app says so.
        "isTest": row["is_test"],
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
