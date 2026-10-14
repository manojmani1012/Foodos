"""Push notifications: who is told what as an order moves, and that a phone
problem never gets in the way of the order itself.

Expo's push service is replaced by a stand-in that records every message.
"""

from types import SimpleNamespace

import httpx
import pytest

from app.components.notifications import push
from app.config import get_settings
from app.database import execute, fetchval

from test_delivery import accepted_order, requests_for, rider, step
from test_restaurant_portal import make_item, owner_with_restaurant, place_customer_order, sign_in

OWNER_TOKEN = "ExponentPushToken[owner-phone]"
CUSTOMER_TOKEN = "ExponentPushToken[customer-phone]"
RIDER_TOKEN = "ExponentPushToken[rider-phone]"


@pytest.fixture
def phones(monkeypatch):
    monkeypatch.setattr(get_settings(), "push_enabled", True)
    outbox: list[dict] = []
    behaviour = {"dead": set(), "down": False}

    async def fake_post(messages):
        if behaviour["down"]:
            raise httpx.ConnectError("Expo is unreachable")

        outbox.extend(messages)

        return [
            {"status": "error", "details": {"error": "DeviceNotRegistered"}}
            if message["to"] in behaviour["dead"]
            else {"status": "ok", "id": "ticket"}
            for message in messages
        ]

    monkeypatch.setattr(push, "_post", fake_post)

    return SimpleNamespace(
        outbox=outbox,
        behaviour=behaviour,
        to=lambda token: [message for message in outbox if message["to"] == token],
        titles=lambda token: [message["title"] for message in outbox if message["to"] == token],
    )


async def register(client, session, token, platform="android"):
    response = await client.put(
        "/api/v1/notifications/push-token",
        json={"token": token, "platform": platform},
        headers=session["headers"],
    )
    assert response.status_code == 200, response.text


class TestRegistering:
    async def test_a_token_is_stored_against_the_app_that_sent_it(self, client):
        rider_session = await sign_in(client, "9100000001", "delivery_partner")

        await register(client, rider_session, RIDER_TOKEN)

        assert await fetchval("select app from push_tokens where token = $1", RIDER_TOKEN) == "delivery"

    async def test_rejects_something_that_is_not_an_expo_token(self, client):
        customer = await sign_in(client, "9876543210", "customer")

        response = await client.put(
            "/api/v1/notifications/push-token", json={"token": "not-a-real-token-at-all"}, headers=customer["headers"]
        )

        assert response.status_code == 400

    async def test_signing_in_as_someone_else_on_the_same_phone_moves_the_token(self, client):
        first = await sign_in(client, "9876543210", "customer")
        second = await sign_in(client, "9876543211", "customer")

        await register(client, first, CUSTOMER_TOKEN)
        await register(client, second, CUSTOMER_TOKEN)

        owner = await fetchval("select user_id::text from push_tokens where token = $1", CUSTOMER_TOKEN)
        assert owner == second["userId"]
        assert await fetchval("select count(*) from push_tokens") == 1

    async def test_signing_out_removes_it(self, client):
        customer = await sign_in(client, "9876543210", "customer")
        await register(client, customer, CUSTOMER_TOKEN)

        response = await client.post(
            "/api/v1/notifications/push-token/remove", json={"token": CUSTOMER_TOKEN}, headers=customer["headers"]
        )

        assert response.status_code == 200
        assert await fetchval("select count(*) from push_tokens") == 0


class TestRestaurantHearsAboutOrders:
    async def test_a_cash_order_rings_the_restaurant(self, client, phones):
        owner, restaurant_id = await owner_with_restaurant(client)
        await register(client, owner, OWNER_TOKEN)
        item = await make_item(restaurant_id)

        order, _ = await place_customer_order(client, item)

        [message] = phones.to(OWNER_TOKEN)
        assert message["title"] == f"New order #{order['orderNumber']}"
        assert "2 items" in message["body"] and "Cash on delivery" in message["body"]
        assert message["channelId"] == "orders"
        assert message["priority"] == "high"
        assert message["data"] == {"type": "order", "orderId": order["id"]}

    async def test_the_customer_cancelling_tells_the_restaurant(self, client, phones):
        owner, restaurant_id = await owner_with_restaurant(client)
        await register(client, owner, OWNER_TOKEN)
        item = await make_item(restaurant_id)
        order, customer = await place_customer_order(client, item)
        await register(client, customer, CUSTOMER_TOKEN)

        await client.post(
            f"/api/v1/customer/orders/{order['id']}/cancel", json={"reason": "Ordered by mistake"}, headers=customer["headers"]
        )

        assert phones.titles(OWNER_TOKEN)[-1] == f"Order #{order['orderNumber']} cancelled"
        assert "Ordered by mistake" in phones.to(OWNER_TOKEN)[-1]["body"]
        # The person who cancelled is not told what they just did.
        assert phones.to(CUSTOMER_TOKEN) == []


