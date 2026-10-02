"""Customer profile, account deletion and order reviews."""

import pytest

from app.database import execute, fetchrow, fetchval

ADDRESS = {"label": "Home", "line1": "12, Lake View Road", "city": "Chennai"}


async def sign_in(client, phone: str = "9876543210") -> dict:
    code = (await client.post("/api/v1/auth/otp/request", json={"phone": phone})).json()["devCode"]
    body = (
        await client.post(
            "/api/v1/auth/otp/verify", json={"phone": phone, "code": code, "role": "customer"}
        )
    ).json()

    return {"headers": {"authorization": f"Bearer {body['accessToken']}"}, "user": body["user"]}


async def make_restaurant_with_item():
    owner = await fetchval(
        "insert into users (phone, full_name) values ('+919000000001', 'Owner') returning id"
    )
    await execute("insert into user_roles (user_id, role) values ($1, 'restaurant_owner')", owner)
    restaurant = await fetchval(
        """
        insert into restaurants (owner_id, name, cuisines, address_line, city, status)
        values ($1, 'The Biryani House', '{Biryani}', 'Anna Nagar', 'Chennai', 'active')
        returning id
        """,
        owner,
    )
    item = await fetchval(
        """
        insert into menu_items (restaurant_id, name, price_paise, is_veg)
        values ($1, 'Chicken Biryani', 24900, false) returning id
        """,
        restaurant,
    )

    return restaurant, item


async def place_order(client, session, item) -> dict:
    response = await client.post(
        "/api/v1/customer/orders",
        json={
            "items": [{"menuItemId": str(item), "quantity": 1}],
            "paymentMethod": "cod",
            "address": ADDRESS,
        },
        headers=session["headers"],
    )

    assert response.status_code == 201, response.text

    return response.json()["order"]


class TestProfile:
    async def test_starts_with_only_a_phone_number(self, client):
        session = await sign_in(client)

        body = (await client.get("/api/v1/customer/profile", headers=session["headers"])).json()

        assert body["profile"]["phone"] == "+919876543210"
        assert body["profile"]["fullName"] is None
        assert body["profile"]["stats"]["deliveredOrders"] == 0

    async def test_sets_a_name(self, client):
        session = await sign_in(client)

        response = await client.patch(
            "/api/v1/customer/profile",
            json={"fullName": "Som Raj"},
            headers=session["headers"],
        )

        assert response.status_code == 200
        assert response.json()["profile"]["fullName"] == "Som Raj"

    async def test_changes_only_what_is_sent(self, client):
        session = await sign_in(client)

        await client.patch(
            "/api/v1/customer/profile",
            json={"fullName": "Som Raj", "email": "som@example.com"},
            headers=session["headers"],
        )
        await client.patch(
            "/api/v1/customer/profile", json={"fullName": "Som R"}, headers=session["headers"]
        )

        body = (await client.get("/api/v1/customer/profile", headers=session["headers"])).json()

        assert body["profile"]["fullName"] == "Som R"
        assert body["profile"]["email"] == "som@example.com", "the email was left alone"

    async def test_email_is_stored_lower_case(self, client):
        session = await sign_in(client)

        response = await client.patch(
            "/api/v1/customer/profile",
            json={"email": "SOM@Example.COM"},
            headers=session["headers"],
        )

        assert response.json()["profile"]["email"] == "som@example.com"

    async def test_refuses_an_email_another_account_uses(self, client):
        first = await sign_in(client, "9876543210")
        second = await sign_in(client, "9123456789")

        await client.patch(
            "/api/v1/customer/profile", json={"email": "taken@example.com"}, headers=first["headers"]
        )
        response = await client.patch(
            "/api/v1/customer/profile",
            json={"email": "taken@example.com"},
            headers=second["headers"],
        )

        assert response.status_code == 409
        assert response.json()["code"] == "email_taken"

    async def test_counts_delivered_orders(self, client):
        _, item = await make_restaurant_with_item()
        session = await sign_in(client)
        order = await place_order(client, session, item)
        await execute("update orders set status = 'delivered' where id = $1::uuid", order["id"])

        body = (await client.get("/api/v1/customer/profile", headers=session["headers"])).json()

        assert body["profile"]["stats"]["deliveredOrders"] == 1


