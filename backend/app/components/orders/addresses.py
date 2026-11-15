"""Saved delivery addresses."""

import uuid
from typing import Any, Optional

from ...database import execute, fetch, fetchrow, transaction
from ...errors import not_found


def _clean(value: Optional[str]) -> Optional[str]:
    return (value or "").strip() or None


def _to_dict(row: Any) -> dict:
    return {
        "id": str(row["id"]),
        "label": row["label"],
        "line1": row["line1"],
        "line2": row["line2"],
        "landmark": row["landmark"],
        "city": row["city"],
        "pincode": row["pincode"],
        "latitude": float(row["latitude"]) if row["latitude"] is not None else None,
        "longitude": float(row["longitude"]) if row["longitude"] is not None else None,
        "isDefault": row["is_default"],
    }


async def list_addresses(user_id: uuid.UUID) -> list[dict]:
    rows = await fetch(
        """
        select id, label, line1, line2, landmark, city, pincode, latitude, longitude, is_default
        from customer_addresses
        where user_id = $1
        order by is_default desc, created_at
        """,
        user_id,
    )

    return [_to_dict(row) for row in rows]


async def add_address(user_id: uuid.UUID, body: Any) -> dict:
    async with transaction() as connection:
        # A partial unique index allows only one default per customer, so the
        # previous one is cleared first.
        existing = await connection.fetchval(
            "select count(*) from customer_addresses where user_id = $1", user_id
        )
        make_default = body.isDefault or existing == 0

        if make_default:
            await connection.execute(
                "update customer_addresses set is_default = false where user_id = $1 and is_default",
                user_id,
            )

        row = await connection.fetchrow(
            """
            insert into customer_addresses
              (user_id, label, line1, line2, landmark, city, pincode, latitude, longitude, is_default)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            returning id, label, line1, line2, landmark, city, pincode, latitude, longitude, is_default
            """,
            user_id,
            body.label,
            body.line1.strip(),
            _clean(body.line2),
            _clean(body.landmark),
            body.city.strip(),
            _clean(body.pincode),
            body.latitude,
            body.longitude,
            make_default,
        )

    return _to_dict(row)


async def update_address(user_id: uuid.UUID, address_id: str, body: Any) -> dict:
    """Replaces a saved address, pin included: how an address saved before
    pins were required gets one."""
    try:
        identifier = uuid.UUID(address_id)
    except (ValueError, TypeError):
        raise not_found("address_not_found", "That address is no longer saved")

    async with transaction() as connection:
        owned = await connection.fetchval(
            "select 1 from customer_addresses where id = $1 and user_id = $2 for update", identifier, user_id
        )

        if not owned:
            raise not_found("address_not_found", "That address is no longer saved")

        if body.isDefault:
            await connection.execute(
                "update customer_addresses set is_default = false where user_id = $1 and is_default and id <> $2",
                user_id,
                identifier,
            )

        row = await connection.fetchrow(
            """
            update customer_addresses
            set label = $3, line1 = $4, line2 = $5, landmark = $6, city = $7, pincode = $8,
                latitude = $9, longitude = $10, is_default = is_default or $11
            where id = $1 and user_id = $2
            returning id, label, line1, line2, landmark, city, pincode, latitude, longitude, is_default
            """,
            identifier,
            user_id,
            body.label,
            body.line1.strip(),
            _clean(body.line2),
            _clean(body.landmark),
            body.city.strip(),
            _clean(body.pincode),
            body.latitude,
            body.longitude,
            body.isDefault,
        )

    return _to_dict(row)


async def delete_address(user_id: uuid.UUID, address_id: str) -> None:
    try:
        identifier = uuid.UUID(address_id)
    except (ValueError, TypeError):
        raise not_found("address_not_found", "That address is no longer saved")

    deleted = await fetchrow(
        "delete from customer_addresses where id = $1 and user_id = $2 returning is_default",
        identifier,
        user_id,
    )

    if deleted is None:
        raise not_found("address_not_found", "That address is no longer saved")

    # Promote another address so the customer always has a default to fall back on.
    if deleted["is_default"]:
        await execute(
            """
            update customer_addresses set is_default = true
            where id = (
              select id from customer_addresses where user_id = $1 order by created_at limit 1
            )
            """,
            user_id,
        )
