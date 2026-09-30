"""Fills an empty database with the restaurants, menus and offers from the
design mockups, so the apps show realistic content during development.

    python -m db.seed

Safe to run repeatedly: it skips seeding if restaurants already exist. Pass
--reset to wipe the seeded catalogue and rebuild it.

Never run this against production.
"""

import asyncio
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402

# Owners are created as users with the restaurant_owner role, exactly as they
# would be after signing in to the restaurant app.
RESTAURANTS = [
    {
        "owner_phone": "+919000000001",
        "owner_name": "Ramesh Kumar",
        "name": "The Biryani House",
        "description": "Hyderabadi dum biryani, slow-cooked in sealed handis.",
        "cuisines": ["Biryani", "North Indian", "Chinese"],
        "address_line": "Anna Nagar",
        "city": "Chennai",
        "is_veg": False,
        "rating": 4.4,
        "rating_count": 1243,
        "avg_prep_minutes": 30,
        "categories": [
            (
                "Biryani",
                [
                    ("Chicken Biryani", "Aromatic basmati rice cooked with tender chicken, spices and herbs.", 24900, False, 4.5, 910),
                    ("Mutton Biryani", "Slow-cooked mutton layered with fragrant basmati rice.", 29900, False, 4.6, 540),
                    ("Veg Biryani", "Mixed vegetables and basmati rice with traditional spices.", 19900, True, 4.2, 320),
                    ("Prawn Biryani", "Juicy prawns simmered in a spiced biryani masala with rice.", 31900, False, 4.4, 210),
                ],
            ),
            (
                "Starters",
                [
                    ("Chicken 65", "Spicy deep-fried chicken bites tossed with curry leaves.", 17900, False, 4.3, 402),
                    ("Gobi Manchurian", "Crispy cauliflower florets in a tangy manchurian sauce.", 15900, True, 4.0, 180),
                ],
            ),
            (
                "Breads",
                [
                    ("Butter Naan", "Tandoor-baked naan brushed with butter.", 5900, True, 4.3, 260),
                    ("Tandoori Roti", "Whole wheat roti from the tandoor.", 3900, True, 4.1, 150),
                ],
            ),
            (
                "Beverages",
                [
                    ("Masala Chaas", "Spiced buttermilk with cumin and coriander.", 4900, True, 4.2, 96),
                ],
            ),
        ],
        # Add-ons attach to the first item of the first category.
        "addons": [("Extra Chicken (2 pcs)", 9000), ("Raita", 3000), ("Boiled Egg", 2000)],
    },
    {
        "owner_phone": "+919000000002",
        "owner_name": "Anita Devi",
        "name": "Pizza Corner",
        "description": "Hand-tossed pizzas on a 24-hour fermented base.",
        "cuisines": ["Pizza", "Fast Food", "Italian"],
        "address_line": "Velachery",
        "city": "Chennai",
        "is_veg": False,
        "rating": 4.1,
        "rating_count": 812,
        "avg_prep_minutes": 25,
        "categories": [
            (
                "Pizzas",
                [
                    ("Margherita", "Tomato, mozzarella and fresh basil.", 22900, True, 4.2, 410),
                    ("Farmhouse", "Onion, capsicum, tomato and mushroom.", 30900, True, 4.3, 356),
                    ("Chicken Tikka", "Spiced chicken tikka with onion and capsicum.", 34900, False, 4.4, 298),
                ],
            ),
            (
                "Sides",
                [
                    ("Garlic Bread", "Baked with garlic butter and herbs.", 12900, True, 4.1, 220),
                    ("Peri Peri Fries", "Crisp fries tossed in peri peri seasoning.", 13900, True, 4.0, 190),
                ],
            ),
        ],
        "addons": [("Extra Cheese", 6000), ("Jalapenos", 3000)],
    },
    {
        "owner_phone": "+919000000003",
        "owner_name": "Vikram Singh",
        "name": "Burger Hub",
        "description": "Smash burgers and loaded fries.",
        "cuisines": ["Burgers", "Sandwiches", "Snacks"],
        "address_line": "T Nagar",
        "city": "Chennai",
        "is_veg": False,
        "rating": 4.3,
        "rating_count": 623,
        "avg_prep_minutes": 20,
        "categories": [
            (
                "Burgers",
                [
                    ("Classic Chicken Burger", "Crispy chicken patty, lettuce and mayo.", 16900, False, 4.3, 289),
                    ("Paneer Tikka Burger", "Spiced paneer patty with mint mayo.", 15900, True, 4.2, 176),
                    ("Double Cheese Burger", "Two patties with melted cheddar.", 24900, False, 4.5, 203),
                ],
            ),
            (
                "Sides",
                [
                    ("Classic Fries", "Salted and golden.", 9900, True, 4.1, 310),
                ],
            ),
        ],
        "addons": [("Extra Patty", 8000), ("Cheese Slice", 2500)],
    },
    {
        "owner_phone": "+919000000004",
        "owner_name": "Suresh Babu",
        "name": "Dosa Express",
        "description": "South Indian tiffins served all day.",
        "cuisines": ["South Indian", "Tiffins"],
        "address_line": "Adyar",
        "city": "Chennai",
        "is_veg": True,
        "rating": 4.5,
        "rating_count": 2140,
        "avg_prep_minutes": 15,
        "categories": [
            (
                "Dosa",
                [
                    ("Masala Dosa", "Crisp dosa with spiced potato filling.", 12900, True, 4.6, 880),
                    ("Ghee Roast Dosa", "Thin dosa roasted in ghee.", 14900, True, 4.5, 540),
                    ("Onion Rava Dosa", "Crisp semolina dosa with onions.", 15900, True, 4.4, 320),
                ],
            ),
            (
                "Idli & Vada",
                [
                    ("Idli (2 pcs)", "Steamed rice cakes with sambar and chutney.", 7900, True, 4.4, 610),
                    ("Medu Vada (2 pcs)", "Crisp lentil doughnuts.", 8900, True, 4.3, 430),
                ],
            ),
        ],
        "addons": [("Extra Sambar", 2000), ("Coconut Chutney", 2000)],
    },
    {
        "owner_phone": "+919000000005",
        "owner_name": "Kavya Reddy",
        "name": "Healthy Bowl",
        "description": "Salads, grain bowls and cold-pressed juices.",
        "cuisines": ["Healthy", "Salads", "Continental"],
        "address_line": "Besant Nagar",
        "city": "Chennai",
        "is_veg": True,
        "rating": 4.2,
        "rating_count": 356,
        "avg_prep_minutes": 20,
        "categories": [
            (
                "Bowls",
                [
                    ("Quinoa Power Bowl", "Quinoa, chickpeas, avocado and greens.", 27900, True, 4.3, 142),
                    ("Paneer Protein Bowl", "Grilled paneer, brown rice and vegetables.", 25900, True, 4.2, 118),
                ],
            ),
            (
                "Juices",
                [
                    ("Cold Pressed Orange", "Nothing but oranges.", 14900, True, 4.1, 86),
                ],
            ),
        ],
        "addons": [("Extra Avocado", 7000)],
    },
]

