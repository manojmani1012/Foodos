"""Swiggy/Zomato-style touches in the customer app: the live order bar, high
demand, sort and filters, bestsellers, search suggestions, cart notes for the
kitchen and the rider, and rating the delivery."""

from app.database import execute, fetchval

from test_delivery import BENGALURU, KILPAUK, accepted_order, hand_over, requests_for, rider, step
from test_restaurant_portal import ADDRESS, make_item, owner_with_restaurant, sign_in

PIN = {"latitude": ADDRESS["latitude"], "longitude": ADDRESS["longitude"]}


async def place(client, customer, item, quantity=1, **extra):
    response = await client.post(
        "/api/v1/customer/orders",
        json={
            "items": [{"menuItemId": str(item), "quantity": quantity}],
            "paymentMethod": "cod",
            "address": ADDRESS,
            **extra,
        },
        headers=customer["headers"],
    )
    assert response.status_code == 201, response.text

    return response.json()["order"]


async def listing(client, session=None, **params):
    response = await client.get(
        "/api/v1/customer/restaurants",
        params={**PIN, **params},
        headers=session["headers"] if session else None,
    )
    assert response.status_code == 200, response.text

    return response.json()


class TestLiveOrderBar:
    async def test_shows_the_order_on_its_way_and_nothing_once_it_arrives(self, client):
        order, owner, customer = await accepted_order(client)
        arjun = await rider(client, "9100000001")

        live = (await client.get("/api/v1/customer/orders/active", headers=customer["headers"])).json()["order"]
        assert live["id"] == order["id"] and live["etaMinutes"] >= 1

        delivery_id = (await requests_for(client, arjun))[0]["id"]
        await hand_over(client, arjun, delivery_id, owner, order["id"])

        done = (await client.get("/api/v1/customer/orders/active", headers=customer["headers"])).json()
        assert done["order"] is None


