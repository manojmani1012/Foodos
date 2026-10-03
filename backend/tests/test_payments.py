"""Razorpay payment flow.

No test here reaches Razorpay's servers: the one HTTP call is stubbed, and the
signature checks run against locally computed HMACs, which is exactly what the
real ones are.
"""

import hashlib
import hmac
import json

import pytest

from app.components.payments import razorpay, service as payment_service
from app.config import get_settings
from app.database import execute, fetchrow, fetchval

KEY_ID = "rzp_test_fake"
KEY_SECRET = "fake-secret-for-tests"
WEBHOOK_SECRET = "fake-webhook-secret"

ADDRESS = {"label": "Home", "line1": "12, Lake View Road", "city": "Chennai"}


@pytest.fixture(autouse=True)
def razorpay_configured(monkeypatch):
    """Turns the gateway on for this file only, with made-up keys."""
    settings = get_settings()
    monkeypatch.setattr(settings, "razorpay_key_id", KEY_ID, raising=False)
    monkeypatch.setattr(settings, "razorpay_key_secret", KEY_SECRET, raising=False)
    monkeypatch.setattr(settings, "razorpay_webhook_secret", WEBHOOK_SECRET, raising=False)

    yield


@pytest.fixture
def fake_gateway(monkeypatch):
    """Stands in for the one outbound HTTP call."""
    created: list[dict] = []

    async def create_order(amount_paise: int, receipt: str, notes=None):
        order = {
            "id": f"order_test_{len(created) + 1}",
            "amount": amount_paise,
            "currency": "INR",
            "receipt": receipt,
        }
        created.append(order)

        return order

    monkeypatch.setattr(razorpay, "create_order", create_order)

    return created


