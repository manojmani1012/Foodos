"""Partner and Delivery app extras, Swiggy/Zomato style: the kitchen's own
prep time and "Need more time?", outlet notices, test orders marked for the
kitchen, fake GPS refused, daily targets, and the cash-in-hand limit."""

from app.config import get_settings
from app.database import execute, fetchrow, fetchval

from test_admin import admin, latest_activity  # noqa: F401 - the admin fixture
from test_admin_money import delivered_yesterday, yesterday
from test_customer_extras import place
from test_delivery import RESTAURANT, hand_over, requests_for, rider, step
from test_restaurant_portal import make_item, owner_with_restaurant, sign_in
from test_test_accounts import accepted, mark_test


async def kitchen(client):
    """A restaurant with one dish, its owner, and a customer: enough for
    several orders without signing anyone in twice."""
    owner, restaurant_id = await owner_with_restaurant(client)
    item = await make_item(restaurant_id)
    customer = await sign_in(client, "9876543210", "customer")

    return owner, restaurant_id, item, customer


async def accept(client, owner, order, **body):
    response = await client.post(
        f"/api/v1/restaurant/orders/{order['id']}/accept", json=body or None, headers=owner["headers"]
    )
    assert response.status_code == 200, response.text

    return response.json()["order"]


async def more_time(client, owner, order, minutes):
    return await client.post(
        f"/api/v1/restaurant/orders/{order['id']}/more-time", json={"minutes": minutes}, headers=owner["headers"]
    )


