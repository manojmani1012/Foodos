"""Admin panel: who can get in, onboarding restaurants, approving riders,
handling orders and customers, and offers.

The theme: each admin action has the effect the partner and customer apps
depend on (a restaurant made live shows up for customers, an approved rider can
go online, a blocked number cannot sign in), and each one is in the activity log.
"""

import pytest

from app.components.auth.passwords import hash_password
from app.database import execute, fetchrow, fetchval

from test_delivery import accepted_order, requests_for, rider, step
from test_restaurant_portal import make_item, owner_with_restaurant, place_customer_order, sign_in

ADMIN_EMAIL = "ops@foodos.in"
ADMIN_PASSWORD = "ops-password-1"

NEW_RESTAURANT = {
    "ownerPhone": "9000000009",
    "ownerName": "Lakshmi Narayanan",
    "name": "Chettinad Kitchen",
    "cuisines": ["South Indian", "Chettinad"],
    "addressLine": "12, Kamarajar Salai, Mylapore",
    "city": "Chennai",
    "pincode": "600004",
    "latitude": 13.0339,
    "longitude": 80.2619,
    "fssaiNumber": "12345678901234",
    "gstNumber": "33abcde1234f1z5",
    "commissionPct": 18,
}


async def make_admin(email: str = ADMIN_EMAIL, role: str = "admin") -> str:
    user_id = await fetchval(
        "insert into users (email, full_name, password_hash) values ($1, 'Priya Sharma', $2) returning id",
        email,
        hash_password(ADMIN_PASSWORD),
    )
    await execute("insert into user_roles (user_id, role) values ($1, $2)", user_id, role)

    return str(user_id)


async def admin_login(client, email: str = ADMIN_EMAIL, password: str = ADMIN_PASSWORD):
    return await client.post("/api/v1/auth/admin/login", json={"email": email, "password": password})


@pytest.fixture
async def admin(client):
    await make_admin()
    body = (await admin_login(client)).json()

    return {"authorization": f"Bearer {body['accessToken']}"}


async def latest_activity(client, admin, module=None):
    params = {"module": module} if module else {}
    response = await client.get("/api/v1/admin/activity", params=params, headers=admin)
    assert response.status_code == 200, response.text

    return response.json()["activity"]


class TestAccess:
    async def test_needs_a_session(self, client):
        response = await client.get("/api/v1/admin/dashboard")

        assert response.status_code == 401

    async def test_a_customer_session_is_turned_away(self, client):
        customer = await sign_in(client, "9876543210", "customer")

        response = await client.get("/api/v1/admin/dashboard", headers=customer["headers"])

        assert response.status_code == 403
        assert response.json()["code"] == "role_forbidden"

    async def test_an_admin_sees_the_dashboard(self, client, admin):
        response = await client.get("/api/v1/admin/dashboard", headers=admin)

        assert response.status_code == 200, response.text
        body = response.json()
        assert set(body) >= {"today", "live", "riders", "restaurants", "customers", "attention", "daily"}
        assert len(body["daily"]) == 14


class TestLoginThrottle:
    async def test_five_wrong_passwords_lock_the_email(self, client):
        await make_admin()

        for _ in range(5):
            assert (await admin_login(client, password="wrong-password")).status_code == 401

        # Even the right password is refused until the window passes.
        locked = await admin_login(client)

        assert locked.status_code == 429
        assert locked.json()["code"] == "login_attempts_exceeded"

    async def test_an_unknown_email_is_throttled_the_same_way(self, client):
        for _ in range(5):
            await admin_login(client, email="nobody@foodos.in")

        assert (await admin_login(client, email="nobody@foodos.in")).status_code == 429

    async def test_sign_ins_are_logged(self, client, admin):
        activity = await latest_activity(client, admin, "Auth")

        assert activity[0]["action"] == "Signed in"
        assert activity[0]["actor"] == "Priya Sharma"


