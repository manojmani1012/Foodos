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
from ..admin import audit
from ..payouts import ledger
from ..wallet import service as wallet
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
        # 'original' (back to the card or UPI account) or 'wallet' (Foodos wallet).
        "destination": row["destination"],
        "requestedAt": row["created_at"].isoformat() if row["created_at"] else None,
        "processedAt": row["processed_at"].isoformat() if row["processed_at"] else None,
    }


async def refund_for_order(order_id: uuid.UUID) -> Optional[dict]:
    """The latest refund on an order, for showing in the apps."""
    row = await fetchrow(
        """
        select status, amount_paise, destination, created_at, processed_at
        from refunds
        where order_id = $1
        order by created_at desc
        limit 1
        """,
        order_id,
    )

    return refund_to_dict(row)


async def refund_for_order_in(connection, order_id: uuid.UUID) -> Optional[dict]:
    row = await connection.fetchrow(
        """
        select status, amount_paise, destination, created_at, processed_at
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
            select p.id, p.provider, p.user_id, p.provider_payment_id, p.amount_paise
            from payments p
            join orders o on o.id = p.order_id
            where p.order_id = $1
              and p.provider in ('razorpay', 'wallet')
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
            select status, amount_paise, destination, created_at, processed_at
            from refunds
            where payment_id = $1 and status <> 'failed' and charged_to is null
            """,
            payment["id"],
        )

        # Already refunded, by an earlier call or by the other route here.
        if existing is not None:
            return refund_to_dict(existing)

        if payment["provider"] == "wallet":
            # Paid from the wallet, so it goes back to the wallet at once, in
            # this same transaction: no gateway, nothing to wait for.
            wallet_refund_id = await connection.fetchval(
                """
                insert into refunds
                  (payment_id, order_id, amount_paise, reason, status, requested_by, processed_at, destination)
                values ($1, $2, $3, $4, 'processed', $5, now(), 'wallet')
                returning id
                """,
                payment["id"],
                order_id,
                payment["amount_paise"],
                reason,
                requested_by,
            )
            await wallet.move(
                connection,
                payment["user_id"],
                "credit",
                "refund",
                payment["amount_paise"],
                order_id=order_id,
                refund_id=wallet_refund_id,
            )
            await connection.execute(
                "update payments set status = 'refunded', updated_at = now() where id = $1", payment["id"]
            )
            await connection.execute(
                "update orders set payment_status = 'refunded' where id = $1", order_id
            )

            return await refund_for_order_in(connection, order_id)

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
            returning id, order_id, payment_id
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
            # A partial refund charged to a restaurant or rider did not happen
            # after all, so it must not come off their payout either.
            await ledger.reverse_refund(updated["id"])

    if updated is None:
        return {"handled": False, "reason": "unknown refund"}

    order_id = updated["order_id"]

    return {"handled": True, "event": event_type, "orderId": str(order_id) if order_id else None}


# --- Partial refunds (admin) -----------------------------------------------


