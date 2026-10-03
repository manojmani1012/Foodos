"""Cart pricing and checkout tests.

The recurring theme: the client never gets to decide what anything costs.
"""

import pytest

from app.database import execute, fetchrow, fetchval

ADDRESS = {"label": "Home", "line1": "12, Lake View Road", "city": "Chennai", "pincode": "600041"}


async def make_restaurant(name: str = "The Biryani House", accepting: bool = True, status: str = "active"):
    owner_id = await fetchval(
        "insert into users (phone, full_name) values ($1, 'Owner') returning id",
        f"+9190000{abs(hash(name)) % 100000:05d}",
    )
    await execute("insert into user_roles (user_id, role) values ($1, 'restaurant_owner')", owner_id)

    return await fetchval(
        """
        insert into restaurants
          (owner_id, name, cuisines, address_line, city, status, is_accepting_orders, avg_prep_minutes)
        values ($1, $2, '{Biryani}', 'Anna Nagar', 'Chennai', $3, $4, 30)
        returning id
        """,
        owner_id,
        name,
        status,
        accepting,
    )


async def make_item(restaurant_id, name="Chicken Biryani", price=24900, available=True):
    return await fetchval(
        """
        insert into menu_items (restaurant_id, name, price_paise, is_veg, is_available)
        values ($1, $2, $3, false, $4)
        returning id
        """,
        restaurant_id,
        name,
        price,
        available,
    )


async def make_addon(item_id, name="Raita", price=3000, available=True):
    return await fetchval(
        """
        insert into menu_item_addons (menu_item_id, name, price_paise, is_available)
        values ($1, $2, $3, $4) returning id
        """,
        item_id,
        name,
        price,
        available,
    )


async def sign_in(client, phone: str = "9876543210") -> dict:
    code = (await client.post("/api/v1/auth/otp/request", json={"phone": phone})).json()["devCode"]
    body = (
        await client.post(
            "/api/v1/auth/otp/verify", json={"phone": phone, "code": code, "role": "customer"}
        )
    ).json()

    return {"headers": {"authorization": f"Bearer {body['accessToken']}"}, "user": body["user"]}


async def place(client, session, items, **extra):
    payload = {"items": items, "paymentMethod": "cod", "address": ADDRESS, **extra}

    return await client.post("/api/v1/customer/orders", json=payload, headers=session["headers"])


