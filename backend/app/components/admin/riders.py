"""Delivery partners, from the Foodos side: approval, suspension, details.

A rider who signs up in the delivery app starts as `pending` and cannot go
online. Someone at Foodos checks them (licence, vehicle, a call) and approves
them here. Suspending or rejecting a rider also takes them offline at once; a
delivery already in their hands can still be finished, so food is never
stranded mid-trip.
"""

import uuid
from typing import Any, Optional

from ...database import fetch, fetchrow, fetchval, transaction
from ...errors import conflict, not_found
from . import audit

STATUSES = ("pending", "active", "suspended", "rejected")
CARRYING = ("accepted", "reached_restaurant", "picked_up", "arrived")

STATUS_ACTIONS = {
    "active": "Approved rider",
    "suspended": "Suspended rider",
    "rejected": "Rejected rider",
}


def as_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found("rider_not_found", "That rider could not be found")


async def list_riders(
    status: Optional[str], search: Optional[str], online: Optional[bool], limit: int, offset: int
) -> dict:
    conditions, args = [], []

    if search:
        args.append(f"%{search.strip()}%")
        clause = f"(u.full_name ilike ${len(args)} or p.city ilike ${len(args)} or p.vehicle_number ilike ${len(args)}"
        digits = "".join(ch for ch in search if ch.isdigit())

        if len(digits) >= 4:
            args.append(f"%{digits}%")
            clause += f" or u.phone like ${len(args)}"

        conditions.append(clause + ")")

    search_where = f"where {' and '.join(conditions)}" if conditions else ""

    counts_rows = await fetch(
        f"""
        select p.status, count(*)::int as n
        from delivery_partners p join users u on u.id = p.user_id
        {search_where}
        group by p.status
        """,
        *args,
    )
    counts = {name: 0 for name in STATUSES}

    for row in counts_rows:
        counts[row["status"]] = row["n"]

    counts["all"] = sum(counts.values())

    if status:
        args.append(status)
        conditions.append(f"p.status = ${len(args)}")

    if online is not None:
        args.append(online)
        conditions.append(f"p.is_online = ${len(args)}")

    where = f"where {' and '.join(conditions)}" if conditions else ""
    total = await fetchval(
        f"select count(*)::int from delivery_partners p join users u on u.id = p.user_id {where}", *args
    )

    carrying, limit_at, offset_at = len(args) + 1, len(args) + 2, len(args) + 3

    rows = await fetch(
        f"""
        select p.user_id, p.vehicle_type, p.vehicle_number, p.city, p.status, p.is_online,
               p.last_location_at, p.rating, p.rating_count, p.created_at,
               u.full_name, u.phone, u.status as account_status,
               (select count(*)::int from deliveries d where d.partner_id = p.user_id and d.status = 'delivered')
                 as delivered,
               (select count(*)::int from deliveries d
                 where d.partner_id = p.user_id and d.status = 'delivered'
                   and d.delivered_at >= date_trunc('day', now())) as delivered_today,
               (select o.order_number from deliveries d join orders o on o.id = d.order_id
                 where d.partner_id = p.user_id and d.status = any(${carrying}::text[])
                 order by d.accepted_at desc limit 1) as carrying
        from delivery_partners p
        join users u on u.id = p.user_id
        {where}
        order by case p.status when 'pending' then 0 when 'active' then 1 when 'suspended' then 2 else 3 end,
                 p.is_online desc, p.created_at desc
        limit ${limit_at} offset ${offset_at}
        """,
        *args,
        list(CARRYING),
        limit,
        offset,
    )

    return {
        "total": total,
        "counts": counts,
        "riders": [
            {
                "id": str(row["user_id"]),
                "name": row["full_name"],
                "phone": row["phone"],
                "city": row["city"],
                "vehicleType": row["vehicle_type"],
                "vehicleNumber": row["vehicle_number"],
                "status": row["status"],
                "isOnline": row["is_online"],
                "accountBlocked": row["account_status"] == "blocked",
                "lastSeenAt": row["last_location_at"].isoformat() if row["last_location_at"] else None,
                "rating": float(row["rating"]),
                "ratingCount": row["rating_count"],
                "deliveries": row["delivered"],
                "deliveriesToday": row["delivered_today"],
                "carryingOrder": row["carrying"],
                "joinedAt": row["created_at"].isoformat(),
            }
            for row in rows
        ],
    }


