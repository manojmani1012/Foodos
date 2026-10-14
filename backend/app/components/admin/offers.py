"""Coupons and offers: what customers see on the home screen and apply in the
cart. The checkout rules live in orders/pricing.py; this only manages them."""

import uuid
from typing import Any, Optional

import asyncpg

from ...database import fetch, fetchrow, transaction
from ...errors import bad_request, conflict, not_found
from . import audit

COLUMNS = {
    "name": "name",
    "code": "code",
    "type": "type",
    "percentOff": "percent_off",
    "flatOffPaise": "flat_off_paise",
    "maxDiscountPaise": "max_discount_paise",
    "minOrderPaise": "min_order_paise",
    "firstOrderOnly": "first_order_only",
    "restaurantId": "restaurant_id",
    "usageLimit": "usage_limit",
    "perUserLimit": "per_user_limit",
    "validFrom": "valid_from",
    "validUntil": "valid_until",
    "isActive": "is_active",
}

SELECT = """
    select o.*, r.name as restaurant_name,
           (select count(*)::int from offer_redemptions x where x.offer_id = o.id) as redemptions,
           (select coalesce(sum(x.discount_paise), 0)::bigint from offer_redemptions x where x.offer_id = o.id)
             as discount_given,
           now() as checked_at
    from offers o
    left join restaurants r on r.id = o.restaurant_id
"""


def as_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found("offer_not_found", "That offer could not be found")


def _state(row: Any) -> str:
    """What a customer would find right now, in one word."""
    if not row["is_active"]:
        return "paused"

    if row["valid_from"] > row["checked_at"]:
        return "scheduled"

    if row["valid_until"] is not None and row["valid_until"] <= row["checked_at"]:
        return "expired"

    if row["usage_limit"] is not None and row["redemptions"] >= row["usage_limit"]:
        return "used_up"

    return "live"


def _to_dict(row: Any) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "code": row["code"],
        "type": row["type"],
        "percentOff": float(row["percent_off"]) if row["percent_off"] is not None else None,
        "flatOffPaise": row["flat_off_paise"],
        "maxDiscountPaise": row["max_discount_paise"],
        "minOrderPaise": row["min_order_paise"],
        "firstOrderOnly": row["first_order_only"],
        "restaurant": {"id": str(row["restaurant_id"]), "name": row["restaurant_name"]}
        if row["restaurant_id"]
        else None,
        "usageLimit": row["usage_limit"],
        "perUserLimit": row["per_user_limit"],
        "validFrom": row["valid_from"].isoformat(),
        "validUntil": row["valid_until"].isoformat() if row["valid_until"] else None,
        "isActive": row["is_active"],
        "state": _state(row),
        "redemptions": row["redemptions"],
        "discountGivenPaise": int(row["discount_given"]),
        "createdAt": row["created_at"].isoformat(),
    }


async def list_offers() -> list[dict]:
    rows = await fetch(f"{SELECT} order by o.is_active desc, o.created_at desc")

    return [_to_dict(row) for row in rows]


async def _get(identifier: uuid.UUID) -> dict:
    row = await fetchrow(f"{SELECT} where o.id = $1", identifier)

    if row is None:
        raise not_found("offer_not_found", "That offer could not be found")

    return _to_dict(row)


def _check_shape(offer: dict) -> None:
    """The value that goes with each type, checked on the merged result so an
    edit that changes only the type is still caught."""
    kind = offer["type"]

    if kind == "percent" and not offer.get("percent_off"):
        raise bad_request("offer_value_missing", "Enter the percentage off")

    if kind == "flat" and not offer.get("flat_off_paise"):
        raise bad_request("offer_value_missing", "Enter the amount off")

    valid_until = offer.get("valid_until")

    if valid_until is not None and valid_until <= offer["valid_from"]:
        raise bad_request("offer_dates_invalid", "The end date must be after the start date")


def _normalise(values: dict) -> dict:
    """Clears the value fields that do not belong to the type, so a coupon
    changed from percent to flat does not keep a stale percentage."""
    kind = values.get("type")

    if kind == "flat":
        values["percent_off"] = None
        values["max_discount_paise"] = None
    elif kind == "free_delivery":
        values["percent_off"] = None
        values["flat_off_paise"] = None
        values["max_discount_paise"] = None
    elif kind == "percent":
        values["flat_off_paise"] = None

    return values


async def _restaurant_exists(connection: asyncpg.Connection, restaurant_id: Optional[str]) -> Optional[uuid.UUID]:
    if restaurant_id is None:
        return None

    try:
        identifier = uuid.UUID(restaurant_id)
    except ValueError:
        raise bad_request("restaurant_invalid", "Choose the restaurant again")

    if not await connection.fetchval("select 1 from restaurants where id = $1", identifier):
        raise bad_request("restaurant_invalid", "Choose the restaurant again")

    return identifier


async def create_offer(body: Any, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    fields = body.model_dump(exclude_unset=False)
    values = {column: fields.get(field) for field, column in COLUMNS.items()}

    async with transaction() as connection:
        values["restaurant_id"] = await _restaurant_exists(connection, fields.get("restaurantId"))

        if values["valid_from"] is None:
            values["valid_from"] = await connection.fetchval("select now()")

        values = _normalise(values)
        _check_shape(values)

        columns = list(values.keys()) + ["created_by"]
        placeholders = ", ".join(f"${i}" for i in range(1, len(columns) + 1))

        try:
            identifier = await connection.fetchval(
                f"insert into offers ({', '.join(columns)}) values ({placeholders}) returning id",
                *values.values(),
                actor_id,
            )
        except asyncpg.UniqueViolationError:
            raise conflict("offer_code_taken", f"The code {values['code']} is already in use")

        await audit.record(
            actor_id, "Created offer", "Offers", "offer", identifier,
            {"code": values["code"], "name": values["name"]}, ip, connection,
        )

    return await _get(identifier)


async def update_offer(offer_id: str, body: Any, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    identifier = as_uuid(offer_id)
    changes = body.model_dump(exclude_unset=True)

    for required in ("name", "code", "type", "minOrderPaise", "firstOrderOnly", "perUserLimit", "validFrom", "isActive"):
        if required in changes and changes[required] is None:
            raise bad_request("field_required", f"{required} cannot be empty")

    async with transaction() as connection:
        current = await connection.fetchrow("select * from offers where id = $1 for update", identifier)

        if current is None:
            raise not_found("offer_not_found", "That offer could not be found")

        values = {column: current[column] for column in COLUMNS.values()}

        for field, value in changes.items():
            values[COLUMNS[field]] = value

        if "restaurantId" in changes:
            values["restaurant_id"] = await _restaurant_exists(connection, changes["restaurantId"])

        values = _normalise(values)
        _check_shape(values)

        assignments = ", ".join(f"{column} = ${i}" for i, column in enumerate(values.keys(), start=2))

        try:
            await connection.execute(
                f"update offers set {assignments} where id = $1", identifier, *values.values()
            )
        except asyncpg.UniqueViolationError:
            raise conflict("offer_code_taken", f"The code {values['code']} is already in use")

        if changes:
            action = "Edited offer"

            if set(changes) == {"isActive"}:
                action = "Resumed offer" if changes["isActive"] else "Paused offer"

            await audit.record(
                actor_id, action, "Offers", "offer", identifier,
                {"code": values["code"], "fields": sorted(changes.keys())}, ip, connection,
            )

    return await _get(identifier)
