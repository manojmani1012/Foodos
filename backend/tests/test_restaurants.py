"""Restaurant and menu browsing tests."""

import pytest

from app.database import execute, fetchval

CHENNAI = "Chennai"


async def make_owner(phone: str = "+919000000099") -> str:
    owner_id = await fetchval(
        "insert into users (phone, full_name) values ($1, 'Owner') returning id", phone
    )
    await execute(
        "insert into user_roles (user_id, role) values ($1, 'restaurant_owner')", owner_id
    )

    return owner_id


async def make_restaurant(
    owner_id,
    name: str = "The Biryani House",
    cuisines: list[str] | None = None,
    city: str = CHENNAI,
    status: str = "active",
    is_veg: bool = False,
    rating: float = 4.4,
    avg_prep_minutes: int = 30,
):
    return await fetchval(
        """
        insert into restaurants
          (owner_id, name, cuisines, address_line, city, status, is_veg, rating,
           rating_count, avg_prep_minutes)
        values ($1, $2, $3, 'Anna Nagar', $4, $5, $6, $7, 100, $8)
        returning id
        """,
        owner_id,
        name,
        cuisines or ["Biryani", "North Indian"],
        city,
        status,
        is_veg,
        rating,
        avg_prep_minutes,
    )


async def make_menu(restaurant_id, category: str = "Biryani"):
    category_id = await fetchval(
        "insert into menu_categories (restaurant_id, name, sort_order) values ($1, $2, 0) returning id",
        restaurant_id,
        category,
    )
    item_id = await fetchval(
        """
        insert into menu_items (restaurant_id, category_id, name, description, price_paise, is_veg)
        values ($1, $2, 'Chicken Biryani', 'Aromatic basmati rice', 24900, false)
        returning id
        """,
        restaurant_id,
        category_id,
    )
    await execute(
        "insert into menu_item_addons (menu_item_id, name, price_paise) values ($1, 'Raita', 3000)",
        item_id,
    )

    return category_id, item_id


async def sign_in_customer(client, phone: str = "9876543210") -> dict:
    code = (await client.post("/api/v1/auth/otp/request", json={"phone": phone})).json()["devCode"]
    response = await client.post(
        "/api/v1/auth/otp/verify", json={"phone": phone, "code": code, "role": "customer"}
    )

    return response.json()


class TestRestaurantList:
    async def test_lists_active_restaurants_without_signing_in(self, client):
        owner = await make_owner()
        await make_restaurant(owner)

        response = await client.get("/api/v1/customer/restaurants")

        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["restaurants"][0]["name"] == "The Biryani House"
        assert body["restaurants"][0]["cuisines"] == ["Biryani", "North Indian"]

    async def test_hides_restaurants_that_are_not_active(self, client):
        owner = await make_owner()
        await make_restaurant(owner, name="Approved Place", status="active")
        await make_restaurant(owner, name="Awaiting Approval", status="pending")
        await make_restaurant(owner, name="Suspended Place", status="suspended")

        body = (await client.get("/api/v1/customer/restaurants")).json()

        assert [r["name"] for r in body["restaurants"]] == ["Approved Place"]

    async def test_reports_an_eta_range_from_preparation_time(self, client):
        owner = await make_owner()
        await make_restaurant(owner, avg_prep_minutes=30)

        restaurant = (await client.get("/api/v1/customer/restaurants")).json()["restaurants"][0]

        assert restaurant["etaMinMinutes"] == 30
        assert restaurant["etaMaxMinutes"] == 40

    async def test_search_matches_name_or_cuisine(self, client):
        owner = await make_owner()
        await make_restaurant(owner, name="The Biryani House", cuisines=["Biryani"])
        await make_restaurant(owner, name="Pizza Corner", cuisines=["Pizza", "Italian"])

        by_name = (await client.get("/api/v1/customer/restaurants?search=pizza")).json()
        by_cuisine = (await client.get("/api/v1/customer/restaurants?search=italian")).json()

        assert [r["name"] for r in by_name["restaurants"]] == ["Pizza Corner"]
        assert [r["name"] for r in by_cuisine["restaurants"]] == ["Pizza Corner"]

    async def test_filters_by_cuisine_and_veg(self, client):
        owner = await make_owner()
        await make_restaurant(owner, name="Dosa Express", cuisines=["South Indian"], is_veg=True)
        await make_restaurant(owner, name="Burger Hub", cuisines=["Burgers"], is_veg=False)

        cuisine = (await client.get("/api/v1/customer/restaurants?cuisine=South Indian")).json()
        veg = (await client.get("/api/v1/customer/restaurants?vegOnly=true")).json()

        assert [r["name"] for r in cuisine["restaurants"]] == ["Dosa Express"]
        assert [r["name"] for r in veg["restaurants"]] == ["Dosa Express"]

    async def test_filters_by_city(self, client):
        owner = await make_owner()
        await make_restaurant(owner, name="Chennai Place", city="Chennai")
        await make_restaurant(owner, name="Bengaluru Place", city="Bengaluru")

        body = (await client.get("/api/v1/customer/restaurants?city=Chennai")).json()

        assert [r["name"] for r in body["restaurants"]] == ["Chennai Place"]

    async def test_paginates(self, client):
        owner = await make_owner()
        for index in range(5):
            await make_restaurant(owner, name=f"Place {index}", rating=4.0 + index / 10)

        page = (await client.get("/api/v1/customer/restaurants?limit=2&offset=0")).json()
        second = (await client.get("/api/v1/customer/restaurants?limit=2&offset=2")).json()

        assert page["total"] == 5
        assert len(page["restaurants"]) == 2
        assert page["restaurants"][0]["name"] != second["restaurants"][0]["name"]

    async def test_rejects_an_absurd_page_size(self, client):
        response = await client.get("/api/v1/customer/restaurants?limit=500")

        assert response.status_code == 400
        assert response.json()["code"] == "validation_failed"


