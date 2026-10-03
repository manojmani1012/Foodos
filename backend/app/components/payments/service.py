"""Payment lifecycle for prepaid orders.

A prepaid order starts as `pending` and only becomes `confirmed` once the money
is confirmed. That matters: a restaurant must never start cooking an order that
has not been paid for.

Cash on delivery skips all of this and is confirmed immediately.
"""

import json
import uuid
from typing import Any, Optional

from ...config import get_settings
from ...database import execute, fetchrow, transaction
from ...errors import bad_request, conflict, not_found
from . import razorpay

# What the app may ask to pay with. Cash is handled entirely in the order
# service; everything else goes through Razorpay.
ONLINE_METHODS = {"upi", "card", "wallet", "netbanking"}


async def start_payment(user_id: uuid.UUID, order_id: uuid.UUID, method: str) -> dict:
    """Creates the Razorpay order the app opens checkout against."""
    order = await fetchrow(
        """
        select o.id, o.order_number, o.customer_id, o.total_paise, o.payment_status, o.status,
               u.full_name, u.phone, u.email
        from orders o
        join users u on u.id = o.customer_id
        where o.id = $1
        """,
        order_id,
    )

    if order is None or order["customer_id"] != user_id:
        raise not_found("order_not_found", "That order could not be found")

    if order["payment_status"] == "paid":
        raise conflict("already_paid", "That order has already been paid for")

    if order["status"] == "cancelled":
        raise conflict("order_cancelled", "That order was cancelled")

    created = await razorpay.create_order(
        amount_paise=order["total_paise"],
        receipt=order["order_number"],
        notes={"orderId": str(order_id), "orderNumber": order["order_number"]},
    )

    settings = get_settings()

    # Recorded before the app opens checkout, so a payment that succeeds while
    # the phone loses signal can still be matched up by the webhook.
    await execute(
        """
        insert into payments
          (order_id, user_id, provider, method, amount_paise, status, provider_order_id)
        values ($1, $2, 'razorpay', $3, $4, 'created', $5)
        """,
        order_id,
        user_id,
        method,
        order["total_paise"],
        created["id"],
    )

    return {
        "razorpayOrderId": created["id"],
        # Public by design: the key id identifies the merchant, the secret
        # authorises, and the secret stays here.
        "keyId": settings.razorpay_key_id,
        "amountPaise": order["total_paise"],
        "currency": "INR",
        "orderNumber": order["order_number"],
        "customer": {
            "name": order["full_name"],
            "phone": order["phone"],
            "email": order["email"],
        },
    }


async def confirm_payment(
    user_id: uuid.UUID,
    order_id: uuid.UUID,
    razorpay_order_id: str,
    razorpay_payment_id: str,
    signature: str,
) -> dict:
    """Marks an order paid, but only if Razorpay's signature checks out."""
    if not razorpay.verify_payment_signature(razorpay_order_id, razorpay_payment_id, signature):
        # Either a forgery or a mismatched pair; neither should move an order.
        raise bad_request("payment_signature_invalid", "That payment could not be verified")

    async with transaction() as connection:
        order = await connection.fetchrow(
            "select customer_id, payment_status, status from orders where id = $1 for update",
            order_id,
        )

        if order is None or order["customer_id"] != user_id:
            raise not_found("order_not_found", "That order could not be found")

        payment = await connection.fetchrow(
            "select id, status from payments where provider_order_id = $1 and order_id = $2",
            razorpay_order_id,
            order_id,
        )

        if payment is None:
            raise not_found("payment_not_found", "That payment could not be found")

        # Already settled, by this call or by the webhook arriving first.
        if order["payment_status"] == "paid":
            return {"paid": True, "orderStatus": order["status"]}

        await connection.execute(
            """
            update payments
            set status = 'captured', provider_payment_id = $2
            where id = $1
            """,
            payment["id"],
            razorpay_payment_id,
        )

        # Paid, so the restaurant can finally see it.
        await connection.execute(
            """
            update orders
            set payment_status = 'paid',
                status = case when status = 'pending' then 'confirmed' else status end,
                confirmed_at = coalesce(confirmed_at, now())
            where id = $1
            """,
            order_id,
        )

        await connection.execute(
            """
            insert into order_status_history (order_id, status, actor_user_id, note)
            values ($1, 'confirmed', $2, 'Payment received')
            """,
            order_id,
            user_id,
        )

    return {"paid": True, "orderStatus": "confirmed"}


async def handle_webhook(body: bytes, signature: str) -> dict:
    """Razorpay's own report of what happened.

    The app telling us it paid is convenient; this is authoritative. It also
    covers the case where the customer's phone died between paying and the app
    confirming.
    """
    if not razorpay.verify_webhook_signature(body, signature):
        raise bad_request("webhook_signature_invalid", "That webhook could not be verified")

    payload = json.loads(body)
    event_id = payload.get("id") or payload.get("event_id") or ""
    event_type = payload.get("event", "")

    # Razorpay retries, so the same event can arrive several times. The unique
    # index makes storing it the idempotency check.
    stored = await fetchrow(
        """
        insert into payment_webhook_events (provider, event_id, event_type, payload)
        values ('razorpay', $1, $2, $3::jsonb)
        on conflict (provider, event_id) do nothing
        returning id
        """,
        event_id,
        event_type,
        json.dumps(payload),
    )

    if stored is None:
        return {"handled": False, "reason": "already processed"}

    if event_type not in {"payment.captured", "order.paid"}:
        return {"handled": False, "reason": f"ignored event {event_type}"}

    entity = (
        payload.get("payload", {}).get("payment", {}).get("entity")
        or payload.get("payload", {}).get("order", {}).get("entity")
        or {}
    )
    razorpay_order_id = entity.get("order_id") or entity.get("id")
    razorpay_payment_id = entity.get("id")

    if not razorpay_order_id:
        return {"handled": False, "reason": "no order id in payload"}

    async with transaction() as connection:
        payment = await connection.fetchrow(
            "select id, order_id from payments where provider_order_id = $1",
            razorpay_order_id,
        )

        if payment is None:
            return {"handled": False, "reason": "unknown payment"}

        await connection.execute(
            "update payments set status = 'captured', provider_payment_id = coalesce($2, provider_payment_id) where id = $1",
            payment["id"],
            razorpay_payment_id,
        )
        await connection.execute(
            """
            update orders
            set payment_status = 'paid',
                status = case when status = 'pending' then 'confirmed' else status end,
                confirmed_at = coalesce(confirmed_at, now())
            where id = $1 and payment_status <> 'paid'
            """,
            payment["order_id"],
        )

    await execute(
        "update payment_webhook_events set processed_at = now() where provider = 'razorpay' and event_id = $1",
        event_id,
    )

    return {"handled": True, "event": event_type}


async def payment_status(user_id: uuid.UUID, order_id: uuid.UUID) -> dict:
    """Lets the app ask whether a payment landed, for the case where checkout
    closed before it could confirm."""
    order = await fetchrow(
        "select customer_id, payment_status, status from orders where id = $1", order_id
    )

    if order is None or order["customer_id"] != user_id:
        raise not_found("order_not_found", "That order could not be found")

    return {"paymentStatus": order["payment_status"], "orderStatus": order["status"]}
