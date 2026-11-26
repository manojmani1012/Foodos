"""Finding and assigning a rider by hand, from the order page.

Dispatch offers every order to nearby riders on its own. When nobody takes it
(no one online nearby, everyone skipped), or a rider stops moving, Foodos
operations step in: see who is available and how far away they are, then give
the order to one of them or move it to another.

An assignment takes effect at once: the rider gets the order as theirs, with no
offer to accept, and a push saying Foodos assigned it.
"""

import uuid
from typing import Optional

from ...config import get_settings
from ...database import fetch, fetchrow, transaction
from ...errors import conflict, not_found
from ..delivery.dispatch import ACTIVE, as_address, order_incentive, trip
from ..payouts import settings as payment_settings
from ..notifications import events
from . import audit

# Riders can be swapped until the food leaves the restaurant.
REASSIGNABLE = ("accepted", "reached_restaurant")


def _as_uuid(value: str, code: str, message: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found(code, message)


async def available_riders(order_id: str) -> dict:
    """Every approved rider who could take this order, nearest first: online
    and free riders at the top, then busy and offline ones for reference."""
    identifier = _as_uuid(order_id, "order_not_found", "That order could not be found")

    order = await fetchrow(
        """
        select o.id, o.status, r.latitude, r.longitude, r.name as restaurant_name,
               d.id as delivery_id, d.status as delivery_status, d.partner_id,
               extract(epoch from now() - d.created_at) / 60 as minutes_waiting
        from orders o
        join restaurants r on r.id = o.restaurant_id
        left join deliveries d on d.order_id = o.id
        where o.id = $1
        """,
        identifier,
    )

    if order is None:
        raise not_found("order_not_found", "That order could not be found")

    rows = await fetch(
        """
        select p.user_id, u.full_name, u.phone, u.is_test, p.city, p.vehicle_type, p.vehicle_number, p.is_online,
               p.current_latitude, p.current_longitude, p.last_location_at,
               extract(epoch from now() - p.last_location_at)::int as seconds_since_location,
               (select o.order_number from deliveries x join orders o on o.id = x.order_id
                where x.partner_id = p.user_id and x.status = any($2::text[]) limit 1) as busy_with,
               (select q.status from delivery_requests q where q.delivery_id = $1 and q.partner_id = p.user_id)
                 as offer_status
        from delivery_partners p
        join users u on u.id = p.user_id
        where p.status = 'active'
        """,
        order["delivery_id"],
        list(ACTIVE),
    )

    riders = []

    for row in rows:
        km = trip(row["current_latitude"], row["current_longitude"], order["latitude"], order["longitude"], {})[0]
        riders.append(
            {
                "id": str(row["user_id"]),
                "name": row["full_name"],
                "phone": row["phone"],
                "city": row["city"],
                "vehicleType": row["vehicle_type"],
                "vehicleNumber": row["vehicle_number"],
                "isOnline": row["is_online"],
                "isTest": row["is_test"],
                "distanceKm": km,
                "latitude": float(row["current_latitude"]) if row["current_latitude"] is not None else None,
                "longitude": float(row["current_longitude"]) if row["current_longitude"] is not None else None,
                "lastLocationAt": row["last_location_at"].isoformat() if row["last_location_at"] else None,
                "secondsSinceLocation": row["seconds_since_location"],
                "busyWith": row["busy_with"],
                # This order's offer to them, if they had one: sent, rejected, expired.
                "offerStatus": row["offer_status"],
                "isCurrentRider": row["user_id"] == order["partner_id"],
                "canAssign": row["busy_with"] is None,
            }
        )

    riders.sort(
        key=lambda r: (
            not r["isOnline"],
            not r["canAssign"],
            r["distanceKm"] if r["distanceKm"] is not None else float("inf"),
        )
    )

    return {
        "restaurant": {
            "name": order["restaurant_name"],
            "latitude": float(order["latitude"]) if order["latitude"] is not None else None,
            "longitude": float(order["longitude"]) if order["longitude"] is not None else None,
        },
        "deliveryStatus": order["delivery_status"],
        "minutesWaiting": int(order["minutes_waiting"]) if order["minutes_waiting"] is not None else None,
        "locationFreshSeconds": get_settings().rider_location_fresh_seconds,
        "riders": riders,
    }


async def assign(order_id: str, rider_id: str, actor_id: uuid.UUID, ip: Optional[str]) -> None:
    identifier = _as_uuid(order_id, "order_not_found", "That order could not be found")
    rider = _as_uuid(rider_id, "rider_not_found", "That rider could not be found")

    async with transaction() as connection:
        # Rider first, then delivery and order: the same order a rider's own
        # accept uses, so the two can never deadlock.
        partner = await connection.fetchrow(
            """
            select p.status, p.current_latitude, p.current_longitude, u.full_name
            from delivery_partners p join users u on u.id = p.user_id
            where p.user_id = $1 for update of p
            """,
            rider,
        )

        if partner is None:
            raise not_found("rider_not_found", "That rider could not be found")

        if partner["status"] != "active":
            raise conflict("rider_not_active", f"{partner['full_name'] or 'This rider'} is not approved for deliveries")

        busy = await connection.fetchval(
            """
            select o.order_number from deliveries d join orders o on o.id = d.order_id
            where d.partner_id = $1 and d.status = any($2::text[]) and d.order_id <> $3
            limit 1
            """,
            rider,
            list(ACTIVE),
            identifier,
        )

        if busy:
            raise conflict("rider_busy", f"{partner['full_name'] or 'This rider'} is delivering #{busy}. Choose a free rider")

        delivery = await connection.fetchrow(
            """
            select d.id, d.status, d.partner_id, o.status as order_status, o.order_number, o.tip_paise,
                   o.delivery_address, o.is_test, r.latitude, r.longitude
            from deliveries d
            join orders o on o.id = d.order_id
            join restaurants r on r.id = o.restaurant_id
            where d.order_id = $1
            for update of d, o
            """,
            identifier,
        )

        if delivery is None:
            order_status = await connection.fetchval("select status from orders where id = $1", identifier)

            if order_status is None:
                raise not_found("order_not_found", "That order could not be found")

            raise conflict(
                "order_not_accepted",
                "The restaurant has not accepted this order yet. A rider can be assigned once they do",
            )

        if delivery["status"] in ("picked_up", "arrived"):
            raise conflict(
                "already_picked_up",
                "The rider has already picked up the food. It cannot be moved to someone else now",
            )

        if delivery["order_status"] not in ("preparing", "ready") or delivery["status"] not in (
            "searching",
            *REASSIGNABLE,
        ):
            raise conflict("order_not_assignable", "This order is no longer waiting for a rider")

        if delivery["partner_id"] == rider and delivery["status"] in ACTIVE:
            raise conflict("already_assigned", "This rider already has this order")

        previous = delivery["partner_id"] if delivery["status"] in REASSIGNABLE else None

        pickup, drop, total = trip(
            partner["current_latitude"],
            partner["current_longitude"],
            delivery["latitude"],
            delivery["longitude"],
            as_address(delivery["delivery_address"]),
        )

        base_pay, distance_pay = payment_settings.rider_pay_parts(total, drop)

        await connection.execute(
            """
            update deliveries
            set partner_id = $2, status = 'accepted', accepted_at = now(), reached_restaurant_at = null,
                pickup_distance_km = $3, drop_distance_km = $4, total_distance_km = $5,
                base_earning_paise = $6, tip_paise = $7, base_pay_paise = $8, distance_pay_paise = $9
            where id = $1
            """,
            delivery["id"],
            rider,
            pickup,
            drop,
            total,
            base_pay + distance_pay,
            delivery["tip_paise"],
            base_pay,
            distance_pay,
        )

        # Whoever had it on screen loses the offer; the new rider's record shows
        # it was given, not chosen.
        await connection.execute(
            "update delivery_requests set status = 'expired' where delivery_id = $1 and status = 'sent'",
            delivery["id"],
        )
        await connection.execute(
            """
            insert into delivery_requests (delivery_id, partner_id, status, expected_earning_paise,
                                           expires_at, responded_at)
            values ($1, $2, 'accepted', $3, now(), now())
            on conflict (delivery_id, partner_id)
            do update set status = 'accepted', expected_earning_paise = excluded.expected_earning_paise,
                          responded_at = now()
            """,
            delivery["id"],
            rider,
            base_pay + distance_pay + delivery["tip_paise"] + order_incentive(delivery["is_test"]),
        )

        await audit.record(
            actor_id,
            "Reassigned rider" if previous else "Assigned rider",
            "Orders",
            "order",
            identifier,
            {
                "orderNumber": delivery["order_number"],
                "rider": partner["full_name"],
                "riderId": str(rider),
                "previousRiderId": str(previous) if previous else None,
            },
            ip,
            connection,
        )

    await events.delivery_assigned(identifier, rider)
    await events.rider_assigned(identifier)

    if previous:
        await events.delivery_taken_away(identifier, previous)

