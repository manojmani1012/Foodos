"""The earnings ledger: one row per thing that changes what Foodos owes a
restaurant or a rider.

    restaurant  order           food + packaging - commission - GST on it - TDS
    rider       delivery        base + distance + incentives + tip
    rider       cash_collected  minus the bill of a cash order (Foodos's money in their pocket)
    rider       cash_deposit    plus cash handed over to Foodos
    either      refund          minus a partial refund charged to them
    either      adjustment      plus or minus, by an admin, with a note

Rows are written where the event happens (the delivered step, a deposit, a
refund, an adjustment) and again by `sweep()` from the background loop, which
catches anything missed and backfills the past. `source` is unique, so the
second write of the same thing does nothing.

Test orders and test accounts never get rows. Rows from before automatic
payouts began are held out ('before_automatic_payouts') unless a paid payout
recorded the old way already covered that day, in which case they are tied to
it; an admin can include held-out rows, and they go into the next batch.
"""

import json
import uuid
from typing import Any, Optional

import asyncpg

from ...database import fetch, fetchrow, fetchval, transaction
from ...errors import bad_request, not_found
from ..admin import audit
from . import settings as payment_settings

BEFORE_START = "before_automatic_payouts"

KIND_LABELS = {
    "order": "Order",
    "delivery": "Delivery",
    "cash_collected": "Cash collected",
    "cash_deposit": "Cash deposited",
    "refund": "Refund",
    "adjustment": "Adjustment",
}

MAX_ADJUSTMENT_PAISE = 1_000_000

ENTRY_COLUMNS = """
    e.id, e.party_type, e.restaurant_id, e.partner_id, e.order_id, e.kind, e.amount_paise, e.breakdown,
    e.business_date, e.payout_id, e.excluded_reason, e.note, e.created_at, o.order_number
"""


def entry_to_dict(row: Any) -> dict:
    breakdown = row["breakdown"]

    return {
        "id": row["id"],
        "kind": row["kind"],
        "orderId": str(row["order_id"]) if row["order_id"] else None,
        "orderNumber": row["order_number"],
        "businessDate": row["business_date"].isoformat(),
        "amountPaise": row["amount_paise"],
        "breakdown": json.loads(breakdown) if isinstance(breakdown, str) else (breakdown or {}),
        "note": row["note"],
        "createdAt": row["created_at"].isoformat(),
    }


def party_column(party_type: str) -> str:
    return "restaurant_id" if party_type == "restaurant" else "partner_id"


async def _insert(
    connection: asyncpg.Connection,
    *,
    party_type: str,
    party_id: uuid.UUID,
    kind: str,
    amount: int,
    source: str,
    moment_sql: str = "now()",
    moment_args: tuple = (),
    order_id: Optional[uuid.UUID] = None,
    breakdown: Optional[dict] = None,
    note: Optional[str] = None,
    created_by: Optional[uuid.UUID] = None,
) -> Optional[int]:
    """Writes one row unless its source is already there. Returns its id, or
    None when it already existed.

    The business day comes from `moment_sql` (a timestamp expression whose
    parameters, `moment_args`, start at $2) through the cutoff. A day before automatic
    payouts began is held out, unless a paid payout from the old manual
    screen covers it, which ties the row to that payout.
    """
    column = party_column(party_type)
    day = await connection.fetchval(
        f"select business_date({moment_sql}, $1::interval)", payment_settings.cutoff(), *moment_args
    )

    covering = await connection.fetchval(
        f"""
        select id from payouts
        where party_type = $1 and {column} = $2 and status = 'paid' and batch_id is null
          and $3::date between period_start and period_end
        order by paid_at
        limit 1
        """,
        party_type,
        party_id,
        day,
    )
    excluded = BEFORE_START if covering is None and day < payment_settings.started_on() else None

    return await connection.fetchval(
        f"""
        insert into earnings_entries
          (party_type, {column}, order_id, kind, amount_paise, breakdown, business_date, payout_id,
           excluded_reason, source, note, created_by)
        values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)
        on conflict (source) do nothing
        returning id
        """,
        party_type,
        party_id,
        order_id,
        kind,
        amount,
        json.dumps(breakdown or {}),
        day,
        covering,
        excluded,
        source,
        note,
        created_by,
    )


