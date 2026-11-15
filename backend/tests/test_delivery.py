"""Delivery partners: approval, dispatch, the delivery steps, and pay.

The order lifecycle used to stop at "ready". These tests take it the rest of
the way, and check what the customer and the restaurant see as it moves.

Dispatch works like Swiggy and Zomato: each order is offered to the nearest
free rider, one at a time. "Reached" and "arrived" only count at the pin, and
the customer's code finishes the order.
"""

from app.components.delivery import dispatch
from app.config import get_settings
from app.database import execute, fetchval

from test_restaurant_portal import make_item, owner_with_restaurant, place_customer_order, sign_in

# Two points in Chennai roughly 4.5 km apart: Anna Nagar and T Nagar.
ANNA_NAGAR = (13.0850, 80.2101)
T_NAGAR = (13.0418, 80.2341)

# Where the test restaurants and the test customers are pinned (see the
# helpers in test_restaurant_portal): Anna Nagar, and a street about 1.8 km east.
RESTAURANT = ANNA_NAGAR
HOME = (13.0827, 80.2270)

# Near the restaurant, but further than the first dispatch ring (3 km).
KILPAUK = (13.0850, 80.2420)  # about 3.5 km east
BENGALURU = (12.9716, 77.5946)


async def rider(client, phone, city="Chennai", active=True, online=True, at=RESTAURANT):
    """An approved rider, online and standing at `at` (the restaurant, unless
    told otherwise), the way they would be while waiting for orders."""
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

        if at:
            await go_to(client, session, at)

    return session


async def go_to(client, session, point):
    response = await client.post(
        "/api/v1/delivery/location", json={"latitude": point[0], "longitude": point[1]}, headers=session["headers"]
    )
    assert response.status_code == 200, response.text


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
    # What the background loop does every few seconds in the running server.
    await dispatch.dispatch_all()

    response = await client.get("/api/v1/delivery/requests", headers=session["headers"])
    assert response.status_code == 200, response.text

    return response.json()["requests"]


async def step(client, session, delivery_id, name, **body):
    return await client.post(
        f"/api/v1/delivery/deliveries/{delivery_id}/{name}", json=body or None, headers=session["headers"]
    )


async def code_for(delivery_id):
    return await fetchval(
        "select o.delivery_code from deliveries d join orders o on o.id = d.order_id where d.id = $1::uuid",
        delivery_id,
    )


async def expire_offers():
    """Runs every live offer's countdown out."""
    await execute("update delivery_requests set expires_at = now() - interval '1 second' where status = 'sent'")


