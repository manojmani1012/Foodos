"""The Foodos wallet: a prepaid balance that only pays for Foodos orders.

The balance lives on `wallets`, and every change to it is a row in the
append-only `wallet_transactions` ledger written in the same transaction, so
the two cannot drift apart. The wallet row is locked while it changes, which
is what stops two orders spending the same rupees.

Three ways in: a top-up through Razorpay, a refund for a cancelled wallet
order, and an adjustment by Foodos staff. One way out: paying for an order.
Nothing here can be withdrawn to a bank account.
"""

import uuid
from typing import Any, Optional

import asyncpg

from ...config import get_settings
from ...database import fetch, fetchrow, fetchval, transaction
from ...errors import bad_request, conflict, not_found
from ..payments import razorpay

REASON_LABELS = {
    "topup": "Added money",
    "refund": "Refund",
    "order_payment": "Order payment",
    "cashback": "Cashback",
    "adjustment": "Adjustment by Foodos",
}


def transaction_to_dict(row: Any) -> dict:
    return {
        "id": row["id"],
        "type": row["type"],
        "reason": row["reason"],
        "label": REASON_LABELS.get(row["reason"], row["reason"]),
        "amountPaise": row["amount_paise"],
        "balanceAfterPaise": row["balance_after_paise"],
        "orderNumber": row["order_number"],
        "note": row["note"] if row["reason"] == "adjustment" else None,
        "createdAt": row["created_at"].isoformat(),
    }


async def balance_of(user_id: uuid.UUID) -> int:
    return await fetchval("select balance_paise from wallets where user_id = $1", user_id) or 0


async def move(
    connection: asyncpg.Connection,
    user_id: uuid.UUID,
    kind: str,
    reason: str,
    amount_paise: int,
    order_id: Optional[uuid.UUID] = None,
    payment_id: Optional[uuid.UUID] = None,
    note: Optional[str] = None,
    created_by: Optional[uuid.UUID] = None,
    refund_id: Optional[uuid.UUID] = None,
) -> int:
    """Adds or removes money and writes the ledger row. Returns the new balance.

    Runs inside the caller's transaction, so a wallet order that fails halfway
    takes its debit back with it.
    """
    if amount_paise <= 0:
        raise bad_request("invalid_amount", "The amount must be more than zero")

    await connection.execute(
        "insert into wallets (user_id) values ($1) on conflict (user_id) do nothing", user_id
    )
    balance = await connection.fetchval(
        "select balance_paise from wallets where user_id = $1 for update", user_id
    )
    new_balance = balance + amount_paise if kind == "credit" else balance - amount_paise

    if new_balance < 0:
        raise conflict(
            "insufficient_wallet_balance",
            "There is not enough money in your Foodos wallet for this",
        )

    await connection.execute(
        "update wallets set balance_paise = $2 where user_id = $1", user_id, new_balance
    )
    await connection.execute(
        """
        insert into wallet_transactions
          (user_id, type, reason, amount_paise, balance_after_paise, order_id, payment_id, note, created_by,
           refund_id)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        """,
        user_id,
        kind,
        reason,
        amount_paise,
        new_balance,
        order_id,
        payment_id,
        note,
        created_by,
        refund_id,
    )

    return new_balance


def limits() -> dict:
    settings = get_settings()

    return {
        "maxBalancePaise": settings.wallet_max_balance_paise,
        "minTopUpPaise": settings.wallet_min_topup_paise,
        "maxTopUpPaise": settings.wallet_max_topup_paise,
    }


async def get_wallet(user_id: uuid.UUID, limit: int = 30, offset: int = 0) -> dict:
    rows = await fetch(
        """
        select t.id, t.type, t.reason, t.amount_paise, t.balance_after_paise, t.note, t.created_at,
               o.order_number
        from wallet_transactions t
        left join orders o on o.id = t.order_id
        where t.user_id = $1
        order by t.id desc
        limit $2 offset $3
        """,
        user_id,
        limit,
        offset,
    )
    total = await fetchval("select count(*)::int from wallet_transactions where user_id = $1", user_id)

    return {
        "balancePaise": await balance_of(user_id),
        "limits": limits(),
        "total": total,
        "transactions": [transaction_to_dict(row) for row in rows],
    }


# --- Adding money -----------------------------------------------------------