async def record_order(connection: asyncpg.Connection, order_id: uuid.UUID) -> int:
    """The rows a delivered order earns: the restaurant's share, the rider's
    pay, and the cash the rider took at the door. Returns how many were new."""
    row = await connection.fetchrow(
        """
        select o.id, o.status, o.is_test, o.restaurant_id, o.subtotal_paise, o.packaging_fee_paise,
               o.total_paise, o.payment_method, coalesce(o.delivered_at, d.delivered_at) as delivered_at,
               r.commission_pct,
               d.partner_id, d.status as delivery_status, d.base_earning_paise, d.base_pay_paise,
               d.distance_pay_paise, d.incentive_paise, d.order_incentive_paise, d.tip_paise,
               d.total_distance_km, d.drop_distance_km, coalesce(u.is_test, false) as rider_is_test
        from orders o
        join restaurants r on r.id = o.restaurant_id
        left join deliveries d on d.order_id = o.id
        left join users u on u.id = d.partner_id
        where o.id = $1
        """,
        order_id,
    )

    if row is None or row["status"] != "delivered" or row["is_test"] or row["delivered_at"] is None:
        return 0

    settings = payment_settings.current()
    moment = ("$2::timestamptz", (row["delivered_at"],))
    written = 0

    food, packaging = row["subtotal_paise"], row["packaging_fee_paise"]
    pct = float(row["commission_pct"])
    commission = payment_settings.percent_of(food, pct)
    gst = payment_settings.percent_of(commission, settings["gstOnCommissionPct"])
    tds = payment_settings.percent_of(food + packaging, settings["restaurantTdsPct"])

    if await _insert(
        connection,
        party_type="restaurant",
        party_id=row["restaurant_id"],
        kind="order",
        amount=food + packaging - commission - gst - tds,
        source=f"order:{order_id}:restaurant",
        moment_sql=moment[0],
        moment_args=moment[1],
        order_id=order_id,
        breakdown={
            "foodPaise": food,
            "packagingPaise": packaging,
            "commissionPct": pct,
            "commissionPaise": commission,
            "gstOnCommissionPaise": gst,
            "tdsPaise": tds,
        },
    ):
        written += 1

    if row["partner_id"] is None or row["delivery_status"] != "delivered" or row["rider_is_test"]:
        return written

    # Trips from before the base/distance split have only the total.
    split = row["base_pay_paise"] is not None
    base = row["base_pay_paise"] if split else row["base_earning_paise"]
    distance = (row["distance_pay_paise"] or 0) if split else 0
    km = row["total_distance_km"]

    if await _insert(
        connection,
        party_type="delivery_partner",
        party_id=row["partner_id"],
        kind="delivery",
        amount=row["base_earning_paise"] + row["incentive_paise"] + row["tip_paise"],
        source=f"order:{order_id}:rider",
        moment_sql=moment[0],
        moment_args=moment[1],
        order_id=order_id,
        breakdown={
            "basePaise": base,
            "distancePaise": distance,
            # All incentives (daily targets and the per-order one); the
            # per-order part is also shown on its own.
            "incentivePaise": row["incentive_paise"],
            "orderIncentivePaise": row["order_incentive_paise"],
            "tipPaise": row["tip_paise"],
            "distanceKm": float(km) if km is not None else None,
        },
    ):
        written += 1

    if row["payment_method"] == "cod":
        if await _insert(
            connection,
            party_type="delivery_partner",
            party_id=row["partner_id"],
            kind="cash_collected",
            amount=-row["total_paise"],
            source=f"order:{order_id}:cash",
            moment_sql=moment[0],
            moment_args=moment[1],
            order_id=order_id,
            breakdown={"cashPaise": row["total_paise"]},
        ):
            written += 1

    return written


async def record_deposit(connection: asyncpg.Connection, deposit_id: uuid.UUID) -> bool:
    row = await connection.fetchrow(
        """
        select c.id, c.partner_id, c.amount_paise, c.reference, c.created_at, c.recorded_by, u.is_test
        from rider_cash_deposits c join users u on u.id = c.partner_id
        where c.id = $1
        """,
        deposit_id,
    )

    if row is None or row["is_test"]:
        return False

    return bool(
        await _insert(
            connection,
            party_type="delivery_partner",
            party_id=row["partner_id"],
            kind="cash_deposit",
            amount=row["amount_paise"],
            source=f"deposit:{deposit_id}",
            moment_sql="$2::timestamptz",
            moment_args=(row["created_at"],),
            breakdown={"cashPaise": row["amount_paise"]},
            note=row["reference"],
            created_by=row["recorded_by"],
        )
    )


async def record_refund(
    connection: asyncpg.Connection,
    refund_id: uuid.UUID,
    party_type: str,
    party_id: uuid.UUID,
    amount_paise: int,
    order_id: uuid.UUID,
    note: Optional[str],
    created_by: Optional[uuid.UUID],
) -> bool:
    """A partial refund charged to the restaurant or the rider comes off what
    they are owed, in the next payout."""
    return bool(
        await _insert(
            connection,
            party_type=party_type,
            party_id=party_id,
            kind="refund",
            amount=-amount_paise,
            source=f"refund:{refund_id}",
            order_id=order_id,
            breakdown={"refundPaise": amount_paise},
            note=note,
            created_by=created_by,
        )
    )


async def _entry(entry_id: int) -> dict:
    row = await fetchrow(
        f"select {ENTRY_COLUMNS} from earnings_entries e left join orders o on o.id = e.order_id where e.id = $1",
        entry_id,
    )

    return entry_to_dict(row)