async def hand_over(client, session, delivery_id, owner, order_id):
    """Accept to delivered, doing each step where it has to be done."""
    assert (await step(client, session, delivery_id, "accept")).status_code == 200
    await go_to(client, session, RESTAURANT)
    assert (await step(client, session, delivery_id, "reached")).status_code == 200
    await client.post(f"/api/v1/restaurant/orders/{order_id}/ready", headers=owner["headers"])
    assert (await step(client, session, delivery_id, "picked-up")).status_code == 200
    await go_to(client, session, HOME)
    assert (await step(client, session, delivery_id, "arrived")).status_code == 200
    done = await step(client, session, delivery_id, "delivered", cashCollected=True, code=await code_for(delivery_id))
    assert done.status_code == 200, done.text

    return done.json()


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
        assert 0 < offers[0]["secondsLeft"] <= get_settings().dispatch_offer_seconds

    async def test_offline_riders_are_not_offered_anything(self, client):
        await accepted_order(client)
        resting = await rider(client, "9100000001", online=False)

        assert await requests_for(client, resting) == []

    async def test_the_registered_city_does_not_matter_only_the_distance(self, client):
        """The testers' riders were registered in Salem while the restaurant
        said Chennai, and no order ever reached them. Distance decides now."""
        await accepted_order(client)
        at_the_counter = await rider(client, "9100000001", city="Salem")

        assert len(await requests_for(client, at_the_counter)) == 1

    async def test_riders_far_away_are_not_offered_it(self, client):
        await accepted_order(client)
        in_bengaluru = await rider(client, "9100000001", at=BENGALURU)

        assert await requests_for(client, in_bengaluru) == []

    async def test_a_rider_who_has_not_shared_a_position_recently_is_skipped(self, client):
        await accepted_order(client)
        arjun = await rider(client, "9100000001")
        await execute("update delivery_partners set last_location_at = now() - interval '1 hour'")

        assert await requests_for(client, arjun) == [], "an hour-old position says nothing about where they are"

    async def test_it_goes_to_the_nearest_rider_and_only_them(self, client):
        near = await rider(client, "9100000001", at=RESTAURANT)
        further = await rider(client, "9100000002", at=HOME)
        await accepted_order(client)

        assert len(await requests_for(client, near)) == 1
        assert await requests_for(client, further) == [], "one rider at a time"

        delivery_id = (await requests_for(client, near))[0]["id"]
        stolen = await step(client, further, delivery_id, "accept")

        assert stolen.status_code == 409
        assert stolen.json()["code"] == "offer_expired", "only the rider it was offered to can take it"

    async def test_skipping_passes_it_to_the_next_rider_straight_away(self, client):
        arjun = await rider(client, "9100000001", at=RESTAURANT)
        bala = await rider(client, "9100000002", at=HOME)
        await accepted_order(client)
        delivery_id = (await requests_for(client, arjun))[0]["id"]

        await step(client, arjun, delivery_id, "reject")

        assert await requests_for(client, arjun) == []
        assert [offer["id"] for offer in await requests_for(client, bala)] == [delivery_id]

        # And it never comes back to the rider who skipped it.
        await step(client, bala, delivery_id, "reject")
        assert await requests_for(client, arjun) == []

    async def test_an_offer_left_to_run_out_moves_on(self, client):
        arjun = await rider(client, "9100000001", at=RESTAURANT)
        bala = await rider(client, "9100000002", at=HOME)
        await accepted_order(client)
        delivery_id = (await requests_for(client, arjun))[0]["id"]

        await expire_offers()

        assert await requests_for(client, arjun) == []
        assert [offer["id"] for offer in await requests_for(client, bala)] == [delivery_id]

        late = await step(client, arjun, delivery_id, "accept")
        assert late.status_code == 409
        assert late.json()["code"] == "offer_expired"

    async def test_the_search_widens_the_longer_it_waits(self, client):
        await accepted_order(client)
        across_town = await rider(client, "9100000001", at=KILPAUK)

        assert await requests_for(client, across_town) == [], "3.5 km is outside the first ring (3 km)"

        await execute("update deliveries set created_at = now() - interval '3 minutes'")

        assert len(await requests_for(client, across_town)) == 1, "after 2 minutes the search reaches 5 km"

    async def test_two_orders_are_never_on_one_riders_screen(self, client):
        arjun = await rider(client, "9100000001")
        _, owner, _ = await accepted_order(client, phone="9876543210")
        restaurant_id = await fetchval("select id from restaurants limit 1")
        item = await make_item(restaurant_id, name="Veg Biryani")
        second, _ = await place_customer_order(client, item, phone="9876543211")
        await client.post(f"/api/v1/restaurant/orders/{second['id']}/accept", headers=owner["headers"])

        assert len(await requests_for(client, arjun)) == 1

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

        # Mid-delivery the customer sees who is coming, can call them, and has
        # the code to give them at the door.
        mid = (await client.get(f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"])).json()["order"]
        assert mid["status"] == "picked_up"
        assert mid["delivery"]["partner"]["name"] == "Arjun"
        assert mid["delivery"]["partner"]["phone"] == "+919100000001"
        assert mid["deliveryCode"] == await code_for(delivery_id)

        await go_to(client, arjun, HOME)
        assert (await step(client, arjun, delivery_id, "arrived")).status_code == 200

        # Cash orders cannot be closed without confirming the cash.
        unpaid = await step(client, arjun, delivery_id, "delivered", code=mid["deliveryCode"])
        assert unpaid.status_code == 400
        assert unpaid.json()["code"] == "cash_not_confirmed"

        done = await step(client, arjun, delivery_id, "delivered", cashCollected=True, code=mid["deliveryCode"])
        assert done.status_code == 200
        assert done.json()["delivered"] is True

        final = (await client.get(f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"])).json()["order"]
        assert final["status"] == "delivered"
        assert final["paymentStatus"] == "paid", "cash collected at the door"
        assert [s["status"] for s in final["timeline"]][-3:] == ["picked_up", "on_the_way", "delivered"]
        assert final["delivery"]["partner"]["phone"] is None, "no reason to keep calling after delivery"
        assert final["deliveryCode"] is None, "the code is only shown while it is needed"

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

    async def test_reaching_the_restaurant_cannot_be_skipped(self, client):
        order, owner, _ = await accepted_order(client)
        arjun = await rider(client, "9100000001")
        delivery_id = (await requests_for(client, arjun))[0]["id"]
        await step(client, arjun, delivery_id, "accept")
        await client.post(f"/api/v1/restaurant/orders/{order['id']}/ready", headers=owner["headers"])

        response = await step(client, arjun, delivery_id, "picked-up")

        assert response.status_code == 409
        assert response.json()["code"] == "delivery_step_invalid"

    async def test_one_rider_cannot_move_anothers_delivery(self, client):
        await accepted_order(client)
        arjun = await rider(client, "9100000001")
        bala = await rider(client, "9100000002", at=HOME)
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


class TestAtThePin:
    """A tester marked "reached the restaurant" from 18 km away."""

    async def accepted(self, client):
        order, owner, customer = await accepted_order(client)
        arjun = await rider(client, "9100000001")
        delivery_id = (await requests_for(client, arjun))[0]["id"]
        await step(client, arjun, delivery_id, "accept")

        return order, owner, arjun, delivery_id

    async def test_reached_is_refused_away_from_the_restaurant(self, client):
        _, _, arjun, delivery_id = await self.accepted(client)
        await go_to(client, arjun, T_NAGAR)

        response = await step(client, arjun, delivery_id, "reached")

        assert response.status_code == 409
        assert response.json()["code"] == "too_far"
        assert response.json()["message"].startswith("You seem to be far away from the pickup location")
        assert 4000 < response.json()["details"]["distanceMetres"] < 6000

    async def test_the_position_sent_with_the_step_counts(self, client):
        _, _, arjun, delivery_id = await self.accepted(client)
        await go_to(client, arjun, T_NAGAR)

        # 60 m from the pin: inside the 100 m allowed.
        response = await step(client, arjun, delivery_id, "reached", latitude=13.0855, longitude=80.2102)

        assert response.status_code == 200, response.text

    async def test_poor_gps_accuracy_is_allowed_for_a_little(self, client):
        _, _, arjun, delivery_id = await self.accepted(client)

        # About 130 m away, but the phone says it is only accurate to 40 m.
        far_ish = (13.0862, 80.2101)
        strict = await step(client, arjun, delivery_id, "reached", latitude=far_ish[0], longitude=far_ish[1])
        lenient = await step(
            client, arjun, delivery_id, "reached", latitude=far_ish[0], longitude=far_ish[1], accuracy=40
        )

        assert strict.status_code == 409
        assert lenient.status_code == 200, lenient.text

    async def test_without_a_recent_position_the_step_asks_for_location(self, client):
        _, _, arjun, delivery_id = await self.accepted(client)
        await execute("update delivery_partners set last_location_at = now() - interval '10 minutes'")

        response = await step(client, arjun, delivery_id, "reached")

        assert response.status_code == 400
        assert response.json()["code"] == "location_needed"

    async def test_arrived_is_refused_away_from_the_customer(self, client):
        order, owner, arjun, delivery_id = await self.accepted(client)
        await step(client, arjun, delivery_id, "reached")
        await client.post(f"/api/v1/restaurant/orders/{order['id']}/ready", headers=owner["headers"])
        await step(client, arjun, delivery_id, "picked-up")

        # Still at the restaurant, 1.8 km from the customer.
        response = await step(client, arjun, delivery_id, "arrived")

        assert response.status_code == 409
        assert "customer's location" in response.json()["message"]


class TestDeliveryCode:
    async def at_the_door(self, client):
        order, owner, _ = await accepted_order(client)
        arjun = await rider(client, "9100000001")
        delivery_id = (await requests_for(client, arjun))[0]["id"]
        await step(client, arjun, delivery_id, "accept")
        await step(client, arjun, delivery_id, "reached")
        await client.post(f"/api/v1/restaurant/orders/{order['id']}/ready", headers=owner["headers"])
        await step(client, arjun, delivery_id, "picked-up")
        await go_to(client, arjun, HOME)
        await step(client, arjun, delivery_id, "arrived")

        return order, arjun, delivery_id

    async def test_delivered_needs_the_customers_code(self, client):
        _, arjun, delivery_id = await self.at_the_door(client)

        without = await step(client, arjun, delivery_id, "delivered", cashCollected=True)
        wrong = await step(client, arjun, delivery_id, "delivered", cashCollected=True, code="0000"
                           if await code_for(delivery_id) != "0000" else "1111")
        right = await step(client, arjun, delivery_id, "delivered", cashCollected=True, code=await code_for(delivery_id))

        assert without.json()["code"] == "code_required"
        assert wrong.json()["code"] == "code_wrong"
        assert right.status_code == 200, right.text

    async def test_five_wrong_codes_lock_it_for_a_while(self, client):
        _, arjun, delivery_id = await self.at_the_door(client)
        real = await code_for(delivery_id)
        wrong = "1111" if real != "1111" else "2222"

        for _ in range(5):
            await step(client, arjun, delivery_id, "delivered", cashCollected=True, code=wrong)

        locked = await step(client, arjun, delivery_id, "delivered", cashCollected=True, code=real)

        assert locked.status_code == 429
        assert locked.json()["code"] == "code_locked"

    async def test_it_can_be_switched_off(self, client, monkeypatch):
        _, arjun, delivery_id = await self.at_the_door(client)
        monkeypatch.setattr(get_settings(), "delivery_code_required", "off")

        response = await step(client, arjun, delivery_id, "delivered", cashCollected=True)

        assert response.status_code == 200, response.text

    async def test_prepaid_only_skips_cash_orders(self, client, monkeypatch):
        _, arjun, delivery_id = await self.at_the_door(client)
        monkeypatch.setattr(get_settings(), "delivery_code_required", "prepaid")

        active = (await client.get("/api/v1/delivery/active", headers=arjun["headers"])).json()["delivery"]
        response = await step(client, arjun, delivery_id, "delivered", cashCollected=True)

        assert active["codeRequired"] is False
        assert response.status_code == 200, response.text


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
        # The rider is standing at the restaurant, so pickup distance is zero.
        arjun = await rider(client, "9100000001", at=ANNA_NAGAR)

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
        assert accepted["pickupKm"] == 0 and 4 < accepted["dropKm"] < 6, "both legs are shown"

    async def test_earnings_count_delivered_orders_and_cash_in_hand(self, client):
        order, owner, _ = await accepted_order(client)
        arjun = await rider(client, "9100000001")
        delivery_id = (await requests_for(client, arjun))[0]["id"]
        result = await hand_over(client, arjun, delivery_id, owner, order["id"])

        body = (await client.get("/api/v1/delivery/earnings?days=7", headers=arjun["headers"])).json()

        assert body["totals"]["deliveries"] == 1
        assert body["totals"]["earningsPaise"] == result["delivery"]["earningPaise"]
        assert body["totals"]["earningsPaise"] > get_settings().rider_base_pay_paise, "pinned trips pay per km"
        assert body["cashCollectedTodayPaise"] == order["totalPaise"]
        assert len(body["daily"]) == 7

        me = (await client.get("/api/v1/delivery/me", headers=arjun["headers"])).json()["partner"]
        assert me["today"]["deliveries"] == 1

    async def test_a_delivered_order_now_shows_in_restaurant_earnings_and_can_be_rated(self, client):
        # The two restaurant screens that had nothing to show until delivery existed.
        order, owner, customer = await accepted_order(client)
        arjun = await rider(client, "9100000001")
        delivery_id = (await requests_for(client, arjun))[0]["id"]
        await hand_over(client, arjun, delivery_id, owner, order["id"])

        earnings = (await client.get("/api/v1/restaurant/earnings?days=7", headers=owner["headers"])).json()
        review = await client.post(
            f"/api/v1/customer/orders/{order['id']}/review", json={"rating": 5}, headers=customer["headers"]
        )

        assert earnings["totals"]["orders"] == 1
        assert review.status_code in (200, 201), review.text

