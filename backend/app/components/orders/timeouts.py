"""Orders that nobody answered.

A restaurant has `restaurant_accept_minutes` to accept a new order. After that
the order is cancelled for the customer and refunded if it was paid, as the
delivery apps do: a customer should never wait on an order that is not being
cooked (testers found orders still "New" days later).

An online order whose payment was never completed is dropped after
`unpaid_order_minutes`. It never reached the restaurant, so only the record is
closed. If the money arrives later anyway, the payment code refunds it.
"""

import logging
import uuid

from ...config import get_settings
from ...database import fetch, transaction
from ..notifications import events
from ..payments import refunds

logger = logging.getLogger("foodos.timeouts")

NOT_ACCEPTED = "The restaurant did not accept your order in time"
NOT_PAID = "Payment was not completed"


async def _cancel(order_id: uuid.UUID, expected_status: str, reason: str) -> bool:
    """Cancels one order if it is still waiting, as Foodos ("system")."""
    async with transaction() as connection:
        # Skip a row someone is changing right now: the restaurant may be
        # accepting it at this very moment.
        status = await connection.fetchval(
            "select status from orders where id = $1 for update skip locked", order_id
        )

        if status != expected_status:
            return False

        await connection.execute(
            """
            update orders
            set status = 'cancelled', cancelled_at = now(), cancelled_by = 'system', cancellation_reason = $2
            where id = $1
            """,
            order_id,
            reason,
        )

        await connection.execute(
            "insert into order_status_history (order_id, status, note) values ($1, 'cancelled', $2)",
            order_id,
            reason,
        )

    return True


async def cancel_unaccepted() -> int:
    """Cancels, refunds and reports every order the restaurant left unanswered."""
    rows = await fetch(
        """
        select id from orders
        where status = 'confirmed' and confirmed_at < now() - make_interval(mins => $1)
        order by confirmed_at
        limit 50
        """,
        get_settings().restaurant_accept_minutes,
    )

    cancelled = 0

    for row in rows:
        try:
            if not await _cancel(row["id"], "confirmed", NOT_ACCEPTED):
                continue

            await refunds.refund_if_paid(row["id"], NOT_ACCEPTED, None)
            await events.cancelled(row["id"], "system", restaurant_saw_it=True)
            cancelled += 1
        except Exception:  # noqa: BLE001 - one bad order must not stop the rest
            logger.exception("[timeouts] cancelling %s failed", row["id"])

    return cancelled


async def expire_unpaid() -> int:
    rows = await fetch(
        """
        select id from orders
        where status = 'pending' and placed_at < now() - make_interval(mins => $1)
        order by placed_at
        limit 50
        """,
        get_settings().unpaid_order_minutes,
    )

    expired = 0

    for row in rows:
        try:
            if await _cancel(row["id"], "pending", NOT_PAID):
                expired += 1
        except Exception:  # noqa: BLE001
            logger.exception("[timeouts] expiring %s failed", row["id"])

    return expired
