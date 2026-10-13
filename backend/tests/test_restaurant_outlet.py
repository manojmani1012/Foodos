"""The rest of the restaurant partner app: history, outlet settings, cover
photo, reviews, earnings and add-ons."""

from app.database import execute, fetchrow

from test_dish_photos import JPEG, photo
from test_restaurant_portal import (
    make_item,
    owner_with_restaurant,
    place_customer_order,
)


async def deliver(order_id):
    # No rider app yet, so the test moves the order the rest of the way.
    await execute("update orders set status = 'delivered', delivered_at = now() where id = $1::uuid", order_id)


class TestPastOrders:
    async def test_finished_orders_are_in_the_past_queue_and_not_the_live_ones(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        delivered, _ = await place_customer_order(client, item, phone="9876543210")
        rejected, _ = await place_customer_order(client, item, phone="9876543211")
        live, _ = await place_customer_order(client, item, phone="9876543212")

        await deliver(delivered["id"])
        await client.post(f"/api/v1/restaurant/orders/{rejected['id']}/reject", json={}, headers=owner["headers"])

        past = (await client.get("/api/v1/restaurant/orders?queue=past", headers=owner["headers"])).json()["orders"]
        new = (await client.get("/api/v1/restaurant/orders?queue=new", headers=owner["headers"])).json()["orders"]

        assert {o["id"] for o in past} == {delivered["id"], rejected["id"]}
        assert [o["id"] for o in new] == [live["id"]]


class TestOutletProfile:
    async def test_an_owner_can_set_hours_prep_time_and_contact(self, client):
        owner, _ = await owner_with_restaurant(client)

        response = await client.patch(
            "/api/v1/restaurant/profile",
            json={"opensAt": "09:30", "closesAt": "23:00", "avgPrepMinutes": 25, "phone": "044 2345 6789"},
            headers=owner["headers"],
        )

        assert response.status_code == 200, response.text
        restaurant = response.json()["restaurant"]
        assert restaurant["opensAt"].startswith("09:30")
        assert restaurant["closesAt"].startswith("23:00")
        assert restaurant["avgPrepMinutes"] == 25
        assert restaurant["phone"] == "044 2345 6789"

    async def test_hours_can_be_cleared(self, client):
        owner, _ = await owner_with_restaurant(client)
        await client.patch("/api/v1/restaurant/profile", json={"opensAt": "09:30"}, headers=owner["headers"])

        cleared = await client.patch("/api/v1/restaurant/profile", json={"opensAt": None}, headers=owner["headers"])

        assert cleared.json()["restaurant"]["opensAt"] is None

    async def test_a_nonsense_time_is_refused(self, client):
        owner, _ = await owner_with_restaurant(client)

        response = await client.patch("/api/v1/restaurant/profile", json={"opensAt": "25:00"}, headers=owner["headers"])

        assert response.status_code == 400

    async def test_the_name_is_not_editable_by_the_owner(self, client):
        owner, restaurant_id = await owner_with_restaurant(client, name="The Biryani House")

        await client.patch(
            "/api/v1/restaurant/profile",
            json={"name": "Something Else", "avgPrepMinutes": 20},
            headers=owner["headers"],
        )

        row = await fetchrow("select name from restaurants where id = $1", restaurant_id)
        assert row["name"] == "The Biryani House"


class TestCoverPhoto:
    async def test_the_cover_appears_for_customers(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)

        response = await client.put("/api/v1/restaurant/image", files=photo(JPEG), headers=owner["headers"])

        assert response.status_code == 200, response.text
        cover = response.json()["restaurant"]["imageUrl"]
        assert (await client.get(cover)).status_code == 200

        detail = (await client.get(f"/api/v1/customer/restaurants/{restaurant_id}")).json()
        assert detail["imageUrl"] == cover

    async def test_removing_the_cover_deletes_the_image(self, client):
        owner, _ = await owner_with_restaurant(client)
        cover = (await client.put("/api/v1/restaurant/image", files=photo(JPEG), headers=owner["headers"])).json()[
            "restaurant"
        ]["imageUrl"]

        removed = await client.delete("/api/v1/restaurant/image", headers=owner["headers"])

        assert removed.json()["restaurant"]["imageUrl"] is None
        assert (await client.get(cover)).status_code == 404


class TestReviews:
    async def test_the_owner_sees_ratings_with_first_names_only(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        order, customer = await place_customer_order(client, item)
        await execute("update users set full_name = 'Priya Sharma' where phone = '+919876543210'")
        await deliver(order["id"])

        posted = await client.post(
            f"/api/v1/customer/orders/{order['id']}/review",
            json={"rating": 4, "comment": "Great biryani, a little late"},
            headers=customer["headers"],
        )
        assert posted.status_code in (200, 201), posted.text

        body = (await client.get("/api/v1/restaurant/reviews", headers=owner["headers"])).json()

        assert body["summary"]["total"] == 1
        assert body["summary"]["average"] == 4.0
        assert body["summary"]["distribution"] == [0, 0, 0, 1, 0]
        review = body["reviews"][0]
        assert review["customerName"] == "Priya", "first name only"
        assert review["comment"] == "Great biryani, a little late"
        assert review["orderNumber"] == order["orderNumber"]


class TestEarnings:
    async def test_delivered_orders_earn_food_plus_packaging_minus_commission(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        await execute("update restaurants set commission_pct = 20 where id = $1", restaurant_id)
        item = await make_item(restaurant_id, price=25000)
        done, _ = await place_customer_order(client, item, phone="9876543210")
        cooking, _ = await place_customer_order(client, item, phone="9876543211")
        await deliver(done["id"])

        body = (await client.get("/api/v1/restaurant/earnings?days=7", headers=owner["headers"])).json()

        food = done["subtotalPaise"]
        packaging = done["packagingFeePaise"]
        assert body["totals"]["orders"] == 1
        assert body["totals"]["foodPaise"] == food
        assert body["totals"]["commissionPaise"] == round(food * 0.20)
        assert body["totals"]["earningsPaise"] == food + packaging - round(food * 0.20)
        assert len(body["daily"]) == 7
        # The order still cooking is not earned yet, but is not hidden either.
        assert body["inProgress"] == {"orders": 1, "foodPaise": cooking["subtotalPaise"]}


class TestAddons:
    async def test_replacing_addons_changes_the_menu_but_not_past_bills(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        await execute(
            "insert into menu_item_addons (menu_item_id, name, price_paise) values ($1, 'Extra raita', 3000)",
            item,
        )
        addon_id = await fetchrow("select id from menu_item_addons where menu_item_id = $1", item)

        # A customer orders with the old add-on.
        from test_restaurant_portal import sign_in, ADDRESS

        customer = await sign_in(client, "9876543210", "customer")
        old_order = (
            await client.post(
                "/api/v1/customer/orders",
                json={
                    "items": [{"menuItemId": str(item), "quantity": 1, "addonIds": [str(addon_id["id"])]}],
                    "paymentMethod": "cod",
                    "address": ADDRESS,
                },
                headers=customer["headers"],
            )
        ).json()["order"]

        response = await client.put(
            f"/api/v1/restaurant/menu/items/{item}/addons",
            json={"addons": [{"name": "Extra egg", "pricePaise": 2000}, {"name": "Coke", "pricePaise": 4000}]},
            headers=owner["headers"],
        )

        assert response.status_code == 200, response.text
        assert [a["name"] for a in response.json()["item"]["addons"]] == ["Extra egg", "Coke"]

        # The old bill still shows what was actually ordered.
        bill = (await client.get(f"/api/v1/customer/orders/{old_order['id']}", headers=customer["headers"])).json()
        assert bill["order"]["items"][0]["addons"] == [{"name": "Extra raita", "pricePaise": 3000}]

    async def test_another_owner_cannot_change_addons(self, client):
        _, theirs = await owner_with_restaurant(client, "9000000001", "Theirs")
        their_item = await make_item(theirs)
        me, _ = await owner_with_restaurant(client, "9000000002", "Mine")

        response = await client.put(
            f"/api/v1/restaurant/menu/items/{their_item}/addons",
            json={"addons": [{"name": "Hijack", "pricePaise": 1}]},
            headers=me["headers"],
        )

        assert response.status_code == 404
