"""Delivery partners: approval, dispatch, the delivery steps, and pay.

The order lifecycle used to stop at "ready". These tests take it the rest of
the way, and check what the customer and the restaurant see as it moves.
"""

import pytest

from app.config import get_settings
from app.database import execute, fetchrow, fetchval

from test_restaurant_portal import make_item, owner_with_restaurant, place_customer_order, sign_in

# Two points in Chennai roughly 4.5 km apart: Anna Nagar and T Nagar.
ANNA_NAGAR = (13.0850, 80.2101)
T_NAGAR = (13.0418, 80.2341)


async def rider(client, phone, city="Chennai", active=True, online=True):
    session = await sign_in(client, phone, "delivery_partner")

    if active:
        await execute(
            "update delivery_partners set status = 'active', city = $2 where user_id = $1::uuid",
            session["userId"],
            city,
        )

    if online:
        response = await client.post("/api/v1/delivery/online", json={"isOnline": True}, headers=session["headers"])
        assert response.status_code == 200, response.text

    return session


async def accepted_order(client, phone="9876543210", lat_lng=None):
    """A cash order the restaurant has accepted, so a delivery is open."""
    owner, restaurant_id = await owner_with_restaurant(client)

    if lat_lng:
        await execute(
            "update restaurants set latitude = $2, longitude = $3 where id = $1", restaurant_id, *lat_lng
        )

    item = await make_item(restaurant_id)
    order, customer = await place_customer_order(client, item, phone=phone)
    accepted = await client.post(f"/api/v1/restaurant/orders/{order['id']}/accept", headers=owner["headers"])
    assert accepted.status_code == 200, accepted.text

    return order, owner, customer


async def requests_for(client, session):
    response = await client.get("/api/v1/delivery/requests", headers=session["headers"])
    assert response.status_code == 200, response.text

    return response.json()["requests"]


async def step(client, session, delivery_id, name, **body):
    return await client.post(
        f"/api/v1/delivery/deliveries/{delivery_id}/{name}", json=body or None, headers=session["headers"]
    )


class TestApproval:
    async def test_a_new_rider_waits_for_approval(self, client):
        session = await rider(client, "9100000001", active=False, online=False)

        me = (await client.get("/api/v1/delivery/me", headers=session["headers"])).json()["partner"]
        online = await client.post("/api/v1/delivery/online", json={"isOnline": True}, headers=session["headers"])

        assert me["status"] == "pending"
        assert online.status_code == 403
        assert online.json()["code"] == "partner_not_approved"

    async def test_a_customer_cannot_use_the_rider_api(self, client):
        customer = await sign_in(client, "9876543210", "customer")

        response = await client.get("/api/v1/delivery/requests", headers=customer["headers"])

        assert response.status_code == 403


class TestDispatch:
    async def test_an_order_is_offered_once_the_restaurant_accepts_it(self, client):
        arjun = await rider(client, "9100000001")
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, _ = await place_customer_order(client, item)

        assert await requests_for(client, arjun) == [], "not offered before the restaurant accepts"

        await client.post(f"/api/v1/restaurant/orders/{order['id']}/accept", headers=owner["headers"])
        offers = await requests_for(client, arjun)

        assert len(offers) == 1
        assert offers[0]["orderNumber"] == order["orderNumber"]
        assert offers[0]["collectPaise"] == order["totalPaise"], "cash order: the rider collects the total"
        assert offers[0]["foodReady"] is False

    async def test_offline_riders_are_not_offered_anything(self, client):
        await accepted_order(client)
        resting = await rider(client, "9100000001", online=False)

        assert await requests_for(client, resting) == []

    async def test_riders_in_another_city_are_not_offered_it(self, client):
        await accepted_order(client)
        elsewhere = await rider(client, "9100000001", city="Bengaluru")

        assert await requests_for(client, elsewhere) == []

    async def test_the_first_rider_to_accept_gets_it(self, client):
        await accepted_order(client)
        arjun = await rider(client, "9100000001")
        bala = await rider(client, "9100000002")
        delivery_id = (await requests_for(client, arjun))[0]["id"]

        first = await step(client, arjun, delivery_id, "accept")
        second = await step(client, bala, delivery_id, "accept")

        assert first.status_code == 200
        assert first.json()["delivery"]["status"] == "accepted"
        assert second.status_code == 409
        assert second.json()["code"] == "delivery_taken"
        assert await requests_for(client, bala) == [], "a taken order disappears for everyone else"

    async def test_rejecting_hides_it_from_that_rider_only(self, client):
        await accepted_order(client)
        arjun = await rider(client, "9100000001")
        bala = await rider(client, "9100000002")
        delivery_id = (await requests_for(client, arjun))[0]["id"]

        await step(client, arjun, delivery_id, "reject")

        assert await requests_for(client, arjun) == []
        assert len(await requests_for(client, bala)) == 1

    async def test_a_rider_carries_one_order_at_a_time(self, client):
        _, owner, _ = await accepted_order(client, phone="9876543210")
        arjun = await rider(client, "9100000001")
        first_id = (await requests_for(client, arjun))[0]["id"]
        await step(client, arjun, first_id, "accept")

        # A second order opens while the first is still being delivered.
        restaurant_id = await fetchval("select id from restaurants limit 1")
        item = await make_item(restaurant_id, name="Veg Biryani")
        second, _ = await place_customer_order(client, item, phone="9876543211")
        await client.post(f"/api/v1/restaurant/orders/{second['id']}/accept", headers=owner["headers"])
        second_id = await fetchval("select id::text from deliveries where status = 'searching'")

        assert await requests_for(client, arjun) == []
        busy = await step(client, arjun, second_id, "accept")
        assert busy.status_code == 409
        assert busy.json()["code"] == "partner_busy"


