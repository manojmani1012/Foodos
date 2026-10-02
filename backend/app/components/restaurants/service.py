"""Restaurant and menu browsing.

Customers only ever see active restaurants; pending, suspended and rejected ones
are invisible here and only reachable through the admin APIs.
"""

import uuid
from typing import Any, Optional

from ...database import fetch, fetchrow, fetchval
from ...errors import not_found
from .schemas import (
    MenuAddon,
    MenuCategory,
    MenuItem,
    Offer,
    RestaurantDetail,
    RestaurantSummary,
)

# Until delivery zones and distance are wired up in a later phase, every
# restaurant quotes the same fee. The cart API becomes the authority on price.
DEFAULT_DELIVERY_FEE_PAISE = 2000

# Riding time added on top of the kitchen's own preparation estimate.
RIDE_ALLOWANCE_MINUTES = 10

# How close a word has to be to count as a match. 0.3 is pg_trgm's own
# default: it accepts briyani/biryani and piza/pizza while scoring
# genuinely unrelated words at zero.
SEARCH_SIMILARITY = 0.3

# A dish match counts for less than a name match. Searching "biryani" should put
# "Biryani House" above a place that merely has biryani on the menu, even when
# that place is better rated - the name is the stronger signal of what was meant.
DISH_MATCH_WEIGHT = 0.6


def _to_summary(row: Any, favourite_ids: set[uuid.UUID]) -> RestaurantSummary:
    prep = row["avg_prep_minutes"]

    return RestaurantSummary(
        id=str(row["id"]),
        name=row["name"],
        cuisines=list(row["cuisines"] or []),
        rating=float(row["rating"]),
        ratingCount=row["rating_count"],
        imageUrl=row["image_url"],
        isVeg=row["is_veg"],
        addressLine=row["address_line"],
        city=row["city"],
        etaMinMinutes=prep,
        etaMaxMinutes=prep + RIDE_ALLOWANCE_MINUTES,
        deliveryFeePaise=DEFAULT_DELIVERY_FEE_PAISE,
        isAcceptingOrders=row["is_accepting_orders"],
        isFavourite=row["id"] in favourite_ids,
    )


async def _favourite_ids(user_id: Optional[uuid.UUID]) -> set[uuid.UUID]:
    if user_id is None:
        return set()

    rows = await fetch("select restaurant_id from favourites where user_id = $1", user_id)

    return {row["restaurant_id"] for row in rows}


