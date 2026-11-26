"""Deposit now: a rider pays in the cash they hold, online through Razorpay.

It becomes the same cash deposit staff would record by hand: it lowers the cash
in hand (which lifts the limit) and is added back to the rider's next payout.
The app's confirmation and Razorpay's webhook both end here; only one records.
"""

import uuid
from typing import Any, Optional

import asyncpg

from ...config import get_settings
from ...database import fetchrow, fetchval, transaction
from ...errors import bad_request, not_found
from ..payments import razorpay
from ..payouts import ledger
from . import cash

PURPOSE = "rider_cash_deposit"
# Razorpay's smallest payment.
MIN_PAISE = 100


async def start(partner_id: uuid.UUID, amount_paise: int) -> dict:
    if not razorpay.is_configured():
        raise bad_request(
            "payment_method_unavailable",
            "Paying online is not available right now. Hand the cash to Foodos staff instead",
        )

    held = await cash.in_hand(partner_id)

    if held < MIN_PAISE:
        raise bad_request("no_cash_to_deposit", "You are not holding any cash to deposit")

    if amount_paise < MIN_PAISE or amount_paise > held:
        raise bad_request(
            "invalid_deposit_amount", f"You can deposit between Rs 1 and Rs {held / 100:,.2f}, the cash you hold"
        )

    user = await fetchrow("select full_name, phone, email from users where id = $1", partner_id)
    created = await razorpay.create_order(
        amount_paise=amount_paise,
        receipt=f"cash-{str(partner_id)[:8]}-{uuid.uuid4().hex[:8]}",
        notes={"purpose": PURPOSE, "userId": str(partner_id)},
    )
    # Recorded before checkout opens, so the webhook can match it.
    await fetchval(
        """
        insert into payments (order_id, user_id, provider, method, amount_paise, status, provider_order_id, purpose)
        values (null, $1, 'razorpay', 'upi', $2, 'created', $3, $4)
        returning id
        """,
        partner_id,
        amount_paise,
        created["id"],
        PURPOSE,
    )

    return {
        "razorpayOrderId": created["id"],
        "keyId": get_settings().razorpay_key_id,
        "amountPaise": amount_paise,
        "currency": "INR",
        "orderNumber": "Foodos cash deposit",
        "customer": {"name": user["full_name"], "phone": user["phone"], "email": user["email"]},
    }


async def record(connection: asyncpg.Connection, payment: Any, provider_payment_id: Optional[str]) -> bool:
    """Marks the payment captured and records the deposit, once. The money has
    left the rider, so it is recorded even if the cash held has since changed."""
    updated = await connection.fetchval(
        """
        update payments set status = 'captured', provider_payment_id = coalesce($2, provider_payment_id)
        where id = $1 and status <> 'captured'
        returning id
        """,
        payment["id"],
        provider_payment_id,
    )

    if updated is None:
        return False

    deposit_id = await connection.fetchval(
        """
        insert into rider_cash_deposits (partner_id, amount_paise, reference, payment_id)
        values ($1, $2, $3, $4)
        on conflict (payment_id) do nothing
        returning id
        """,
        payment["user_id"],
        payment["amount_paise"],
        provider_payment_id or "Paid online",
        payment["id"],
    )

    if deposit_id is None:
        return False

    await ledger.record_deposit(connection, deposit_id)

    return True


async def confirm(partner_id: uuid.UUID, razorpay_order_id: str, razorpay_payment_id: str, signature: str) -> dict:
    if not razorpay.verify_payment_signature(razorpay_order_id, razorpay_payment_id, signature):
        raise bad_request("payment_signature_invalid", "That payment could not be verified")

    async with transaction() as connection:
        payment = await connection.fetchrow(
            """
            select id, user_id, amount_paise from payments
            where provider_order_id = $1 and user_id = $2 and purpose = $3
            for update
            """,
            razorpay_order_id,
            partner_id,
            PURPOSE,
        )

        if payment is None:
            raise not_found("payment_not_found", "That payment could not be found")

        await record(connection, payment, razorpay_payment_id)

    return {"cash": await cash.summary(partner_id)}


async def status(partner_id: uuid.UUID) -> dict:
    """For when checkout closed before the app could confirm."""
    return {"cash": await cash.summary(partner_id), "deposits": await cash.deposits(partner_id)}
