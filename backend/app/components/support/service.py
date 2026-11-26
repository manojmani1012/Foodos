"""Help & support: tickets people raise from the apps, and Foodos's replies.

Anyone signed in to a Foodos app (customer, restaurant owner, delivery
partner) can raise a ticket, optionally about one of their orders, and follow
the conversation. Foodos answers from the admin panel (admin/support.py).
Notes the team marks internal are never shown to the person who raised it.

A resolved ticket reopens when the person writes again; a closed one stays
closed, and they start a new one.
"""

import uuid
from typing import Any, Optional

from ...config import get_settings
from ...database import fetch, fetchrow, fetchval, transaction
from ...errors import conflict, not_found

# What the ticket is about. The apps show the ones that fit them.
TOPICS = {
    "order_late": "Order is late or not delivered",
    "order_wrong": "Wrong or missing items",
    "food_quality": "Food quality",
    "payment_refund": "Payment or refund",
    "delivery_partner": "Delivery partner",
    "payouts": "Payouts and earnings",
    "app_problem": "Problem with the app",
    "account": "My account",
    "other": "Something else",
}

# These need a quick answer: someone is waiting for food or for money.
URGENT_TOPICS = {"order_late", "order_wrong", "payment_refund"}

# Open tickets one person may have at a time, so a stuck app cannot flood support.
MAX_OPEN_TICKETS = 5

OPEN = ("open", "in_progress")

LEGAL_PAGES = {
    "terms": "Terms of Use",
    "privacy": "Privacy Policy",
    "refund": "Refund & Cancellation Policy",
    "delivery": "Delivery Policy",
    "contact": "Contact Us",
}


def _as_uuid(value: Optional[str], code: str = "ticket_not_found", message: str = "That ticket could not be found") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found(code, message)


def info() -> dict:
    """How to reach Foodos, for the apps' Help screens. Phone, email and hours
    are null until they are set."""
    settings = get_settings()

    return {
        "supportPhone": settings.support_phone.strip() or None,
        "supportEmail": settings.support_email.strip() or None,
        "supportHours": settings.support_hours.strip() or None,
        # Paths on the API; each app adds its own server address.
        "policies": [{"key": key, "title": title, "path": f"/legal/{key}"} for key, title in LEGAL_PAGES.items()],
        "topics": [{"key": key, "label": label} for key, label in TOPICS.items()],
    }


async def _check_order(connection: Any, user_id: uuid.UUID, role: str, order_id: str) -> uuid.UUID:
    """The order must be this person's: theirs as a customer, their kitchen's,
    or one they carried."""
    identifier = _as_uuid(order_id, "order_not_found", "That order could not be found")

    owned = await connection.fetchval(
        """
        select 1 from orders o
        join restaurants r on r.id = o.restaurant_id
        left join deliveries d on d.order_id = o.id
        where o.id = $1 and (
          ($3 = 'customer' and o.customer_id = $2)
          or ($3 = 'restaurant_owner' and r.owner_id = $2)
          or ($3 = 'delivery_partner' and d.partner_id = $2)
        )
        """,
        identifier,
        user_id,
        role,
    )

    if not owned:
        raise not_found("order_not_found", "That order could not be found")

    return identifier


async def create_ticket(user_id: uuid.UUID, role: str, topic: str, message: str, order_id: Optional[str]) -> dict:
    async with transaction() as connection:
        # One decision per person at a time, so two quick taps cannot both pass the limit.
        await connection.execute("select pg_advisory_xact_lock(hashtext($1))", f"tickets:{user_id}")

        open_count = await connection.fetchval(
            "select count(*) from support_tickets where raised_by = $1 and status = any($2::text[])",
            user_id,
            list(OPEN),
        )

        if open_count >= MAX_OPEN_TICKETS:
            raise conflict(
                "too_many_open_tickets",
                f"You already have {MAX_OPEN_TICKETS} open tickets. Reply on one of those and Foodos will get back to you",
            )

        order = await _check_order(connection, user_id, role, order_id) if order_id else None

        ticket_id = await connection.fetchval(
            """
            insert into support_tickets (raised_by, raised_by_role, order_id, subject, description, priority)
            values ($1, $2, $3, $4, $5, $6)
            returning id
            """,
            user_id,
            role,
            order,
            TOPICS[topic],
            message,
            "high" if topic in URGENT_TOPICS and order else "medium",
        )

        await connection.execute(
            "insert into ticket_messages (ticket_id, sender_id, body) values ($1, $2, $3)",
            ticket_id,
            user_id,
            message,
        )

    return await get_ticket(user_id, str(ticket_id))


