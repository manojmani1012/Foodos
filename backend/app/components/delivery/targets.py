"""Daily targets: "Complete 15 trips today, earn ₹250 extra".

Foodos sets the targets in the admin panel (`incentive_rules`). Every active
target counts the rider's delivered trips since midnight, India time. The trip
that reaches a target carries its bonus (`deliveries.incentive_paise`), so the
bonus shows in the rider's earnings and in their payout like any other pay.
`incentive_awards` holds one row per target, rider and day, so a bonus is
never paid twice.
"""

import uuid
from typing import Any

from ...database import fetch, fetchval

LIVE_RULE = "r.is_active and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now())"

TRIPS_TODAY = """
    select count(*)::int from deliveries
    where partner_id = $1 and status = 'delivered' and delivered_at::date = current_date
"""


async def today(partner_id: uuid.UUID) -> list[dict]:
    """Each live target with this rider's progress on it today."""
    rows = await fetch(
        f"""
        select r.id, r.name, r.target_trips, r.bonus_paise,
               exists (
                 select 1 from incentive_awards a
                 where a.rule_id = r.id and a.partner_id = $1 and a.award_date = current_date
               ) as achieved
        from incentive_rules r
        where {LIVE_RULE}
        order by r.target_trips, r.bonus_paise
        """,
        partner_id,
    )

    if not rows:
        return []

    trips = await fetchval(TRIPS_TODAY, partner_id)

    return [
        {
            "id": str(row["id"]),
            "name": row["name"],
            "targetTrips": row["target_trips"],
            "bonusPaise": row["bonus_paise"],
            "tripsDone": min(trips, row["target_trips"]),
            "achieved": row["achieved"],
        }
        for row in rows
    ]


async def award(connection: Any, partner_id: uuid.UUID, delivery_id: uuid.UUID) -> list[dict]:
    """Pays every target this delivery completes. Runs in the transaction that
    marks the delivery delivered, so the trip counts itself."""
    rules = await connection.fetch(
        f"""
        select r.id, r.name, r.bonus_paise
        from incentive_rules r
        where {LIVE_RULE} and r.target_trips <= ({TRIPS_TODAY})
        order by r.target_trips
        """,
        partner_id,
    )

    won = []

    for rule in rules:
        awarded = await connection.fetchval(
            """
            insert into incentive_awards (rule_id, partner_id, award_date, amount_paise)
            values ($1, $2, current_date, $3)
            on conflict (rule_id, partner_id, award_date) do nothing
            returning id
            """,
            rule["id"],
            partner_id,
            rule["bonus_paise"],
        )

        if awarded:
            won.append({"name": rule["name"], "bonusPaise": rule["bonus_paise"]})

    if won:
        await connection.execute(
            "update deliveries set incentive_paise = incentive_paise + $2 where id = $1",
            delivery_id,
            sum(target["bonusPaise"] for target in won),
        )

    return won
