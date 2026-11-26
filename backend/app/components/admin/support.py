"""Support tickets, from the Foodos side: read them, reply, resolve.

A reply is sent to the person's app (and as a notification); an internal note
stays with the team. Replying to a new ticket moves it to "in progress".
Resolving and closing are logged in the activity log.
"""

import uuid
from typing import Any, Optional

from ...database import fetch, fetchrow, transaction
from ...errors import conflict, not_found
from ..notifications import events
from . import audit

STATUSES = ("open", "in_progress", "resolved", "closed")

STATUS_ACTIONS = {
    "open": "Reopened ticket",
    "resolved": "Resolved ticket",
    "closed": "Closed ticket",
}


def _as_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found("ticket_not_found", "That ticket could not be found")


def _row_to_dict(row: Any) -> dict:
    return {
        "id": str(row["id"]),
        "ticketNumber": row["ticket_number"],
        "subject": row["subject"],
        "status": row["status"],
        "priority": row["priority"],
        "role": row["raised_by_role"],
        "person": {"id": str(row["raised_by"]), "name": row["full_name"], "phone": row["phone"]},
        "order": {"id": str(row["order_id"]), "orderNumber": row["order_number"]} if row["order_id"] else None,
        "lastMessage": row["last_body"],
        "messageCount": row["message_count"],
        "createdAt": row["created_at"].isoformat(),
        "updatedAt": row["updated_at"].isoformat(),
    }


COLUMNS = """
    t.id, t.ticket_number, t.subject, t.status, t.priority, t.raised_by, t.raised_by_role, t.order_id,
    t.created_at, t.updated_at, t.resolved_at, u.full_name, u.phone, o.order_number,
    (select m.body from ticket_messages m where m.ticket_id = t.id order by m.created_at desc limit 1) as last_body,
    (select count(*) from ticket_messages m where m.ticket_id = t.id)::int as message_count
"""


async def list_tickets(status: Optional[str], search: Optional[str], limit: int, offset: int) -> dict:
    """`status` "waiting" means open or in progress: everything not yet done."""
    statuses = ["open", "in_progress"] if status == "waiting" else [status] if status else None
    pattern = f"%{search.strip()}%" if search and search.strip() else None

    where = """
        where ($1::text[] is null or t.status = any($1::text[]))
          and ($2::text is null or t.ticket_number ilike $2 or u.phone ilike $2 or u.full_name ilike $2
               or o.order_number ilike $2 or t.subject ilike $2)
    """

    rows = await fetch(
        f"""
        select {COLUMNS}
        from support_tickets t
        join users u on u.id = t.raised_by
        left join orders o on o.id = t.order_id
        {where}
        order by case t.status when 'open' then 0 when 'in_progress' then 1 else 2 end,
                 case t.priority when 'high' then 0 when 'medium' then 1 else 2 end,
                 t.updated_at desc
        limit $3 offset $4
        """,
        statuses,
        pattern,
        limit,
        offset,
    )

    total = await fetchrow(
        f"""
        select count(*)::int as total
        from support_tickets t
        join users u on u.id = t.raised_by
        left join orders o on o.id = t.order_id
        {where}
        """,
        statuses,
        pattern,
    )

    counts = await fetchrow(
        """
        select count(*)::int as all,
               count(*) filter (where status in ('open', 'in_progress'))::int as waiting,
               count(*) filter (where status = 'open')::int as open,
               count(*) filter (where status = 'resolved')::int as resolved,
               count(*) filter (where status = 'closed')::int as closed
        from support_tickets
        """
    )

    return {"total": total["total"], "counts": dict(counts), "tickets": [_row_to_dict(row) for row in rows]}


async def get_ticket(ticket_id: str) -> dict:
    identifier = _as_uuid(ticket_id)

    row = await fetchrow(
        f"""
        select {COLUMNS}, o.status as order_status
        from support_tickets t
        join users u on u.id = t.raised_by
        left join orders o on o.id = t.order_id
        where t.id = $1
        """,
        identifier,
    )

    if row is None:
        raise not_found("ticket_not_found", "That ticket could not be found")

    messages = await fetch(
        """
        select m.id, m.sender_id, m.body, m.is_internal, m.created_at, u.full_name
        from ticket_messages m
        join users u on u.id = m.sender_id
        where m.ticket_id = $1
        order by m.created_at
        """,
        identifier,
    )

    ticket = _row_to_dict(row)

    if ticket["order"]:
        ticket["order"]["status"] = row["order_status"]

    return {
        **ticket,
        "resolvedAt": row["resolved_at"].isoformat() if row["resolved_at"] else None,
        "messages": [
            {
                "id": str(message["id"]),
                "fromSupport": message["sender_id"] != row["raised_by"],
                "author": message["full_name"],
                "body": message["body"],
                "internal": message["is_internal"],
                "createdAt": message["created_at"].isoformat(),
            }
            for message in messages
        ],
    }


async def reply(ticket_id: str, actor_id: uuid.UUID, message: str, internal: bool) -> dict:
    identifier = _as_uuid(ticket_id)

    async with transaction() as connection:
        ticket = await connection.fetchrow("select status from support_tickets where id = $1 for update", identifier)

        if ticket is None:
            raise not_found("ticket_not_found", "That ticket could not be found")

        if ticket["status"] == "closed" and not internal:
            raise conflict("ticket_closed", "This ticket is closed. Reopen it first to reply")

        await connection.execute(
            "insert into ticket_messages (ticket_id, sender_id, body, is_internal) values ($1, $2, $3, $4)",
            identifier,
            actor_id,
            message,
            internal,
        )

        await connection.execute(
            """
            update support_tickets
            set status = case when $2 and status = 'open' then 'in_progress' else status end,
                assigned_to = coalesce(assigned_to, $3),
                updated_at = now()
            where id = $1
            """,
            identifier,
            not internal,
            actor_id,
        )

    if not internal:
        await events.support_replied(identifier, message)

    return await get_ticket(ticket_id)


async def set_status(ticket_id: str, status: str, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    identifier = _as_uuid(ticket_id)

    async with transaction() as connection:
        ticket = await connection.fetchrow(
            "select status, ticket_number, subject from support_tickets where id = $1 for update", identifier
        )

        if ticket is None:
            raise not_found("ticket_not_found", "That ticket could not be found")

        if ticket["status"] == status:
            raise conflict("status_unchanged", f"{ticket['ticket_number']} is already {status.replace('_', ' ')}")

        await connection.execute(
            """
            update support_tickets
            set status = $2,
                resolved_at = case when $2 in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end
            where id = $1
            """,
            identifier,
            status,
        )

        await audit.record(
            actor_id,
            STATUS_ACTIONS[status],
            "Support",
            "support_ticket",
            identifier,
            {"ticket": ticket["ticket_number"], "subject": ticket["subject"], "from": ticket["status"], "to": status},
            ip,
            connection,
        )

    return await get_ticket(ticket_id)
