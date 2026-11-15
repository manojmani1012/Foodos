"""The fixes from the first round of user testing (October 2026).

Each class is one finding from the testers' videos and voice notes: what went
wrong, and the Swiggy/Zomato behaviour that replaces it.
"""

import pytest

from app.components.orders import timeouts
from app.components.orders.service import _eta_minutes
from app.database import execute, fetchrow, fetchval

from test_admin import admin, latest_activity  # noqa: F401 - the admin fixture
from test_delivery import (
    BENGALURU,
    HOME,
    KILPAUK,
    RESTAURANT,
    accepted_order,
    code_for,
    go_to,
    requests_for,
    rider,
    step,
)
from test_restaurant_portal import ADDRESS, make_item, owner_with_restaurant, place_customer_order, sign_in


async def order_with(client, customer, item_id, **address_changes):
    return await client.post(
        "/api/v1/customer/orders",
        json={
            "items": [{"menuItemId": str(item_id), "quantity": 1}],
            "paymentMethod": "cod",
            "address": {**ADDRESS, **address_changes},
        },
        headers=customer["headers"],
    )


class TestOneAmountEverywhere:
    """The customer app said Rs 146 while the rider was told to collect Rs 145.50."""

    async def test_the_bill_is_whole_rupees_and_every_app_shows_the_same_total(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        # 110 + 20 delivery + 10 packaging + 5.50 GST = 145.50: the testers' order.
        item = await make_item(restaurant_id, name="Curd Rice", price=11000)
        customer = await sign_in(client, "9876543210", "customer")
        order = (await order_with(client, customer, item)).json()["order"]

        assert order["totalPaise"] == 14600
        assert order["roundOffPaise"] == 50

        await client.post(f"/api/v1/restaurant/orders/{order['id']}/accept", headers=owner["headers"])
        arjun = await rider(client, "9100000001")
        offer = (await requests_for(client, arjun))[0]
        restaurant_view = (
            await client.get(f"/api/v1/restaurant/orders/{order['id']}", headers=owner["headers"])
        ).json()["order"]

        assert offer["collectPaise"] == 14600, "the rider collects exactly what the customer sees"
        assert restaurant_view["totalPaise"] == 14600
        lines = ("subtotalPaise", "deliveryFeePaise", "packagingFeePaise", "taxPaise", "tipPaise", "roundOffPaise")
        assert sum(restaurant_view[key] for key in lines) - restaurant_view["discountPaise"] == 14600, (
            "the restaurant's bill lines add up to its total"
        )


class TestDeliversOnlyNearby:
    """A Chennai restaurant accepted an order for an address in Salem."""

    async def test_an_address_needs_a_map_pin(self, client):
        customer = await sign_in(client, "9876543210", "customer")
        unpinned = {key: value for key, value in ADDRESS.items() if key not in ("latitude", "longitude")}

        response = await client.post("/api/v1/customer/addresses", json=unpinned, headers=customer["headers"])

        assert response.status_code == 400
        assert set(response.json()["details"]["fields"]) == {"latitude", "longitude"}

    async def test_an_old_address_without_a_pin_must_be_pinned_before_ordering(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        customer = await sign_in(client, "9876543210", "customer")
        address_id = await fetchval(
            """
            insert into customer_addresses (user_id, label, line1, city)
            values ($1::uuid, 'Home', 'Gjc', 'Chennai') returning id::text
            """,
            customer["userId"],
        )

        refused = await client.post(
            "/api/v1/customer/orders",
            json={"items": [{"menuItemId": str(item), "quantity": 1}], "paymentMethod": "cod", "addressId": address_id},
            headers=customer["headers"],
        )
        repinned = await client.put(
            f"/api/v1/customer/addresses/{address_id}",
            json={**ADDRESS, "line1": "12, Lake View Road", "landmark": "Opposite the temple"},
            headers=customer["headers"],
        )
        accepted = await client.post(
            "/api/v1/customer/orders",
            json={"items": [{"menuItemId": str(item), "quantity": 1}], "paymentMethod": "cod", "addressId": address_id},
            headers=customer["headers"],
        )

        assert refused.status_code == 400
        assert refused.json()["code"] == "address_needs_pin"
        assert repinned.status_code == 200, repinned.text
        assert repinned.json()["address"]["landmark"] == "Opposite the temple"
        assert accepted.status_code == 201, accepted.text
        assert accepted.json()["order"]["deliveryAddress"]["landmark"] == "Opposite the temple"

    async def test_an_address_beyond_the_radius_is_refused(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        customer = await sign_in(client, "9876543210", "customer")

        response = await order_with(client, customer, item, latitude=BENGALURU[0], longitude=BENGALURU[1], city="Bengaluru")

        assert response.status_code == 409
        assert response.json()["code"] == "address_too_far"
        assert "does not deliver to this address" in response.json()["message"]

    async def test_the_cart_says_so_before_checkout(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        customer = await sign_in(client, "9876543210", "customer")
        far = (
            await client.post(
                "/api/v1/customer/addresses",
                json={**ADDRESS, "latitude": BENGALURU[0], "longitude": BENGALURU[1], "city": "Bengaluru"},
                headers=customer["headers"],
            )
        ).json()["address"]

        quote = (
            await client.post(
                "/api/v1/customer/cart/quote",
                json={"items": [{"menuItemId": str(item), "quantity": 1}], "addressId": far["id"]},
                headers=customer["headers"],
            )
        ).json()

        assert quote["serviceable"]["ok"] is False
        assert quote["serviceable"]["code"] == "address_too_far"

    async def test_browsing_lists_only_restaurants_that_deliver_to_the_pin(self, client):
        owner, near_id = await owner_with_restaurant(client, name="Near Kitchen")
        _, far_id = await owner_with_restaurant(client, phone="9000000002", name="Far Kitchen")
        await execute("update restaurants set latitude = $2, longitude = $3 where id = $1", far_id, *BENGALURU)
        pin = {"latitude": HOME[0], "longitude": HOME[1]}

        listed = (await client.get("/api/v1/customer/restaurants", params=pin)).json()["restaurants"]
        far_detail = (await client.get(f"/api/v1/customer/restaurants/{far_id}", params=pin)).json()

        assert [r["name"] for r in listed] == ["Near Kitchen"]
        assert 1 < listed[0]["distanceKm"] < 3
        assert listed[0]["deliversHere"] is True
        assert far_detail["deliversHere"] is False, "a favourite out of range says so"

    async def test_a_restaurant_can_have_its_own_radius(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        await execute("update restaurants set delivery_radius_km = 1 where id = $1", restaurant_id)

        listed = (
            await client.get("/api/v1/customer/restaurants", params={"latitude": HOME[0], "longitude": HOME[1]})
        ).json()["restaurants"]

        assert listed == [], "1.8 km away, and it only delivers within 1 km"

    async def test_a_restaurant_without_a_pin_is_hidden(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        await execute("update restaurants set latitude = null, longitude = null where id = $1", restaurant_id)

        listed = (await client.get("/api/v1/customer/restaurants")).json()["restaurants"]
        detail = await client.get(f"/api/v1/customer/restaurants/{restaurant_id}")

        assert listed == []
        assert detail.status_code == 404


class TestUnansweredOrders:
    """Orders sat as "New" for days because the restaurant never answered."""

    async def test_an_order_not_accepted_in_time_is_cancelled_for_the_customer(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        late, customer = await place_customer_order(client, item, phone="9876543210")
        fresh, _ = await place_customer_order(client, item, phone="9876543211")
        await execute("update orders set confirmed_at = now() - interval '6 minutes' where id = $1::uuid", late["id"])

        cancelled = await timeouts.cancel_unaccepted()

        seen = (await client.get(f"/api/v1/customer/orders/{late['id']}", headers=customer["headers"])).json()["order"]
        still_waiting = await fetchval("select status from orders where id = $1::uuid", fresh["id"])
        assert cancelled == 1
        assert seen["status"] == "cancelled"
        assert seen["cancellationReason"] == timeouts.NOT_ACCEPTED
        assert await fetchval("select cancelled_by from orders where id = $1::uuid", late["id"]) == "system"
        assert still_waiting == "confirmed", "inside the 5 minutes, nothing happens"

    async def test_an_accepted_order_is_never_auto_cancelled(self, client):
        order, _, _ = await accepted_order(client)
        await execute("update orders set confirmed_at = now() - interval '1 hour'")

        assert await timeouts.cancel_unaccepted() == 0
        assert await fetchval("select status from orders where id = $1::uuid", order["id"]) == "preparing"

    async def test_an_unpaid_online_order_is_dropped_after_a_while(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, _ = await place_customer_order(client, item)
        await execute(
            "update orders set status = 'pending', placed_at = now() - interval '31 minutes' where id = $1::uuid",
            order["id"],
        )

        assert await timeouts.expire_unpaid() == 1
        assert await fetchval("select status from orders where id = $1::uuid", order["id"]) == "cancelled"


class TestFindAndAssignRiders:
    """Voice note 2: the admin panel showed no riders and could not assign one."""

    async def test_the_order_page_lists_riders_nearest_first(self, client, admin):
        order, _, _ = await accepted_order(client)
        near = await rider(client, "9100000001", at=RESTAURANT)
        further = await rider(client, "9100000002", at=KILPAUK)
        await rider(client, "9100000003", online=False)

        body = (await client.get(f"/api/v1/admin/orders/{order['id']}/riders", headers=admin)).json()

        names = [r["id"] for r in body["riders"]]
        assert names[:2] == [near["userId"], further["userId"]]
        assert body["riders"][0]["distanceKm"] == 0
        assert body["riders"][-1]["isOnline"] is False, "offline riders come last"
        assert all(r["canAssign"] for r in body["riders"])

    async def test_an_admin_assigns_a_rider_who_gets_it_straight_away(self, client, admin):
        order, _, customer = await accepted_order(client)
        far_rider = await rider(client, "9100000001", at=BENGALURU)

        response = await client.post(
            f"/api/v1/admin/orders/{order['id']}/assign", json={"riderId": far_rider["userId"]}, headers=admin
        )
        active = (await client.get("/api/v1/delivery/active", headers=far_rider["headers"])).json()["delivery"]
        seen = (await client.get(f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"])).json()["order"]

        assert response.status_code == 200, response.text
        assert response.json()["order"]["rider"]["id"] == far_rider["userId"]
        assert active["orderNumber"] == order["orderNumber"]
        assert seen["delivery"]["status"] == "accepted"
        assert (await latest_activity(client, admin, "Orders"))[0]["action"] == "Assigned rider"

    async def test_an_order_can_be_moved_to_another_rider_until_pickup(self, client, admin):
        order, owner, _ = await accepted_order(client)
        arjun = await rider(client, "9100000001")
        bala = await rider(client, "9100000002", at=HOME)
        delivery_id = (await requests_for(client, arjun))[0]["id"]
        await step(client, arjun, delivery_id, "accept")

        moved = await client.post(
            f"/api/v1/admin/orders/{order['id']}/assign", json={"riderId": bala["userId"]}, headers=admin
        )

        assert moved.status_code == 200, moved.text
        assert (await client.get("/api/v1/delivery/active", headers=arjun["headers"])).json()["delivery"] is None
        assert (await latest_activity(client, admin, "Orders"))[0]["action"] == "Reassigned rider"

        # Once the food has left the restaurant, it stays with that rider.
        await go_to(client, bala, RESTAURANT)
        await step(client, bala, delivery_id, "reached")
        await client.post(f"/api/v1/restaurant/orders/{order['id']}/ready", headers=owner["headers"])
        await step(client, bala, delivery_id, "picked-up")
        too_late = await client.post(
            f"/api/v1/admin/orders/{order['id']}/assign", json={"riderId": arjun["userId"]}, headers=admin
        )

        assert too_late.status_code == 409
        assert too_late.json()["code"] == "already_picked_up"

    async def test_a_busy_rider_cannot_be_given_a_second_order(self, client, admin):
        first, owner, _ = await accepted_order(client, phone="9876543210")
        arjun = await rider(client, "9100000001")
        await step(client, arjun, (await requests_for(client, arjun))[0]["id"], "accept")
        restaurant_id = await fetchval("select id from restaurants limit 1")
        item = await make_item(restaurant_id, name="Veg Biryani")
        second, _ = await place_customer_order(client, item, phone="9876543211")
        await client.post(f"/api/v1/restaurant/orders/{second['id']}/accept", headers=owner["headers"])

        response = await client.post(
            f"/api/v1/admin/orders/{second['id']}/assign", json={"riderId": arjun["userId"]}, headers=admin
        )

        assert response.status_code == 409
        assert response.json()["code"] == "rider_busy"

    async def test_the_live_list_shows_how_long_an_order_has_waited_for_a_rider(self, client, admin):
        order, _, _ = await accepted_order(client)
        await execute("update deliveries set created_at = now() - interval '7 minutes'")

        listed = (await client.get("/api/v1/admin/orders", params={"view": "live"}, headers=admin)).json()["orders"]
        dashboard = (await client.get("/api/v1/admin/dashboard", headers=admin)).json()

        assert listed[0]["riderWaitMinutes"] == 7
        assert [o["orderNumber"] for o in dashboard["attention"]["waitingForRider"]] == [order["orderNumber"]]


class TestLiveArrivalTime:
    """Zomato shows "Arriving in 25 mins"; ours showed a fixed time."""

    async def test_live_orders_carry_minutes_to_arrival(self, client):
        order, _, customer = await accepted_order(client)

        seen = (await client.get(f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"])).json()["order"]

        assert seen["etaMinutes"] > 0
        assert isinstance(seen["lateNight"], bool)

    def test_the_estimate_follows_the_order(self):
        from datetime import datetime, timedelta, timezone

        now = datetime.now(timezone.utc)
        restaurant, home = RESTAURANT, HOME

        cooking = _eta_minutes("preparing", 30, now - timedelta(minutes=10), restaurant, home, None, now)
        nearly_cooked = _eta_minutes("preparing", 30, now - timedelta(minutes=28), restaurant, home, None, now)
        on_the_way = _eta_minutes(
            "picked_up", 30, None, restaurant, home,
            {"status": "picked_up", "location": {"latitude": RESTAURANT[0], "longitude": RESTAURANT[1]}}, now,
        )
        at_the_door = _eta_minutes(
            "on_the_way", 30, None, restaurant, home, {"status": "arrived", "location": None}, now
        )

        assert cooking > nearly_cooked > on_the_way > at_the_door == 0
        assert _eta_minutes("delivered", 30, None, restaurant, home, None, now) is None
