"""Restaurants, from the Foodos side: onboarding, details, going live.

Onboarding is done here rather than by the owner because what a restaurant is
called, where it is and what it cooks decide what customers search for and
where riders are sent. The owner signs in to the restaurant app with the phone
number given here and finds their outlet waiting, then adds the menu and
photos while it is still pending. Customers only see it once it is made live.
"""

import uuid
from typing import Any, Optional

from ...database import fetch, fetchrow, fetchval, transaction
from ...errors import bad_request, conflict, forbidden, not_found
from ..auth.phone import normalize_phone
from . import audit

STATUSES = ("pending", "active", "suspended", "rejected")

# API field -> column, for the parts of a restaurant an admin can edit.
COLUMNS = {
    "name": "name",
    "description": "description",
    "cuisines": "cuisines",
    "addressLine": "address_line",
    "city": "city",
    "pincode": "pincode",
    "latitude": "latitude",
    "longitude": "longitude",
    "phone": "phone",
    "isVeg": "is_veg",
    "fssaiNumber": "fssai_number",
    "gstNumber": "gst_number",
    "commissionPct": "commission_pct",
    "avgPrepMinutes": "avg_prep_minutes",
}

STATUS_ACTIONS = {
    "active": "Made restaurant live",
    "suspended": "Suspended restaurant",
    "rejected": "Rejected restaurant",
}


def as_uuid(value: str, code: str = "restaurant_not_found", message: str = "That restaurant could not be found") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found(code, message)


def _search_digits(search: str) -> Optional[str]:
    digits = "".join(ch for ch in search if ch.isdigit())

    return digits if len(digits) >= 4 else None


async def list_restaurants(status: Optional[str], search: Optional[str], limit: int, offset: int) -> dict:
    conditions, args = [], []

    if search:
        args.append(f"%{search.strip()}%")
        clause = f"(r.name ilike ${len(args)} or r.city ilike ${len(args)} or r.address_line ilike ${len(args)} or u.full_name ilike ${len(args)}"
        digits = _search_digits(search)

        if digits:
            args.append(f"%{digits}%")
            clause += f" or u.phone like ${len(args)}"

        conditions.append(clause + ")")

    # Counts per status respect the search but not the status filter, so the
    # tabs show how many sit behind each one.
    search_where = f"where {' and '.join(conditions)}" if conditions else ""

    counts_rows = await fetch(
        f"""
        select r.status, count(*)::int as n
        from restaurants r join users u on u.id = r.owner_id
        {search_where}
        group by r.status
        """,
        *args,
    )
    counts = {status_name: 0 for status_name in STATUSES}

    for row in counts_rows:
        counts[row["status"]] = row["n"]

    counts["all"] = sum(counts.values())

    if status:
        args.append(status)
        conditions.append(f"r.status = ${len(args)}")

    where = f"where {' and '.join(conditions)}" if conditions else ""
    total = await fetchval(
        f"select count(*)::int from restaurants r join users u on u.id = r.owner_id {where}", *args
    )

    rows = await fetch(
        f"""
        select r.id, r.name, r.cuisines, r.address_line, r.city, r.status, r.is_accepting_orders,
               r.rating, r.rating_count, r.commission_pct, r.image_url, r.created_at,
               r.latitude is not null as has_location,
               u.full_name as owner_name, u.phone as owner_phone,
               (select count(*)::int from menu_items m where m.restaurant_id = r.id and m.deleted_at is null) as menu_items,
               (select count(*)::int from orders o
                 where o.restaurant_id = r.id and o.status = 'delivered'
                   and o.placed_at >= now() - interval '30 days') as delivered_30d
        from restaurants r
        join users u on u.id = r.owner_id
        {where}
        order by case r.status when 'pending' then 0 when 'active' then 1 when 'suspended' then 2 else 3 end,
                 r.created_at desc
        limit ${len(args) + 1} offset ${len(args) + 2}
        """,
        *args,
        limit,
        offset,
    )

    return {
        "total": total,
        "counts": counts,
        "restaurants": [
            {
                "id": str(row["id"]),
                "name": row["name"],
                "cuisines": list(row["cuisines"] or []),
                "area": row["address_line"],
                "city": row["city"],
                "status": row["status"],
                "isAcceptingOrders": row["is_accepting_orders"],
                "rating": float(row["rating"]),
                "ratingCount": row["rating_count"],
                "commissionPct": float(row["commission_pct"]),
                "imageUrl": row["image_url"],
                "hasLocation": row["has_location"],
                "owner": {"name": row["owner_name"], "phone": row["owner_phone"]},
                "menuItems": row["menu_items"],
                "deliveredLast30Days": row["delivered_30d"],
                "createdAt": row["created_at"].isoformat(),
            }
            for row in rows
        ],
    }


