"""Customers, from the Foodos side: looking someone up when they call, and
blocking an account that is abusing the platform.

Blocking is by person, not by app: one phone number is one account, so a
blocked number cannot sign in to any Foodos app. The screens say so before
anyone confirms it.
"""

import uuid
from typing import Optional

from ...database import fetch, fetchrow, fetchval, transaction
from ...errors import forbidden, not_found
from ..auth.tokens import revoke_all_sessions_for_user
from . import audit


def as_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found("customer_not_found", "That customer could not be found")


async def list_customers(search: Optional[str], status: Optional[str], limit: int, offset: int) -> dict:
    conditions, args = ["exists (select 1 from user_roles ur where ur.user_id = u.id and ur.role = 'customer')"], []

    if search:
        args.append(f"%{search.strip()}%")
        clause = f"(u.full_name ilike ${len(args)} or u.email ilike ${len(args)}"
        digits = "".join(ch for ch in search if ch.isdigit())

        if len(digits) >= 4:
            args.append(f"%{digits}%")
            clause += f" or u.phone like ${len(args)}"

        conditions.append(clause + ")")

    if status:
        args.append(status)
        conditions.append(f"u.status = ${len(args)}")

    where = f"where {' and '.join(conditions)}"
    total = await fetchval(f"select count(*)::int from users u {where}", *args)

    rows = await fetch(
        f"""
        select u.id, u.full_name, u.phone, u.email, u.status, u.created_at, u.last_login_at,
               coalesce(s.orders, 0) as orders, coalesce(s.spent, 0) as spent, s.last_order_at
        from users u
        left join lateral (
          select count(*) filter (where o.status <> 'cancelled')::int as orders,
                 coalesce(sum(o.total_paise) filter (where o.status = 'delivered'), 0)::bigint as spent,
                 max(o.placed_at) as last_order_at
          from orders o where o.customer_id = u.id
        ) s on true
        {where}
        order by s.last_order_at desc nulls last, u.created_at desc
        limit ${len(args) + 1} offset ${len(args) + 2}
        """,
        *args,
        limit,
        offset,
    )

    return {
        "total": total,
        "customers": [
            {
                "id": str(row["id"]),
                "name": row["full_name"],
                "phone": row["phone"],
                "email": row["email"],
                "blocked": row["status"] == "blocked",
                "orders": row["orders"],
                "spentPaise": int(row["spent"]),
                "lastOrderAt": row["last_order_at"].isoformat() if row["last_order_at"] else None,
                "joinedAt": row["created_at"].isoformat(),
            }
            for row in rows
        ],
    }


async def get_customer(customer_id: str) -> dict:
    identifier = as_uuid(customer_id)

    row = await fetchrow(
        """
        select u.id, u.full_name, u.phone, u.email, u.status, u.created_at, u.last_login_at,
               array(select role from user_roles where user_id = u.id order by role) as roles
        from users u
        where u.id = $1
          and exists (select 1 from user_roles ur where ur.user_id = u.id and ur.role = 'customer')
        """,
        identifier,
    )

    if row is None:
        raise not_found("customer_not_found", "That customer could not be found")

    stats = await fetchrow(
        """
        select count(*)::int as placed,
               count(*) filter (where status = 'delivered')::int as delivered,
               count(*) filter (where status = 'cancelled')::int as cancelled,
               count(*) filter (where status = 'cancelled' and cancelled_by = 'customer')::int as cancelled_by_them,
               coalesce(sum(total_paise) filter (where status = 'delivered'), 0)::bigint as spent
        from orders where customer_id = $1
        """,
        identifier,
    )

    addresses = await fetch(
        """
        select label, line1, line2, city, pincode, is_default
        from customer_addresses where user_id = $1
        order by is_default desc, created_at
        """,
        identifier,
    )

    recent = await fetch(
        """
        select o.id, o.order_number, o.status, o.total_paise, o.payment_method, o.placed_at,
               r.name as restaurant_name
        from orders o join restaurants r on r.id = o.restaurant_id
        where o.customer_id = $1
        order by o.placed_at desc
        limit 20
        """,
        identifier,
    )

    roles = list(row["roles"])

    return {
        "id": str(row["id"]),
        "name": row["full_name"],
        "phone": row["phone"],
        "email": row["email"],
        "blocked": row["status"] == "blocked",
        "joinedAt": row["created_at"].isoformat(),
        "lastSignedInAt": row["last_login_at"].isoformat() if row["last_login_at"] else None,
        # The same number may also be a rider or a restaurant owner; blocking
        # it stops those apps too.
        "otherRoles": [role for role in roles if role != "customer"],
        "stats": {
            "orders": stats["placed"],
            "delivered": stats["delivered"],
            "cancelled": stats["cancelled"],
            "cancelledByCustomer": stats["cancelled_by_them"],
            "spentPaise": int(stats["spent"]),
        },
        "addresses": [
            {
                "label": a["label"],
                "address": ", ".join(filter(None, [a["line1"], a["line2"], a["city"], a["pincode"]])),
                "isDefault": a["is_default"],
            }
            for a in addresses
        ],
        "recentOrders": [
            {
                "id": str(o["id"]),
                "orderNumber": o["order_number"],
                "status": o["status"],
                "totalPaise": o["total_paise"],
                "paymentMethod": o["payment_method"],
                "placedAt": o["placed_at"].isoformat(),
                "restaurant": o["restaurant_name"],
            }
            for o in recent
        ],
    }


async def set_blocked(
    customer_id: str, blocked: bool, reason: Optional[str], actor_id: uuid.UUID, ip: Optional[str]
) -> dict:
    identifier = as_uuid(customer_id)

    async with transaction() as connection:
        row = await connection.fetchrow(
            """
            select u.status, u.full_name, u.phone,
                   array(select role from user_roles where user_id = u.id) as roles
            from users u where u.id = $1
            for update of u
            """,
            identifier,
        )

        if row is None or "customer" not in row["roles"]:
            raise not_found("customer_not_found", "That customer could not be found")

        if {"admin", "super_admin"} & set(row["roles"]):
            raise forbidden("cannot_block_admin", "Admin accounts cannot be blocked from here")

        await connection.execute(
            "update users set status = $2 where id = $1", identifier, "blocked" if blocked else "active"
        )

        if blocked:
            # A blocked rider must not stay online and keep receiving offers.
            await connection.execute(
                "update delivery_partners set is_online = false where user_id = $1", identifier
            )

        await audit.record(
            actor_id,
            "Blocked account" if blocked else "Unblocked account",
            "Customers",
            "customer",
            identifier,
            {"name": row["full_name"], "phone": row["phone"], "reason": reason},
            ip,
            connection,
        )

    if blocked:
        # Sessions end at once rather than when the access token runs out.
        await revoke_all_sessions_for_user(identifier)

    return await get_customer(str(identifier))
