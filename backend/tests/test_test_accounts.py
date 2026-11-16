"""Test accounts: the client's staff run a whole order from home or the office.

An order placed by a test customer is a test order. It goes only to test
riders, wherever they are, and the "be at the pin" check is off for it. Real
orders keep every rule and never go to a test rider.
"""

from app.database import fetchval, transaction

from test_admin import admin, latest_activity  # noqa: F401 - the admin fixture
from test_delivery import BENGALURU, code_for, requests_for, rider, step
from test_restaurant_portal import make_item, owner_with_restaurant, sign_in
from test_uat_fixes import order_with


async def mark_test(client, admin, session, is_test=True):
    response = await client.post(
        f"/api/v1/admin/accounts/{session['userId']}/test", json={"isTest": is_test}, headers=admin
    )
    assert response.status_code == 200, response.text


async def accepted(client, customer):
    """An order from this customer that the restaurant has accepted."""
    owner, restaurant_id = await owner_with_restaurant(client)
    item = await make_item(restaurant_id)
    order = (await order_with(client, customer, item)).json()["order"]
    response = await client.post(f"/api/v1/restaurant/orders/{order['id']}/accept", headers=owner["headers"])
    assert response.status_code == 200, response.text

    return order, owner


class TestTestOrders:
    async def test_a_test_customers_order_goes_to_a_test_rider_hundreds_of_km_away(self, client, admin):
        customer = await sign_in(client, "9876543210", "customer")
        await mark_test(client, admin, customer)
        order, _ = await accepted(client, customer)
        real_rider = await rider(client, "9100000001")
        test_rider = await rider(client, "9100000002", at=BENGALURU)
        await mark_test(client, admin, test_rider)

        offers = await requests_for(client, test_rider)

        assert [offer["orderNumber"] for offer in offers] == [order["orderNumber"]]
        assert offers[0]["isTest"] is True
        assert await requests_for(client, real_rider) == [], "a real rider never gets a test order"
        assert await fetchval("select is_test from orders where id = $1::uuid", order["id"])

    async def test_a_test_rider_finishes_a_test_order_from_far_away(self, client, admin):
        customer = await sign_in(client, "9876543210", "customer")
        await mark_test(client, admin, customer)
        order, owner = await accepted(client, customer)
        test_rider = await rider(client, "9100000002", at=BENGALURU)
        await mark_test(client, admin, test_rider)
        delivery_id = (await requests_for(client, test_rider))[0]["id"]

        assert (await step(client, test_rider, delivery_id, "accept")).status_code == 200
        active = (await client.get("/api/v1/delivery/active", headers=test_rider["headers"])).json()["delivery"]
        assert active["isTest"] is True, "the app can say the location check is off"
        reached = await step(client, test_rider, delivery_id, "reached", latitude=BENGALURU[0], longitude=BENGALURU[1])
        assert reached.status_code == 200, reached.text
        await client.post(f"/api/v1/restaurant/orders/{order['id']}/ready", headers=owner["headers"])
        assert (await step(client, test_rider, delivery_id, "picked-up")).status_code == 200
        assert (await step(client, test_rider, delivery_id, "arrived")).status_code == 200
        done = await step(
            client, test_rider, delivery_id, "delivered", cashCollected=True, code=await code_for(delivery_id)
        )

        assert done.status_code == 200, done.text
        assert await fetchval("select status from orders where id = $1::uuid", order["id"]) == "delivered"

    async def test_a_real_order_never_goes_to_a_test_rider_and_keeps_the_location_check(self, client, admin):
        customer = await sign_in(client, "9876543210", "customer")
        order, _ = await accepted(client, customer)
        test_rider = await rider(client, "9100000002")
        await mark_test(client, admin, test_rider)

        assert await requests_for(client, test_rider) == [], "even standing at the restaurant"

        real_rider = await rider(client, "9100000001", at=BENGALURU)
        assert await requests_for(client, real_rider) == [], "and real riders still have to be nearby"

    async def test_the_admin_order_list_marks_test_orders(self, client, admin):
        customer = await sign_in(client, "9876543210", "customer")
        await mark_test(client, admin, customer)
        order, _ = await accepted(client, customer)

        listed = (await client.get("/api/v1/admin/orders", params={"view": "live"}, headers=admin)).json()["orders"]

        assert [row["isTest"] for row in listed if row["id"] == order["id"]] == [True]


