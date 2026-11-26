"""Finding a rider for each delivery, the way Swiggy and Zomato do it.

An open delivery is offered to one rider at a time: the nearest free rider,
by their live position, for `dispatch_offer_seconds`. If they skip it or let
it run out, it goes to the next nearest. The search starts close to the
restaurant and widens through `dispatch_radii_km` the longer the order waits.

A rider is offered work only when they are approved, online, free (no
delivery in hand, no other offer on screen) and their position is recent: a
rider who closed the app an hour ago is not nearby, whatever their last pin
says. A rider who skipped this order is not asked again; one who let it run
out may be asked again after a short pause, if they are still the nearest. A
rider holding as much cash as the limit allows is offered only prepaid orders
(see cash.py).

Each offer is decided with the delivery and the chosen rider locked, so two
deliveries can never be offered to the same rider at once, and the background
loop and a rider's own skip can never offer the same delivery twice.

When no rider is found, the admin panel shows the delivery waiting and an admin
can assign one by hand.
"""

import json
import logging
import uuid
from typing import Any, Optional

from ...config import get_settings
from ...database import fetch, transaction
from ..geo import distance_km, sql_distance_km
from ..notifications import events
from ..payouts import settings as payment_settings
from . import cash

logger = logging.getLogger("foodos.dispatch")

# Statuses where the rider still has the order in hand.
ACTIVE = ("accepted", "reached_restaurant", "picked_up", "arrived")

# Orders a rider can be sent to: the kitchen has accepted and not yet handed over.
DISPATCHABLE_ORDER = ("preparing", "ready")

# A rider who let an offer run out can be offered the same order again after
# this long, in case they were simply looking away.
EXPIRED_PAUSE_SECONDS = 60


def rider_pay(total_km: Optional[float], drop_km: Optional[float] = None) -> int:
    """Base plus distance pay for a trip, by the payment settings (see
    payouts/settings.py). Tips and incentives come on top."""
    base, distance = payment_settings.rider_pay_parts(total_km, drop_km)

    return base + distance


def order_incentive(is_test: bool) -> int:
    """The flat per-order incentive a delivered trip earns. Test orders earn
    nothing, so the offer screen does not promise it either."""
    return 0 if is_test else int(payment_settings.current()["riderOrderIncentivePaise"])


def trip(rider_lat: Any, rider_lng: Any, restaurant_lat: Any, restaurant_lng: Any, address: dict):
    """Pickup, drop and total distance for a rider taking this order."""
    pickup = distance_km(rider_lat, rider_lng, restaurant_lat, restaurant_lng)
    drop = distance_km(restaurant_lat, restaurant_lng, address.get("latitude"), address.get("longitude"))
    total = None if pickup is None and drop is None else round((pickup or 0) + (drop or 0), 2)

    return pickup, drop, total


def as_address(value: Any) -> dict:
    if isinstance(value, str):
        return json.loads(value)

    return dict(value or {})