async def get_rider(rider_id: str) -> dict:
    identifier = as_uuid(rider_id)

    row = await fetchrow(
        """
        select p.*, u.full_name, u.phone, u.status as account_status, u.last_login_at, u.created_at as user_created
        from delivery_partners p
        join users u on u.id = p.user_id
        where p.user_id = $1
        """,
        identifier,
    )

    if row is None:
        raise not_found("rider_not_found", "That rider could not be found")

    stats = await fetchrow(
        """
        select
          count(*) filter (where status = 'delivered')::int as delivered,
          count(*) filter (where status = 'delivered' and delivered_at >= now() - interval '7 days')::int as delivered_7,
          coalesce(sum(base_earning_paise + incentive_paise + tip_paise)
            filter (where status = 'delivered' and delivered_at >= now() - interval '7 days'), 0)::bigint as earned_7,
          coalesce(sum(total_distance_km) filter (where status = 'delivered' and delivered_at >= now() - interval '7 days'), 0)::float
            as km_7
        from deliveries
        where partner_id = $1
        """,
        identifier,
    )

    # Cash taken at the door today that the rider is holding for Foodos.
    cash_today = await fetchval(
        """
        select coalesce(sum(o.total_paise), 0)::bigint
        from deliveries d join orders o on o.id = d.order_id
        where d.partner_id = $1 and d.status = 'delivered' and o.payment_method = 'cod'
          and d.delivered_at >= date_trunc('day', now())
        """,
        identifier,
    )

    recent = await fetch(
        """
        select d.id, d.status, d.accepted_at, d.delivered_at, d.total_distance_km,
               d.base_earning_paise + d.incentive_paise + d.tip_paise as earning,
               o.id as order_id, o.order_number, o.payment_method, o.total_paise,
               r.name as restaurant_name
        from deliveries d
        join orders o on o.id = d.order_id
        join restaurants r on r.id = o.restaurant_id
        where d.partner_id = $1
        order by d.accepted_at desc nulls last
        limit 15
        """,
        identifier,
    )

    documents = await fetch(
        """
        select doc_type, file_url, status, rejection_reason, created_at
        from delivery_partner_documents where partner_id = $1 order by doc_type
        """,
        identifier,
    )

    has_location = row["current_latitude"] is not None

    return {
        "id": str(row["user_id"]),
        "name": row["full_name"],
        "phone": row["phone"],
        "city": row["city"],
        "vehicleType": row["vehicle_type"],
        "vehicleNumber": row["vehicle_number"],
        "licenseNumber": row["license_number"],
        "status": row["status"],
        "isOnline": row["is_online"],
        "accountBlocked": row["account_status"] == "blocked",
        "rating": float(row["rating"]),
        "ratingCount": row["rating_count"],
        "joinedAt": row["created_at"].isoformat(),
        "lastSignedInAt": row["last_login_at"].isoformat() if row["last_login_at"] else None,
        "location": {
            "latitude": float(row["current_latitude"]),
            "longitude": float(row["current_longitude"]),
            "updatedAt": row["last_location_at"].isoformat() if row["last_location_at"] else None,
        }
        if has_location
        else None,
        "stats": {
            "deliveries": stats["delivered"],
            "deliveriesLast7Days": stats["delivered_7"],
            "earnedPaiseLast7Days": int(stats["earned_7"]),
            "distanceKmLast7Days": round(stats["km_7"], 1),
            "cashHeldTodayPaise": int(cash_today),
        },
        "documents": [
            {
                "type": doc["doc_type"],
                "url": doc["file_url"],
                "status": doc["status"],
                "rejectionReason": doc["rejection_reason"],
                "uploadedAt": doc["created_at"].isoformat(),
            }
            for doc in documents
        ],
        "recentDeliveries": [
            {
                "id": str(item["id"]),
                "status": item["status"],
                "orderId": str(item["order_id"]),
                "orderNumber": item["order_number"],
                "restaurant": item["restaurant_name"],
                "paymentMethod": item["payment_method"],
                "orderTotalPaise": item["total_paise"],
                "earningPaise": item["earning"],
                "distanceKm": float(item["total_distance_km"]) if item["total_distance_km"] is not None else None,
                "acceptedAt": item["accepted_at"].isoformat() if item["accepted_at"] else None,
                "deliveredAt": item["delivered_at"].isoformat() if item["delivered_at"] else None,
            }
            for item in recent
        ],
    }


async def update_rider(rider_id: str, changes: dict, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    identifier = as_uuid(rider_id)

    async with transaction() as connection:
        exists = await connection.fetchval(
            "select 1 from delivery_partners where user_id = $1 for update", identifier
        )

        if not exists:
            raise not_found("rider_not_found", "That rider could not be found")

        if changes.get("fullName"):
            await connection.execute(
                "update users set full_name = $2 where id = $1", identifier, changes["fullName"].strip()
            )

        columns = {"city": "city", "vehicleType": "vehicle_type", "vehicleNumber": "vehicle_number"}
        assignments, args = [], [identifier]

        for field, column in columns.items():
            if field in changes and (changes[field] is not None or field == "vehicleNumber"):
                value = changes[field]
                args.append(value.strip() if isinstance(value, str) else value)
                assignments.append(f"{column} = ${len(args)}")

        if assignments:
            await connection.execute(
                f"update delivery_partners set {', '.join(assignments)} where user_id = $1", *args
            )

        if changes:
            await audit.record(
                actor_id, "Edited rider", "Riders", "rider", identifier,
                {"fields": sorted(changes.keys())}, ip, connection,
            )

    return await get_rider(str(identifier))


async def set_status(
    rider_id: str, status: str, reason: Optional[str], actor_id: uuid.UUID, ip: Optional[str]
) -> dict:
    identifier = as_uuid(rider_id)

    async with transaction() as connection:
        current = await connection.fetchrow(
            """
            select p.status, p.city, u.full_name
            from delivery_partners p join users u on u.id = p.user_id
            where p.user_id = $1
            for update of p
            """,
            identifier,
        )

        if current is None:
            raise not_found("rider_not_found", "That rider could not be found")

        if current["status"] == status:
            raise conflict("status_unchanged", f"This rider is already {status}")

        # Offers go to riders in the same city; without one a rider would be
        # shown every city's orders.
        if status == "active" and not current["city"]:
            raise conflict("rider_city_missing", "Set the rider's city before approving them")

        await connection.execute(
            """
            update delivery_partners
            set status = $2, is_online = case when $2 = 'active' then is_online else false end
            where user_id = $1
            """,
            identifier,
            status,
        )

        await audit.record(
            actor_id,
            STATUS_ACTIONS[status],
            "Riders",
            "rider",
            identifier,
            {"name": current["full_name"], "from": current["status"], "to": status, "reason": reason},
            ip,
            connection,
        )

    return await get_rider(str(identifier))
