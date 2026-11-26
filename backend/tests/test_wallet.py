"""The Foodos wallet: adding money, paying with it, and getting it back.

The ledger is the thing to protect: the balance must always equal the sum of
its rows, and the same payment or refund must never land twice.
"""

import json

import pytest

from app.database import execute, fetchrow, fetchval

from test_admin import admin  # noqa: F401 - fixture
from test_payments import (  # noqa: F401 - fixtures and helpers
    ADDRESS,
    fake_gateway,
    make_menu_item,
    razorpay_configured,
    sign_in,
    sign_payment,
    sign_webhook,
)
from test_refunds import refund_gateway  # noqa: F401 - fixture

WALLET = "/api/v1/customer/wallet"


async def add_money(client, session, amount_paise: int, payment_id: str = "pay_wallet_1") -> dict:
    """A top-up the way the app does it: start, pay in checkout, confirm."""
    started = await client.post(f"{WALLET}/topup", json={"amountPaise": amount_paise}, headers=session["headers"])
    assert started.status_code == 200, started.text
    payment = started.json()["payment"]

    confirmed = await client.post(
        f"{WALLET}/topup/confirm",
        json={
            "razorpayOrderId": payment["razorpayOrderId"],
            "razorpayPaymentId": payment_id,
            "razorpaySignature": sign_payment(payment["razorpayOrderId"], payment_id),
        },
        headers=session["headers"],
    )
    assert confirmed.status_code == 200, confirmed.text

    return payment


async def order_with_wallet(client, session, item):
    return await client.post(
        "/api/v1/customer/orders",
        json={
            "items": [{"menuItemId": str(item), "quantity": 1}],
            "paymentMethod": "wallet",
            "address": ADDRESS,
        },
        headers=session["headers"],
    )


async def balance(client, session) -> int:
    return (await client.get(WALLET, headers=session["headers"])).json()["balancePaise"]


async def ledger_matches_balance(user_id) -> bool:
    return await fetchval(
        """
        select w.balance_paise = coalesce(sum(case t.type when 'credit' then t.amount_paise else -t.amount_paise end), 0)
        from wallets w left join wallet_transactions t on t.user_id = w.user_id
        where w.user_id = $1
        group by w.balance_paise
        """,
        user_id,
    )


