"""Daily targets for riders, set from the admin panel.

"Complete 15 trips, earn ₹250 extra": each target runs every day, counting a
rider's delivered trips since midnight, until someone stops it. Several can
run at once (10 trips for ₹100 and 15 for ₹250, say); a rider earns each one
they reach. The bonus is paid by delivery/targets.py on the trip that reaches
the target.
"""

import uuid
from typing import Any, Optional

from ...database import fetch, fetchrow, transaction
from ...errors import conflict, not_found
from . import audit


def _rupees(paise: int) -> str:
    value = paise / 100
    return f"₹{value:,.0f}" if value == int(value) else f"₹{value:,.2f}"


def _as_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found("target_not_found", "That target could not be found")


LIVE = "r.is_active and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now())"

COLUMNS = f"""
    r.id, r.name, r.target_trips, r.bonus_paise, r.starts_at, r.ends_at, ({LIVE}) as live,
    (select count(*) from incentive_awards a where a.rule_id = r.id and a.award_date = current_date)::int
      as reached_today,
    (select count(*) from incentive_awards a where a.rule_id = r.id)::int as reached_total,
    (select coalesce(sum(a.amount_paise), 0) from incentive_awards a where a.rule_id = r.id)::bigint as paid_total
"""


def _to_dict(row: Any) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "targetTrips": row["target_trips"],
        "bonusPaise": row["bonus_paise"],
        "live": row["live"],
        "startsAt": row["starts_at"].isoformat(),
        "endsAt": row["ends_at"].isoformat() if row["ends_at"] else None,
        "reachedToday": row["reached_today"],
        "reachedTotal": row["reached_total"],
        "paidTotalPaise": int(row["paid_total"]),
    }


async def list_targets() -> list[dict]:
    rows = await fetch(
        f"""
        select {COLUMNS}
        from incentive_rules r
        order by ({LIVE}) desc, r.target_trips, r.created_at desc
        limit 50
        """
    )

    return [_to_dict(row) for row in rows]


async def _get(identifier: uuid.UUID) -> dict:
    row = await fetchrow(f"select {COLUMNS} from incentive_rules r where r.id = $1", identifier)

    if row is None:
        raise not_found("target_not_found", "That target could not be found")

    return _to_dict(row)


async def create_target(body: Any, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    name = body.name or f"Complete {body.targetTrips} trips, earn {_rupees(body.bonusPaise)} extra"

    async with transaction() as connection:
        identifier = await connection.fetchval(
            """
            insert into incentive_rules (name, target_trips, bonus_paise)
            values ($1, $2, $3)
            returning id
            """,
            name,
            body.targetTrips,
            body.bonusPaise,
        )

        await audit.record(
            actor_id,
            "Started daily target",
            "Riders",
            "incentive_rule",
            identifier,
            {"name": name, "targetTrips": body.targetTrips, "bonusPaise": body.bonusPaise},
            ip,
            connection,
        )

    return await _get(identifier)


async def stop_target(target_id: str, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    """Ends a target now. Bonuses already earned stay paid."""
    identifier = _as_uuid(target_id)

    async with transaction() as connection:
        row = await connection.fetchrow(
            f"select r.name, ({LIVE}) as live from incentive_rules r where r.id = $1 for update", identifier
        )

        if row is None:
            raise not_found("target_not_found", "That target could not be found")

        if not row["live"]:
            raise conflict("target_not_running", "That target has already ended")

        await connection.execute(
            "update incentive_rules set is_active = false, ends_at = now() where id = $1", identifier
        )

        await audit.record(
            actor_id, "Stopped daily target", "Riders", "incentive_rule", identifier, {"name": row["name"]}, ip, connection
        )

    return await _get(identifier)
