"""The cash on delivery switch, and floating cash: the limit staff set, what it
blocks, and "Deposit now" through Razorpay."""

import hashlib
import hmac
import json
import uuid

import pytest

from app.components.delivery import cash
from app.components.wallet import service as wallet
from app.config import get_settings
from app.database import fetchval
from app.errors import AppError

from test_admin import admin  # noqa: F401 - fixture
from test_delivery import rider
from test_payments import fake_gateway, razorpay_configured  # noqa: F401 - fixtures
from test_payouts_phase1 import delivered_cash_order, settings_body
from test_restaurant_portal import make_item, owner_with_restaurant, sign_in


async def save(client, admin, **changes):
    response = await client.put("/api/v1/admin/finance/settings", json=settings_body(**changes), headers=admin)
    assert response.status_code == 200, response.text


class TestCodSwitch:
    async def test_cash_is_on_until_staff_turn_it_off(self, client, admin):
        _, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        cart = {"items": [{"menuItemId": str(item), "quantity": 1}]}

        assert (await client.post("/api/v1/customer/cart/quote", json=cart)).json()["codAvailable"] is True

        await save(client, admin, codEnabled=False)

        assert (await client.post("/api/v1/customer/cart/quote", json=cart)).json()["codAvailable"] is False

        customer = await sign_in(client, "9876543210", "customer")
        response = await client.post(
            "/api/v1/customer/orders",
            json={**cart, "paymentMethod": "cod", "address": {"line1": "12 Anna Nagar", "city": "Chennai",
                  "latitude": 13.086, "longitude": 80.211}},
            headers=customer["headers"],
        )

        assert response.status_code == 400 and response.json()["code"] == "cod_unavailable", response.text
        assert await fetchval("select count(*) from orders") == 0


class TestLimit:
    async def test_the_setting_overrides_the_server_default(self, client, admin):
        assert cash.limit_paise() == get_settings().rider_cash_limit_paise

        body = (await client.get("/api/v1/admin/finance/settings", headers=admin)).json()
        assert body["settings"]["riderCashLimitPaise"] is None
        assert body["serverCashLimitPaise"] == get_settings().rider_cash_limit_paise

        await save(client, admin, riderCashLimitPaise=50000)
        assert cash.limit_paise() == 50000

        await save(client, admin, riderCashLimitPaise=0)
        assert cash.limit_paise() == 0
        assert cash.summary_of(10**9)["limitReached"] is False
        assert cash.skip_limit("cod", "pending") is True

    async def test_what_the_limit_blocks(self, client, admin):
        await save(client, admin, riderCashLimitPaise=100)
        assert cash.skip_limit("cod", "pending") is False
        assert cash.skip_limit("upi", "paid") is True

        await save(client, admin, riderCashLimitPaise=100, riderCashBlock="all_orders")
        assert cash.skip_limit("upi", "paid") is False
        assert cash.summary_of(100)["blocks"] == "all_orders"


def signature(order_id: str, payment_id: str) -> str:
    return hmac.new(
        get_settings().razorpay_key_secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256
    ).hexdigest()


async def holding_cash(client):
    order, _, _, arjun, _ = await delivered_cash_order(client)

    return arjun, order["totalPaise"]


async def start(client, arjun, amount):
    return await client.post("/api/v1/delivery/cash/deposit", json={"amountPaise": amount}, headers=arjun["headers"])


async def confirm(client, arjun, order_id, payment_id="pay_cash1"):
    return await client.post(
        "/api/v1/delivery/cash/deposit/confirm",
        json={"razorpayOrderId": order_id, "razorpayPaymentId": payment_id,
              "razorpaySignature": signature(order_id, payment_id)},
        headers=arjun["headers"],
    )