class TestTheDelivery:
    async def test_the_whole_journey_moves_the_customers_order(self, client):
        order, owner, customer = await accepted_order(client)
        arjun = await rider(client, "9100000001")
        await execute("update users set full_name = 'Arjun Kumar' where phone = '+919100000001'")
        delivery_id = (await requests_for(client, arjun))[0]["id"]
        await step(client, arjun, delivery_id, "accept")

        assert (await step(client, arjun, delivery_id, "reached")).status_code == 200

        # The rider cannot leave with food the kitchen has not finished.
        early = await step(client, arjun, delivery_id, "picked-up")
        assert early.status_code == 409
        assert early.json()["code"] == "order_not_ready"

        await client.post(f"/api/v1/restaurant/orders/{order['id']}/ready", headers=owner["headers"])
        assert (await step(client, arjun, delivery_id, "picked-up")).status_code == 200

        # Mid-delivery the customer sees who is coming and can call them.
        mid = (await client.get(f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"])).json()["order"]
        assert mid["status"] == "picked_up"
        assert mid["delivery"]["partner"]["name"] == "Arjun"
        assert mid["delivery"]["partner"]["phone"] == "+919100000001"

        assert (await step(client, arjun, delivery_id, "arrived")).status_code == 200

        # Cash orders cannot be closed without confirming the cash.
        unpaid = await step(client, arjun, delivery_id, "delivered")
        assert unpaid.status_code == 400
        assert unpaid.json()["code"] == "cash_not_confirmed"

        done = await step(client, arjun, delivery_id, "delivered", cashCollected=True)
        assert done.status_code == 200
        assert done.json()["delivered"] is True

        final = (await client.get(f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"])).json()["order"]
        assert final["status"] == "delivered"
        assert final["paymentStatus"] == "paid", "cash collected at the door"
        assert [s["status"] for s in final["timeline"]][-3:] == ["picked_up", "on_the_way", "delivered"]
        assert final["delivery"]["partner"]["phone"] is None, "no reason to keep calling after delivery"

        # And the rider is free for the next order.
        assert (await client.get("/api/v1/delivery/active", headers=arjun["headers"])).json()["delivery"] is None

    async def test_steps_cannot_be_done_out_of_order(self, client):
        await accepted_order(client)
        arjun = await rider(client, "9100000001")
        delivery_id = (await requests_for(client, arjun))[0]["id"]
        await step(client, arjun, delivery_id, "accept")

        response = await step(client, arjun, delivery_id, "arrived")

        assert response.status_code == 409
        assert response.json()["code"] == "delivery_step_invalid"

    async def test_one_rider_cannot_move_anothers_delivery(self, client):
        await accepted_order(client)
        arjun = await rider(client, "9100000001")
        bala = await rider(client, "9100000002")
        delivery_id = (await requests_for(client, arjun))[0]["id"]
        await step(client, arjun, delivery_id, "accept")

        response = await step(client, bala, delivery_id, "reached")

        assert response.status_code == 404

    async def test_the_restaurant_sees_who_is_collecting(self, client):
        order, owner, _ = await accepted_order(client)
        arjun = await rider(client, "9100000001")
        await step(client, arjun, (await requests_for(client, arjun))[0]["id"], "accept")

        seen = (await client.get(f"/api/v1/restaurant/orders/{order['id']}", headers=owner["headers"])).json()["order"]

        assert seen["delivery"]["status"] == "accepted"
        assert seen["delivery"]["partner"]["phone"] == "+919100000001"


class TestPay:
    async def test_pay_is_base_plus_distance_plus_the_whole_tip(self, client):
        settings = get_settings()
        order, owner, customer = await accepted_order(client, lat_lng=ANNA_NAGAR)
        # The total must keep matching its parts, so the tip raises it too.
        await execute(
            "update orders set tip_paise = 3000, total_paise = total_paise + 3000 where id = $1::uuid", order["id"]
        )
        await execute(
            """update orders set delivery_address = delivery_address
                 || jsonb_build_object('latitude', $2::float, 'longitude', $3::float)
               where id = $1::uuid""",
            order["id"],
            *T_NAGAR,
        )
        arjun = await rider(client, "9100000001")
        # The rider is standing at the restaurant, so pickup distance is zero.
        await client.post(
            "/api/v1/delivery/location",
            json={"latitude": ANNA_NAGAR[0], "longitude": ANNA_NAGAR[1]},
            headers=arjun["headers"],
        )

        offer = (await requests_for(client, arjun))[0]
        accepted = (await step(client, arjun, offer["id"], "accept")).json()["delivery"]

        # The customer's map gets both ends of the trip.
        tracked = (await client.get(f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"])).json()["order"]
        assert (tracked["restaurant"]["latitude"], tracked["restaurant"]["longitude"]) == ANNA_NAGAR
        assert (tracked["deliveryAddress"]["latitude"], tracked["deliveryAddress"]["longitude"]) == T_NAGAR

        km = accepted["distanceKm"]
        assert 4 < km < 6, f"Anna Nagar to T Nagar is about 5 km straight-line, got {km}"
        expected = settings.rider_base_pay_paise + round(km * settings.rider_pay_per_km_paise) + 3000
        assert accepted["earningPaise"] == expected
        assert offer["earningPaise"] == expected, "the offer shows what the rider will actually earn"

    async def test_earnings_count_delivered_orders_and_cash_in_hand(self, client):
        order, owner, _ = await accepted_order(client)
        arjun = await rider(client, "9100000001")
        delivery_id = (await requests_for(client, arjun))[0]["id"]
        await step(client, arjun, delivery_id, "accept")
        await client.post(f"/api/v1/restaurant/orders/{order['id']}/ready", headers=owner["headers"])
        await step(client, arjun, delivery_id, "picked-up")
        await step(client, arjun, delivery_id, "delivered", cashCollected=True)

        body = (await client.get("/api/v1/delivery/earnings?days=7", headers=arjun["headers"])).json()

        assert body["totals"]["deliveries"] == 1
        assert body["totals"]["earningsPaise"] == get_settings().rider_base_pay_paise, "no coordinates: base pay only"
        assert body["cashCollectedTodayPaise"] == order["totalPaise"]
        assert len(body["daily"]) == 7

        me = (await client.get("/api/v1/delivery/me", headers=arjun["headers"])).json()["partner"]
        assert me["today"]["deliveries"] == 1

    async def test_a_delivered_order_now_shows_in_restaurant_earnings_and_can_be_rated(self, client):
        # The two restaurant screens that had nothing to show until delivery existed.
        order, owner, customer = await accepted_order(client)
        arjun = await rider(client, "9100000001")
        delivery_id = (await requests_for(client, arjun))[0]["id"]
        await step(client, arjun, delivery_id, "accept")
        await client.post(f"/api/v1/restaurant/orders/{order['id']}/ready", headers=owner["headers"])
        await step(client, arjun, delivery_id, "picked-up")
        await step(client, arjun, delivery_id, "delivered", cashCollected=True)

        earnings = (await client.get("/api/v1/restaurant/earnings?days=7", headers=owner["headers"])).json()
        review = await client.post(
            f"/api/v1/customer/orders/{order['id']}/review", json={"rating": 5}, headers=customer["headers"]
        )

        assert earnings["totals"]["orders"] == 1
        assert review.status_code in (200, 201), review.text
