"""Dish photos: restaurant owners upload them, everyone can see them.

The things that must not happen: a file that is not an image being stored and
served as one, an owner touching another restaurant's dish, and replaced
photos piling up in the database.
"""

from app.components.media.service import MAX_IMAGE_BYTES
from app.database import fetchval

from test_restaurant_portal import make_item, owner_with_restaurant, sign_in

# Only the signature is checked, so a JPEG header followed by padding is a
# valid upload as far as the server is concerned.
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 256
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 256


def photo(data: bytes, name: str = "dish.jpg", content_type: str = "image/jpeg") -> dict:
    return {"file": (name, data, content_type)}


async def upload(client, owner, item_id, data=JPEG, **kwargs):
    return await client.put(
        f"/api/v1/restaurant/menu/items/{item_id}/image",
        files=photo(data, **kwargs),
        headers=owner["headers"],
    )


class TestUpload:
    async def test_an_owner_can_add_a_photo_and_anyone_can_view_it(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item_id = await make_item(restaurant_id)

        response = await upload(client, owner, item_id)

        assert response.status_code == 200, response.text
        image_url = response.json()["item"]["imageUrl"]
        assert image_url.startswith("/media/")

        # No auth header: customers see photos before they sign in.
        served = await client.get(image_url)

        assert served.status_code == 200
        assert served.headers["content-type"] == "image/jpeg"
        assert served.content == JPEG
        assert "immutable" in served.headers["cache-control"]

    async def test_the_photo_appears_on_the_owner_menu_and_the_customer_menu(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item_id = await make_item(restaurant_id)
        image_url = (await upload(client, owner, item_id)).json()["item"]["imageUrl"]

        menu = (await client.get("/api/v1/restaurant/menu", headers=owner["headers"])).json()
        assert menu["items"][0]["imageUrl"] == image_url

        detail = (await client.get(f"/api/v1/customer/restaurants/{restaurant_id}")).json()
        dishes = [item for category in detail["categories"] for item in category["items"]]
        assert dishes[0]["imageUrl"] == image_url

    async def test_png_is_accepted_and_served_as_png(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item_id = await make_item(restaurant_id)

        response = await upload(client, owner, item_id, PNG, name="dish.png", content_type="image/png")
        served = await client.get(response.json()["item"]["imageUrl"])

        assert served.headers["content-type"] == "image/png"


class TestReplaceAndRemove:
    async def test_replacing_a_photo_deletes_the_old_one(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item_id = await make_item(restaurant_id)

        first = (await upload(client, owner, item_id)).json()["item"]["imageUrl"]
        second = (await upload(client, owner, item_id, PNG, content_type="image/png")).json()["item"]["imageUrl"]

        assert first != second
        assert (await client.get(first)).status_code == 404
        assert (await client.get(second)).status_code == 200
        assert await fetchval("select count(*) from media") == 1

    async def test_removing_a_photo_clears_the_dish_and_deletes_the_file(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item_id = await make_item(restaurant_id)
        image_url = (await upload(client, owner, item_id)).json()["item"]["imageUrl"]

        response = await client.delete(
            f"/api/v1/restaurant/menu/items/{item_id}/image", headers=owner["headers"]
        )

        assert response.status_code == 200
        assert response.json()["item"]["imageUrl"] is None
        assert (await client.get(image_url)).status_code == 404
        assert await fetchval("select count(*) from media") == 0


class TestRejected:
    async def test_a_renamed_file_that_is_not_an_image_is_refused(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item_id = await make_item(restaurant_id)

        # Claims to be a JPEG by name and header; the bytes say otherwise.
        response = await upload(client, owner, item_id, b"<script>alert(1)</script>")

        assert response.status_code == 400
        assert response.json()["code"] == "image_unsupported"
        assert await fetchval("select count(*) from media") == 0

    async def test_an_oversized_photo_is_refused(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item_id = await make_item(restaurant_id)

        response = await upload(client, owner, item_id, JPEG + b"\x00" * MAX_IMAGE_BYTES)

        assert response.status_code == 413
        assert response.json()["code"] == "image_too_large"

    async def test_an_empty_upload_is_refused(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item_id = await make_item(restaurant_id)

        response = await upload(client, owner, item_id, b"")

        assert response.status_code == 400
        assert response.json()["code"] == "image_empty"


class TestOwnership:
    async def test_an_owner_cannot_change_another_restaurants_dish(self, client):
        _, their_restaurant = await owner_with_restaurant(client, "9000000001", "Theirs")
        their_item = await make_item(their_restaurant)
        me, _ = await owner_with_restaurant(client, "9000000002", "Mine")

        response = await upload(client, me, their_item)

        assert response.status_code == 404
        assert response.json()["code"] == "item_not_found"
        # Refused before anything was stored.
        assert await fetchval("select count(*) from media") == 0

    async def test_a_customer_cannot_upload(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        item_id = await make_item(restaurant_id)
        customer = await sign_in(client, "9876543210", "customer")

        response = await upload(client, customer, item_id)

        assert response.status_code == 403

    async def test_an_unknown_image_is_a_404_not_a_crash(self, client):
        assert (await client.get("/media/not-a-uuid")).status_code == 404
        assert (
            await client.get("/media/00000000-0000-0000-0000-000000000000")
        ).status_code == 404