class TestOnboardRestaurant:
    async def test_adds_a_pending_restaurant_the_owner_can_sign_in_to(self, client, admin):
        response = await client.post("/api/v1/admin/restaurants", json=NEW_RESTAURANT, headers=admin)

        assert response.status_code == 201, response.text
        restaurant = response.json()["restaurant"]
        assert restaurant["status"] == "pending"
        assert restaurant["owner"]["phone"] == "+919000000009"
        assert restaurant["owner"]["name"] == "Lakshmi Narayanan"
        assert restaurant["gstNumber"] == "33ABCDE1234F1Z5"
        assert restaurant["checklist"] == {
            "ownerSignedIn": False,
            "hasMenu": False,
            "hasLocation": True,
            "hasCoverPhoto": False,
            "hasFssai": True,
        }

        # The owner signs in to the restaurant app with that number and finds it.
        owner = await sign_in(client, "9000000009", "restaurant_owner")
        me = await client.get("/api/v1/restaurant/me", headers=owner["headers"])

        assert me.status_code == 200
        assert me.json()["restaurant"]["id"] == restaurant["id"]

        # Customers do not see it while it is pending.
        listing = (await client.get("/api/v1/customer/restaurants")).json()["restaurants"]
        assert restaurant["id"] not in [r["id"] for r in listing]

    async def test_an_existing_customer_number_becomes_an_owner(self, client, admin):
        customer = await sign_in(client, "9000000009", "customer")

        response = await client.post("/api/v1/admin/restaurants", json=NEW_RESTAURANT, headers=admin)

        assert response.status_code == 201, response.text
        assert response.json()["restaurant"]["owner"]["id"] == customer["userId"]
        roles = await fetchval(
            "select array_agg(role order by role) from user_roles where user_id = $1::uuid", customer["userId"]
        )
        assert roles == ["customer", "restaurant_owner"]

    async def test_one_restaurant_per_owner_number(self, client, admin):
        await client.post("/api/v1/admin/restaurants", json=NEW_RESTAURANT, headers=admin)

        second = await client.post(
            "/api/v1/admin/restaurants", json={**NEW_RESTAURANT, "name": "Chettinad Express"}, headers=admin
        )

        assert second.status_code == 409
        assert second.json()["code"] == "owner_has_restaurant"

    @pytest.mark.parametrize(
        "change, field",
        [
            ({"fssaiNumber": "1234"}, "fssaiNumber"),
            ({"gstNumber": "NOTAGSTIN"}, "gstNumber"),
            ({"pincode": "60004"}, "pincode"),
            ({"cuisines": [" "]}, "cuisines"),
        ],
    )
    async def test_rejects_bad_details_with_the_field_named(self, client, admin, change, field):
        response = await client.post("/api/v1/admin/restaurants", json={**NEW_RESTAURANT, **change}, headers=admin)

        assert response.status_code == 400
        assert field in response.json()["details"]["fields"]

    async def test_a_pin_outside_india_is_refused(self, client, admin):
        # Latitude and longitude swapped: a common slip.
        response = await client.post(
            "/api/v1/admin/restaurants",
            json={**NEW_RESTAURANT, "latitude": 80.2619, "longitude": 13.0339},
            headers=admin,
        )

        assert response.status_code == 400
        assert "outside India" in str(response.json()["details"])