async def partial_refund(
    order_id: uuid.UUID, amount_paise: int, reason: str, charged_to: str, actor_id: uuid.UUID, ip: Optional[str]
) -> dict:
    """Gives back part of a delivered order: a missing item, a cold dish.

    Card and UPI payments are refunded through Razorpay to where they came
    from. Wallet orders, and cash orders (whose cash cannot be handed back
    from here), are credited to the customer's Foodos wallet at once. The
    refunds on an order can never add up to more than its total.

    Charged to the restaurant or the rider, the refund comes off their next
    payout (a 'refund' row in the earnings ledger); charged to Foodos, it
    comes off nobody's.
    """
    reason = reason.strip()

    async with transaction() as connection:
        order = await connection.fetchrow(
            """
            select o.id, o.status, o.order_number, o.customer_id, o.restaurant_id, o.total_paise,
                   o.payment_method, o.is_test, d.partner_id
            from orders o left join deliveries d on d.order_id = o.id
            where o.id = $1
            for update of o
            """,
            order_id,
        )

        if order is None:
            raise AppError(404, "order_not_found", "That order could not be found")

        if order["status"] != "delivered":
            raise AppError(409, "order_not_delivered", "Only a delivered order can be partly refunded. Cancel it instead")

        refunded = await connection.fetchval(
            "select coalesce(sum(amount_paise), 0)::int from refunds where order_id = $1 and status <> 'failed'",
            order_id,
        )
        left = order["total_paise"] - refunded

        if amount_paise > left:
            raise AppError(
                400,
                "refund_too_large",
                f"Only ₹{left / 100:,.2f} of this order is left to refund" if left > 0 else "This order is already fully refunded",
                {"refundablePaise": left},
            )

        party_id = None

        if charged_to == "restaurant":
            party_id = order["restaurant_id"]
        elif charged_to == "rider":
            party_id = order["partner_id"]

            if party_id is None:
                raise AppError(400, "no_rider", "No rider delivered this order, so the refund cannot be charged to one")

        payment = await connection.fetchrow(
            """
            select id, provider, provider_payment_id
            from payments
            where order_id = $1 and provider in ('razorpay', 'wallet') and status in ('captured', 'refunded')
            order by created_at desc
            limit 1
            for update
            """,
            order_id,
        )
        to_wallet = payment is None or payment["provider"] == "wallet"

        refund_id = await connection.fetchval(
            """
            insert into refunds
              (payment_id, order_id, amount_paise, reason, status, requested_by, processed_at, charged_to, destination)
            values ($1, $2, $3, $4, $5, $6, case when $5 = 'processed' then now() end, $7, $8)
            returning id
            """,
            payment["id"] if payment else None,
            order_id,
            amount_paise,
            reason,
            "processed" if to_wallet else "pending",
            actor_id,
            charged_to,
            "wallet" if to_wallet else "original",
        )

        if to_wallet:
            await wallet.move(
                connection,
                order["customer_id"],
                "credit",
                "refund",
                amount_paise,
                order_id=order_id,
                refund_id=refund_id,
                note=reason,
            )
            await _after_refund(connection, order_id, order["total_paise"], payment, refund_id, party_id, charged_to,
                                amount_paise, reason, actor_id, order["is_test"])

        await _audit_refund(connection, actor_id, ip, order, amount_paise, charged_to, reason, to_wallet)

    if to_wallet:
        return {"refundId": str(refund_id), "status": "processed"}

    # Card or UPI: the gateway is called after the refund row has committed.
    try:
        result = await razorpay.create_refund(
            payment["provider_payment_id"],
            amount_paise,
            notes={"order_id": str(order_id), "reason": reason[:200], "partial": "yes"},
        )
    except AppError as error:
        logger.error("Partial refund failed for order %s: %s", order_id, error.message)
        await execute("update refunds set status = 'failed' where id = $1", refund_id)

        raise AppError(502, "refund_gateway_error", f"Razorpay did not accept the refund. {error.message}".strip())

    status = "processed" if result.get("status") == "processed" else "pending"

    async with transaction() as connection:
        await connection.execute(
            """
            update refunds
            set status = $2, provider_refund_id = $3,
                processed_at = case when $2 = 'processed' then now() else processed_at end
            where id = $1
            """,
            refund_id,
            status,
            result.get("id"),
        )
        await _after_refund(connection, order_id, order["total_paise"], payment, refund_id, party_id, charged_to,
                            amount_paise, reason, actor_id, order["is_test"])

    return {"refundId": str(refund_id), "status": status}


async def _after_refund(
    connection, order_id, total_paise, payment, refund_id, party_id, charged_to, amount_paise, reason, actor_id, is_test
) -> None:
    """The order is 'refunded' only once the refunds cover all of it; the
    party the refund is charged to has it taken off their next payout."""
    refunded = await connection.fetchval(
        "select coalesce(sum(amount_paise), 0)::int from refunds where order_id = $1 and status <> 'failed'", order_id
    )

    if refunded >= total_paise:
        await connection.execute("update orders set payment_status = 'refunded' where id = $1", order_id)

        if payment is not None:
            await connection.execute(
                "update payments set status = 'refunded', updated_at = now() where id = $1", payment["id"]
            )

    if party_id is not None and not is_test:
        await ledger.record_refund(
            connection,
            refund_id,
            "restaurant" if charged_to == "restaurant" else "delivery_partner",
            party_id,
            amount_paise,
            order_id,
            reason,
            actor_id,
        )


async def _audit_refund(connection, actor_id, ip, order, amount_paise, charged_to, reason, to_wallet) -> None:
    await audit.record(
        actor_id,
        "Refunded part of order",
        "Orders",
        "order",
        order["id"],
        {
            "orderNumber": order["order_number"],
            "amountPaise": amount_paise,
            "chargedTo": charged_to,
            "destination": "wallet" if to_wallet else "original",
            "reason": reason,
        },
        ip,
        connection,
    )