async def get_restaurant(restaurant_id: str) -> dict:
    identifier = as_uuid(restaurant_id)

    row = await fetchrow(
        """
        select r.*, u.id as owner_user_id, u.full_name as owner_name, u.phone as owner_phone,
               u.status as owner_status, u.last_login_at as owner_last_login
        from restaurants r
        join users u on u.id = r.owner_id
        where r.id = $1
        """,
        identifier,
    )

    if row is None:
        raise not_found("restaurant_not_found", "That restaurant could not be found")

    menu = await fetchrow(
        """
        select count(*)::int as items,
               count(*) filter (where is_available)::int as available,
               count(*) filter (where image_url is not null)::int as with_photo
        from menu_items
        where restaurant_id = $1 and deleted_at is null
        """,
        identifier,
    )

    orders = await fetchrow(
        """
        select count(*)::int as total,
               count(*) filter (where placed_at >= now() - interval '30 days')::int as last_30,
               count(*) filter (where status = 'delivered' and placed_at >= now() - interval '30 days')::int
                 as delivered_30,
               count(*) filter (where status = 'cancelled' and placed_at >= now() - interval '30 days')::int
                 as cancelled_30,
               coalesce(sum(total_paise) filter (where status = 'delivered' and placed_at >= now() - interval '30 days'), 0)::bigint
                 as delivered_paise_30
        from orders
        where restaurant_id = $1
        """,
        identifier,
    )

    recent = await fetch(
        """
        select o.id, o.order_number, o.status, o.total_paise, o.placed_at, u.full_name as customer_name
        from orders o
        join users u on u.id = o.customer_id
        where o.restaurant_id = $1
        order by o.placed_at desc
        limit 10
        """,
        identifier,
    )

    has_location = row["latitude"] is not None

    return {
        "id": str(row["id"]),
        "name": row["name"],
        "description": row["description"],
        "cuisines": list(row["cuisines"] or []),
        "addressLine": row["address_line"],
        "city": row["city"],
        "pincode": row["pincode"],
        "latitude": float(row["latitude"]) if has_location else None,
        "longitude": float(row["longitude"]) if has_location else None,
        "phone": row["phone"],
        "imageUrl": row["image_url"],
        "isVeg": row["is_veg"],
        "fssaiNumber": row["fssai_number"],
        "gstNumber": row["gst_number"],
        "commissionPct": float(row["commission_pct"]),
        "avgPrepMinutes": row["avg_prep_minutes"],
        "rating": float(row["rating"]),
        "ratingCount": row["rating_count"],
        "status": row["status"],
        "isAcceptingOrders": row["is_accepting_orders"],
        "opensAt": row["opens_at"].isoformat(timespec="minutes") if row["opens_at"] else None,
        "closesAt": row["closes_at"].isoformat(timespec="minutes") if row["closes_at"] else None,
        "createdAt": row["created_at"].isoformat(),
        "owner": {
            "id": str(row["owner_user_id"]),
            "name": row["owner_name"],
            "phone": row["owner_phone"],
            "status": row["owner_status"],
            "lastSignedInAt": row["owner_last_login"].isoformat() if row["owner_last_login"] else None,
        },
        "menu": {"items": menu["items"], "available": menu["available"], "withPhoto": menu["with_photo"]},
        "orders": {
            "total": orders["total"],
            "last30Days": orders["last_30"],
            "deliveredLast30Days": orders["delivered_30"],
            "cancelledLast30Days": orders["cancelled_30"],
            "deliveredPaiseLast30Days": int(orders["delivered_paise_30"]),
        },
        # What still stands between this outlet and its first order.
        "checklist": {
            "ownerSignedIn": row["owner_last_login"] is not None,
            "hasMenu": menu["available"] > 0,
            "hasLocation": has_location,
            "hasCoverPhoto": row["image_url"] is not None,
            "hasFssai": row["fssai_number"] is not None,
        },
        "recentOrders": [
            {
                "id": str(order["id"]),
                "orderNumber": order["order_number"],
                "status": order["status"],
                "totalPaise": order["total_paise"],
                "placedAt": order["placed_at"].isoformat(),
                "customerName": order["customer_name"],
            }
            for order in recent
        ],
    }