async def add_adjustment(
    party_type: str, party_id: str, amount_paise: int, note: str, actor_id: uuid.UUID, ip: Optional[str]
) -> dict:
    """An admin correction: a bonus, a penalty, money owed from elsewhere. It
    goes into the party's next payout."""
    if amount_paise == 0 or abs(amount_paise) > MAX_ADJUSTMENT_PAISE:
        raise bad_request("invalid_amount", "Enter an amount other than zero, up to ₹10,000 either way")

    note = (note or "").strip()

    if len(note) < 5:
        raise bad_request("note_required", "Say what this adjustment is for (at least 5 characters)")

    try:
        identifier = uuid.UUID(str(party_id))
    except (ValueError, TypeError):
        raise not_found("party_not_found", "That partner could not be found")

    if party_type == "restaurant":
        name = await fetchval("select name from restaurants where id = $1", identifier)
    else:
        name = await fetchval(
            "select u.full_name from delivery_partners p join users u on u.id = p.user_id where p.user_id = $1",
            identifier,
        )
        exists = await fetchval("select 1 from delivery_partners where user_id = $1", identifier)
        name = name or ("Rider" if exists else None)

    if name is None:
        raise not_found("party_not_found", "That partner could not be found")

    async with transaction() as connection:
        entry_id = await _insert(
            connection,
            party_type=party_type,
            party_id=identifier,
            kind="adjustment",
            amount=amount_paise,
            source=f"adjustment:{uuid.uuid4()}",
            breakdown={"adjustmentPaise": amount_paise},
            note=note,
            created_by=actor_id,
        )
        await audit.record(
            actor_id,
            "Added payout adjustment",
            "Payouts",
            party_type,
            identifier,
            {"name": name, "amountPaise": amount_paise, "note": note},
            ip,
            connection,
        )

    return await _entry(entry_id)


async def include_excluded(
    party_type: Optional[str], party_id: Optional[str], actor_id: uuid.UUID, ip: Optional[str]
) -> int:
    """Lets rows from before automatic payouts into the next batch."""
    identifier = None

    if party_id:
        try:
            identifier = uuid.UUID(str(party_id))
        except (ValueError, TypeError):
            raise not_found("party_not_found", "That partner could not be found")

    async with transaction() as connection:
        rows = await connection.fetch(
            """
            update earnings_entries set excluded_reason = null
            where excluded_reason is not null and payout_id is null
              and ($1::text is null or party_type = $1)
              and ($2::uuid is null or restaurant_id = $2 or partner_id = $2)
            returning id
            """,
            party_type,
            identifier,
        )

        if rows:
            await audit.record(
                actor_id,
                "Included earlier earnings in payouts",
                "Payouts",
                party_type or "all",
                identifier,
                {"entries": len(rows)},
                ip,
                connection,
            )

    return len(rows)


SWEEP_CHUNK = 200


async def sweep() -> int:
    """Writes any rows that are missing: delivered orders and cash deposits
    with no ledger row yet. Safe to run at any time, as often as wanted.
    Returns how many rows it wrote."""
    written = 0

    while True:
        before = written
        orders = await fetch(
            """
            select o.id from orders o
            left join deliveries d on d.order_id = o.id
            left join users u on u.id = d.partner_id
            where o.status = 'delivered' and not o.is_test
              and (
                not exists (select 1 from earnings_entries e where e.source = 'order:' || o.id || ':restaurant')
                or (d.status = 'delivered' and d.partner_id is not null and not u.is_test
                    and not exists (select 1 from earnings_entries e where e.source = 'order:' || o.id || ':rider'))
              )
            order by o.delivered_at nulls last
            limit $1
            """,
            SWEEP_CHUNK,
        )

        for row in orders:
            async with transaction() as connection:
                written += await record_order(connection, row["id"])

        deposits = await fetch(
            """
            select c.id from rider_cash_deposits c join users u on u.id = c.partner_id
            where not u.is_test
              and not exists (select 1 from earnings_entries e where e.source = 'deposit:' || c.id)
            limit $1
            """,
            SWEEP_CHUNK,
        )

        for row in deposits:
            async with transaction() as connection:
                written += 1 if await record_deposit(connection, row["id"]) else 0

        # A row that cannot be written (bad data) must not loop forever.
        if len(orders) < SWEEP_CHUNK and len(deposits) < SWEEP_CHUNK:
            return written

        if written == before:
            return written


async def reverse_refund(refund_id: uuid.UUID) -> None:
    """A refund the bank refused. Its row comes out of the ledger if it is not
    in a payout yet; otherwise an equal and opposite row goes into the next."""
    async with transaction() as connection:
        row = await connection.fetchrow(
            """
            select e.id, e.party_type, coalesce(e.restaurant_id, e.partner_id) as party_id, e.amount_paise,
                   e.order_id, e.payout_id, p.status as payout_status
            from earnings_entries e left join payouts p on p.id = e.payout_id
            where e.source = $1
            for update of e
            """,
            f"refund:{refund_id}",
        )

        if row is None:
            return

        if row["payout_id"] is None:
            await connection.execute("delete from earnings_entries where id = $1", row["id"])
            return

        await _insert(
            connection,
            party_type=row["party_type"],
            party_id=row["party_id"],
            kind="adjustment",
            amount=-row["amount_paise"],
            source=f"refund-failed:{refund_id}",
            order_id=row["order_id"],
            breakdown={"adjustmentPaise": -row["amount_paise"]},
            note="Refund to the customer failed, so it is not charged",
        )
