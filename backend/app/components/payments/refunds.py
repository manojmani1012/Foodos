"""Refunds for cancelled orders.

The rule: an order that was paid online and then cancelled, by anyone, gets a
full refund. Cash orders were never paid, so they never need one.

Two orderings are deliberate:
  - The refund runs after the cancellation has committed, never inside it. A
    slow or failing gateway must not hold the order row locked, and must not
    undo the cancellation itself.
  - The refund row is written as `pending` before Razorpay is called. If the
    process dies mid-call, there is a record that a refund is owed instead of
    a cancelled, paid order with no trace of what happened.
"""

import logging
import uuid
from typing import Any, Optional

from ...database import execute, fetchrow, transaction
from ...errors import AppError
from . import razorpay

logger = logging.getLogger("foodos.refunds")

# Razorpay's own refund statuses, as stored.
REFUND_DONE = {"pending", "processed"}


def refund_to_dict(row: Optional[Any]) -> Optional[dict]:
    if row is None:
        return None

    return {
        "status": row["status"],
        "amountPaise": row["amount_paise"],
        "requestedAt": row["created_at"].isoformat() if row["created_at"] else None,
        "processedAt": row["processed_at"].isoformat() if row["processed_at"] else None,
    }


async def refund_for_order(order_id: uuid.UUID) -> Optional[dict]:
    """The latest refund on an order, for showing in the apps."""
    row = await fetchrow(
        """
        select status, amount_paise, created_at, processed_at
        from refunds
        where order_id = $1
        order by created_at desc
        limit 1
        """,
        order_id,
    )

    return refund_to_dict(row)


async def refund_if_paid(
    order_id: uuid.UUID, reason: Optional[str], requested_by: Optional[uuid.UUID]
) -> Optional[dict]:
    """Refunds a cancelled order in full if it was paid online.

    Returns the refund (with status `pending`, `processed` or `failed`), or
    None when there was nothing to refund. Never raises: the order is already
    cancelled, and a gateway problem must not turn that into an error for the
    person who cancelled it. A failed refund is recorded so it can be retried.
    """
    async with transaction() as connection:
        payment = await connection.fetchrow(
            """
            select p.id, p.provider_payment_id, p.amount_paise
            from payments p
            join orders o on o.id = p.order_id
            where p.order_id = $1
              and p.provider = 'razorpay'
              and p.status = 'captured'
              and o.status = 'cancelled'
            for update of p
            """,
            order_id,
        )

        if payment is None:
            # Nothing captured to refund: a cash order, an unpaid one, or one
            # already refunded. Report any refund that exists rather than None,
            # so a repeat call never reads as "this was never refunded".
            return await refund_for_order(order_id)

        existing = await connection.fetchrow(
            """
            select status, amount_paise, created_at, processed_at
            from refunds
            where payment_id = $1 and status <> 'failed'
            """,
            payment["id"],
        )

        # Already refunded, by an earlier call or by the other route here.
        if existing is not None:
            return refund_to_dict(existing)

        refund = await connection.fetchrow(
            """
            insert into refunds (payment_id, order_id, amount_paise, reason, status, requested_by)
            values ($1, $2, $3, $4, 'pending', $5)
            returning id
            """,
            payment["id"],
            order_id,
            payment["amount_paise"],
            reason,
            requested_by,
        )

    refund_id = refund["id"]

    try:
        result = await razorpay.create_refund(
            payment["provider_payment_id"],
            payment["amount_paise"],
            notes={"order_id": str(order_id), "reason": (reason or "Order cancelled")[:200]},
        )
    except AppError as error:
        # Logged loudly: this customer is owed money and nothing has moved yet.
        logger.error("Refund failed for order %s: %s", order_id, error.message)
        await execute("update refunds set status = 'failed' where id = $1", refund_id)

        return await refund_for_order(order_id)

    gateway_status = result.get("status")
    status = "processed" if gateway_status == "processed" else "pending"

    async with transaction() as connection:
        await connection.execute(
            """
            update refunds
            set status = $2,
                provider_refund_id = $3,
                processed_at = case when $2 = 'processed' then now() else processed_at end
            where id = $1
            """,
            refund_id,
            status,
            result.get("id"),
        )
        await connection.execute(
            "update payments set status = 'refunded', updated_at = now() where id = $1",
            payment["id"],
        )
        await connection.execute(
            "update orders set payment_status = 'refunded' where id = $1",
            order_id,
        )

    return await refund_for_order(order_id)


async def apply_refund_webhook(event_type: str, entity: dict) -> dict:
    """Razorpay reporting how a refund finished: `refund.processed` when the
    money is on its way back, `refund.failed` when the bank refused it."""
    provider_refund_id = entity.get("id")

    if not provider_refund_id:
        return {"handled": False, "reason": "no refund id in payload"}

    if event_type == "refund.processed":
        updated = await fetchrow(
            """
            update refunds set status = 'processed', processed_at = coalesce(processed_at, now())
            where provider_refund_id = $1
            returning id, order_id
            """,
            provider_refund_id,
        )
    else:
        updated = await fetchrow(
            """
            update refunds set status = 'failed' where provider_refund_id = $1
            returning order_id, payment_id
            """,
            provider_refund_id,
        )

        if updated is not None:
            # The money did not go back, so nothing is refunded after all, and
            # the failed row leaves the way open for a retry.
            logger.error("Bank refused refund %s", provider_refund_id)
            await execute(
                "update payments set status = 'captured', updated_at = now() where id = $1",
                updated["payment_id"],
            )
            await execute(
                "update orders set payment_status = 'paid' where id = $1", updated["order_id"]
            )

    if updated is None:
        return {"handled": False, "reason": "unknown refund"}

    order_id = updated["order_id"]

    return {"handled": True, "event": event_type, "orderId": str(order_id) if order_id else None}