class TestRestaurantLifecycle:
    async def onboarded(self, client, admin):
        response = await client.post("/api/v1/admin/restaurants", json=NEW_RESTAURANT, headers=admin)

        return response.json()["restaurant"]["id"]

    async def test_cannot_go_live_with_an_empty_menu(self, client, admin):
        restaurant_id = await self.onboarded(client, admin)

        response = await client.post(
            f"/api/v1/admin/restaurants/{restaurant_id}/status", json={"status": "active"}, headers=admin
        )

        assert response.status_code == 409
        assert response.json()["code"] == "menu_empty"

    async def test_going_live_puts_it_in_front_of_customers(self, client, admin):
        restaurant_id = await self.onboarded(client, admin)
        await make_item(restaurant_id)

        response = await client.post(
            f"/api/v1/admin/restaurants/{restaurant_id}/status", json={"status": "active"}, headers=admin
        )

        assert response.status_code == 200, response.text
        assert response.json()["restaurant"]["status"] == "active"
        listing = (await client.get("/api/v1/customer/restaurants")).json()["restaurants"]
        assert restaurant_id in [r["id"] for r in listing]

        activity = await latest_activity(client, admin, "Restaurants")
        assert activity[0]["action"] == "Made restaurant live"
        assert activity[0]["details"]["from"] == "pending"

    async def test_suspending_needs_a_reason_and_hides_it(self, client, admin):
        owner, restaurant_id = await owner_with_restaurant(client)

        no_reason = await client.post(
            f"/api/v1/admin/restaurants/{restaurant_id}/status", json={"status": "suspended"}, headers=admin
        )
        assert no_reason.status_code == 400

        suspended = await client.post(
            f"/api/v1/admin/restaurants/{restaurant_id}/status",
            json={"status": "suspended", "reason": "FSSAI licence expired"},
            headers=admin,
        )

        assert suspended.status_code == 200
        listing = (await client.get("/api/v1/customer/restaurants")).json()["restaurants"]
        assert str(restaurant_id) not in [r["id"] for r in listing]
        activity = await latest_activity(client, admin, "Restaurants")
        assert activity[0]["details"]["reason"] == "FSSAI licence expired"

    async def test_edits_only_what_is_sent(self, client, admin):
        restaurant_id = await self.onboarded(client, admin)

        response = await client.patch(
            f"/api/v1/admin/restaurants/{restaurant_id}",
            json={"commissionPct": 15, "description": "Home-style Chettinad meals", "ownerName": "Lakshmi N"},
            headers=admin,
        )

        assert response.status_code == 200, response.text
        restaurant = response.json()["restaurant"]
        assert restaurant["commissionPct"] == 15
        assert restaurant["description"] == "Home-style Chettinad meals"
        assert restaurant["owner"]["name"] == "Lakshmi N"
        assert restaurant["name"] == "Chettinad Kitchen"
        assert restaurant["latitude"] == pytest.approx(13.0339)

    async def test_can_take_a_restaurant_off_the_map(self, client, admin):
        restaurant_id = await self.onboarded(client, admin)

        response = await client.patch(
            f"/api/v1/admin/restaurants/{restaurant_id}",
            json={"latitude": None, "longitude": None},
            headers=admin,
        )

        assert response.status_code == 200
        assert response.json()["restaurant"]["checklist"]["hasLocation"] is False

    async def test_lists_with_counts_and_finds_by_owner_phone(self, client, admin):
        await self.onboarded(client, admin)
        await owner_with_restaurant(client)

        everything = (await client.get("/api/v1/admin/restaurants", headers=admin)).json()
        by_phone = (
            await client.get("/api/v1/admin/restaurants", params={"search": "90000 00009"}, headers=admin)
        ).json()

        assert everything["counts"]["pending"] == 1
        assert everything["counts"]["active"] == 1
        assert everything["counts"]["all"] == 2
        # Pending first: those are the ones waiting on someone.
        assert everything["restaurants"][0]["status"] == "pending"
        assert [r["name"] for r in by_phone["restaurants"]] == ["Chettinad Kitchen"]

    async def test_shows_the_menu_the_owner_built(self, client, admin):
        restaurant_id = await self.onboarded(client, admin)
        await make_item(restaurant_id, "Chettinad Chicken", 28900)

        categories = (
            await client.get(f"/api/v1/admin/restaurants/{restaurant_id}/menu", headers=admin)
        ).json()["categories"]

        assert categories[0]["items"][0]["name"] == "Chettinad Chicken"
        assert categories[0]["items"][0]["pricePaise"] == 28900