class TestAddingMoney:
    async def test_a_new_wallet_is_empty_with_its_limits(self, client, fake_gateway):
        session = await sign_in(client)
        wallet = (await client.get(WALLET, headers=session["headers"])).json()

        assert wallet["balancePaise"] == 0
        assert wallet["transactions"] == []
        assert wallet["limits"]["maxBalancePaise"] >= wallet["limits"]["maxTopUpPaise"]

    async def test_a_confirmed_top_up_is_credited(self, client, fake_gateway):
        session = await sign_in(client)
        await add_money(client, session, 50000)

        wallet = (await client.get(WALLET, headers=session["headers"])).json()

        assert wallet["balancePaise"] == 50000
        assert wallet["transactions"][0]["reason"] == "topup"
        assert wallet["transactions"][0]["balanceAfterPaise"] == 50000
        assert await ledger_matches_balance(session["user"]["id"])

    async def test_a_forged_confirmation_credits_nothing(self, client, fake_gateway):
        session = await sign_in(client)
        started = await client.post(f"{WALLET}/topup", json={"amountPaise": 50000}, headers=session["headers"])
        payment = started.json()["payment"]

        response = await client.post(
            f"{WALLET}/topup/confirm",
            json={
                "razorpayOrderId": payment["razorpayOrderId"],
                "razorpayPaymentId": "pay_forged",
                "razorpaySignature": "0" * 64,
            },
            headers=session["headers"],
        )

        assert response.status_code == 400
        assert await balance(client, session) == 0

    async def test_the_app_and_the_webhook_credit_it_only_once(self, client, fake_gateway):
        session = await sign_in(client)
        payment = await add_money(client, session, 50000, "pay_wallet_1")

        body = json.dumps(
            {
                "id": "evt_wallet_1",
                "event": "payment.captured",
                "payload": {
                    "payment": {
                        "entity": {"id": "pay_wallet_1", "order_id": payment["razorpayOrderId"], "status": "captured"}
                    }
                },
            }
        ).encode()
        response = await client.post(
            "/api/v1/webhooks/razorpay",
            content=body,
            headers={"x-razorpay-signature": sign_webhook(body), "content-type": "application/json"},
        )

        assert response.status_code == 200, response.text
        assert await balance(client, session) == 50000

    async def test_the_webhook_credits_a_top_up_the_app_never_confirmed(self, client, fake_gateway):
        session = await sign_in(client)
        started = await client.post(f"{WALLET}/topup", json={"amountPaise": 30000}, headers=session["headers"])
        razorpay_order_id = started.json()["payment"]["razorpayOrderId"]

        body = json.dumps(
            {
                "id": "evt_wallet_2",
                "event": "payment.captured",
                "payload": {"payment": {"entity": {"id": "pay_wallet_2", "order_id": razorpay_order_id}}},
            }
        ).encode()
        await client.post(
            "/api/v1/webhooks/razorpay",
            content=body,
            headers={"x-razorpay-signature": sign_webhook(body), "content-type": "application/json"},
        )

        assert await balance(client, session) == 30000
        assert await ledger_matches_balance(session["user"]["id"])

    async def test_someone_elses_top_up_cannot_be_claimed(self, client, fake_gateway):
        owner = await sign_in(client, "9876543210")
        thief = await sign_in(client, "9876543299")
        started = await client.post(f"{WALLET}/topup", json={"amountPaise": 50000}, headers=owner["headers"])
        payment = started.json()["payment"]

        response = await client.post(
            f"{WALLET}/topup/confirm",
            json={
                "razorpayOrderId": payment["razorpayOrderId"],
                "razorpayPaymentId": "pay_x_1",
                "razorpaySignature": sign_payment(payment["razorpayOrderId"], "pay_x_1"),
            },
            headers=thief["headers"],
        )

        assert response.status_code == 404
        assert await balance(client, thief) == 0

    @pytest.mark.parametrize("amount", [100, 600000])
    async def test_an_amount_outside_the_limits_is_refused(self, client, fake_gateway, amount):
        session = await sign_in(client)
        response = await client.post(f"{WALLET}/topup", json={"amountPaise": amount}, headers=session["headers"])

        assert response.status_code == 400
        assert response.json()["code"] == "invalid_topup_amount"
        assert fake_gateway == []

    async def test_the_wallet_cannot_go_past_its_cap(self, client, fake_gateway):
        session = await sign_in(client)

        for index in range(2):
            await add_money(client, session, 500000, f"pay_cap_{index}")

        response = await client.post(f"{WALLET}/topup", json={"amountPaise": 10000}, headers=session["headers"])

        assert response.status_code == 400
        assert response.json()["code"] == "wallet_limit"


class TestPayingWithTheWallet:
    async def test_it_pays_for_an_order_and_the_kitchen_sees_it_at_once(self, client, fake_gateway):
        item = await make_menu_item()
        session = await sign_in(client)
        await add_money(client, session, 100000)

        response = await order_with_wallet(client, session, item)

        assert response.status_code == 201, response.text
        order = response.json()["order"]
        assert order["status"] == "confirmed"
        assert order["paymentStatus"] == "paid"
        assert order["paymentMethod"] == "wallet"
        assert await balance(client, session) == 100000 - order["totalPaise"]
        assert await ledger_matches_balance(session["user"]["id"])

        payment = await fetchrow("select provider, status, amount_paise from payments where order_id = $1", __import__("uuid").UUID(order["id"]))
        assert (payment["provider"], payment["status"], payment["amount_paise"]) == ("wallet", "captured", order["totalPaise"])

    async def test_it_works_without_the_payment_gateway(self, client, monkeypatch):
        from app.config import get_settings

        settings = get_settings()
        monkeypatch.setattr(settings, "razorpay_key_id", "", raising=False)
        monkeypatch.setattr(settings, "razorpay_key_secret", "", raising=False)
        item = await make_menu_item()
        session = await sign_in(client)
        # Money in the wallet already, whatever the gateway is doing now.
        await execute("insert into wallets (user_id, balance_paise) values ($1, 100000)", __import__("uuid").UUID(session["user"]["id"]))

        response = await order_with_wallet(client, session, item)

        assert response.status_code == 201, response.text

    async def test_not_enough_money_places_no_order(self, client, fake_gateway):
        item = await make_menu_item()
        session = await sign_in(client)
        await add_money(client, session, 10000)

        response = await order_with_wallet(client, session, item)

        assert response.status_code == 409
        assert response.json()["code"] == "insufficient_wallet_balance"
        assert await fetchval("select count(*)::int from orders") == 0
        assert await balance(client, session) == 10000

    async def test_one_balance_cannot_pay_two_orders_at_once(self, client, fake_gateway):
        import asyncio

        item = await make_menu_item()
        session = await sign_in(client)
        # Enough for one order, not two.
        quote = (
            await client.post(
                "/api/v1/customer/cart/quote",
                json={"items": [{"menuItemId": str(item), "quantity": 1}], "address": ADDRESS},
                headers=session["headers"],
            )
        ).json()
        total = quote["quote"]["totalPaise"] if "quote" in quote else quote["totalPaise"]
        await execute(
            "insert into wallets (user_id, balance_paise) values ($1, $2)",
            __import__("uuid").UUID(session["user"]["id"]),
            total + 100,
        )

        results = await asyncio.gather(
            order_with_wallet(client, session, item), order_with_wallet(client, session, item)
        )

        assert sorted(r.status_code for r in results) == [201, 409]
        assert await balance(client, session) == 100