class TestRestaurantDetail:
    async def test_returns_the_full_menu_in_one_call(self, client):
        owner = await make_owner()
        restaurant_id = await make_restaurant(owner)
        await make_menu(restaurant_id)

        response = await client.get(f"/api/v1/customer/restaurants/{restaurant_id}")

        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "The Biryani House"
        assert len(body["categories"]) == 1

        category = body["categories"][0]
        assert category["name"] == "Biryani"

        item = category["items"][0]
        assert item["name"] == "Chicken Biryani"
        assert item["pricePaise"] == 24900, "money is paise, so 249 rupees is 24900"
        assert item["addons"][0]["name"] == "Raita"
        assert item["addons"][0]["pricePaise"] == 3000

    async def test_hides_deleted_menu_items(self, client):
        owner = await make_owner()
        restaurant_id = await make_restaurant(owner)
        _, item_id = await make_menu(restaurant_id)
        await execute("update menu_items set deleted_at = now() where id = $1", item_id)

        body = (await client.get(f"/api/v1/customer/restaurants/{restaurant_id}")).json()

        assert body["categories"] == []

    async def test_keeps_unavailable_items_but_flags_them(self, client):
        owner = await make_owner()
        restaurant_id = await make_restaurant(owner)
        _, item_id = await make_menu(restaurant_id)
        await execute("update menu_items set is_available = false where id = $1", item_id)

        body = (await client.get(f"/api/v1/customer/restaurants/{restaurant_id}")).json()

        # Sold out still shows on the menu, greyed out, rather than vanishing.
        assert body["categories"][0]["items"][0]["isAvailable"] is False

    async def test_404_for_an_unknown_restaurant(self, client):
        response = await client.get("/api/v1/customer/restaurants/11111111-1111-1111-1111-111111111111")

        assert response.status_code == 404
        assert response.json()["code"] == "restaurant_not_found"

    async def test_404_rather_than_a_crash_for_a_malformed_id(self, client):
        response = await client.get("/api/v1/customer/restaurants/not-a-uuid")

        assert response.status_code == 404
        assert response.json()["code"] == "restaurant_not_found"

    async def test_a_pending_restaurant_is_not_reachable_by_id(self, client):
        owner = await make_owner()
        restaurant_id = await make_restaurant(owner, status="pending")

        response = await client.get(f"/api/v1/customer/restaurants/{restaurant_id}")

        assert response.status_code == 404


