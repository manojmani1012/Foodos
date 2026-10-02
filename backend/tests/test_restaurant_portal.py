"""Restaurant partner app: order queue, lifecycle and menu management.

The recurring theme: an owner can only ever see and move their own restaurant.
"""

import pytest

from app.database import execute, fetchrow, fetchval

ADDRESS = {"label": "Home", "line1": "12, Lake View Road", "city": "Chennai"}


async def sign_in(client, phone: str, role: str) -> dict:
    code = (await client.post("/api/v1/auth/otp/request", json={"phone": phone})).json()["devCode"]
    body = (
        await client.post("/api/v1/auth/otp/verify", json={"phone": phone, "code": code, "role": role})
    ).json()

    return {"headers": {"authorization": f"Bearer {body['accessToken']}"}, "userId": body["user"]["id"]}


async def make_restaurant_for(owner_id: str, name: str = "The Biryani House"):
    return await fetchval(
        """
        insert into restaurants
          (owner_id, name, cuisines, address_line, city, status, is_accepting_orders, avg_prep_minutes)
        values ($1::uuid, $2, '{Biryani}', 'Anna Nagar', 'Chennai', 'active', true, 30)
        returning id
        """,
        owner_id,
        name,
    )


async def make_item(restaurant_id, name="Chicken Biryani", price=24900):
    return await fetchval(
        """
        insert into menu_items (restaurant_id, name, price_paise, is_veg)
        values ($1, $2, $3, false) returning id
        """,
        restaurant_id,
        name,
        price,
    )


async def place_customer_order(client, item_id, phone="9876543210"):
    customer = await sign_in(client, phone, "customer")
    response = await client.post(
        "/api/v1/customer/orders",
        json={
            "items": [{"menuItemId": str(item_id), "quantity": 2}],
            "paymentMethod": "cod",
            "address": ADDRESS,
        },
        headers=customer["headers"],
    )

    assert response.status_code == 201, response.text

    return response.json()["order"], customer


async def owner_with_restaurant(client, phone="9000000001", name="The Biryani House"):
    owner = await sign_in(client, phone, "restaurant_owner")
    restaurant_id = await make_restaurant_for(owner["userId"], name)

    return owner, restaurant_id