class TestHighDemandAndRiders:
    async def test_a_busy_kitchen_is_marked_and_takes_longer(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        customer = await sign_in(client, "9876543210", "customer")
        before = (await listing(client, customer))["restaurants"][0]

        for _ in range(5):
            await place(client, customer, item)

        after = (await listing(client, customer))["restaurants"][0]
        detail = (
            await client.get(f"/api/v1/customer/restaurants/{restaurant_id}", params=PIN, headers=customer["headers"])
        ).json()

        assert before["highDemand"] is False
        assert after["highDemand"] is True and detail["highDemand"] is True
        assert after["etaMinMinutes"] == before["etaMinMinutes"] + 10

    async def test_says_when_no_delivery_partner_is_free_nearby(self, client):
        await owner_with_restaurant(client)

        assert (await listing(client))["fewRiders"] is True

        await rider(client, "9100000001", at=KILPAUK)
        assert (await listing(client))["fewRiders"] is False

        await rider(client, "9100000002", at=BENGALURU)  # far away: does not count
        await execute("update delivery_partners set is_online = false where user_id = (select id from users where phone = '+919100000001')")
        assert (await listing(client))["fewRiders"] is True


class TestSortAndFilters:
    async def test_sort_by_rating_distance_and_filter_rating_and_fast_delivery(self, client):
        _, near = await owner_with_restaurant(client, "9000000001", "Near Kitchen")
        _, far = await owner_with_restaurant(client, "9000000002", "Far Kitchen")
        # Near: 3.9 stars at the customer's door. Far: 4.6 stars about 5 km away.
        await execute("update restaurants set rating = 3.9, latitude = $2, longitude = $3 where id = $1", near, PIN["latitude"], PIN["longitude"])
        await execute("update restaurants set rating = 4.6, latitude = 13.1270, longitude = 80.2270 where id = $1", far)

        names = lambda body: [r["name"] for r in body["restaurants"]]  # noqa: E731

        assert names(await listing(client, sort="rating")) == ["Far Kitchen", "Near Kitchen"]
        assert names(await listing(client, sort="distance")) == ["Near Kitchen", "Far Kitchen"]
        assert names(await listing(client, sort="delivery_time")) == ["Near Kitchen", "Far Kitchen"]
        assert names(await listing(client, minRating=4)) == ["Far Kitchen"]
        assert names(await listing(client, fastDelivery="true")) == ["Near Kitchen"]


class TestBestsellersAndSuggestions:
    async def test_most_ordered_dishes_are_bestsellers_and_suggested(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        biryani = await make_item(restaurant_id, name="Chicken Biryani")
        await make_item(restaurant_id, name="Plain Rice")
        customer = await sign_in(client, "9876543210", "customer")
        await place(client, customer, biryani, quantity=2)

        detail = (await client.get(f"/api/v1/customer/restaurants/{restaurant_id}", params=PIN)).json()
        flags = {i["name"]: i["isBestseller"] for c in detail["categories"] for i in c["items"]}
        popular = (await client.get("/api/v1/customer/popular-dishes", params=PIN)).json()["dishes"]

        assert flags == {"Chicken Biryani": True, "Plain Rice": False}
        assert popular == ["Chicken Biryani"]


class TestCartNotes:
    async def test_the_kitchen_and_the_rider_each_get_their_own_note(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        customer = await sign_in(client, "9876543210", "customer")
        order = await place(
            client,
            customer,
            item,
            cookingInstructions="Less spicy please",
            noCutlery=True,
            deliveryPreferences=["leave_at_door", "no_bell"],
        )
        await client.post(f"/api/v1/restaurant/orders/{order['id']}/accept", headers=owner["headers"])
        arjun = await rider(client, "9100000001")
        delivery_id = (await requests_for(client, arjun))[0]["id"]
        await step(client, arjun, delivery_id, "accept")

        kitchen = (
            await client.get(f"/api/v1/restaurant/orders/{order['id']}", headers=owner["headers"])
        ).json()["order"]["specialInstructions"]
        door = (await client.get("/api/v1/delivery/active", headers=arjun["headers"])).json()["delivery"]["customer"][
            "instructions"
        ]

        assert kitchen == "Less spicy please · No cutlery needed"
        assert door == "Leave the order at the door · Do not ring the bell"
        assert order["deliveryPreferences"] == ["leave_at_door", "no_bell"] and order["noCutlery"] is True

    async def test_unknown_delivery_preferences_are_refused(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        customer = await sign_in(client, "9876543210", "customer")

        response = await client.post(
            "/api/v1/customer/orders",
            json={
                "items": [{"menuItemId": str(item), "quantity": 1}],
                "paymentMethod": "cod",
                "address": ADDRESS,
                "deliveryPreferences": ["throw_it_over_the_wall"],
            },
            headers=customer["headers"],
        )

        assert response.status_code in (400, 422)


class TestRateTheDelivery:
    async def test_rate_once_after_delivery_and_the_riders_average_updates(self, client):
        order, owner, customer = await accepted_order(client)
        arjun = await rider(client, "9100000001")
        review = f"/api/v1/customer/orders/{order['id']}/rider-review"

        early = await client.post(review, json={"rating": 5}, headers=customer["headers"])
        assert early.status_code == 409

        delivery_id = (await requests_for(client, arjun))[0]["id"]
        await hand_over(client, arjun, delivery_id, owner, order["id"])

        rated = await client.post(review, json={"rating": 4, "comment": "Polite"}, headers=customer["headers"])
        again = await client.post(review, json={"rating": 1}, headers=customer["headers"])
        shown = (await client.get(f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"])).json()

        assert rated.status_code == 200, rated.text
        assert again.status_code == 409
        assert shown["order"]["riderReview"] == {"rating": 4, "comment": "Polite"}
        assert float(await fetchval("select rating from delivery_partners where user_id = $1::uuid", arjun["userId"])) == 4.0