async def eta(client, customer, order):
    response = await client.get(f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"])

    return response.json()["order"]["etaMinutes"]


async def deliver(client, owner, customer, item, session):
    """One cash order, placed, accepted and carried to the door by `session`."""
    order = await place(client, customer, item)
    await accept(client, owner, order)
    offer = (await requests_for(client, session))[0]

    return order, await hand_over(client, session, offer["id"], owner, order["id"])


async def me(client, session):
    response = await client.get("/api/v1/delivery/me", headers=session["headers"])
    assert response.status_code == 200, response.text

    return response.json()["partner"]


class TestPrepTime:
    async def test_the_kitchen_picks_the_time_and_the_customer_eta_follows(self, client):
        owner, _, item, customer = await kitchen(client)
        order = await place(client, customer, item)

        accepted_order = await accept(client, owner, order, prepMinutes=10)
        quick = await eta(client, customer, order)

        response = await more_time(client, owner, order, 10)
        later = response.json()["order"]

        assert accepted_order["prepMinutes"] == 10 and accepted_order["readyBy"] and accepted_order["moreTimeLeft"] == 3
        assert response.status_code == 200, response.text
        assert later["prepMinutes"] == 20 and later["moreTimeLeft"] == 2
        assert await eta(client, customer, order) >= quick + 9

    async def test_an_older_app_gets_the_usual_time_and_more_time_has_limits(self, client):
        owner, _, item, customer = await kitchen(client)
        usual = await place(client, customer, item)
        waiting = await place(client, customer, item)
        long = await place(client, customer, item)

        assert (await accept(client, owner, usual))["prepMinutes"] == 30

        for _ in range(3):
            assert (await more_time(client, owner, usual, 5)).status_code == 200

        fourth = await more_time(client, owner, usual, 5)
        not_cooking = await more_time(client, owner, waiting, 5)
        await accept(client, owner, long, prepMinutes=110)
        too_long = await more_time(client, owner, long, 15)

        assert fourth.json()["code"] == "no_more_time"
        assert not_cooking.json()["code"] == "order_not_preparing"
        assert too_long.json()["code"] == "prep_too_long"


class TestOutletAndTestOrders:
    async def test_the_owner_is_told_when_customers_cannot_find_the_outlet(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)

        pinned = (await client.get("/api/v1/restaurant/me", headers=owner["headers"])).json()["restaurant"]
        await execute("update restaurants set latitude = null, longitude = null where id = $1", restaurant_id)
        unpinned = (await client.get("/api/v1/restaurant/me", headers=owner["headers"])).json()["restaurant"]

        assert pinned["onMap"] is True and unpinned["onMap"] is False

    async def test_the_kitchen_sees_which_orders_are_tests(self, client, admin):
        customer = await sign_in(client, "9876543210", "customer")
        await mark_test(client, admin, customer)
        order, owner = await accepted(client, customer)

        listed = (
            await client.get("/api/v1/restaurant/orders", params={"queue": "preparing"}, headers=owner["headers"])
        ).json()["orders"]
        detail = (await client.get(f"/api/v1/restaurant/orders/{order['id']}", headers=owner["headers"])).json()

        assert [o["isTest"] for o in listed] == [True]
        assert detail["order"]["isTest"] is True and listed[0]["readyBy"]


class TestFakeGps:
    async def test_a_fake_position_is_refused_counted_and_shown(self, client, admin):
        arjun = await rider(client, "9100000001")
        before = await fetchrow("select current_latitude, current_longitude from delivery_partners where user_id = $1::uuid", arjun["userId"])

        fake = {"latitude": 12.9716, "longitude": 77.5946, "mocked": True}
        first = await client.post("/api/v1/delivery/location", json=fake, headers=arjun["headers"])
        again = await client.post("/api/v1/delivery/location", json=fake, headers=arjun["headers"])
        after = await fetchrow("select current_latitude, current_longitude from delivery_partners where user_id = $1::uuid", arjun["userId"])
        on = (await me(client, arjun))["fakeGps"]

        real = {"latitude": RESTAURANT[0], "longitude": RESTAURANT[1]}
        await client.post("/api/v1/delivery/location", json=real, headers=arjun["headers"])
        seen = (await client.get(f"/api/v1/admin/riders/{arjun['userId']}", headers=admin)).json()["rider"]["fakeGps"]

        assert first.status_code == 409 and first.json()["code"] == "mock_location"
        assert again.status_code == 409
        assert dict(after) == dict(before)  # the fake position was never stored
        assert on is True and (await me(client, arjun))["fakeGps"] is False
        assert seen["count"] == 1 and seen["lastSeenAt"]  # once per 10 minutes, not per update

    async def test_a_step_sent_from_fake_gps_is_refused(self, client):
        owner, _, item, customer = await kitchen(client)
        order = await place(client, customer, item)
        await accept(client, owner, order)
        arjun = await rider(client, "9100000001")
        offer = (await requests_for(client, arjun))[0]
        await step(client, arjun, offer["id"], "accept")

        response = await step(
            client, arjun, offer["id"], "reached", latitude=RESTAURANT[0], longitude=RESTAURANT[1], mocked=True
        )

        assert response.status_code == 409 and response.json()["code"] == "mock_location"
        assert await fetchval("select status from deliveries where id = $1::uuid", offer["id"]) == "accepted"

    async def test_test_riders_may_use_fake_gps(self, client, admin):
        arjun = await rider(client, "9100000001")
        await mark_test(client, admin, arjun)

        response = await client.post(
            "/api/v1/delivery/location", json={"latitude": 12.9716, "longitude": 77.5946, "mocked": True}, headers=arjun["headers"]
        )

        assert response.status_code == 200, response.text


class TestDailyTargets:
    async def test_the_trip_that_reaches_a_target_pays_its_bonus_once(self, client, admin):
        two = (
            await client.post("/api/v1/admin/targets", json={"targetTrips": 2, "bonusPaise": 5000}, headers=admin)
        ).json()["target"]
        await client.post("/api/v1/admin/targets", json={"targetTrips": 3, "bonusPaise": 9000, "name": "Weekend push"}, headers=admin)
        owner, _, item, customer = await kitchen(client)
        arjun = await rider(client, "9100000001")

        start = (await me(client, arjun))["targets"]
        _, first = await deliver(client, owner, customer, item, arjun)
        _, second = await deliver(client, owner, customer, item, arjun)
        progress = (await me(client, arjun))["targets"]
        earnings = (await client.get("/api/v1/delivery/earnings", params={"days": 1}, headers=arjun["headers"])).json()
        listed = (await client.get("/api/v1/admin/targets", headers=admin)).json()["targets"]

        assert two["name"] == "Complete 2 trips, earn ₹50 extra" and two["live"] is True
        assert [(t["targetTrips"], t["tripsDone"], t["achieved"]) for t in start] == [(2, 0, False), (3, 0, False)]
        assert first["targetsReached"] == []
        assert second["targetsReached"] == [{"name": two["name"], "bonusPaise": 5000}]
        assert [(t["tripsDone"], t["achieved"]) for t in progress] == [(2, True), (2, False)]
        assert earnings["totals"]["incentivePaise"] == 5000
        assert await fetchval("select count(*) from incentive_awards") == 1
        assert [(t["targetTrips"], t["reachedToday"], t["paidTotalPaise"]) for t in listed] == [(2, 1, 5000), (3, 0, 0)]

        stopped = await client.post(f"/api/v1/admin/targets/{two['id']}/stop", headers=admin)
        again = await client.post(f"/api/v1/admin/targets/{two['id']}/stop", headers=admin)

        assert stopped.json()["target"]["live"] is False
        assert again.json()["code"] == "target_not_running"
        assert [t["targetTrips"] for t in (await me(client, arjun))["targets"]] == [3]
        assert (await latest_activity(client, admin, "Riders"))[0]["action"] == "Stopped daily target"


class TestCashLimit:
    async def test_a_rider_at_the_limit_gets_only_prepaid_orders_until_they_deposit(self, client, admin, monkeypatch):
        monkeypatch.setattr(get_settings(), "rider_cash_limit_paise", 10000)
        owner, _, item, customer = await kitchen(client)
        arjun = await rider(client, "9100000001")

        delivered, _ = await deliver(client, owner, customer, item, arjun)
        held = (await me(client, arjun))["cash"]

        cash_order = await place(client, customer, item)
        await accept(client, owner, cash_order)
        while_full = await requests_for(client, arjun)

        too_much = await client.post(
            f"/api/v1/admin/riders/{arjun['userId']}/cash-deposits",
            json={"amountPaise": delivered["totalPaise"] + 100},
            headers=admin,
        )
        deposit = await client.post(
            f"/api/v1/admin/riders/{arjun['userId']}/cash-deposits",
            json={"amountPaise": delivered["totalPaise"], "reference": " UPI 4471 "},
            headers=admin,
        )
        after = (await me(client, arjun))["cash"]
        offered = await requests_for(client, arjun)

        assert held == {"inHandPaise": delivered["totalPaise"], "limitPaise": 10000, "limitReached": True}
        assert while_full == []
        assert too_much.json()["code"] == "deposit_too_large"
        assert deposit.status_code == 200, deposit.text
        assert deposit.json()["rider"]["cash"]["deposits"][0]["reference"] == "UPI 4471"
        assert after == {"inHandPaise": 0, "limitPaise": 10000, "limitReached": False}
        assert [o["orderNumber"] for o in offered] == [cash_order["orderNumber"]]

    async def test_prepaid_orders_still_reach_a_rider_at_the_limit(self, client, monkeypatch):
        monkeypatch.setattr(get_settings(), "rider_cash_limit_paise", 10000)
        owner, _, item, customer = await kitchen(client)
        arjun = await rider(client, "9100000001")
        await deliver(client, owner, customer, item, arjun)

        prepaid = await place(client, customer, item)
        await execute("update orders set payment_method = 'upi', payment_status = 'paid' where id = $1::uuid", prepaid["id"])
        await accept(client, owner, prepaid)

        assert [o["orderNumber"] for o in await requests_for(client, arjun)] == [prepaid["orderNumber"]]

    async def test_the_payout_adds_back_cash_already_deposited(self, client, admin):
        order, arjun, _ = await delivered_yesterday(client)
        await client.post(
            f"/api/v1/admin/riders/{arjun['userId']}/cash-deposits",
            json={"amountPaise": order["totalPaise"]},
            headers=admin,
        )
        await execute("update rider_cash_deposits set created_at = created_at - interval '1 day'")
        day = (await yesterday()).isoformat()

        line = (
            await client.get(
                "/api/v1/admin/payouts/statement",
                params={"party": "delivery_partner", "from": day, "to": day},
                headers=admin,
            )
        ).json()["lines"][0]

        assert line["breakdown"]["cashDepositedPaise"] == order["totalPaise"]
        assert line["adjustmentsPaise"] == 0
        assert line["netPaise"] == line["grossPaise"]