async def list_restaurants(
    *,
    city: Optional[str] = None,
    search: Optional[str] = None,
    cuisine: Optional[str] = None,
    veg_only: bool = False,
    limit: int = 20,
    offset: int = 0,
    user_id: Optional[uuid.UUID] = None,
) -> dict[str, Any]:
    conditions = ["r.status = 'active'"]
    args: list[Any] = []

    def placeholder(value: Any) -> str:
        args.append(value)
        return f"${len(args)}"

    if city:
        conditions.append(f"r.city ilike {placeholder(city)}")

    relevance = None

    if search:
        # Matches the restaurant name, its cuisines, or anything on its menu, so
        # "biryani" finds both "The Biryani House" and anywhere serving a
        # biryani dish.
        #
        # Spelling varies — briyani/biryani, panner/paneer — so plain substring
        # matching is paired with trigram similarity.
        #
        # strict_word_similarity, not word_similarity: the loose version matches
        # on a shared prefix alone, which scored "dosa" against "Double Cheese
        # Burger" at 0.40 and put a burger shop in the dosa results. The strict
        # version aligns to word boundaries, dropping that pair to 0.20 while
        # "briyani" against "The Biryani House" still scores 0.33.
        like = placeholder(f"%{search}%")
        term = placeholder(search)

        conditions.append(
            f"""(
              r.name ilike {like}
              or strict_word_similarity({term}, r.name) >= {SEARCH_SIMILARITY}
              or exists (
                select 1 from unnest(r.cuisines) as c
                where c ilike {like} or strict_word_similarity({term}, c) >= {SEARCH_SIMILARITY}
              )
              or exists (
                select 1 from menu_items mi
                where mi.restaurant_id = r.id and mi.deleted_at is null
                  and (mi.name ilike {like} or strict_word_similarity({term}, mi.name) >= {SEARCH_SIMILARITY})
              )
            )"""
        )

        # Closest name match first, so an exact restaurant beats somewhere that
        # merely sells the dish.
        relevance = (
            f"greatest("
            f"  strict_word_similarity({term}, r.name),"
            f"  {DISH_MATCH_WEIGHT} * coalesce((select max(strict_word_similarity({term}, mi.name))"
            f"    from menu_items mi"
            f"    where mi.restaurant_id = r.id and mi.deleted_at is null), 0)"
            f") desc,"
        )

    if cuisine:
        term = placeholder(f"%{cuisine}%")
        conditions.append(f"exists (select 1 from unnest(r.cuisines) as c where c ilike {term})")

    if veg_only:
        conditions.append("r.is_veg")

    where = " and ".join(conditions)

    total = await fetchval(f"select count(*)::int from restaurants r where {where}", *args)

    rows = await fetch(
        f"""
        select r.id, r.name, r.cuisines, r.rating, r.rating_count, r.image_url, r.is_veg,
               r.address_line, r.city, r.avg_prep_minutes, r.is_accepting_orders
        from restaurants r
        where {where}
        order by r.is_accepting_orders desc, {relevance or ""} r.rating desc, r.name
        limit ${len(args) + 1} offset ${len(args) + 2}
        """,
        *args,
        limit,
        offset,
    )

    favourites = await _favourite_ids(user_id)

    return {
        "restaurants": [_to_summary(row, favourites) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


async def get_restaurant(restaurant_id: str, user_id: Optional[uuid.UUID] = None) -> RestaurantDetail:
    try:
        identifier = uuid.UUID(restaurant_id)
    except (ValueError, TypeError):
        raise not_found("restaurant_not_found", "That restaurant is no longer available")

    row = await fetchrow(
        """
        select r.id, r.name, r.description, r.cuisines, r.rating, r.rating_count, r.image_url,
               r.is_veg, r.address_line, r.city, r.phone, r.avg_prep_minutes,
               r.is_accepting_orders, r.opens_at, r.closes_at
        from restaurants r
        where r.id = $1 and r.status = 'active'
        """,
        identifier,
    )

    if row is None:
        raise not_found("restaurant_not_found", "That restaurant is no longer available")

    favourites = await _favourite_ids(user_id)
    summary = _to_summary(row, favourites)

    # One round trip for the whole menu: the restaurant screen needs every
    # category, item and add-on at once, and mobile networks punish extra calls.
    item_rows = await fetch(
        """
        select i.id, i.name, i.description, i.price_paise, i.image_url, i.is_veg,
               i.is_available, i.rating, i.rating_count, i.sort_order,
               c.id as category_id, c.name as category_name, c.sort_order as category_sort
        from menu_items i
        left join menu_categories c on c.id = i.category_id
        where i.restaurant_id = $1 and i.deleted_at is null
        order by c.sort_order nulls last, c.name, i.sort_order, i.name
        """,
        identifier,
    )

    addon_rows = await fetch(
        """
        select a.id, a.menu_item_id, a.name, a.price_paise, a.is_available
        from menu_item_addons a
        join menu_items i on i.id = a.menu_item_id
        where i.restaurant_id = $1 and i.deleted_at is null
        order by a.sort_order, a.name
        """,
        identifier,
    )

    addons_by_item: dict[Any, list[MenuAddon]] = {}

    for addon in addon_rows:
        addons_by_item.setdefault(addon["menu_item_id"], []).append(
            MenuAddon(
                id=str(addon["id"]),
                name=addon["name"],
                pricePaise=addon["price_paise"],
                isAvailable=addon["is_available"],
            )
        )

    categories: dict[Any, MenuCategory] = {}

    for item in item_rows:
        key = item["category_id"]

        if key not in categories:
            categories[key] = MenuCategory(
                id=str(key) if key else "uncategorised",
                name=item["category_name"] or "More",
                items=[],
            )

        categories[key].items.append(
            MenuItem(
                id=str(item["id"]),
                name=item["name"],
                description=item["description"],
                pricePaise=item["price_paise"],
                imageUrl=item["image_url"],
                isVeg=item["is_veg"],
                isAvailable=item["is_available"],
                rating=float(item["rating"]) if item["rating"] is not None else None,
                ratingCount=item["rating_count"],
                addons=addons_by_item.get(item["id"], []),
            )
        )

    return RestaurantDetail(
        **summary.model_dump(),
        description=row["description"],
        phone=row["phone"],
        opensAt=row["opens_at"].isoformat() if row["opens_at"] else None,
        closesAt=row["closes_at"].isoformat() if row["closes_at"] else None,
        categories=list(categories.values()),
    )


async def list_offers(restaurant_id: Optional[str] = None) -> list[Offer]:
    """Offers shown on the home screen and in the cart.

    Only currently valid ones: active, started, and not expired.
    """
    conditions = [
        "o.is_active",
        "o.valid_from <= now()",
        "(o.valid_until is null or o.valid_until > now())",
    ]
    args: list[Any] = []

    if restaurant_id:
        try:
            args.append(uuid.UUID(restaurant_id))
        except (ValueError, TypeError):
            raise not_found("restaurant_not_found", "That restaurant is no longer available")

        conditions.append("(o.restaurant_id = $1 or o.restaurant_id is null)")
    else:
        conditions.append("o.restaurant_id is null")

    rows = await fetch(
        f"""
        select o.id, o.name, o.code, o.type, o.percent_off, o.flat_off_paise,
               o.max_discount_paise, o.min_order_paise, o.first_order_only, o.restaurant_id
        from offers o
        where {" and ".join(conditions)}
        order by o.first_order_only desc, o.min_order_paise
        """,
        *args,
    )

    return [
        Offer(
            id=str(row["id"]),
            name=row["name"],
            code=row["code"],
            type=row["type"],
            percentOff=float(row["percent_off"]) if row["percent_off"] is not None else None,
            flatOffPaise=row["flat_off_paise"],
            maxDiscountPaise=row["max_discount_paise"],
            minOrderPaise=row["min_order_paise"],
            firstOrderOnly=row["first_order_only"],
            restaurantId=str(row["restaurant_id"]) if row["restaurant_id"] else None,
        )
        for row in rows
    ]


async def list_cuisines(city: Optional[str] = None) -> list[str]:
    """The category chips on the home screen, built from what is actually on the
    platform rather than a hard-coded list."""
    rows = await fetch(
        """
        select distinct unnest(r.cuisines) as cuisine
        from restaurants r
        where r.status = 'active' and ($1::text is null or r.city ilike $1)
        order by cuisine
        """,
        city,
    )

    return [row["cuisine"] for row in rows]


async def set_favourite(user_id: uuid.UUID, restaurant_id: str, favourite: bool) -> bool:
    try:
        identifier = uuid.UUID(restaurant_id)
    except (ValueError, TypeError):
        raise not_found("restaurant_not_found", "That restaurant is no longer available")

    exists = await fetchval(
        "select 1 from restaurants where id = $1 and status = 'active'", identifier
    )

    if not exists:
        raise not_found("restaurant_not_found", "That restaurant is no longer available")

    if favourite:
        await fetchval(
            """
            insert into favourites (user_id, restaurant_id) values ($1, $2)
            on conflict do nothing
            returning 1
            """,
            user_id,
            identifier,
        )
    else:
        await fetchval(
            "delete from favourites where user_id = $1 and restaurant_id = $2 returning 1",
            user_id,
            identifier,
        )

    return favourite


async def list_favourites(user_id: uuid.UUID) -> list[RestaurantSummary]:
    rows = await fetch(
        """
        select r.id, r.name, r.cuisines, r.rating, r.rating_count, r.image_url, r.is_veg,
               r.address_line, r.city, r.avg_prep_minutes, r.is_accepting_orders
        from favourites f
        join restaurants r on r.id = f.restaurant_id
        where f.user_id = $1 and r.status = 'active'
        order by f.created_at desc
        """,
        user_id,
    )

    ids = {row["id"] for row in rows}

    return [_to_summary(row, ids) for row in rows]
