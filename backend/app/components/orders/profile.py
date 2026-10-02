"""Customer profile and account management."""

import uuid
from typing import Any, Optional

from ...database import execute, fetchrow, transaction
from ...errors import conflict, not_found


async def get_profile(user_id: uuid.UUID) -> dict:
    user = await fetchrow(
        """
        select u.id, u.phone, u.email, u.full_name, u.avatar_url, u.created_at,
               (select count(*)::int from orders o
                where o.customer_id = u.id and o.status = 'delivered') as delivered_orders,
               (select count(*)::int from favourites f where f.user_id = u.id) as favourites,
               (select count(*)::int from customer_addresses a where a.user_id = u.id) as addresses
        from users u
        where u.id = $1
        """,
        user_id,
    )

    if user is None:
        raise not_found("user_not_found", "That account no longer exists")

    return {
        "id": str(user["id"]),
        "phone": user["phone"],
        "email": user["email"],
        "fullName": user["full_name"],
        "avatarUrl": user["avatar_url"],
        "memberSince": user["created_at"].isoformat(),
        "stats": {
            "deliveredOrders": user["delivered_orders"],
            "favourites": user["favourites"],
            "addresses": user["addresses"],
        },
    }


async def update_profile(user_id: uuid.UUID, body: Any) -> dict:
    """Only the fields sent are changed, so setting a name cannot blank an email."""
    updates = body.model_dump(exclude_unset=True)
    columns = {"fullName": "full_name", "email": "email", "avatarUrl": "avatar_url"}

    assignments = []
    args: list[Any] = [user_id]

    for field, value in updates.items():
        column = columns.get(field)

        if column is None:
            continue

        if field == "email" and value:
            value = value.strip().lower()

            # The column is unique, so a clash needs a clear message rather than
            # a database error.
            taken = await fetchrow(
                "select 1 from users where email = $1 and id <> $2", value, user_id
            )

            if taken:
                raise conflict("email_taken", "That email is already linked to another account")

        args.append(value)
        assignments.append(f"{column} = ${len(args)}")

    if assignments:
        await execute(f"update users set {', '.join(assignments)} where id = $1", *args)

    return await get_profile(user_id)


async def delete_account(user_id: uuid.UUID) -> None:
    """Removes the person, keeps the business record.

    App stores require in-app account deletion. Orders cannot simply be deleted —
    they are financial records tied to restaurants and settlements — so the
    personal details are cleared and the account is blocked, leaving the order
    history intact but no longer identifying anyone.
    """
    async with transaction() as connection:
        exists = await connection.fetchrow("select 1 from users where id = $1", user_id)

        if exists is None:
            raise not_found("user_not_found", "That account no longer exists")

        # Anything that only serves the person goes.
        await connection.execute("delete from customer_addresses where user_id = $1", user_id)
        await connection.execute("delete from favourites where user_id = $1", user_id)
        await connection.execute("delete from auth_identities where user_id = $1", user_id)
        await connection.execute(
            "update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null",
            user_id,
        )

        # The phone is released so the same number can sign up again later.
        #
        # A row still needs one contact field (users_contact_required), so a
        # placeholder on the reserved .invalid domain takes its place: unique
        # because it carries the user id, and unmistakably not a real address.
        await connection.execute(
            """
            update users
            set phone = null,
                email = 'deleted-' || $1::text || '@deleted.invalid',
                full_name = 'Deleted account',
                avatar_url = null,
                password_hash = null,
                status = 'blocked'
            where id = $1
            """,
            user_id,
        )


async def review_order(user_id: uuid.UUID, order_id: str, rating: int, comment: Optional[str]) -> dict:
    """One review per order, and only once it has been delivered."""
    try:
        identifier = uuid.UUID(order_id)
    except (ValueError, TypeError):
        raise not_found("order_not_found", "That order could not be found")

    order = await fetchrow(
        "select customer_id, restaurant_id, status from orders where id = $1", identifier
    )

    if order is None or order["customer_id"] != user_id:
        raise not_found("order_not_found", "That order could not be found")

    if order["status"] != "delivered":
        raise conflict("order_not_delivered", "You can rate an order once it has been delivered")

    existing = await fetchrow("select 1 from restaurant_reviews where order_id = $1", identifier)

    if existing:
        raise conflict("already_reviewed", "You have already rated this order")

    async with transaction() as connection:
        await connection.execute(
            """
            insert into restaurant_reviews (order_id, restaurant_id, user_id, rating, comment)
            values ($1, $2, $3, $4, $5)
            """,
            identifier,
            order["restaurant_id"],
            user_id,
            rating,
            comment,
        )

        # The restaurant's headline rating is recomputed from its reviews rather
        # than nudged, so it can never drift from the underlying data.
        await connection.execute(
            """
            update restaurants r
            set rating = coalesce(stats.average, 0),
                rating_count = stats.total
            from (
              select round(avg(rating)::numeric, 2) as average, count(*)::int as total
              from restaurant_reviews
              where restaurant_id = $1
            ) as stats
            where r.id = $1
            """,
            order["restaurant_id"],
        )

    return {"orderId": str(identifier), "rating": rating, "comment": comment}


async def get_order_review(user_id: uuid.UUID, order_id: str) -> Optional[dict]:
    try:
        identifier = uuid.UUID(order_id)
    except (ValueError, TypeError):
        return None

    row = await fetchrow(
        "select rating, comment from restaurant_reviews where order_id = $1 and user_id = $2",
        identifier,
        user_id,
    )

    return {"rating": row["rating"], "comment": row["comment"]} if row else None