class TestRiders:
    async def test_approving_a_rider_lets_them_go_online(self, client, admin):
        session = await rider(client, "9100000001", active=False, online=False)
        await execute("update delivery_partners set city = 'Chennai' where user_id = $1::uuid", session["userId"])

        pending = (await client.get("/api/v1/admin/riders", params={"status": "pending"}, headers=admin)).json()
        assert [r["phone"] for r in pending["riders"]] == ["+919100000001"]

        approved = await client.post(
            f"/api/v1/admin/riders/{session['userId']}/status", json={"status": "active"}, headers=admin
        )
        online = await client.post("/api/v1/delivery/online", json={"isOnline": True}, headers=session["headers"])

        assert approved.status_code == 200, approved.text
        assert approved.json()["rider"]["status"] == "active"
        assert online.status_code == 200

    async def test_a_rider_needs_a_city_before_approval(self, client, admin):
        session = await rider(client, "9100000001", active=False, online=False)

        refused = await client.post(
            f"/api/v1/admin/riders/{session['userId']}/status", json={"status": "active"}, headers=admin
        )
        assert refused.status_code == 409
        assert refused.json()["code"] == "rider_city_missing"

        await client.patch(
            f"/api/v1/admin/riders/{session['userId']}",
            json={"city": "Chennai", "vehicleNumber": "tn 09 ab 1234"},
            headers=admin,
        )
        approved = await client.post(
            f"/api/v1/admin/riders/{session['userId']}/status", json={"status": "active"}, headers=admin
        )

        assert approved.status_code == 200
        assert approved.json()["rider"]["vehicleNumber"] == "TN 09 AB 1234"

    async def test_suspending_takes_a_rider_offline_at_once(self, client, admin):
        session = await rider(client, "9100000001")

        suspended = await client.post(
            f"/api/v1/admin/riders/{session['userId']}/status",
            json={"status": "suspended", "reason": "Customer complaints"},
            headers=admin,
        )
        again = await client.post("/api/v1/delivery/online", json={"isOnline": True}, headers=session["headers"])

        assert suspended.status_code == 200
        assert suspended.json()["rider"]["isOnline"] is False
        assert again.status_code == 403

    async def test_rejecting_needs_a_reason(self, client, admin):
        session = await rider(client, "9100000001", active=False, online=False)

        response = await client.post(
            f"/api/v1/admin/riders/{session['userId']}/status", json={"status": "rejected"}, headers=admin
        )

        assert response.status_code == 400

    async def test_shows_what_a_rider_is_carrying(self, client, admin):
        arjun = await rider(client, "9100000001")
        order, _, _ = await accepted_order(client)
        offer = (await requests_for(client, arjun))[0]
        await step(client, arjun, offer["id"], "accept")

        listing = (await client.get("/api/v1/admin/riders", params={"online": True}, headers=admin)).json()
        detail = (await client.get(f"/api/v1/admin/riders/{arjun['userId']}", headers=admin)).json()["rider"]

        assert listing["riders"][0]["carryingOrder"] == order["orderNumber"]
        assert detail["recentDeliveries"][0]["orderNumber"] == order["orderNumber"]