class TestFavourites:
    async def test_requires_signing_in(self, client):
        response = await client.get("/api/v1/customer/favourites")

        assert response.status_code == 401

    async def test_add_list_and_remove(self, client):
        owner = await make_owner()
        restaurant_id = await make_restaurant(owner)
        session = await sign_in_customer(client)
        headers = {"authorization": f"Bearer {session['accessToken']}"}

        added = await client.put(f"/api/v1/customer/favourites/{restaurant_id}", headers=headers)
        assert added.status_code == 200

        listed = await client.get("/api/v1/customer/favourites", headers=headers)
        assert [r["name"] for r in listed.json()["restaurants"]] == ["The Biryani House"]

        removed = await client.delete(f"/api/v1/customer/favourites/{restaurant_id}", headers=headers)
        assert removed.status_code == 200

        empty = await client.get("/api/v1/customer/favourites", headers=headers)
        assert empty.json()["restaurants"] == []

    async def test_adding_twice_is_harmless(self, client):
        owner = await make_owner()
        restaurant_id = await make_restaurant(owner)
        session = await sign_in_customer(client)
        headers = {"authorization": f"Bearer {session['accessToken']}"}

        await client.put(f"/api/v1/customer/favourites/{restaurant_id}", headers=headers)
        second = await client.put(f"/api/v1/customer/favourites/{restaurant_id}", headers=headers)

        assert second.status_code == 200
        assert await fetchval("select count(*) from favourites") == 1

    async def test_browsing_marks_favourites_when_signed_in(self, client):
        owner = await make_owner()
        restaurant_id = await make_restaurant(owner)
        session = await sign_in_customer(client)
        headers = {"authorization": f"Bearer {session['accessToken']}"}

        await client.put(f"/api/v1/customer/favourites/{restaurant_id}", headers=headers)

        signed_in = (await client.get("/api/v1/customer/restaurants", headers=headers)).json()
        anonymous = (await client.get("/api/v1/customer/restaurants")).json()

        assert signed_in["restaurants"][0]["isFavourite"] is True
        assert anonymous["restaurants"][0]["isFavourite"] is False

    async def test_an_expired_token_does_not_block_browsing(self, client):
        owner = await make_owner()
        await make_restaurant(owner)

        response = await client.get(
            "/api/v1/customer/restaurants", headers={"authorization": "Bearer not-a-real-token"}
        )

        # Browsing is open, so a stale token means "not signed in", not an error.
        assert response.status_code == 200
        assert response.json()["restaurants"][0]["isFavourite"] is False

    async def test_a_rider_session_cannot_use_customer_favourites(self, client):
        owner = await make_owner()
        restaurant_id = await make_restaurant(owner)

        code = (await client.post("/api/v1/auth/otp/request", json={"phone": "9123456789"})).json()["devCode"]
        rider = (
            await client.post(
                "/api/v1/auth/otp/verify",
                json={"phone": "9123456789", "code": code, "role": "delivery_partner"},
            )
        ).json()

        response = await client.put(
            f"/api/v1/customer/favourites/{restaurant_id}",
            headers={"authorization": f"Bearer {rider['accessToken']}"},
        )

        assert response.status_code == 403
        assert response.json()["code"] == "role_forbidden"


class TestOffersAndCuisines:
    async def test_lists_only_valid_platform_offers(self, client):
        await execute(
            """
            insert into offers (name, code, type, percent_off, max_discount_paise, first_order_only)
            values ('First Order', 'FOODOS50', 'percent', 50, 10000, true)
            """
        )
        await execute(
            """
            insert into offers (name, code, type, flat_off_paise, is_active)
            values ('Old Offer', 'EXPIRED', 'flat', 5000, false)
            """
        )
        # An offer that ran last week. valid_from has to precede valid_until,
        # which the schema enforces, so both are set in the past.
        await execute(
            """
            insert into offers (name, code, type, flat_off_paise, valid_from, valid_until)
            values ('Finished', 'PASTDUE', 'flat', 5000,
                    now() - interval '7 days', now() - interval '1 day')
            """
        )

        body = (await client.get("/api/v1/customer/offers")).json()

        assert [o["code"] for o in body["offers"]] == ["FOODOS50"]
        assert body["offers"][0]["percentOff"] == 50
        assert body["offers"][0]["maxDiscountPaise"] == 10000

    async def test_cuisines_come_from_live_restaurants(self, client):
        owner = await make_owner()
        await make_restaurant(owner, name="A", cuisines=["Biryani", "Chinese"])
        await make_restaurant(owner, name="B", cuisines=["Pizza"])
        await make_restaurant(owner, name="Hidden", cuisines=["Sushi"], status="pending")

        body = (await client.get("/api/v1/customer/cuisines")).json()

        assert body["cuisines"] == ["Biryani", "Chinese", "Pizza"]
        assert "Sushi" not in body["cuisines"]


