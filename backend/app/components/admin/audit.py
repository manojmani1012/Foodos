"""The admin activity log: who changed what, and when.

Every admin action that changes data writes one row, inside the same
transaction as the change where there is one, so the log never claims something
happened that was rolled back.
"""

import ipaddress
import json
import uuid
from typing import Any, Optional

import asyncpg

from ...database import execute, fetch, fetchval


def valid_ip(ip: Optional[str]) -> Optional[str]:
    """The column is inet; a malformed forwarded header must not fail the action."""
    if not ip:
        return None

    try:
        return str(ipaddress.ip_address(ip))
    except ValueError:
        return None


async def record(
    actor_id: Optional[uuid.UUID],
    action: str,
    module: str,
    entity_type: Optional[str] = None,
    entity_id: Any = None,
    metadata: Optional[dict] = None,
    ip: Optional[str] = None,
    connection: Optional[asyncpg.Connection] = None,
) -> None:
    sql = """
        insert into audit_logs (actor_user_id, action, module, entity_type, entity_id, metadata, ip)
        values ($1, $2, $3, $4, $5, $6::jsonb, $7::inet)
    """
    args = (
        actor_id,
        action,
        module,
        entity_type,
        str(entity_id) if entity_id is not None else None,
        json.dumps(metadata or {}, default=str),
        valid_ip(ip),
    )

    if connection is not None:
        await connection.execute(sql, *args)
    else:
        await execute(sql, *args)


async def list_activity(module: Optional[str], entity_id: Optional[str], limit: int, offset: int) -> dict:
    conditions, args = [], []

    if module:
        args.append(module)
        conditions.append(f"a.module = ${len(args)}")

    if entity_id:
        args.append(entity_id)
        conditions.append(f"a.entity_id = ${len(args)}")

    where = f"where {' and '.join(conditions)}" if conditions else ""

    total = await fetchval(f"select count(*)::int from audit_logs a {where}", *args)

    rows = await fetch(
        f"""
        select a.id, a.action, a.module, a.entity_type, a.entity_id, a.metadata, a.ip, a.created_at,
               u.full_name as actor_name, u.email as actor_email
        from audit_logs a
        left join users u on u.id = a.actor_user_id
        {where}
        order by a.created_at desc, a.id desc
        limit ${len(args) + 1} offset ${len(args) + 2}
        """,
        *args,
        limit,
        offset,
    )

    return {
        "total": total,
        "activity": [
            {
                "id": row["id"],
                "action": row["action"],
                "module": row["module"],
                "entityType": row["entity_type"],
                "entityId": row["entity_id"],
                "details": json.loads(row["metadata"]) if isinstance(row["metadata"], str) else row["metadata"],
                "ip": str(row["ip"]) if row["ip"] else None,
                "actor": row["actor_name"] or row["actor_email"],
                "at": row["created_at"].isoformat(),
            }
            for row in rows
        ],
    }