class TestAccess:
    async def test_requires_a_restaurant_owner_session(self, client):
        customer = await sign_in(client, "9876543210", "customer")

        response = await client.get("/api/v1/restaurant/dashboard", headers=customer["headers"])

        assert response.status_code == 403
        assert response.json()["code"] == "role_forbidden"

    async def test_an_owner_without_a_restaurant_is_told_so(self, client):
        owner = await sign_in(client, "9000000001", "restaurant_owner")

        response = await client.get("/api/v1/restaurant/me", headers=owner["headers"])

        assert response.status_code == 404
        assert response.json()["code"] == "restaurant_not_found"

    async def test_returns_only_the_owners_restaurant(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        await owner_with_restaurant(client, "9000000002", "Pizza Corner")

        body = (await client.get("/api/v1/restaurant/me", headers=owner["headers"])).json()

        assert body["restaurant"]["name"] == "The Biryani House"
        assert body["restaurant"]["id"] == str(restaurant_id)


class TestAcceptingOrdersToggle:
    async def test_turning_it_off_stops_new_orders(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)

        off = await client.patch(
            "/api/v1/restaurant/settings",
            json={"isAcceptingOrders": False},
            headers=owner["headers"],
        )
        assert off.status_code == 200
        assert off.json()["restaurant"]["isAcceptingOrders"] is False

        customer = await sign_in(client, "9876543210", "customer")
        response = await client.post(
            "/api/v1/customer/orders",
            json={
                "items": [{"menuItemId": str(item), "quantity": 1}],
                "paymentMethod": "cod",
                "address": ADDRESS,
            },
            headers=customer["headers"],
        )

        assert response.status_code == 409
        assert response.json()["code"] == "restaurant_closed"

    async def test_closing_does_not_disturb_orders_already_in_the_kitchen(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, _ = await place_customer_order(client, item)

        await client.post(f"/api/v1/restaurant/orders/{order['id']}/accept", headers=owner["headers"])
        await client.patch(
            "/api/v1/restaurant/settings", json={"isAcceptingOrders": False}, headers=owner["headers"]
        )

        ready = await client.post(
            f"/api/v1/restaurant/orders/{order['id']}/ready", headers=owner["headers"]
        )

        assert ready.status_code == 200
        assert ready.json()["order"]["status"] == "ready"


class TestOrderQueue:
    async def test_new_orders_appear_in_the_queue(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, _ = await place_customer_order(client, item)

        body = (await client.get("/api/v1/restaurant/orders?queue=new", headers=owner["headers"])).json()

        assert len(body["orders"]) == 1
        assert body["orders"][0]["orderNumber"] == order["orderNumber"]
        assert body["orders"][0]["itemCount"] == 2, "counts dishes, not lines"

    async def test_queues_separate_by_stage(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)

        first, _ = await place_customer_order(client, item, "9876543210")
        second, _ = await place_customer_order(client, item, "9123456789")

        await client.post(f"/api/v1/restaurant/orders/{first['id']}/accept", headers=owner["headers"])

        new = (await client.get("/api/v1/restaurant/orders?queue=new", headers=owner["headers"])).json()
        preparing = (
            await client.get("/api/v1/restaurant/orders?queue=preparing", headers=owner["headers"])
        ).json()

        assert [o["orderNumber"] for o in new["orders"]] == [second["orderNumber"]]
        assert [o["orderNumber"] for o in preparing["orders"]] == [first["orderNumber"]]

    async def test_order_detail_shows_the_customer_and_items(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, _ = await place_customer_order(client, item)

        body = (
            await client.get(f"/api/v1/restaurant/orders/{order['id']}", headers=owner["headers"])
        ).json()

        assert body["order"]["customer"]["phone"] == "+919876543210"
        assert body["order"]["items"][0]["name"] == "Chicken Biryani"
        assert body["order"]["items"][0]["quantity"] == 2

    async def test_cannot_see_another_restaurants_order(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        intruder, _ = await owner_with_restaurant(client, "9000000002", "Pizza Corner")
        item = await make_item(restaurant_id)
        order, _ = await place_customer_order(client, item)

        response = await client.get(
            f"/api/v1/restaurant/orders/{order['id']}", headers=intruder["headers"]
        )

        # Missing rather than forbidden, so order ids cannot be probed.
        assert response.status_code == 404

    async def test_cannot_move_another_restaurants_order(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        intruder, _ = await owner_with_restaurant(client, "9000000002", "Pizza Corner")
        item = await make_item(restaurant_id)
        order, _ = await place_customer_order(client, item)

        response = await client.post(
            f"/api/v1/restaurant/orders/{order['id']}/accept", headers=intruder["headers"]
        )

        assert response.status_code == 404
        assert await fetchval("select status from orders where id = $1::uuid", order["id"]) == "confirmed"


class TestOrderLifecycle:
    async def test_accept_then_ready(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, customer = await place_customer_order(client, item)

        accepted = await client.post(
            f"/api/v1/restaurant/orders/{order['id']}/accept", headers=owner["headers"]
        )
        assert accepted.json()["order"]["status"] == "preparing"

        ready = await client.post(
            f"/api/v1/restaurant/orders/{order['id']}/ready", headers=owner["headers"]
        )
        assert ready.json()["order"]["status"] == "ready"

        # The customer's tracking timeline follows along.
        tracked = await client.get(
            f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"]
        )
        assert [s["status"] for s in tracked.json()["order"]["timeline"]] == [
            "confirmed",
            "preparing",
            "ready",
        ]

    async def test_rejecting_cancels_the_order(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, customer = await place_customer_order(client, item)

        response = await client.post(
            f"/api/v1/restaurant/orders/{order['id']}/reject",
            json={"reason": "Out of stock"},
            headers=owner["headers"],
        )

        assert response.status_code == 200
        assert response.json()["order"]["status"] == "cancelled"
        assert response.json()["order"]["cancellationReason"] == "Out of stock"

        row = await fetchrow("select cancelled_by from orders where id = $1::uuid", order["id"])
        assert row["cancelled_by"] == "restaurant"

    async def test_cannot_mark_ready_before_accepting(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, _ = await place_customer_order(client, item)

        response = await client.post(
            f"/api/v1/restaurant/orders/{order['id']}/ready", headers=owner["headers"]
        )

        assert response.status_code == 409
        assert response.json()["code"] == "order_transition_invalid"

    async def test_accepting_twice_is_refused(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, _ = await place_customer_order(client, item)

        await client.post(f"/api/v1/restaurant/orders/{order['id']}/accept", headers=owner["headers"])
        second = await client.post(
            f"/api/v1/restaurant/orders/{order['id']}/accept", headers=owner["headers"]
        )

        assert second.status_code == 409
        assert second.json()["code"] == "order_already_in_status"

    async def test_cannot_accept_an_order_the_customer_cancelled(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, customer = await place_customer_order(client, item)

        await client.post(
            f"/api/v1/customer/orders/{order['id']}/cancel", json={}, headers=customer["headers"]
        )

        response = await client.post(
            f"/api/v1/restaurant/orders/{order['id']}/accept", headers=owner["headers"]
        )

        assert response.status_code == 409

    async def test_customer_cannot_cancel_once_accepted(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, customer = await place_customer_order(client, item)

        await client.post(f"/api/v1/restaurant/orders/{order['id']}/accept", headers=owner["headers"])

        response = await client.post(
            f"/api/v1/customer/orders/{order['id']}/cancel", json={}, headers=customer["headers"]
        )

        assert response.status_code == 409
        assert response.json()["code"] == "order_not_cancellable"


class TestDashboard:
    async def test_counts_the_queues(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)

        first, _ = await place_customer_order(client, item, "9876543210")
        await place_customer_order(client, item, "9123456789")
        await client.post(f"/api/v1/restaurant/orders/{first['id']}/accept", headers=owner["headers"])

        body = (await client.get("/api/v1/restaurant/dashboard", headers=owner["headers"])).json()

        assert body["newOrders"] == 1
        assert body["preparing"] == 1
        assert body["ordersToday"] == 2

    async def test_revenue_counts_delivered_orders_only(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, _ = await place_customer_order(client, item)

        before = (await client.get("/api/v1/restaurant/dashboard", headers=owner["headers"])).json()
        assert before["revenueTodayPaise"] == 0, "an order still cooking is not revenue"
        assert before["inProgressPaise"] > 0

        await execute("update orders set status = 'delivered' where id = $1::uuid", order["id"])

        after = (await client.get("/api/v1/restaurant/dashboard", headers=owner["headers"])).json()
        assert after["revenueTodayPaise"] == order["totalPaise"]


class TestMenuManagement:
    async def test_creates_a_category_and_an_item(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)

        category = await client.post(
            "/api/v1/restaurant/menu/categories",
            json={"name": "Biryani", "sortOrder": 0},
            headers=owner["headers"],
        )
        assert category.status_code == 201

        item = await client.post(
            "/api/v1/restaurant/menu/items",
            json={
                "name": "Chicken Biryani",
                "pricePaise": 24900,
                "categoryId": category.json()["category"]["id"],
                "description": "Aromatic basmati rice",
                "addons": [{"name": "Raita", "pricePaise": 3000}],
            },
            headers=owner["headers"],
        )

        assert item.status_code == 201
        assert item.json()["item"]["pricePaise"] == 24900
        assert item.json()["item"]["addons"][0]["name"] == "Raita"

    async def test_refuses_a_duplicate_category(self, client):
        owner, _ = await owner_with_restaurant(client)

        await client.post(
            "/api/v1/restaurant/menu/categories", json={"name": "Biryani"}, headers=owner["headers"]
        )
        second = await client.post(
            "/api/v1/restaurant/menu/categories", json={"name": "biryani"}, headers=owner["headers"]
        )

        assert second.status_code == 409
        assert second.json()["code"] == "category_exists"

    async def test_updates_only_the_fields_sent(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)

        response = await client.patch(
            f"/api/v1/restaurant/menu/items/{item}",
            json={"pricePaise": 27900},
            headers=owner["headers"],
        )

        assert response.status_code == 200
        assert response.json()["item"]["pricePaise"] == 27900
        assert response.json()["item"]["name"] == "Chicken Biryani", "name was left alone"

    async def test_toggling_availability_hides_it_from_customers(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)

        await client.patch(
            f"/api/v1/restaurant/menu/items/{item}",
            json={"isAvailable": False},
            headers=owner["headers"],
        )

        customer_view = (await client.get(f"/api/v1/customer/restaurants/{restaurant_id}")).json()
        dish = customer_view["categories"][0]["items"][0]

        # Sold out still shows, greyed out, rather than vanishing.
        assert dish["isAvailable"] is False

        ordered = await client.post(
            "/api/v1/customer/cart/quote", json={"items": [{"menuItemId": str(item), "quantity": 1}]}
        )
        assert ordered.status_code == 409
        assert ordered.json()["code"] == "item_sold_out"

    async def test_deleting_removes_it_from_the_menu_but_not_from_past_orders(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, customer = await place_customer_order(client, item)

        deleted = await client.delete(
            f"/api/v1/restaurant/menu/items/{item}", headers=owner["headers"]
        )
        assert deleted.status_code == 200

        menu = (await client.get("/api/v1/restaurant/menu", headers=owner["headers"])).json()
        assert menu["items"] == []

        # The order still reads correctly.
        past = await client.get(f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"])
        assert past.json()["order"]["items"][0]["name"] == "Chicken Biryani"

    async def test_cannot_touch_another_restaurants_item(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        intruder, _ = await owner_with_restaurant(client, "9000000002", "Pizza Corner")
        item = await make_item(restaurant_id)

        response = await client.patch(
            f"/api/v1/restaurant/menu/items/{item}",
            json={"pricePaise": 1},
            headers=intruder["headers"],
        )

        assert response.status_code == 404
        assert await fetchval("select price_paise from menu_items where id = $1", item) == 24900

    async def test_cannot_file_an_item_under_another_restaurants_category(self, client):
        owner, _ = await owner_with_restaurant(client)
        intruder, _ = await owner_with_restaurant(client, "9000000002", "Pizza Corner")

        theirs = await client.post(
            "/api/v1/restaurant/menu/categories", json={"name": "Pizzas"}, headers=intruder["headers"]
        )

        response = await client.post(
            "/api/v1/restaurant/menu/items",
            json={
                "name": "Sneaky Dish",
                "pricePaise": 10000,
                "categoryId": theirs.json()["category"]["id"],
            },
            headers=owner["headers"],
        )

        assert response.status_code == 404
        assert response.json()["code"] == "category_not_found"