def _summary(row: Any) -> dict:
    return {
        "id": str(row["id"]),
        "ticketNumber": row["ticket_number"],
        "subject": row["subject"],
        "status": row["status"],
        "order": {"id": str(row["order_id"]), "orderNumber": row["order_number"]} if row["order_id"] else None,
        "createdAt": row["created_at"].isoformat(),
        "updatedAt": row["updated_at"].isoformat(),
        "lastMessage": row["last_body"],
        # Foodos wrote last: the person has an answer waiting.
        "awaitingYou": row["last_sender"] is not None and row["last_sender"] != row["raised_by"],
    }


LAST_MESSAGE = """
    left join lateral (
      select m.body as last_body, m.sender_id as last_sender
      from ticket_messages m
      where m.ticket_id = t.id and not m.is_internal
      order by m.created_at desc
      limit 1
    ) last on true
"""


async def list_tickets(user_id: uuid.UUID, role: str) -> list[dict]:
    """This person's tickets from this app, newest activity first."""
    rows = await fetch(
        f"""
        select t.id, t.ticket_number, t.subject, t.status, t.order_id, t.raised_by, t.created_at, t.updated_at,
               o.order_number, last.last_body, last.last_sender
        from support_tickets t
        left join orders o on o.id = t.order_id
        {LAST_MESSAGE}
        where t.raised_by = $1 and t.raised_by_role = $2
        order by t.updated_at desc
        limit 50
        """,
        user_id,
        role,
    )

    return [_summary(row) for row in rows]


async def get_ticket(user_id: uuid.UUID, ticket_id: str) -> dict:
    identifier = _as_uuid(ticket_id)

    row = await fetchrow(
        f"""
        select t.id, t.ticket_number, t.subject, t.status, t.order_id, t.raised_by, t.created_at, t.updated_at,
               o.order_number, last.last_body, last.last_sender
        from support_tickets t
        left join orders o on o.id = t.order_id
        {LAST_MESSAGE}
        where t.id = $1
        """,
        identifier,
    )

    # Someone else's ticket is reported as missing, not forbidden.
    if row is None or row["raised_by"] != user_id:
        raise not_found("ticket_not_found", "That ticket could not be found")

    messages = await fetch(
        """
        select id, sender_id, body, created_at
        from ticket_messages
        where ticket_id = $1 and not is_internal
        order by created_at
        """,
        identifier,
    )

    return {
        **_summary(row),
        "messages": [
            {
                "id": str(message["id"]),
                "fromSupport": message["sender_id"] != user_id,
                "body": message["body"],
                "createdAt": message["created_at"].isoformat(),
            }
            for message in messages
        ],
    }


async def reply(user_id: uuid.UUID, ticket_id: str, message: str) -> dict:
    identifier = _as_uuid(ticket_id)

    async with transaction() as connection:
        ticket = await connection.fetchrow(
            "select raised_by, status from support_tickets where id = $1 for update", identifier
        )

        if ticket is None or ticket["raised_by"] != user_id:
            raise not_found("ticket_not_found", "That ticket could not be found")

        if ticket["status"] == "closed":
            raise conflict("ticket_closed", "This ticket is closed. Start a new one and Foodos will help")

        await connection.execute(
            "insert into ticket_messages (ticket_id, sender_id, body) values ($1, $2, $3)",
            identifier,
            user_id,
            message,
        )

        # Writing again on a resolved ticket means it is not resolved after all.
        await connection.execute(
            """
            update support_tickets
            set status = case when status = 'resolved' then 'open' else status end,
                resolved_at = case when status = 'resolved' then null else resolved_at end,
                updated_at = now()
            where id = $1
            """,
            identifier,
        )

    return await get_ticket(user_id, ticket_id)


async def waiting_count() -> int:
    """Tickets nobody at Foodos has answered yet, for the admin menu."""
    return int(await fetchval("select count(*) from support_tickets where status = 'open'"))
