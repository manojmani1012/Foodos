"""Photo proof for refunds, and refunds a restaurant asks for.

A photo is uploaded first, for one order, and then named in the refund or the
request. Photos are private: only signed-in staff can open them.

A restaurant cannot move money itself. It asks for part of a delivered order to
be refunded for a food problem, with photos; Foodos staff look at them and
approve (the refund is made and comes off the restaurant's next payout) or
reject with a reason the restaurant sees.
"""

import uuid
from typing import Any, Optional

from ...database import execute, fetch, fetchrow, fetchval, transaction
from ...errors import AppError, bad_request, conflict, not_found
from ..admin import audit
from ..media.service import store_image
from . import refunds

# How long after delivery a restaurant may ask for a refund.
REQUEST_DAYS = 7
MAX_PHOTOS = 5
# Photos that may be waiting, not yet used, for one order and person.
MAX_UNUSED_PHOTOS = 10


def _id(value: str, code: str, message: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found(code, message)


async def add_photo(order_id: uuid.UUID, user_id: uuid.UUID, data: bytes) -> dict:
    unused = await fetchval(
        """
        select count(*)::int from refund_photos
        where order_id = $1 and uploaded_by = $2 and refund_id is null and request_id is null
        """,
        order_id,
        user_id,
    )

    if unused >= MAX_UNUSED_PHOTOS:
        raise conflict("too_many_photos", "There are already many photos waiting for this order. Use or retry those")

    url = await store_image(user_id, data, private=True)
    photo_id = await fetchval(
        "insert into refund_photos (order_id, media_id, uploaded_by) values ($1, $2, $3) returning id",
        order_id,
        uuid.UUID(url.rsplit("/", 1)[1]),
        user_id,
    )

    return {"id": str(photo_id)}


async def claim(connection: Any, photo_ids: list[str], order_id: uuid.UUID, user_id: uuid.UUID) -> list[uuid.UUID]:
    """The ids of photos this person uploaded for this order and has not used."""
    if len(photo_ids) > MAX_PHOTOS:
        raise bad_request("too_many_photos", f"Attach up to {MAX_PHOTOS} photos")

    ids = list({_id(value, "photo_not_found", "That photo could not be found") for value in photo_ids})

    if not ids:
        return []

    rows = await connection.fetch(
        """
        select id from refund_photos
        where id = any($1::uuid[]) and order_id = $2 and uploaded_by = $3
          and refund_id is null and request_id is null
        for update
        """,
        ids,
        order_id,
        user_id,
    )

    if len(rows) != len(ids):
        raise bad_request("photo_not_found", "A photo is missing or already used. Add the photos again")

    return ids


async def photo_file(photo_id: str) -> Optional[Any]:
    identifier = _id(photo_id, "photo_not_found", "That photo could not be found")

    return await fetchrow(
        "select m.content_type, m.data from refund_photos p join media m on m.id = p.media_id where p.id = $1",
        identifier,
    )


# --- Requests from a restaurant ---------------------------------------------

REQUEST_SELECT = """
    select q.id, q.order_id, q.amount_paise, q.reason, q.status, q.reject_reason, q.created_at, q.reviewed_at,
           q.restaurant_id, o.order_number, o.total_paise, o.delivered_at, r.name as restaurant_name,
           f.amount_paise as refunded_paise,
           array(select p.id from refund_photos p where p.request_id = q.id order by p.created_at) as photo_ids
    from refund_requests q
    join orders o on o.id = q.order_id
    join restaurants r on r.id = q.restaurant_id
    left join refunds f on f.id = q.refund_id
"""


def request_to_dict(row: Any) -> dict:
    return {
        "id": str(row["id"]),
        "orderId": str(row["order_id"]),
        "orderNumber": row["order_number"],
        "restaurantId": str(row["restaurant_id"]),
        "restaurantName": row["restaurant_name"],
        "orderTotalPaise": row["total_paise"],
        "amountPaise": row["amount_paise"],
        # What was actually refunded, which staff may have lowered.
        "refundedPaise": row["refunded_paise"],
        "reason": row["reason"],
        "status": row["status"],
        "rejectReason": row["reject_reason"],
        "photoIds": [str(value) for value in row["photo_ids"]],
        "createdAt": row["created_at"].isoformat(),
        "reviewedAt": row["reviewed_at"].isoformat() if row["reviewed_at"] else None,
    }


async def _refundable(connection: Any, order_id: uuid.UUID, total: int) -> int:
    value = connection.fetchval if connection else fetchval

    return total - await value(
        "select coalesce(sum(amount_paise), 0)::int from refunds where order_id = $1 and status <> 'failed'", order_id
    )


async def _own_order(order_id: str, restaurant_id: uuid.UUID, connection: Any = None) -> Any:
    identifier = _id(order_id, "order_not_found", "That order could not be found")
    query = f"""
        select id, status, total_paise, delivered_at,
               coalesce(delivered_at > now() - interval '{REQUEST_DAYS} days', false) as recent
        from orders where id = $1 and restaurant_id = $2
    """
    row = await (
        connection.fetchrow(query + " for update", identifier, restaurant_id)
        if connection
        else fetchrow(query, identifier, restaurant_id)
    )

    if row is None:
        raise not_found("order_not_found", "That order could not be found")

    return row


def _check_open(order: Any) -> None:
    if order["status"] != "delivered":
        raise conflict("order_not_delivered", "A refund can be asked for once the order is delivered")

    if not order["recent"]:
        raise conflict("refund_window_closed", f"A refund can be asked for up to {REQUEST_DAYS} days after delivery")


async def for_restaurant(order_id: str, restaurant_id: uuid.UUID) -> dict:
    """What the partner app shows under a delivered order."""
    order = await _own_order(order_id, restaurant_id)
    rows = await fetch(f"{REQUEST_SELECT} where q.order_id = $1 order by q.created_at desc", order["id"])
    left = await _refundable(None, order["id"], order["total_paise"])
    waiting = any(row["status"] == "pending" for row in rows)

    return {
        "canRequest": order["status"] == "delivered" and order["recent"] and left > 0 and not waiting,
        "refundablePaise": max(0, left),
        "windowDays": REQUEST_DAYS,
        "requests": [request_to_dict(row) for row in rows],
    }


async def restaurant_photo(order_id: str, restaurant_id: uuid.UUID, user_id: uuid.UUID, data: bytes) -> dict:
    order = await _own_order(order_id, restaurant_id)
    _check_open(order)

    return await add_photo(order["id"], user_id, data)


async def create_request(
    order_id: str, restaurant_id: uuid.UUID, user_id: uuid.UUID, amount_paise: int, reason: str, photo_ids: list[str]
) -> dict:
    if not photo_ids:
        raise bad_request("photo_required", "Add at least one photo of the problem")

    async with transaction() as connection:
        order = await _own_order(order_id, restaurant_id, connection)
        _check_open(order)
        left = await _refundable(connection, order["id"], order["total_paise"])

        if amount_paise > left:
            raise bad_request("refund_too_large", f"At most Rs {max(0, left) / 100:,.2f} of this order can be refunded")

        if await connection.fetchval(
            "select 1 from refund_requests where order_id = $1 and status = 'pending'", order["id"]
        ):
            raise conflict("refund_request_waiting", "Foodos is already checking a refund for this order")

        ids = await claim(connection, photo_ids, order["id"], user_id)
        request_id = await connection.fetchval(
            """
            insert into refund_requests (order_id, restaurant_id, amount_paise, reason, requested_by)
            values ($1, $2, $3, $4, $5) returning id
            """,
            order["id"],
            restaurant_id,
            amount_paise,
            reason.strip(),
            user_id,
        )
        await connection.execute("update refund_photos set request_id = $2 where id = any($1::uuid[])", ids, request_id)

    return await for_restaurant(order_id, restaurant_id)


async def list_requests(status: str, limit: int = 100) -> dict:
    where = "" if status == "all" else "where q.status = 'pending'"
    order = "asc" if status != "all" else "desc"
    rows = await fetch(f"{REQUEST_SELECT} {where} order by q.created_at {order} limit $1", limit)

    return {"requests": [request_to_dict(row) for row in rows]}


async def pending_count() -> int:
    return await fetchval("select count(*)::int from refund_requests where status = 'pending'")


async def _request(request_id: uuid.UUID) -> dict:
    row = await fetchrow(f"{REQUEST_SELECT} where q.id = $1", request_id)

    if row is None:
        raise not_found("refund_request_not_found", "That refund request could not be found")

    return request_to_dict(row)


async def _take(request_id: uuid.UUID, status: str, actor_id: uuid.UUID, reject_reason: Optional[str]) -> Any:
    """Moves a waiting request to `status`, so only one member of staff can act."""
    row = await fetchrow(
        """
        update refund_requests set status = $2, reviewed_by = $3, reviewed_at = now(), reject_reason = $4
        where id = $1 and status = 'pending'
        returning order_id, amount_paise, reason
        """,
        request_id,
        status,
        actor_id,
        reject_reason,
    )

    if row is None:
        await _request(request_id)
        raise conflict("refund_request_settled", "This request has already been decided")

    return row


async def approve(request_id: str, amount_paise: Optional[int], actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    """Makes the refund, charged to the restaurant. Staff may lower the amount."""
    identifier = _id(request_id, "refund_request_not_found", "That refund request could not be found")
    asked = await _request(identifier)

    if amount_paise is not None and amount_paise > asked["amountPaise"]:
        raise bad_request("amount_above_request", "The restaurant is charged, so refund no more than it asked for")

    row = await _take(identifier, "approved", actor_id, None)

    try:
        done = await refunds.partial_refund(
            row["order_id"],
            amount_paise or row["amount_paise"],
            row["reason"],
            "restaurant",
            actor_id,
            ip,
            issue="food",
            request_id=identifier,
        )
    except AppError:
        # Nothing was refunded, so it waits to be tried again.
        await execute(
            "update refund_requests set status = 'pending', reviewed_by = null, reviewed_at = null where id = $1",
            identifier,
        )
        raise

    await execute("update refund_requests set refund_id = $2 where id = $1", identifier, uuid.UUID(done["refundId"]))

    return await _request(identifier)


async def reject(request_id: str, reason: str, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    identifier = _id(request_id, "refund_request_not_found", "That refund request could not be found")
    reason = reason.strip()
    await _take(identifier, "rejected", actor_id, reason)
    result = await _request(identifier)

    async with transaction() as connection:
        await audit.record(
            actor_id, "Rejected refund request", "Orders", "order", uuid.UUID(result["orderId"]),
            {"orderNumber": result["orderNumber"], "amountPaise": result["amountPaise"], "reason": reason},
            ip, connection,
        )

    return result