class TestRefundsToTheWallet:
    async def test_a_cancelled_wallet_order_goes_straight_back(self, client, fake_gateway, refund_gateway):
        item = await make_menu_item()
        session = await sign_in(client)
        await add_money(client, session, 100000)
        order = (await order_with_wallet(client, session, item)).json()["order"]

        cancelled = await client.post(
            f"/api/v1/customer/orders/{order['id']}/cancel", json={}, headers=session["headers"]
        )

        assert cancelled.status_code == 200, cancelled.text
        result = cancelled.json()["order"]
        assert result["paymentStatus"] == "refunded"
        assert result["refund"]["status"] == "processed"
        assert await balance(client, session) == 100000
        # The card gateway is never involved.
        assert refund_gateway["calls"] == []
        assert await ledger_matches_balance(session["user"]["id"])

    async def test_it_is_refunded_once_however_often_it_is_asked(self, client, fake_gateway, refund_gateway):
        from app.components.payments.refunds import refund_if_paid

        item = await make_menu_item()
        session = await sign_in(client)
        await add_money(client, session, 100000)
        order = (await order_with_wallet(client, session, item)).json()["order"]
        await client.post(f"/api/v1/customer/orders/{order['id']}/cancel", json={}, headers=session["headers"])

        import uuid

        await refund_if_paid(uuid.UUID(order["id"]), "again", None)
        await refund_if_paid(uuid.UUID(order["id"]), "and again", None)

        assert await balance(client, session) == 100000
        assert await fetchval("select count(*)::int from refunds") == 1


class TestAdminAdjustments:
    async def test_staff_can_credit_with_a_reason(self, client, fake_gateway, admin):
        session = await sign_in(client)

        response = await client.post(
            f"/api/v1/admin/customers/{session['user']['id']}/wallet",
            json={"type": "credit", "amountPaise": 5000, "reason": "Goodwill for a late order"},
            headers=admin,
        )

        assert response.status_code == 200, response.text
        assert response.json()["balancePaise"] == 5000

        mine = (await client.get(WALLET, headers=session["headers"])).json()["transactions"][0]
        assert mine["label"] == "Adjustment by Foodos"
        assert mine["note"] == "Goodwill for a late order"

        detail = (await client.get(f"/api/v1/admin/customers/{session['user']['id']}", headers=admin)).json()["customer"]
        assert detail["wallet"]["balancePaise"] == 5000

        activity = (await client.get("/api/v1/admin/activity", params={"module": "Customers"}, headers=admin)).json()["activity"]
        assert any(entry["action"] == "wallet_credit" for entry in activity)

    async def test_a_reason_is_required_and_a_debit_cannot_overdraw(self, client, fake_gateway, admin):
        session = await sign_in(client)
        url = f"/api/v1/admin/customers/{session['user']['id']}/wallet"

        no_reason = await client.post(url, json={"type": "credit", "amountPaise": 5000, "reason": ""}, headers=admin)
        overdraw = await client.post(
            url, json={"type": "debit", "amountPaise": 5000, "reason": "Taking back a mistake"}, headers=admin
        )

        assert no_reason.status_code == 400
        assert overdraw.status_code == 409

    async def test_a_customer_cannot_adjust_a_wallet(self, client, fake_gateway):
        session = await sign_in(client)

        response = await client.post(
            f"/api/v1/admin/customers/{session['user']['id']}/wallet",
            json={"type": "credit", "amountPaise": 5000, "reason": "Give me money"},
            headers=session["headers"],
        )

        assert response.status_code in (401, 403)


class TestDeletingAnAccount:
    async def test_money_in_the_wallet_stops_the_deletion(self, client, fake_gateway):
        session = await sign_in(client)
        await add_money(client, session, 20000)

        response = await client.delete("/api/v1/customer/account", headers=session["headers"])

        assert response.status_code == 409
        assert response.json()["code"] == "wallet_not_empty"