OFFERS = [
    {
        "name": "First Order",
        "code": "FOODOS50",
        "type": "percent",
        "percent_off": 50,
        "max_discount_paise": 10000,
        "min_order_paise": 0,
        "first_order_only": True,
    },
    {
        "name": "Free Delivery",
        "code": "FREEDEL",
        "type": "free_delivery",
        "min_order_paise": 19900,
        "first_order_only": False,
    },
    {
        "name": "Flat 100 Off",
        "code": "FLAT100",
        "type": "flat",
        "flat_off_paise": 10000,
        "min_order_paise": 39900,
        "first_order_only": False,
    },
]


async def seed(connection: asyncpg.Connection, reset: bool = False) -> None:
    if reset:
        # Only the seeded catalogue; users, orders and sessions are untouched.
        await connection.execute("delete from restaurants")
        await connection.execute("delete from offers")
        print("Cleared the existing catalogue")

    existing = await connection.fetchval("select count(*) from restaurants")

    if existing:
        print(f"{existing} restaurant(s) already present; nothing to do. Use --reset to rebuild.")
        return

    for entry in RESTAURANTS:
        owner_id = await connection.fetchval(
            """
            insert into users (phone, full_name) values ($1, $2)
            on conflict (phone) do update set full_name = excluded.full_name
            returning id
            """,
            entry["owner_phone"],
            entry["owner_name"],
        )
        await connection.execute(
            "insert into user_roles (user_id, role) values ($1, 'restaurant_owner') on conflict do nothing",
            owner_id,
        )

        restaurant_id = await connection.fetchval(
            """
            insert into restaurants
              (owner_id, name, description, cuisines, address_line, city, is_veg,
               rating, rating_count, avg_prep_minutes, status, is_accepting_orders)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', true)
            returning id
            """,
            owner_id,
            entry["name"],
            entry["description"],
            entry["cuisines"],
            entry["address_line"],
            entry["city"],
            entry["is_veg"],
            entry["rating"],
            entry["rating_count"],
            entry["avg_prep_minutes"],
        )

        first_item_id = None

        for category_order, (category_name, items) in enumerate(entry["categories"]):
            category_id = await connection.fetchval(
                """
                insert into menu_categories (restaurant_id, name, sort_order)
                values ($1, $2, $3) returning id
                """,
                restaurant_id,
                category_name,
                category_order,
            )

            for item_order, (name, description, price, is_veg, rating, rating_count) in enumerate(items):
                item_id = await connection.fetchval(
                    """
                    insert into menu_items
                      (restaurant_id, category_id, name, description, price_paise,
                       is_veg, rating, rating_count, sort_order)
                    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    returning id
                    """,
                    restaurant_id,
                    category_id,
                    name,
                    description,
                    price,
                    is_veg,
                    rating,
                    rating_count,
                    item_order,
                )

                if first_item_id is None:
                    first_item_id = item_id

        for addon_order, (addon_name, addon_price) in enumerate(entry["addons"]):
            await connection.execute(
                """
                insert into menu_item_addons (menu_item_id, name, price_paise, sort_order)
                values ($1, $2, $3, $4)
                """,
                first_item_id,
                addon_name,
                addon_price,
                addon_order,
            )

        print(f"Added {entry['name']}")

    for offer in OFFERS:
        await connection.execute(
            """
            insert into offers
              (name, code, type, percent_off, flat_off_paise, max_discount_paise,
               min_order_paise, first_order_only)
            values ($1, $2, $3, $4, $5, $6, $7, $8)
            on conflict do nothing
            """,
            offer["name"],
            offer["code"],
            offer["type"],
            offer.get("percent_off"),
            offer.get("flat_off_paise"),
            offer.get("max_discount_paise"),
            offer["min_order_paise"],
            offer["first_order_only"],
        )

    print(f"Added {len(OFFERS)} offers")


async def main() -> None:
    settings = get_settings()

    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured")

    if settings.is_production:
        raise RuntimeError("Refusing to seed a production database")

    connection = await asyncpg.connect(dsn=settings.database_url)

    try:
        async with connection.transaction():
            await seed(connection, reset="--reset" in sys.argv)
    finally:
        await connection.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:  # noqa: BLE001 - top-level CLI reporting
        print(error)
        sys.exit(1)