class TestDepositNow:
    async def test_paying_online_clears_the_cash(self, client, admin, razorpay_configured, fake_gateway):
        arjun, held = await holding_cash(client)
        await save(client, admin, riderCashLimitPaise=held)

        mine = (await client.get("/api/v1/delivery/cash", headers=arjun["headers"])).json()
        assert mine["cash"]["inHandPaise"] == held and mine["cash"]["limitReached"] is True

        started = await start(client, arjun, held)
        assert started.status_code == 200, started.text
        order_id = started.json()["payment"]["razorpayOrderId"]

        # Nothing changes until the payment is confirmed.
        assert await cash.in_hand(arjun["userId"]) == held

        for _ in range(2):
            done = await confirm(client, arjun, order_id)
            assert done.status_code == 200, done.text

        assert done.json()["cash"]["inHandPaise"] == 0 and done.json()["cash"]["limitReached"] is False
        assert await fetchval("select count(*) from rider_cash_deposits") == 1
        assert await fetchval("select count(*) from earnings_entries where kind = 'cash_deposit'") == 1
        assert await fetchval("select amount_paise from earnings_entries where kind = 'cash_deposit'") == held

        deposits = (await client.get("/api/v1/delivery/cash", headers=arjun["headers"])).json()["deposits"]
        assert deposits[0]["online"] is True and deposits[0]["reference"] == "pay_cash1"

    async def test_the_amount_must_be_within_the_cash_held(self, client, razorpay_configured, fake_gateway):
        arjun, held = await holding_cash(client)

        assert (await start(client, arjun, held + 1)).json()["code"] == "invalid_deposit_amount"
        assert (await start(client, arjun, 99)).status_code == 400

        other = await rider(client, "9100000002")
        assert (await start(client, other, 500)).json()["code"] == "no_cash_to_deposit"

    async def test_a_bad_signature_or_someone_elses_payment_records_nothing(
        self, client, razorpay_configured, fake_gateway
    ):
        arjun, held = await holding_cash(client)
        order_id = (await start(client, arjun, held)).json()["payment"]["razorpayOrderId"]

        bad = await client.post(
            "/api/v1/delivery/cash/deposit/confirm",
            json={"razorpayOrderId": order_id, "razorpayPaymentId": "pay_x", "razorpaySignature": "no"},
            headers=arjun["headers"],
        )
        assert bad.status_code == 400

        other = await rider(client, "9100000002")
        assert (await confirm(client, other, order_id)).status_code == 404
        assert await fetchval("select count(*) from rider_cash_deposits") == 0

    async def test_a_deposit_payment_cannot_become_wallet_money(self, client, razorpay_configured, fake_gateway):
        arjun, held = await holding_cash(client)
        order_id = (await start(client, arjun, held)).json()["payment"]["razorpayOrderId"]

        # The same person may be a customer too, so the wallet's own confirm
        # must not recognise this payment.
        with pytest.raises(AppError) as refused:
            await wallet.confirm_topup(
                uuid.UUID(arjun["userId"]), order_id, "pay_w", signature(order_id, "pay_w")
            )

        assert refused.value.status == 404
        assert await fetchval("select count(*) from wallet_transactions") == 0

    async def test_the_webhook_records_it_once(self, client, razorpay_configured, fake_gateway, monkeypatch):
        arjun, held = await holding_cash(client)
        order_id = (await start(client, arjun, held)).json()["payment"]["razorpayOrderId"]
        monkeypatch.setattr(get_settings(), "razorpay_webhook_secret", "hook-secret")

        async def deliver(event_id):
            body = json.dumps(
                {"id": event_id, "event": "payment.captured",
                 "payload": {"payment": {"entity": {"id": "pay_hook1", "order_id": order_id}}}}
            ).encode()

            return await client.post(
                "/api/v1/webhooks/razorpay",
                content=body,
                headers={"x-razorpay-signature": hmac.new(b"hook-secret", body, hashlib.sha256).hexdigest()},
            )

        assert (await deliver("evt_1")).json()["cashDeposit"] is True
        await deliver("evt_2")
        await confirm(client, arjun, order_id, "pay_hook1")

        assert await fetchval("select count(*) from rider_cash_deposits") == 1
        assert await fetchval("select count(*) from wallet_transactions") == 0