class TestCartQuote:
    async def test_prices_from_the_database_not_the_request(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant, price=24900)

        response = await client.post(
            "/api/v1/customer/cart/quote",
            # A tampered client could send anything here; only ids and counts
            # are read.
            json={"items": [{"menuItemId": str(item), "quantity": 2, "pricePaise": 1}]},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["subtotalPaise"] == 49800
        assert body["items"][0]["unitPricePaise"] == 24900

    async def test_totals_add_up(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant, price=24900)

        body = (
            await client.post(
                "/api/v1/customer/cart/quote", json={"items": [{"menuItemId": str(item), "quantity": 1}]}
            )
        ).json()

        expected = (
            body["subtotalPaise"]
            + body["deliveryFeePaise"]
            + body["packagingFeePaise"]
            + body["taxPaise"]
            - body["discountPaise"]
        )
        assert body["totalPaise"] == expected

    async def test_add_ons_are_charged(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant, price=24900)
        addon = await make_addon(item, price=9000)

        body = (
            await client.post(
                "/api/v1/customer/cart/quote",
                json={"items": [{"menuItemId": str(item), "quantity": 2, "addonIds": [str(addon)]}]},
            )
        ).json()

        # (249 + 90) * 2
        assert body["subtotalPaise"] == 67800

    async def test_refuses_an_addon_from_a_different_dish(self, client):
        restaurant = await make_restaurant()
        cheap = await make_item(restaurant, name="Veg Biryani", price=19900)
        expensive = await make_item(restaurant, name="Prawn Biryani", price=31900)
        addon = await make_addon(cheap, name="Extra Raita", price=3000)

        response = await client.post(
            "/api/v1/customer/cart/quote",
            json={"items": [{"menuItemId": str(expensive), "quantity": 1, "addonIds": [str(addon)]}]},
        )

        assert response.status_code == 400
        assert response.json()["code"] == "addon_unavailable"

    async def test_refuses_dishes_from_two_restaurants(self, client):
        first = await make_item(await make_restaurant("One"))
        second = await make_item(await make_restaurant("Two"))

        response = await client.post(
            "/api/v1/customer/cart/quote",
            json={
                "items": [
                    {"menuItemId": str(first), "quantity": 1},
                    {"menuItemId": str(second), "quantity": 1},
                ]
            },
        )

        assert response.status_code == 400
        assert response.json()["code"] == "multiple_restaurants"

    async def test_refuses_a_sold_out_dish(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant, available=False)

        response = await client.post(
            "/api/v1/customer/cart/quote", json={"items": [{"menuItemId": str(item), "quantity": 1}]}
        )

        assert response.status_code == 409
        assert response.json()["code"] == "item_sold_out"

    async def test_refuses_when_the_restaurant_is_closed(self, client):
        restaurant = await make_restaurant(accepting=False)
        item = await make_item(restaurant)

        response = await client.post(
            "/api/v1/customer/cart/quote", json={"items": [{"menuItemId": str(item), "quantity": 1}]}
        )

        assert response.status_code == 409
        assert response.json()["code"] == "restaurant_closed"

    async def test_rejects_an_empty_cart(self, client):
        response = await client.post("/api/v1/customer/cart/quote", json={"items": []})

        assert response.status_code == 400


class TestCoupons:
    async def setup_offer(self, **overrides):
        fields = {
            "name": "First Order",
            "code": "FOODOS50",
            "type": "percent",
            "percent_off": 50,
            "max_discount_paise": 10000,
            "min_order_paise": 0,
            "first_order_only": False,
            "per_user_limit": 1,
        }
        fields.update(overrides)

        return await fetchval(
            """
            insert into offers
              (name, code, type, percent_off, flat_off_paise, max_discount_paise,
               min_order_paise, first_order_only, per_user_limit, usage_limit)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            returning id
            """,
            fields["name"],
            fields["code"],
            fields["type"],
            fields.get("percent_off"),
            fields.get("flat_off_paise"),
            fields.get("max_discount_paise"),
            fields["min_order_paise"],
            fields["first_order_only"],
            fields["per_user_limit"],
            fields.get("usage_limit"),
        )

    async def test_percentage_discount_is_capped(self, client):
        await self.setup_offer()
        restaurant = await make_restaurant()
        item = await make_item(restaurant, price=100000)  # 1000 rupees
        session = await sign_in(client)

        body = (
            await client.post(
                "/api/v1/customer/cart/quote",
                json={"items": [{"menuItemId": str(item), "quantity": 1}], "couponCode": "FOODOS50"},
                headers=session["headers"],
            )
        ).json()

        # 50% of 1000 is 500, but the offer caps the discount at 100.
        assert body["coupon"]["applied"] is True
        assert body["discountPaise"] == 10000

    async def test_reports_why_a_code_does_not_apply(self, client):
        await self.setup_offer(min_order_paise=50000)
        restaurant = await make_restaurant()
        item = await make_item(restaurant, price=10000)

        body = (
            await client.post(
                "/api/v1/customer/cart/quote",
                json={"items": [{"menuItemId": str(item), "quantity": 1}], "couponCode": "FOODOS50"},
            )
        ).json()

        # The cart still prices; the coupon simply explains itself.
        assert body["coupon"]["applied"] is False
        assert "400" in body["coupon"]["reason"]
        assert body["discountPaise"] == 0
        assert body["totalPaise"] > 0

    async def test_unknown_code_is_rejected_politely(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant)

        body = (
            await client.post(
                "/api/v1/customer/cart/quote",
                json={"items": [{"menuItemId": str(item), "quantity": 1}], "couponCode": "NOPE"},
            )
        ).json()

        assert body["coupon"]["applied"] is False
        assert body["coupon"]["reason"] == "That code is not valid"

    async def test_a_code_cannot_be_used_twice(self, client):
        await self.setup_offer(per_user_limit=1)
        restaurant = await make_restaurant()
        item = await make_item(restaurant, price=50000)
        session = await sign_in(client)

        first = await place(client, session, [{"menuItemId": str(item), "quantity": 1}], couponCode="FOODOS50")
        assert first.status_code == 201

        second = await place(client, session, [{"menuItemId": str(item), "quantity": 1}], couponCode="FOODOS50")

        assert second.status_code == 400
        assert second.json()["code"] == "coupon_invalid"
        assert "already used" in second.json()["message"]

    async def test_first_order_only_blocks_the_second_order(self, client):
        await self.setup_offer(first_order_only=True, per_user_limit=5)
        restaurant = await make_restaurant()
        item = await make_item(restaurant, price=50000)
        session = await sign_in(client)

        await place(client, session, [{"menuItemId": str(item), "quantity": 1}])

        response = await place(
            client, session, [{"menuItemId": str(item), "quantity": 1}], couponCode="FOODOS50"
        )

        assert response.status_code == 400
        assert "first order" in response.json()["message"]

    async def test_free_delivery_discounts_exactly_the_delivery_fee(self, client):
        await self.setup_offer(code="FREEDEL", type="free_delivery", percent_off=None)
        restaurant = await make_restaurant()
        item = await make_item(restaurant, price=50000)
        session = await sign_in(client)

        body = (
            await client.post(
                "/api/v1/customer/cart/quote",
                json={"items": [{"menuItemId": str(item), "quantity": 1}], "couponCode": "FREEDEL"},
                headers=session["headers"],
            )
        ).json()

        assert body["discountPaise"] == body["deliveryFeePaise"]


class TestPlacingOrders:
    async def test_places_an_order_and_records_everything(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant, price=24900)
        addon = await make_addon(item, price=9000)
        session = await sign_in(client)

        response = await place(
            client, session, [{"menuItemId": str(item), "quantity": 2, "addonIds": [str(addon)]}]
        )

        assert response.status_code == 201
        order = response.json()["order"]

        assert order["orderNumber"].startswith("FD")
        assert order["status"] == "confirmed"
        assert order["paymentMethod"] == "cod"
        assert order["subtotalPaise"] == 67800
        assert order["items"][0]["quantity"] == 2
        assert order["items"][0]["addons"][0]["name"] == "Raita"
        assert order["deliveryAddress"]["line1"] == ADDRESS["line1"]
        assert [step["status"] for step in order["timeline"]] == ["confirmed"]

    async def test_requires_signing_in(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant)

        response = await client.post(
            "/api/v1/customer/orders",
            json={"items": [{"menuItemId": str(item), "quantity": 1}], "paymentMethod": "cod", "address": ADDRESS},
        )

        assert response.status_code == 401

    async def test_online_payment_is_refused_when_no_gateway_is_configured(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant)
        session = await sign_in(client)

        response = await place(
            client, session, [{"menuItemId": str(item), "quantity": 1}], paymentMethod="upi"
        )

        # Better to send someone to cash on delivery than to take an order that
        # can never be paid for.
        assert response.status_code == 400
        assert response.json()["code"] == "payment_method_unavailable"

    async def test_a_retried_checkout_does_not_place_two_orders(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant)
        session = await sign_in(client)

        key = "checkout-attempt-00000001"
        first = await place(client, session, [{"menuItemId": str(item), "quantity": 1}], idempotencyKey=key)
        second = await place(client, session, [{"menuItemId": str(item), "quantity": 1}], idempotencyKey=key)

        assert first.status_code == 201
        assert second.status_code == 201
        assert first.json()["order"]["id"] == second.json()["order"]["id"]
        assert await fetchval("select count(*) from orders") == 1

    async def test_different_keys_place_different_orders(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant)
        session = await sign_in(client)

        await place(client, session, [{"menuItemId": str(item), "quantity": 1}], idempotencyKey="first-attempt-1")
        await place(client, session, [{"menuItemId": str(item), "quantity": 1}], idempotencyKey="second-attempt")

        assert await fetchval("select count(*) from orders") == 2

    async def test_uses_a_saved_address(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant)
        session = await sign_in(client)

        saved = await client.post("/api/v1/customer/addresses", json=ADDRESS, headers=session["headers"])
        assert saved.status_code == 201
        address_id = saved.json()["address"]["id"]

        response = await client.post(
            "/api/v1/customer/orders",
            json={
                "items": [{"menuItemId": str(item), "quantity": 1}],
                "paymentMethod": "cod",
                "addressId": address_id,
            },
            headers=session["headers"],
        )

        assert response.status_code == 201
        assert response.json()["order"]["deliveryAddress"]["line1"] == ADDRESS["line1"]

    async def test_will_not_use_someone_elses_address(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant)
        owner = await sign_in(client, "9876543210")
        intruder = await sign_in(client, "9123456789")

        saved = await client.post("/api/v1/customer/addresses", json=ADDRESS, headers=owner["headers"])
        address_id = saved.json()["address"]["id"]

        response = await client.post(
            "/api/v1/customer/orders",
            json={
                "items": [{"menuItemId": str(item), "quantity": 1}],
                "paymentMethod": "cod",
                "addressId": address_id,
            },
            headers=intruder["headers"],
        )

        assert response.status_code == 404

    async def test_requires_an_address(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant)
        session = await sign_in(client)

        response = await client.post(
            "/api/v1/customer/orders",
            json={"items": [{"menuItemId": str(item), "quantity": 1}], "paymentMethod": "cod"},
            headers=session["headers"],
        )

        assert response.status_code == 400
        assert response.json()["code"] == "address_required"

    async def test_the_order_snapshot_survives_a_price_change(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant, price=24900)
        session = await sign_in(client)

        placed = await place(client, session, [{"menuItemId": str(item), "quantity": 1}])
        order_id = placed.json()["order"]["id"]

        # The restaurant raises its price after the order was placed.
        await execute("update menu_items set price_paise = 99900 where id = $1", item)

        fetched = await client.get(f"/api/v1/customer/orders/{order_id}", headers=session["headers"])

        assert fetched.json()["order"]["items"][0]["unitPricePaise"] == 24900
        assert fetched.json()["order"]["subtotalPaise"] == 24900


class TestViewingAndCancelling:
    async def test_lists_only_your_own_orders(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant)
        mine = await sign_in(client, "9876543210")
        theirs = await sign_in(client, "9123456789")

        await place(client, mine, [{"menuItemId": str(item), "quantity": 1}])
        await place(client, theirs, [{"menuItemId": str(item), "quantity": 1}])

        body = (await client.get("/api/v1/customer/orders", headers=mine["headers"])).json()

        assert body["total"] == 1

    async def test_cannot_read_someone_elses_order(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant)
        owner = await sign_in(client, "9876543210")
        intruder = await sign_in(client, "9123456789")

        placed = await place(client, owner, [{"menuItemId": str(item), "quantity": 1}])
        order_id = placed.json()["order"]["id"]

        response = await client.get(f"/api/v1/customer/orders/{order_id}", headers=intruder["headers"])

        # Reported as missing, not forbidden, so order ids cannot be probed.
        assert response.status_code == 404

    async def test_cancels_a_confirmed_order(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant)
        session = await sign_in(client)

        placed = await place(client, session, [{"menuItemId": str(item), "quantity": 1}])
        order_id = placed.json()["order"]["id"]

        response = await client.post(
            f"/api/v1/customer/orders/{order_id}/cancel",
            json={"reason": "Ordered by mistake"},
            headers=session["headers"],
        )

        assert response.status_code == 200
        order = response.json()["order"]
        assert order["status"] == "cancelled"
        assert order["cancellationReason"] == "Ordered by mistake"
        assert [step["status"] for step in order["timeline"]] == ["confirmed", "cancelled"]

    async def test_cannot_cancel_once_the_kitchen_started(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant)
        session = await sign_in(client)

        placed = await place(client, session, [{"menuItemId": str(item), "quantity": 1}])
        order_id = placed.json()["order"]["id"]

        await execute("update orders set status = 'preparing' where id = $1::uuid", order_id)

        response = await client.post(
            f"/api/v1/customer/orders/{order_id}/cancel", json={}, headers=session["headers"]
        )

        assert response.status_code == 409
        assert response.json()["code"] == "order_not_cancellable"

    async def test_cancelling_twice_is_refused(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant)
        session = await sign_in(client)

        placed = await place(client, session, [{"menuItemId": str(item), "quantity": 1}])
        order_id = placed.json()["order"]["id"]

        await client.post(f"/api/v1/customer/orders/{order_id}/cancel", json={}, headers=session["headers"])
        second = await client.post(
            f"/api/v1/customer/orders/{order_id}/cancel", json={}, headers=session["headers"]
        )

        assert second.status_code == 409
        assert second.json()["code"] == "order_already_cancelled"


class TestAddresses:
    async def test_the_first_address_becomes_the_default(self, client):
        session = await sign_in(client)

        first = await client.post("/api/v1/customer/addresses", json=ADDRESS, headers=session["headers"])

        assert first.json()["address"]["isDefault"] is True

    async def test_a_new_default_replaces_the_old_one(self, client):
        session = await sign_in(client)

        await client.post("/api/v1/customer/addresses", json=ADDRESS, headers=session["headers"])
        await client.post(
            "/api/v1/customer/addresses",
            json={**ADDRESS, "label": "Work", "line1": "5, Mount Road", "isDefault": True},
            headers=session["headers"],
        )

        body = (await client.get("/api/v1/customer/addresses", headers=session["headers"])).json()
        defaults = [a for a in body["addresses"] if a["isDefault"]]

        assert len(defaults) == 1
        assert defaults[0]["label"] == "Work"

    async def test_deleting_the_default_promotes_another(self, client):
        session = await sign_in(client)

        first = await client.post("/api/v1/customer/addresses", json=ADDRESS, headers=session["headers"])
        await client.post(
            "/api/v1/customer/addresses",
            json={**ADDRESS, "label": "Work", "line1": "5, Mount Road"},
            headers=session["headers"],
        )

        await client.delete(
            f"/api/v1/customer/addresses/{first.json()['address']['id']}", headers=session["headers"]
        )

        body = (await client.get("/api/v1/customer/addresses", headers=session["headers"])).json()

        assert len(body["addresses"]) == 1
        assert body["addresses"][0]["isDefault"] is True


class TestCouponsWhenSignedOut:
    async def test_a_coupon_asks_the_visitor_to_sign_in(self, client):
        await execute(
            """
            insert into offers (name, code, type, percent_off, max_discount_paise)
            values ('First Order', 'FOODOS50', 'percent', 50, 10000)
            """
        )
        restaurant = await make_restaurant()
        item = await make_item(restaurant, price=50000)

        body = (
            await client.post(
                "/api/v1/customer/cart/quote",
                json={"items": [{"menuItemId": str(item), "quantity": 1}], "couponCode": "FOODOS50"},
            )
        ).json()

        # Offers carry per-user limits, so applying one needs a known customer.
        # The cart still prices; only the discount waits for sign-in.
        assert body["coupon"]["applied"] is False
        assert body["coupon"]["reason"] == "Sign in to use this code"
        assert body["totalPaise"] > 0


class TestOrderListCounts:
    async def test_item_count_is_total_dishes_not_lines(self, client):
        restaurant = await make_restaurant()
        item = await make_item(restaurant)
        session = await sign_in(client)

        await place(client, session, [{"menuItemId": str(item), "quantity": 3}])

        body = (await client.get("/api/v1/customer/orders", headers=session["headers"])).json()

        assert body["orders"][0]["itemCount"] == 3