async def offer_next(delivery_id: uuid.UUID) -> Optional[uuid.UUID]:
    """Offers this delivery to the nearest free rider, unless it is already on
    someone's screen. Returns the rider offered it, if any. Safe to call at any
    time and as often as needed."""
    settings = get_settings()
    rider_id = None

    async with transaction() as connection:
        delivery = await connection.fetchrow(
            """
            select d.id, d.status, d.order_id, o.status as order_status, o.tip_paise, o.delivery_address, o.is_test,
                   o.payment_method, o.payment_status, r.latitude, r.longitude,
                   extract(epoch from now() - d.created_at) / 60 as minutes_open
            from deliveries d
            join orders o on o.id = d.order_id
            join restaurants r on r.id = o.restaurant_id
            where d.id = $1
            for update of d skip locked
            """,
            delivery_id,
        )

        # Locked means another call is deciding this delivery right now.
        if delivery is None or delivery["status"] != "searching":
            return None

        if delivery["order_status"] not in DISPATCHABLE_ORDER:
            return None

        await connection.execute(
            "update delivery_requests set status = 'expired' where delivery_id = $1 and status = 'sent' and expires_at <= now()",
            delivery_id,
        )

        live = await connection.fetchval(
            "select 1 from delivery_requests where delivery_id = $1 and status = 'sent' and expires_at > now()",
            delivery_id,
        )

        # A restaurant with no pin cannot be measured from; an admin assigns.
        if live or delivery["latitude"] is None:
            return None

        radii = settings.dispatch_radii
        ring = min(int(float(delivery["minutes_open"]) // settings.dispatch_ring_minutes), len(radii) - 1)
        distance = sql_distance_km("p.current_latitude", "p.current_longitude", "$2", "$3")

        # A test order goes only to test riders, wherever they are, so the
        # client's staff can run one from home; a real order never goes to one.
        rider = await connection.fetchrow(
            f"""
            select p.user_id, p.current_latitude, p.current_longitude, {distance} as km
            from delivery_partners p
            join users u on u.id = p.user_id
            where p.status = 'active' and p.is_online and u.is_test = $8
              and p.current_latitude is not null and p.current_longitude is not null
              and p.last_location_at > now() - make_interval(secs => $4)
              and ($8 or {distance} <= $5)
              and ($9 or {cash.in_hand_sql("p.user_id")} < $10)
              and not exists (
                select 1 from deliveries x where x.partner_id = p.user_id and x.status = any($6::text[])
              )
              and not exists (
                select 1 from delivery_requests q
                join deliveries other on other.id = q.delivery_id and other.status = 'searching'
                where q.partner_id = p.user_id and q.status = 'sent' and q.expires_at > now()
              )
              and not exists (
                select 1 from delivery_requests q
                where q.delivery_id = $1 and q.partner_id = p.user_id
                  and (q.status in ('rejected', 'accepted')
                       or (q.status = 'expired' and q.expires_at > now() - make_interval(secs => $7)))
              )
            order by km, p.last_location_at desc
            limit 1
            for update of p skip locked
            """,
            delivery_id,
            float(delivery["latitude"]),
            float(delivery["longitude"]),
            settings.rider_location_fresh_seconds,
            radii[ring],
            list(ACTIVE),
            EXPIRED_PAUSE_SECONDS,
            delivery["is_test"],
            cash.skip_limit(delivery["payment_method"], delivery["payment_status"]),
            settings.rider_cash_limit_paise,
        )

        if rider is None:
            return None

        _, drop, total = trip(
            rider["current_latitude"],
            rider["current_longitude"],
            delivery["latitude"],
            delivery["longitude"],
            as_address(delivery["delivery_address"]),
        )

        await connection.execute(
            """
            insert into delivery_requests (delivery_id, partner_id, status, expected_earning_paise, sent_at, expires_at)
            values ($1, $2, 'sent', $3, now(), now() + make_interval(secs => $4))
            on conflict (delivery_id, partner_id) do update
              set status = 'sent', expected_earning_paise = excluded.expected_earning_paise,
                  sent_at = now(), expires_at = excluded.expires_at, responded_at = null
            """,
            delivery_id,
            rider["user_id"],
            rider_pay(total, drop) + delivery["tip_paise"] + order_incentive(delivery["is_test"]),
            settings.dispatch_offer_seconds,
        )

        rider_id = rider["user_id"]
        order_id = delivery["order_id"]

    # Told after the offer has committed, so the app finds it when it opens.
    await events.delivery_offered(order_id, rider_id)

    return rider_id


async def dispatch_all() -> int:
    """One pass over every delivery still looking for a rider: expires offers
    that ran out and offers each delivery to the next rider. Run by the
    background loop every few seconds. Returns how many offers went out."""
    rows = await fetch(
        """
        select d.id
        from deliveries d
        join orders o on o.id = d.order_id
        where d.status = 'searching' and o.status = any($1::text[])
        order by d.created_at
        limit 100
        """,
        list(DISPATCHABLE_ORDER),
    )

    offered = 0

    for row in rows:
        try:
            if await offer_next(row["id"]):
                offered += 1
        except Exception:  # noqa: BLE001 - one bad delivery must not stop the rest
            logger.exception("[dispatch] offering %s failed", row["id"])

    return offered