class TestOrders:
    async def test_finds_live_orders_by_number_and_phone(self, client, admin):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, _ = await place_customer_order(client, item, phone="9876543210")

        live = (await client.get("/api/v1/admin/orders", params={"view": "live"}, headers=admin)).json()
        by_number = (
            await client.get("/api/v1/admin/orders", params={"search": order["orderNumber"]}, headers=admin)
        ).json()
        by_phone = (await client.get("/api/v1/admin/orders", params={"search": "98765"}, headers=admin)).json()
        delivered = (await client.get("/api/v1/admin/orders", params={"view": "delivered"}, headers=admin)).json()

        assert [o["id"] for o in live["orders"]] == [order["id"]]
        assert live["counts"]["live"] == 1
        assert [o["id"] for o in by_number["orders"]] == [order["id"]]
        assert [o["id"] for o in by_phone["orders"]] == [order["id"]]
        assert delivered["orders"] == []

    async def test_cancelling_frees_the_rider_and_tells_the_customer(self, client, admin):
        arjun = await rider(client, "9100000001")
        order, owner, customer = await accepted_order(client)
        offer = (await requests_for(client, arjun))[0]
        await step(client, arjun, offer["id"], "accept")

        response = await client.post(
            f"/api/v1/admin/orders/{order['id']}/cancel",
            json={"reason": "Customer called: wrong address"},
            headers=admin,
        )

        assert response.status_code == 200, response.text
        cancelled = response.json()["order"]
        assert cancelled["status"] == "cancelled"
        assert cancelled["cancelledBy"] == "admin"
        assert cancelled["deliveryStatus"] == "cancelled"
        assert cancelled["actions"]["canCancel"] is False

        # The rider has nothing in hand and can take the next order.
        active = (await client.get("/api/v1/delivery/active", headers=arjun["headers"])).json()
        assert active["delivery"] is None

        # The customer sees why.
        seen = (await client.get(f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"])).json()
        assert seen["order"]["status"] == "cancelled"
        assert seen["order"]["cancellationReason"] == "Customer called: wrong address"

        activity = await latest_activity(client, admin, "Orders")
        assert activity[0]["action"] == "Cancelled order"

    async def test_a_delivered_order_cannot_be_cancelled(self, client, admin):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, _ = await place_customer_order(client, item)
        await execute("update orders set status = 'delivered' where id = $1::uuid", order["id"])

        response = await client.post(
            f"/api/v1/admin/orders/{order['id']}/cancel", json={"reason": "Too late"}, headers=admin
        )

        assert response.status_code == 409
        assert response.json()["code"] == "order_not_cancellable"

    async def test_a_cash_order_has_nothing_to_refund(self, client, admin):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, _ = await place_customer_order(client, item)
        await client.post(f"/api/v1/admin/orders/{order['id']}/cancel", json={"reason": "Duplicate"}, headers=admin)

        response = await client.post(f"/api/v1/admin/orders/{order['id']}/refund", headers=admin)

        assert response.status_code == 409
        assert response.json()["code"] == "nothing_to_refund"

    async def test_an_order_waiting_on_the_restaurant_is_flagged(self, client, admin):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, _ = await place_customer_order(client, item)
        await execute(
            "update orders set placed_at = now() - interval '15 minutes' where id = $1::uuid", order["id"]
        )

        attention = (await client.get("/api/v1/admin/dashboard", headers=admin)).json()["attention"]

        assert [o["orderNumber"] for o in attention["waitingForRestaurant"]] == [order["orderNumber"]]
        assert attention["waitingForRestaurant"][0]["minutes"] >= 15


class TestCustomers:
    async def test_lists_customers_with_their_orders(self, client, admin):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        await place_customer_order(client, item, phone="9876543210")

        customers = (
            await client.get("/api/v1/admin/customers", params={"search": "9876543210"}, headers=admin)
        ).json()["customers"]

        assert len(customers) == 1
        assert customers[0]["orders"] == 1

    async def test_blocking_stops_sign_in_and_ends_sessions(self, client, admin):
        customer = await sign_in(client, "9876543210", "customer")

        no_reason = await client.post(
            f"/api/v1/admin/customers/{customer['userId']}/block", json={"blocked": True}, headers=admin
        )
        assert no_reason.status_code == 400

        blocked = await client.post(
            f"/api/v1/admin/customers/{customer['userId']}/block",
            json={"blocked": True, "reason": "Repeated fake orders"},
            headers=admin,
        )
        otp = await client.post("/api/v1/auth/otp/request", json={"phone": "9876543210"})
        live_sessions = await fetchval(
            "select count(*) from refresh_tokens where user_id = $1::uuid and revoked_at is null", customer["userId"]
        )

        assert blocked.status_code == 200
        assert blocked.json()["customer"]["blocked"] is True
        assert otp.status_code == 403
        assert live_sessions == 0

        unblocked = await client.post(
            f"/api/v1/admin/customers/{customer['userId']}/block", json={"blocked": False}, headers=admin
        )

        assert unblocked.status_code == 200
        # Asked again within the 30 s resend wait, so the answer is "wait",
        # but no longer "blocked".
        retry = await client.post("/api/v1/auth/otp/request", json={"phone": "9876543210"})
        assert retry.json()["code"] != "account_blocked"
        assert await fetchval("select status from users where id = $1::uuid", customer["userId"]) == "active"

    async def test_says_when_a_number_is_also_a_partner(self, client, admin):
        customer = await sign_in(client, "9100000001", "customer")
        # As if they had also signed in to the delivery app (a second OTP
        # inside the resend wait would be refused).
        await execute(
            "insert into user_roles (user_id, role) values ($1::uuid, 'delivery_partner')", customer["userId"]
        )

        detail = (await client.get(f"/api/v1/admin/customers/{customer['userId']}", headers=admin)).json()

        assert detail["customer"]["otherRoles"] == ["delivery_partner"]


class TestOffers:
    PERCENT = {
        "name": "Weekend Feast",
        "code": "feast40",
        "type": "percent",
        "percentOff": 40,
        "maxDiscountPaise": 12000,
        "minOrderPaise": 19900,
    }

    async def test_a_new_offer_reaches_customers(self, client, admin):
        response = await client.post("/api/v1/admin/offers", json=self.PERCENT, headers=admin)

        assert response.status_code == 201, response.text
        offer = response.json()["offer"]
        assert offer["code"] == "FEAST40"
        assert offer["state"] == "live"

        codes = [o["code"] for o in (await client.get("/api/v1/customer/offers")).json()["offers"]]
        assert "FEAST40" in codes

    async def test_codes_are_unique_ignoring_case(self, client, admin):
        await client.post("/api/v1/admin/offers", json=self.PERCENT, headers=admin)

        again = await client.post("/api/v1/admin/offers", json={**self.PERCENT, "code": "Feast40"}, headers=admin)

        assert again.status_code == 409
        assert again.json()["code"] == "offer_code_taken"

    async def test_each_type_needs_its_value(self, client, admin):
        no_percent = {key: value for key, value in self.PERCENT.items() if key != "percentOff"}

        response = await client.post("/api/v1/admin/offers", json=no_percent, headers=admin)

        assert response.status_code == 400
        assert response.json()["code"] == "offer_value_missing"

    async def test_pausing_takes_it_off_the_app(self, client, admin):
        offer = (await client.post("/api/v1/admin/offers", json=self.PERCENT, headers=admin)).json()["offer"]

        paused = await client.patch(f"/api/v1/admin/offers/{offer['id']}", json={"isActive": False}, headers=admin)

        assert paused.json()["offer"]["state"] == "paused"
        codes = [o["code"] for o in (await client.get("/api/v1/customer/offers")).json()["offers"]]
        assert "FEAST40" not in codes
        assert (await latest_activity(client, admin, "Offers"))[0]["action"] == "Paused offer"

    async def test_changing_the_type_clears_the_old_value(self, client, admin):
        offer = (await client.post("/api/v1/admin/offers", json=self.PERCENT, headers=admin)).json()["offer"]

        changed = await client.patch(
            f"/api/v1/admin/offers/{offer['id']}", json={"type": "flat", "flatOffPaise": 5000}, headers=admin
        )

        assert changed.status_code == 200, changed.text
        assert changed.json()["offer"]["percentOff"] is None
        assert changed.json()["offer"]["maxDiscountPaise"] is None
        assert changed.json()["offer"]["flatOffPaise"] == 5000

    async def test_the_end_must_come_after_the_start(self, client, admin):
        response = await client.post(
            "/api/v1/admin/offers",
            json={**self.PERCENT, "validFrom": "2026-11-10T00:00:00", "validUntil": "2026-11-01T00:00:00"},
            headers=admin,
        )

        assert response.status_code == 400
        assert response.json()["code"] == "offer_dates_invalid"