class TestTheWholeTrip:
    async def test_everyone_is_told_at_each_step(self, client, phones):
        arjun = await rider(client, "9100000001")
        await register(client, arjun, RIDER_TOKEN)
        owner, restaurant_id = await owner_with_restaurant(client)
        await register(client, owner, OWNER_TOKEN)
        item = await make_item(restaurant_id)
        order, customer = await place_customer_order(client, item)
        await register(client, customer, CUSTOMER_TOKEN)
        await execute("update users set full_name = 'Arjun Kumar' where id = $1::uuid", arjun["userId"])

        await client.post(f"/api/v1/restaurant/orders/{order['id']}/accept", headers=owner["headers"])

        assert phones.titles(CUSTOMER_TOKEN) == ["Order confirmed"]
        assert phones.titles(RIDER_TOKEN) == ["New delivery request"]
        assert phones.to(RIDER_TOKEN)[0]["channelId"] == "orders"

        offer = (await requests_for(client, arjun))[0]
        await step(client, arjun, offer["id"], "accept")
        assert phones.to(CUSTOMER_TOKEN)[-1]["body"].startswith("Arjun is heading to")

        await step(client, arjun, offer["id"], "reached")
        assert phones.titles(OWNER_TOKEN)[-1] == "Rider has arrived"

        await client.post(f"/api/v1/restaurant/orders/{order['id']}/ready", headers=owner["headers"])
        assert phones.titles(RIDER_TOKEN)[-1] == "Food is ready"

        await step(client, arjun, offer["id"], "picked-up")
        await step(client, arjun, offer["id"], "arrived")
        await step(client, arjun, offer["id"], "delivered", cashCollected=True)

        assert phones.titles(CUSTOMER_TOKEN) == [
            "Order confirmed",
            "Delivery partner assigned",
            "Your order is on the way",
            "Your order is here",
            "Order delivered",
        ]
        # A cash order: the customer is reminded to have the money ready.
        arrived = phones.to(CUSTOMER_TOKEN)[3]
        assert "keep ₹" in arrived["body"]

    async def test_only_riders_who_could_take_it_are_told(self, client, phones):
        ready = await rider(client, "9100000001")
        offline = await rider(client, "9100000002", online=False)
        elsewhere = await rider(client, "9100000003", city="Coimbatore")
        for session, token in ((ready, "ExponentPushToken[ready]"), (offline, "ExponentPushToken[offline]"), (elsewhere, "ExponentPushToken[elsewhere]")):
            await register(client, session, token)

        await accepted_order(client)

        assert phones.titles("ExponentPushToken[ready]") == ["New delivery request"]
        assert phones.to("ExponentPushToken[offline]") == []
        assert phones.to("ExponentPushToken[elsewhere]") == []

    async def test_a_rider_does_not_get_delivery_alerts_in_their_customer_app(self, client, phones):
        await rider(client, "9100000001")
        # The same person, signed in to the customer app on another phone.
        await execute(
            "insert into user_roles (user_id, role) select id, 'customer' from users where phone = '+919100000001'"
        )
        user_id = await fetchval("select id from users where phone = '+919100000001'")
        await push.register(user_id, "customer", "ExponentPushToken[their-customer-app]", "android")

        await accepted_order(client)

        assert phones.to("ExponentPushToken[their-customer-app]") == []


class TestCancelledByFoodos:
    async def test_customer_restaurant_and_rider_are_all_told(self, client, phones):
        from test_admin import make_admin, admin_login

        arjun = await rider(client, "9100000001")
        await register(client, arjun, RIDER_TOKEN)
        order, owner, customer = await accepted_order(client)
        await register(client, owner, OWNER_TOKEN)
        await register(client, customer, CUSTOMER_TOKEN)
        offer = (await requests_for(client, arjun))[0]
        await step(client, arjun, offer["id"], "accept")

        await make_admin()
        admin = {"authorization": f"Bearer {(await admin_login(client)).json()['accessToken']}"}
        await client.post(f"/api/v1/admin/orders/{order['id']}/cancel", json={"reason": "Restaurant closed early"}, headers=admin)

        assert phones.to(CUSTOMER_TOKEN)[-1]["body"] == "Foodos cancelled your order: Restaurant closed early"
        assert phones.titles(OWNER_TOKEN)[-1] == f"Order #{order['orderNumber']} cancelled"
        assert phones.titles(RIDER_TOKEN)[-1] == "Delivery cancelled"

    async def test_the_restaurant_rejecting_tells_the_customer(self, client, phones):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, customer = await place_customer_order(client, item)
        await register(client, customer, CUSTOMER_TOKEN)

        await client.post(
            f"/api/v1/restaurant/orders/{order['id']}/reject", json={"reason": "Out of stock"}, headers=owner["headers"]
        )

        [message] = phones.to(CUSTOMER_TOKEN)
        assert message["title"] == "Order cancelled"
        # A cash order: there is no refund to mention.
        assert "refund" not in message["body"]


class TestWhenPhonesMisbehave:
    async def test_an_uninstalled_app_is_forgotten(self, client, phones):
        owner, restaurant_id = await owner_with_restaurant(client)
        await register(client, owner, OWNER_TOKEN)
        phones.behaviour["dead"].add(OWNER_TOKEN)
        item = await make_item(restaurant_id)

        await place_customer_order(client, item)

        assert await fetchval("select count(*) from push_tokens where token = $1", OWNER_TOKEN) == 0

    async def test_the_order_goes_through_when_expo_is_down(self, client, phones):
        owner, restaurant_id = await owner_with_restaurant(client)
        await register(client, owner, OWNER_TOKEN)
        phones.behaviour["down"] = True
        item = await make_item(restaurant_id)

        order, _ = await place_customer_order(client, item)

        assert order["status"] == "confirmed"
        # Not removed: an outage says nothing about the phone.
        assert await fetchval("select count(*) from push_tokens") == 1