async def create_restaurant(body: Any, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    owner_phone = normalize_phone(body.ownerPhone)

    async with transaction() as connection:
        owner = await connection.fetchrow(
            "select id, full_name, status from users where phone = $1 for update", owner_phone
        )

        if owner is not None and owner["status"] == "blocked":
            raise forbidden("owner_blocked", "That phone number is blocked. Unblock it under Customers first")

        if owner is None:
            owner_id = await connection.fetchval(
                "insert into users (phone, full_name) values ($1, $2) returning id",
                owner_phone,
                body.ownerName.strip(),
            )
        else:
            owner_id = owner["id"]

            existing = await connection.fetchrow(
                "select name from restaurants where owner_id = $1 limit 1", owner_id
            )

            # The restaurant app signs an owner in to one outlet. A second one
            # on the same number would be unreachable, so it is refused.
            if existing is not None:
                raise conflict(
                    "owner_has_restaurant",
                    f"This number already owns {existing['name']}. Use a different phone number for each outlet",
                )

            if not owner["full_name"]:
                await connection.execute(
                    "update users set full_name = $2 where id = $1", owner_id, body.ownerName.strip()
                )

        await connection.execute(
            "insert into user_roles (user_id, role) values ($1, 'restaurant_owner') on conflict do nothing",
            owner_id,
        )

        restaurant_id = await connection.fetchval(
            """
            insert into restaurants
              (owner_id, name, description, cuisines, address_line, city, pincode, latitude, longitude,
               phone, is_veg, fssai_number, gst_number, commission_pct, avg_prep_minutes, status)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'pending')
            returning id
            """,
            owner_id,
            body.name.strip(),
            body.description,
            body.cuisines,
            body.addressLine.strip(),
            body.city.strip(),
            body.pincode,
            body.latitude,
            body.longitude,
            body.phone,
            body.isVeg,
            body.fssaiNumber,
            body.gstNumber,
            body.commissionPct,
            body.avgPrepMinutes,
        )

        await audit.record(
            actor_id,
            "Added restaurant",
            "Restaurants",
            "restaurant",
            restaurant_id,
            {"name": body.name.strip(), "ownerPhone": owner_phone},
            ip,
            connection,
        )

    return await get_restaurant(str(restaurant_id))


async def update_restaurant(restaurant_id: str, body: Any, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    identifier = as_uuid(restaurant_id)
    changes = body.model_dump(exclude_unset=True)

    # Name, address, city and cuisines cannot be emptied, only replaced.
    for required in ("name", "addressLine", "city", "cuisines", "isVeg", "commissionPct", "avgPrepMinutes"):
        if required in changes and changes[required] is None:
            raise bad_request("field_required", f"{required} cannot be empty")

    async with transaction() as connection:
        current = await connection.fetchrow(
            "select id, owner_id from restaurants where id = $1 for update", identifier
        )

        if current is None:
            raise not_found("restaurant_not_found", "That restaurant could not be found")

        assignments, args = [], [identifier]

        for field, column in COLUMNS.items():
            if field in changes:
                value = changes[field]
                args.append(value.strip() if isinstance(value, str) else value)
                assignments.append(f"{column} = ${len(args)}")

        if assignments:
            await connection.execute(
                f"update restaurants set {', '.join(assignments)} where id = $1", *args
            )

        if changes.get("ownerName"):
            await connection.execute(
                "update users set full_name = $2 where id = $1", current["owner_id"], changes["ownerName"].strip()
            )

        if changes:
            await audit.record(
                actor_id,
                "Edited restaurant",
                "Restaurants",
                "restaurant",
                identifier,
                {"fields": sorted(changes.keys())},
                ip,
                connection,
            )

    return await get_restaurant(str(identifier))


async def set_status(
    restaurant_id: str, status: str, reason: Optional[str], actor_id: uuid.UUID, ip: Optional[str]
) -> dict:
    identifier = as_uuid(restaurant_id)

    async with transaction() as connection:
        current = await connection.fetchrow(
            "select status, name from restaurants where id = $1 for update", identifier
        )

        if current is None:
            raise not_found("restaurant_not_found", "That restaurant could not be found")

        if current["status"] == status:
            raise conflict("status_unchanged", f"{current['name']} is already {status}")

        if status == "active":
            available = await connection.fetchval(
                """
                select count(*)::int from menu_items
                where restaurant_id = $1 and deleted_at is null and is_available
                """,
                identifier,
            )

            # Live with nothing to order would show customers an empty page.
            if not available:
                raise conflict(
                    "menu_empty",
                    "This restaurant has no dishes yet. The owner adds the menu in the restaurant app before it can go live",
                )

        await connection.execute("update restaurants set status = $2 where id = $1", identifier, status)

        await audit.record(
            actor_id,
            STATUS_ACTIONS[status],
            "Restaurants",
            "restaurant",
            identifier,
            {"name": current["name"], "from": current["status"], "to": status, "reason": reason},
            ip,
            connection,
        )

    return await get_restaurant(str(identifier))


async def menu(restaurant_id: str) -> list[dict]:
    identifier = as_uuid(restaurant_id)

    exists = await fetchval("select 1 from restaurants where id = $1", identifier)

    if not exists:
        raise not_found("restaurant_not_found", "That restaurant could not be found")

    rows = await fetch(
        """
        select m.id, m.name, m.description, m.price_paise, m.image_url, m.is_veg, m.is_available,
               c.id as category_id, c.name as category_name, c.sort_order as category_order,
               (select count(*)::int from menu_item_addons a where a.menu_item_id = m.id) as addons
        from menu_items m
        left join menu_categories c on c.id = m.category_id
        where m.restaurant_id = $1 and m.deleted_at is null
        order by c.sort_order nulls last, c.name nulls last, m.sort_order, m.name
        """,
        identifier,
    )

    categories: dict[Any, dict] = {}

    for row in rows:
        key = row["category_id"]

        if key not in categories:
            categories[key] = {
                "id": str(key) if key else None,
                "name": row["category_name"] or "Uncategorised",
                "items": [],
            }

        categories[key]["items"].append(
            {
                "id": str(row["id"]),
                "name": row["name"],
                "description": row["description"],
                "pricePaise": row["price_paise"],
                "imageUrl": row["image_url"],
                "isVeg": row["is_veg"],
                "isAvailable": row["is_available"],
                "addons": row["addons"],
            }
        )

    return list(categories.values())
