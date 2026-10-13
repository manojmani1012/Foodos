"""Menu management for the restaurant owner.

Items are never hard-deleted. Past orders reference them, and an order must keep
reading correctly years later, so removal is a `deleted_at` stamp and the item
simply stops appearing on the menu.
"""

import uuid
from typing import Any, Optional

from ...database import fetch, fetchrow, fetchval, transaction
from ...errors import bad_request, conflict, not_found
from ..media import service as media


def _item_to_dict(row: Any, addons: Optional[list[dict]] = None) -> dict:
    return {
        "id": str(row["id"]),
        "categoryId": str(row["category_id"]) if row["category_id"] else None,
        "name": row["name"],
        "description": row["description"],
        "pricePaise": row["price_paise"],
        "imageUrl": row["image_url"],
        "isVeg": row["is_veg"],
        "isAvailable": row["is_available"],
        "rating": float(row["rating"]) if row["rating"] is not None else None,
        "ratingCount": row["rating_count"],
        "sortOrder": row["sort_order"],
        "addons": addons or [],
    }


async def _as_uuid(value: str, message: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found("not_found", message)


async def list_menu(restaurant_id: Any) -> dict:
    categories = await fetch(
        """
        select id, name, sort_order
        from menu_categories
        where restaurant_id = $1
        order by sort_order, name
        """,
        restaurant_id,
    )

    items = await fetch(
        """
        select id, category_id, name, description, price_paise, image_url, is_veg,
               is_available, rating, rating_count, sort_order
        from menu_items
        where restaurant_id = $1 and deleted_at is null
        order by sort_order, name
        """,
        restaurant_id,
    )

    addon_rows = await fetch(
        """
        select a.id, a.menu_item_id, a.name, a.price_paise, a.is_available
        from menu_item_addons a
        join menu_items i on i.id = a.menu_item_id
        where i.restaurant_id = $1 and i.deleted_at is null
        order by a.sort_order, a.name
        """,
        restaurant_id,
    )

    addons_by_item: dict[Any, list[dict]] = {}

    for addon in addon_rows:
        addons_by_item.setdefault(addon["menu_item_id"], []).append(
            {
                "id": str(addon["id"]),
                "name": addon["name"],
                "pricePaise": addon["price_paise"],
                "isAvailable": addon["is_available"],
            }
        )

    return {
        "categories": [
            {"id": str(c["id"]), "name": c["name"], "sortOrder": c["sort_order"]} for c in categories
        ],
        "items": [_item_to_dict(row, addons_by_item.get(row["id"], [])) for row in items],
    }


async def create_category(restaurant_id: Any, name: str, sort_order: int = 0) -> dict:
    existing = await fetchval(
        "select id from menu_categories where restaurant_id = $1 and lower(name) = lower($2)",
        restaurant_id,
        name,
    )

    if existing:
        raise conflict("category_exists", f'"{name}" is already a category')

    row = await fetchrow(
        """
        insert into menu_categories (restaurant_id, name, sort_order)
        values ($1, $2, $3)
        returning id, name, sort_order
        """,
        restaurant_id,
        name,
        sort_order,
    )

    return {"id": str(row["id"]), "name": row["name"], "sortOrder": row["sort_order"]}


async def _assert_category_belongs(restaurant_id: Any, category_id: Optional[str]) -> Optional[uuid.UUID]:
    if category_id is None:
        return None

    identifier = await _as_uuid(category_id, "That category does not exist")

    owns = await fetchval(
        "select 1 from menu_categories where id = $1 and restaurant_id = $2",
        identifier,
        restaurant_id,
    )

    if not owns:
        raise not_found("category_not_found", "That category does not exist")

    return identifier


async def create_item(restaurant_id: Any, body: Any) -> dict:
    category_id = await _assert_category_belongs(restaurant_id, body.categoryId)

    async with transaction() as connection:
        row = await connection.fetchrow(
            """
            insert into menu_items
              (restaurant_id, category_id, name, description, price_paise, image_url,
               is_veg, is_available, sort_order)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            returning id, category_id, name, description, price_paise, image_url, is_veg,
                      is_available, rating, rating_count, sort_order
            """,
            restaurant_id,
            category_id,
            body.name,
            body.description,
            body.pricePaise,
            body.imageUrl,
            body.isVeg,
            body.isAvailable,
            body.sortOrder,
        )

        addons = []

        for index, addon in enumerate(body.addons or []):
            created = await connection.fetchrow(
                """
                insert into menu_item_addons (menu_item_id, name, price_paise, sort_order)
                values ($1, $2, $3, $4)
                returning id, name, price_paise, is_available
                """,
                row["id"],
                addon.name,
                addon.pricePaise,
                index,
            )
            addons.append(
                {
                    "id": str(created["id"]),
                    "name": created["name"],
                    "pricePaise": created["price_paise"],
                    "isAvailable": created["is_available"],
                }
            )

    return _item_to_dict(row, addons)


async def update_item(restaurant_id: Any, item_id: str, body: Any) -> dict:
    identifier = await _as_uuid(item_id, "That dish is no longer on the menu")

    owns = await fetchval(
        "select 1 from menu_items where id = $1 and restaurant_id = $2 and deleted_at is null",
        identifier,
        restaurant_id,
    )

    if not owns:
        raise not_found("item_not_found", "That dish is no longer on the menu")

    updates = body.model_dump(exclude_unset=True)

    if "categoryId" in updates:
        updates["categoryId"] = await _assert_category_belongs(restaurant_id, updates["categoryId"])

    columns = {
        "categoryId": "category_id",
        "name": "name",
        "description": "description",
        "pricePaise": "price_paise",
        "imageUrl": "image_url",
        "isVeg": "is_veg",
        "isAvailable": "is_available",
        "sortOrder": "sort_order",
    }

    assignments = []
    args: list[Any] = [identifier]

    for field, value in updates.items():
        column = columns.get(field)

        if column is None:
            continue

        args.append(value)
        assignments.append(f"{column} = ${len(args)}")

    if not assignments:
        raise bad_request("nothing_to_update", "No changes were provided")

    row = await fetchrow(
        f"""
        update menu_items set {", ".join(assignments)}
        where id = $1
        returning id, category_id, name, description, price_paise, image_url, is_veg,
                  is_available, rating, rating_count, sort_order
        """,
        *args,
    )

    addons = await fetch(
        """
        select id, name, price_paise, is_available
        from menu_item_addons
        where menu_item_id = $1
        order by sort_order, name
        """,
        identifier,
    )

    return _item_to_dict(
        row,
        [
            {
                "id": str(a["id"]),
                "name": a["name"],
                "pricePaise": a["price_paise"],
                "isAvailable": a["is_available"],
            }
            for a in addons
        ],
    )


async def delete_item(restaurant_id: Any, item_id: str) -> None:
    """Soft delete: the dish leaves the menu but stays readable from past orders."""
    identifier = await _as_uuid(item_id, "That dish is no longer on the menu")

    deleted = await fetchval(
        """
        update menu_items set deleted_at = now()
        where id = $1 and restaurant_id = $2 and deleted_at is null
        returning 1
        """,
        identifier,
        restaurant_id,
    )

    if not deleted:
        raise not_found("item_not_found", "That dish is no longer on the menu")


async def _owned_item_image(restaurant_id: Any, item_id: str) -> tuple[uuid.UUID, Optional[str]]:
    identifier = await _as_uuid(item_id, "That dish is no longer on the menu")

    row = await fetchrow(
        """
        select image_url from menu_items
        where id = $1 and restaurant_id = $2 and deleted_at is null
        """,
        identifier,
        restaurant_id,
    )

    if row is None:
        raise not_found("item_not_found", "That dish is no longer on the menu")

    return identifier, row["image_url"]


async def set_item_image(restaurant_id: Any, owner_id: Any, item_id: str, data: bytes) -> dict:
    """Stores a new dish photo and points the dish at it, removing the old one."""
    # Checked before storing, so a request for someone else's dish never
    # leaves an orphaned image behind.
    identifier, previous_url = await _owned_item_image(restaurant_id, item_id)

    image_url = await media.store_image(owner_id, data)

    await fetchval(
        "update menu_items set image_url = $2 where id = $1 returning 1",
        identifier,
        image_url,
    )

    await media.delete_image(previous_url, owner_id)

    return await _item_by_id(identifier)


async def clear_item_image(restaurant_id: Any, owner_id: Any, item_id: str) -> dict:
    identifier, previous_url = await _owned_item_image(restaurant_id, item_id)

    await fetchval(
        "update menu_items set image_url = null where id = $1 returning 1",
        identifier,
    )

    await media.delete_image(previous_url, owner_id)

    return await _item_by_id(identifier)


async def _item_by_id(identifier: uuid.UUID) -> dict:
    row = await fetchrow(
        """
        select id, category_id, name, description, price_paise, image_url, is_veg,
               is_available, rating, rating_count, sort_order
        from menu_items where id = $1
        """,
        identifier,
    )

    addons = await fetch(
        """
        select id, name, price_paise, is_available
        from menu_item_addons
        where menu_item_id = $1
        order by sort_order, name
        """,
        identifier,
    )

    return _item_to_dict(
        row,
        [
            {
                "id": str(a["id"]),
                "name": a["name"],
                "pricePaise": a["price_paise"],
                "isAvailable": a["is_available"],
            }
            for a in addons
        ],
    )


async def replace_addons(restaurant_id: Any, item_id: str, addons: list) -> dict:
    """Swaps a dish's add-ons for a new list.

    Safe for past orders: an order keeps its own copy of each add-on's name and
    price, so changing or removing one here never alters an old bill.
    """
    identifier, _ = await _owned_item_image(restaurant_id, item_id)

    async with transaction() as connection:
        await connection.execute("delete from menu_item_addons where menu_item_id = $1", identifier)

        for index, addon in enumerate(addons):
            await connection.execute(
                """
                insert into menu_item_addons (menu_item_id, name, price_paise, sort_order)
                values ($1, $2, $3, $4)
                """,
                identifier,
                addon.name.strip(),
                addon.pricePaise,
                index,
            )

    return await _item_by_id(identifier)