class TestAccountDeletion:
    async def test_clears_personal_details_but_keeps_the_order(self, client):
        _, item = await make_restaurant_with_item()
        session = await sign_in(client)
        order = await place_order(client, session, item)
        user_id = session["user"]["id"]

        response = await client.delete("/api/v1/customer/account", headers=session["headers"])
        assert response.status_code == 200

        row = await fetchrow(
            "select phone, email, full_name, status from users where id = $1::uuid", user_id
        )

        assert row["phone"] is None
        assert row["full_name"] == "Deleted account"
        assert row["status"] == "blocked"
        # The schema insists on one contact field, so a placeholder stands in.
        assert row["email"].endswith("@deleted.invalid")

        # The restaurant's record of what was sold has to survive.
        assert await fetchval("select count(*) from orders where id = $1::uuid", order["id"]) == 1

    async def test_ends_every_session(self, client):
        session = await sign_in(client)

        await client.delete("/api/v1/customer/account", headers=session["headers"])

        revoked = await fetchval(
            "select count(*) from refresh_tokens where revoked_at is null"
        )
        assert revoked == 0

    async def test_the_phone_number_can_sign_up_again(self, client):
        session = await sign_in(client, "9876543210")
        await client.delete("/api/v1/customer/account", headers=session["headers"])

        # The resend cooldown would block a second code within 30 seconds.
        await execute("update otp_codes set created_at = created_at - interval '1 minute'")

        # Releasing the number matters: the same person may come back.
        fresh = await sign_in(client, "9876543210")

        assert fresh["user"]["phone"] == "+919876543210"
        assert fresh["user"]["id"] != session["user"]["id"]

    async def test_removes_saved_addresses_and_favourites(self, client):
        restaurant, item = await make_restaurant_with_item()
        session = await sign_in(client)

        await client.post("/api/v1/customer/addresses", json=ADDRESS, headers=session["headers"])
        await client.put(
            f"/api/v1/customer/favourites/{restaurant}", headers=session["headers"]
        )

        await client.delete("/api/v1/customer/account", headers=session["headers"])

        assert await fetchval("select count(*) from customer_addresses") == 0
        assert await fetchval("select count(*) from favourites") == 0


class TestReviews:
    async def test_rates_a_delivered_order(self, client):
        restaurant, item = await make_restaurant_with_item()
        session = await sign_in(client)
        order = await place_order(client, session, item)
        await execute("update orders set status = 'delivered' where id = $1::uuid", order["id"])

        response = await client.post(
            f"/api/v1/customer/orders/{order['id']}/review",
            json={"rating": 5, "comment": "Excellent biryani"},
            headers=session["headers"],
        )

        assert response.status_code == 201
        assert response.json()["review"]["rating"] == 5

    async def test_updates_the_restaurant_rating(self, client):
        restaurant, item = await make_restaurant_with_item()
        session = await sign_in(client)
        order = await place_order(client, session, item)
        await execute("update orders set status = 'delivered' where id = $1::uuid", order["id"])

        await client.post(
            f"/api/v1/customer/orders/{order['id']}/review",
            json={"rating": 4},
            headers=session["headers"],
        )

        row = await fetchrow(
            "select rating, rating_count from restaurants where id = $1", restaurant
        )

        assert float(row["rating"]) == 4.0
        assert row["rating_count"] == 1

    async def test_cannot_rate_before_delivery(self, client):
        _, item = await make_restaurant_with_item()
        session = await sign_in(client)
        order = await place_order(client, session, item)

        response = await client.post(
            f"/api/v1/customer/orders/{order['id']}/review",
            json={"rating": 5},
            headers=session["headers"],
        )

        assert response.status_code == 409
        assert response.json()["code"] == "order_not_delivered"

    async def test_cannot_rate_twice(self, client):
        _, item = await make_restaurant_with_item()
        session = await sign_in(client)
        order = await place_order(client, session, item)
        await execute("update orders set status = 'delivered' where id = $1::uuid", order["id"])

        await client.post(
            f"/api/v1/customer/orders/{order['id']}/review",
            json={"rating": 5},
            headers=session["headers"],
        )
        second = await client.post(
            f"/api/v1/customer/orders/{order['id']}/review",
            json={"rating": 1},
            headers=session["headers"],
        )

        assert second.status_code == 409
        assert second.json()["code"] == "already_reviewed"

    async def test_cannot_rate_someone_elses_order(self, client):
        _, item = await make_restaurant_with_item()
        owner = await sign_in(client, "9876543210")
        intruder = await sign_in(client, "9123456789")
        order = await place_order(client, owner, item)
        await execute("update orders set status = 'delivered' where id = $1::uuid", order["id"])

        response = await client.post(
            f"/api/v1/customer/orders/{order['id']}/review",
            json={"rating": 1},
            headers=intruder["headers"],
        )

        assert response.status_code == 404

    async def test_rejects_a_rating_outside_one_to_five(self, client):
        _, item = await make_restaurant_with_item()
        session = await sign_in(client)
        order = await place_order(client, session, item)

        response = await client.post(
            f"/api/v1/customer/orders/{order['id']}/review",
            json={"rating": 9},
            headers=session["headers"],
        )

        assert response.status_code == 400

    async def test_reads_back_an_existing_review(self, client):
        _, item = await make_restaurant_with_item()
        session = await sign_in(client)
        order = await place_order(client, session, item)
        await execute("update orders set status = 'delivered' where id = $1::uuid", order["id"])

        await client.post(
            f"/api/v1/customer/orders/{order['id']}/review",
            json={"rating": 3, "comment": "Fine"},
            headers=session["headers"],
        )

        body = (
            await client.get(
                f"/api/v1/customer/orders/{order['id']}/review", headers=session["headers"]
            )
        ).json()

        assert body["review"]["rating"] == 3
        assert body["review"]["comment"] == "Fine"