def sign_payment(razorpay_order_id: str, razorpay_payment_id: str) -> str:
    """What Razorpay's checkout returns, computed the same way they do."""
    return hmac.new(
        KEY_SECRET.encode(),
        f"{razorpay_order_id}|{razorpay_payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()


def sign_webhook(body: bytes) -> str:
    return hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()


async def sign_in(client, phone: str = "9876543210") -> dict:
    code = (await client.post("/api/v1/auth/otp/request", json={"phone": phone})).json()["devCode"]
    body = (
        await client.post(
            "/api/v1/auth/otp/verify", json={"phone": phone, "code": code, "role": "customer"}
        )
    ).json()

    return {"headers": {"authorization": f"Bearer {body['accessToken']}"}, "user": body["user"]}


async def make_menu_item():
    owner = await fetchval(
        "insert into users (phone, full_name) values ('+919000000001', 'Owner') returning id"
    )
    await execute("insert into user_roles (user_id, role) values ($1, 'restaurant_owner')", owner)
    restaurant = await fetchval(
        """
        insert into restaurants (owner_id, name, cuisines, address_line, city, status)
        values ($1, 'The Biryani House', '{Biryani}', 'Anna Nagar', 'Chennai', 'active')
        returning id
        """,
        owner,
    )

    return await fetchval(
        """
        insert into menu_items (restaurant_id, name, price_paise, is_veg)
        values ($1, 'Chicken Biryani', 24900, false) returning id
        """,
        restaurant,
    )


async def place_prepaid_order(client, session, item) -> dict:
    response = await client.post(
        "/api/v1/customer/orders",
        json={
            "items": [{"menuItemId": str(item), "quantity": 1}],
            "paymentMethod": "upi",
            "address": ADDRESS,
        },
        headers=session["headers"],
    )

    assert response.status_code == 201, response.text

    return response.json()["order"]


class TestPrepaidOrders:
    async def test_a_prepaid_order_waits_for_payment(self, client, fake_gateway):
        item = await make_menu_item()
        session = await sign_in(client)

        order = await place_prepaid_order(client, session, item)

        # Not confirmed: a restaurant must never start cooking an unpaid order.
        assert order["status"] == "pending"
        assert order["paymentStatus"] == "pending"

    async def test_a_cash_order_is_confirmed_at_once(self, client, fake_gateway):
        item = await make_menu_item()
        session = await sign_in(client)

        response = await client.post(
            "/api/v1/customer/orders",
            json={
                "items": [{"menuItemId": str(item), "quantity": 1}],
                "paymentMethod": "cod",
                "address": ADDRESS,
            },
            headers=session["headers"],
        )

        assert response.json()["order"]["status"] == "confirmed"

    async def test_a_pending_order_is_invisible_to_the_restaurant(self, client, fake_gateway):
        item = await make_menu_item()
        session = await sign_in(client)
        await place_prepaid_order(client, session, item)

        owner_code = (
            await client.post("/api/v1/auth/otp/request", json={"phone": "9000000001"})
        ).json()["devCode"]
        owner = (
            await client.post(
                "/api/v1/auth/otp/verify",
                json={"phone": "9000000001", "code": owner_code, "role": "restaurant_owner"},
            )
        ).json()

        queue = await client.get(
            "/api/v1/restaurant/orders?queue=new",
            headers={"authorization": f"Bearer {owner['accessToken']}"},
        )

        assert queue.json()["orders"] == []


class TestStartingPayment:
    async def test_returns_the_key_id_but_never_the_secret(self, client, fake_gateway):
        item = await make_menu_item()
        session = await sign_in(client)
        order = await place_prepaid_order(client, session, item)

        response = await client.post(
            f"/api/v1/customer/orders/{order['id']}/pay", headers=session["headers"]
        )

        assert response.status_code == 200
        payment = response.json()["payment"]
        assert payment["keyId"] == KEY_ID
        assert payment["razorpayOrderId"].startswith("order_test_")
        assert payment["amountPaise"] == order["totalPaise"]
        # The secret authorises payments; it must never leave the server.
        assert KEY_SECRET not in json.dumps(response.json())

    async def test_records_the_payment_before_checkout_opens(self, client, fake_gateway):
        item = await make_menu_item()
        session = await sign_in(client)
        order = await place_prepaid_order(client, session, item)

        await client.post(f"/api/v1/customer/orders/{order['id']}/pay", headers=session["headers"])

        row = await fetchrow("select status, provider, provider_order_id from payments")

        # Written first, so a payment that succeeds while the phone drops off
        # can still be matched by the webhook.
        assert row["status"] == "created"
        assert row["provider"] == "razorpay"
        assert row["provider_order_id"].startswith("order_test_")

    async def test_cannot_pay_for_someone_elses_order(self, client, fake_gateway):
        item = await make_menu_item()
        owner = await sign_in(client, "9876543210")
        intruder = await sign_in(client, "9123456789")
        order = await place_prepaid_order(client, owner, item)

        response = await client.post(
            f"/api/v1/customer/orders/{order['id']}/pay", headers=intruder["headers"]
        )

        assert response.status_code == 404


class TestConfirmingPayment:
    async def test_a_correctly_signed_payment_confirms_the_order(self, client, fake_gateway):
        item = await make_menu_item()
        session = await sign_in(client)
        order = await place_prepaid_order(client, session, item)

        payment = (
            await client.post(
                f"/api/v1/customer/orders/{order['id']}/pay", headers=session["headers"]
            )
        ).json()["payment"]

        razorpay_order_id = payment["razorpayOrderId"]
        razorpay_payment_id = "pay_test_1"

        response = await client.post(
            f"/api/v1/customer/orders/{order['id']}/pay/confirm",
            json={
                "razorpayOrderId": razorpay_order_id,
                "razorpayPaymentId": razorpay_payment_id,
                "razorpaySignature": sign_payment(razorpay_order_id, razorpay_payment_id),
            },
            headers=session["headers"],
        )

        assert response.status_code == 200
        assert response.json()["paid"] is True

        row = await fetchrow(
            "select status, payment_status from orders where id = $1::uuid", order["id"]
        )
        assert row["payment_status"] == "paid"
        assert row["status"] == "confirmed", "paid, so the restaurant can see it"

    async def test_a_forged_signature_is_refused(self, client, fake_gateway):
        item = await make_menu_item()
        session = await sign_in(client)
        order = await place_prepaid_order(client, session, item)

        payment = (
            await client.post(
                f"/api/v1/customer/orders/{order['id']}/pay", headers=session["headers"]
            )
        ).json()["payment"]

        # Anyone can call this endpoint claiming they paid. Only a signature made
        # with the key secret proves it.
        response = await client.post(
            f"/api/v1/customer/orders/{order['id']}/pay/confirm",
            json={
                "razorpayOrderId": payment["razorpayOrderId"],
                "razorpayPaymentId": "pay_fake",
                "razorpaySignature": "0" * 64,
            },
            headers=session["headers"],
        )

        assert response.status_code == 400
        assert response.json()["code"] == "payment_signature_invalid"

        row = await fetchrow(
            "select status, payment_status from orders where id = $1::uuid", order["id"]
        )
        assert row["payment_status"] == "pending", "an unpaid order must stay unpaid"
        assert row["status"] == "pending"

    async def test_confirming_twice_is_harmless(self, client, fake_gateway):
        item = await make_menu_item()
        session = await sign_in(client)
        order = await place_prepaid_order(client, session, item)

        payment = (
            await client.post(
                f"/api/v1/customer/orders/{order['id']}/pay", headers=session["headers"]
            )
        ).json()["payment"]

        body = {
            "razorpayOrderId": payment["razorpayOrderId"],
            "razorpayPaymentId": "pay_test_1",
            "razorpaySignature": sign_payment(payment["razorpayOrderId"], "pay_test_1"),
        }

        first = await client.post(
            f"/api/v1/customer/orders/{order['id']}/pay/confirm",
            json=body,
            headers=session["headers"],
        )
        second = await client.post(
            f"/api/v1/customer/orders/{order['id']}/pay/confirm",
            json=body,
            headers=session["headers"],
        )

        assert first.status_code == 200
        assert second.status_code == 200
        assert await fetchval("select count(*) from order_status_history where status = 'confirmed'") == 1


class TestWebhook:
    async def test_an_unsigned_webhook_is_rejected(self, client, fake_gateway):
        response = await client.post(
            "/api/v1/webhooks/razorpay",
            content=json.dumps({"event": "payment.captured"}),
            headers={"content-type": "application/json"},
        )

        assert response.status_code == 400
        assert response.json()["code"] == "webhook_signature_invalid"

    async def test_a_signed_webhook_marks_the_order_paid(self, client, fake_gateway):
        item = await make_menu_item()
        session = await sign_in(client)
        order = await place_prepaid_order(client, session, item)

        payment = (
            await client.post(
                f"/api/v1/customer/orders/{order['id']}/pay", headers=session["headers"]
            )
        ).json()["payment"]

        body = json.dumps(
            {
                "id": "evt_test_1",
                "event": "payment.captured",
                "payload": {
                    "payment": {
                        "entity": {"id": "pay_hook_1", "order_id": payment["razorpayOrderId"]}
                    }
                },
            }
        ).encode()

        response = await client.post(
            "/api/v1/webhooks/razorpay",
            content=body,
            headers={
                "content-type": "application/json",
                "x-razorpay-signature": sign_webhook(body),
            },
        )

        assert response.status_code == 200
        assert response.json()["handled"] is True

        row = await fetchrow(
            "select status, payment_status from orders where id = $1::uuid", order["id"]
        )
        assert row["payment_status"] == "paid"
        assert row["status"] == "confirmed"

    async def test_a_repeated_webhook_is_ignored(self, client, fake_gateway):
        item = await make_menu_item()
        session = await sign_in(client)
        order = await place_prepaid_order(client, session, item)

        payment = (
            await client.post(
                f"/api/v1/customer/orders/{order['id']}/pay", headers=session["headers"]
            )
        ).json()["payment"]

        body = json.dumps(
            {
                "id": "evt_test_1",
                "event": "payment.captured",
                "payload": {
                    "payment": {
                        "entity": {"id": "pay_hook_1", "order_id": payment["razorpayOrderId"]}
                    }
                },
            }
        ).encode()
        headers = {"content-type": "application/json", "x-razorpay-signature": sign_webhook(body)}

        first = await client.post("/api/v1/webhooks/razorpay", content=body, headers=headers)
        # Razorpay retries; the same event must not be applied twice.
        second = await client.post("/api/v1/webhooks/razorpay", content=body, headers=headers)

        assert first.json()["handled"] is True
        assert second.json()["handled"] is False
        assert await fetchval("select count(*) from payment_webhook_events") == 1


class TestSignatureHelpers:
    def test_payment_signature_matches_razorpays_formula(self):
        # order_id|payment_id signed with the key secret, exactly as documented.
        assert razorpay.verify_payment_signature(
            "order_abc", "pay_xyz", sign_payment("order_abc", "pay_xyz")
        )

    def test_a_swapped_pair_does_not_verify(self):
        signature = sign_payment("order_abc", "pay_xyz")

        assert not razorpay.verify_payment_signature("order_xyz", "pay_abc", signature)