class TestTheSwitch:
    async def test_the_admin_switch_shows_on_the_account_and_is_logged(self, client, admin):
        test_rider = await rider(client, "9100000002")
        customer = await sign_in(client, "9876543210", "customer")

        await mark_test(client, admin, test_rider)
        await mark_test(client, admin, customer)

        rider_view = (await client.get(f"/api/v1/admin/riders/{test_rider['userId']}", headers=admin)).json()
        customer_view = (await client.get(f"/api/v1/admin/customers/{customer['userId']}", headers=admin)).json()
        assert rider_view["rider"]["isTest"] is True
        assert customer_view["customer"]["isTest"] is True
        assert (await latest_activity(client, admin))[0]["action"] == "Marked as test account"

        await mark_test(client, admin, customer, is_test=False)
        customer_view = (await client.get(f"/api/v1/admin/customers/{customer['userId']}", headers=admin)).json()
        assert customer_view["customer"]["isTest"] is False

    async def test_only_admins_can_flip_it(self, client):
        customer = await sign_in(client, "9876543210", "customer")

        response = await client.post(
            f"/api/v1/admin/accounts/{customer['userId']}/test", json={"isTest": True}, headers=customer["headers"]
        )

        assert response.status_code == 403


class TestTestCustomers:
    async def test_a_test_customer_sees_every_restaurant_and_can_order_from_far_away(self, client, admin):
        _, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        tester = await sign_in(client, "9876543210", "customer")
        await mark_test(client, admin, tester)
        far = {"latitude": BENGALURU[0], "longitude": BENGALURU[1]}

        listed = (
            await client.get("/api/v1/customer/restaurants", params=far, headers=tester["headers"])
        ).json()["restaurants"]
        placed = await order_with(client, tester, item, **far)

        assert [(r["id"], r["deliversHere"]) for r in listed] == [(str(restaurant_id), True)]
        assert placed.status_code == 201, placed.text

    async def test_a_real_customer_keeps_the_delivery_radius(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        customer = await sign_in(client, "9876543210", "customer")
        far = {"latitude": BENGALURU[0], "longitude": BENGALURU[1]}

        listed = (
            await client.get("/api/v1/customer/restaurants", params=far, headers=customer["headers"])
        ).json()["restaurants"]
        placed = await order_with(client, customer, item, **far)

        assert listed == []
        assert placed.status_code == 409
        assert placed.json()["code"] == "address_too_far"

    async def test_the_seed_makes_a_ready_test_customer_and_rider(self, client):
        from db.seed import TEST_CUSTOMER, TEST_RIDER, seed_test_accounts

        async with transaction() as connection:
            await seed_test_accounts(connection)
            await seed_test_accounts(connection)  # safe to run again

        customer = await sign_in(client, TEST_CUSTOMER["phone"][3:], "customer")
        test_rider = await sign_in(client, TEST_RIDER["phone"][3:], "delivery_partner")
        addresses = (await client.get("/api/v1/customer/addresses", headers=customer["headers"])).json()["addresses"]
        partner = (await client.get("/api/v1/delivery/me", headers=test_rider["headers"])).json()["partner"]

        assert [a["label"] for a in addresses] == ["Test address"]
        assert addresses[0]["latitude"] is not None, "pinned, so it can be ordered to"
        assert partner["status"] == "active", "approved, so it can go online at once"
        assert await fetchval("select count(*) from users where is_test") == 2