async def start_topup(user_id: uuid.UUID, amount_paise: int) -> dict:
    """Creates the Razorpay order the app opens checkout against."""
    settings = get_settings()

    if not razorpay.is_configured():
        raise bad_request("payment_method_unavailable", "Adding money is not available right now")

    if amount_paise < settings.wallet_min_topup_paise or amount_paise > settings.wallet_max_topup_paise:
        raise bad_request(
            "invalid_topup_amount",
            f"You can add between ₹{settings.wallet_min_topup_paise // 100} "
            f"and ₹{settings.wallet_max_topup_paise // 100} at a time",
        )

    if await balance_of(user_id) + amount_paise > settings.wallet_max_balance_paise:
        raise bad_request(
            "wallet_limit",
            f"Your wallet can hold up to ₹{settings.wallet_max_balance_paise // 100}. "
            "Add a smaller amount, or use some of the balance first",
        )

    user = await fetchrow("select full_name, phone, email from users where id = $1", user_id)
    created = await razorpay.create_order(
        amount_paise=amount_paise,
        receipt=f"wallet-{str(user_id)[:8]}-{uuid.uuid4().hex[:8]}",
        notes={"purpose": "wallet_topup", "userId": str(user_id)},
    )

    # Recorded before checkout opens, like an order payment, so the webhook can
    # still match a payment that succeeds while the phone loses signal.
    await fetchval(
        """
        insert into payments (order_id, user_id, provider, method, amount_paise, status, provider_order_id)
        values (null, $1, 'razorpay', 'upi', $2, 'created', $3)
        returning id
        """,
        user_id,
        amount_paise,
        created["id"],
    )

    return {
        "razorpayOrderId": created["id"],
        "keyId": get_settings().razorpay_key_id,
        "amountPaise": amount_paise,
        "currency": "INR",
        "orderNumber": "Foodos wallet",
        "customer": {"name": user["full_name"], "phone": user["phone"], "email": user["email"]},
    }


async def credit_topup(connection: asyncpg.Connection, payment: Any, provider_payment_id: Optional[str]) -> bool:
    """Marks a top-up captured and credits it, once. False if it already was."""
    updated = await connection.fetchval(
        """
        update payments
        set status = 'captured', provider_payment_id = coalesce($2, provider_payment_id)
        where id = $1 and status <> 'captured'
        returning id
        """,
        payment["id"],
        provider_payment_id,
    )

    if updated is None:
        return False

    # The money has already left the customer, so a top-up is credited even if
    # it takes the wallet past the cap. The cap is checked when it is started.
    await move(connection, payment["user_id"], "credit", "topup", payment["amount_paise"], payment_id=payment["id"])

    return True


async def confirm_topup(
    user_id: uuid.UUID, razorpay_order_id: str, razorpay_payment_id: str, signature: str
) -> dict:
    if not razorpay.verify_payment_signature(razorpay_order_id, razorpay_payment_id, signature):
        raise bad_request("payment_signature_invalid", "That payment could not be verified")

    async with transaction() as connection:
        payment = await connection.fetchrow(
            """
            select id, user_id, amount_paise from payments
            where provider_order_id = $1 and user_id = $2 and order_id is null and purpose is null
            for update
            """,
            razorpay_order_id,
            user_id,
        )

        if payment is None:
            raise not_found("payment_not_found", "That payment could not be found")

        await credit_topup(connection, payment, razorpay_payment_id)

    return {"balancePaise": await balance_of(user_id)}


async def topup_status(user_id: uuid.UUID) -> dict:
    """For when checkout closed before the app could confirm."""
    return {"balancePaise": await balance_of(user_id)}


# --- Paying and being refunded ---------------------------------------------


async def pay_for_order(
    connection: asyncpg.Connection, user_id: uuid.UUID, order_id: uuid.UUID, total_paise: int
) -> None:
    """Spends the wallet on an order, inside the order's own transaction."""
    await move(connection, user_id, "debit", "order_payment", total_paise, order_id=order_id)
    await connection.execute(
        """
        insert into payments (order_id, user_id, provider, method, amount_paise, status)
        values ($1, $2, 'wallet', 'wallet', $3, 'captured')
        """,
        order_id,
        user_id,
        total_paise,
    )


async def adjust(
    user_id: uuid.UUID, kind: str, amount_paise: int, note: str, actor_id: uuid.UUID
) -> int:
    """Foodos staff correcting a balance. The caller records it in the audit log."""
    async with transaction() as connection:
        exists = await connection.fetchval("select 1 from users where id = $1", user_id)

        if not exists:
            raise not_found("customer_not_found", "That customer could not be found")

        return await move(
            connection, user_id, kind, "adjustment", amount_paise, note=note, created_by=actor_id
        )