class TestFuzzySearch:
    """Spelling varies; the search has to cope."""

    async def setup_catalogue(self):
        owner = await make_owner()
        biryani = await make_restaurant(owner, name="The Biryani House", cuisines=["Biryani", "North Indian"])
        pizza = await make_restaurant(owner, name="Pizza Corner", cuisines=["Pizza", "Italian"])

        return biryani, pizza

    async def test_a_misspelt_search_still_finds_the_restaurant(self, client):
        await self.setup_catalogue()

        # The spelling a customer actually typed on the phone.
        body = (await client.get("/api/v1/customer/restaurants?search=briyani")).json()

        assert [r["name"] for r in body["restaurants"]] == ["The Biryani House"]

    async def test_other_common_misspellings(self, client):
        await self.setup_catalogue()

        for typo, expected in [("piza", "Pizza Corner"), ("biriyani", "The Biryani House")]:
            body = (await client.get(f"/api/v1/customer/restaurants?search={typo}")).json()
            names = [r["name"] for r in body["restaurants"]]

            assert expected in names, f"{typo!r} should find {expected!r}, got {names}"

    async def test_finds_a_restaurant_by_a_dish_it_sells(self, client):
        owner = await make_owner()
        restaurant = await make_restaurant(owner, name="Anna Kitchen", cuisines=["South Indian"])
        await make_menu(restaurant, category="Biryani")

        # "Anna Kitchen" says nothing about biryani; only its menu does.
        body = (await client.get("/api/v1/customer/restaurants?search=biryani")).json()

        assert [r["name"] for r in body["restaurants"]] == ["Anna Kitchen"]

    async def test_an_unrelated_search_still_returns_nothing(self, client):
        await self.setup_catalogue()

        body = (await client.get("/api/v1/customer/restaurants?search=sushi")).json()

        # Fuzzy matching must not turn into matching everything.
        assert body["restaurants"] == []

    async def test_the_closest_name_ranks_first(self, client):
        owner = await make_owner()
        await make_restaurant(owner, name="Biryani House", cuisines=["Biryani"], rating=3.0)
        serves_it = await make_restaurant(owner, name="Anna Kitchen", cuisines=["South Indian"], rating=5.0)
        await make_menu(serves_it, category="Biryani")

        body = (await client.get("/api/v1/customer/restaurants?search=biryani")).json()

        # Named for it beats merely selling it, even on a lower rating.
        assert body["restaurants"][0]["name"] == "Biryani House"


class TestSearchPrecision:
    async def test_a_short_term_does_not_match_on_a_shared_prefix(self, client):
        """"dosa" once matched "Double Cheese Burger" on the "do" prefix alone."""
        owner = await make_owner()
        burgers = await make_restaurant(owner, name="Burger Hub", cuisines=["Burgers"])
        await fetchval(
            """
            insert into menu_items (restaurant_id, name, price_paise, is_veg)
            values ($1, 'Double Cheese Burger', 24900, false) returning id
            """,
            burgers,
        )
        dosas = await make_restaurant(owner, name="Dosa Express", cuisines=["South Indian"])
        await fetchval(
            """
            insert into menu_items (restaurant_id, name, price_paise, is_veg)
            values ($1, 'Masala Dosa', 12900, true) returning id
            """,
            dosas,
        )

        body = (await client.get("/api/v1/customer/restaurants?search=dosa")).json()
        names = [r["name"] for r in body["restaurants"]]

        assert "Dosa Express" in names
        assert "Burger Hub" not in names, "a shared prefix is not a match"
