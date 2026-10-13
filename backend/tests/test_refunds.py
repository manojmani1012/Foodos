"""Refunds: an online-paid order that gets cancelled gives the money back.

The restaurant app tells an owner that rejecting a paid order refunds the
customer. These tests are what make that sentence true.
"""

import json

import pytest

from app.components.payments import razorpay
from app.components.payments.refunds import refund_if_paid
from app.database import fetchrow, fetchval
from app.errors import AppError

# Fixtures and helpers are shared with the payment tests; importing the
# fixtures registers them for this module too.
from test_payments import (  # noqa: F401
    fake_gateway,
    make_menu_item,
    place_prepaid_order,
    razorpay_configured,
    sign_in,
    sign_payment,
    sign_webhook,
)

ADDRESS = {"label": "Home", "line1": "12, Lake View Road", "city": "Chennai"}


@pytest.fixture
def refund_gateway(monkeypatch):
    """Stands in for Razorpay's refund endpoint and records every call."""
    calls: list[dict] = []
    behaviour = {"fail": False, "status": "pending"}

    async def create_refund(provider_payment_id, amount_paise, notes=None):
        calls.append({"payment": provider_payment_id, "amount": amount_paise, "notes": notes})

        if behaviour["fail"]:
            raise AppError(502, "refund_gateway_error", "The refund could not be started.")

        return {"id": f"rfnd_test_{len(calls)}", "status": behaviour["status"], "amount": amount_paise}

    monkeypatch.setattr(razorpay, "create_refund", create_refund)

    return {"calls": calls, "behaviour": behaviour}


async def paid_order(client, fake_gateway, payment_id="pay_test_1"):
    """A prepaid order, paid and confirmed, as the restaurant would see it."""
    item = await make_menu_item()
    customer = await sign_in(client)
    order = await place_prepaid_order(client, customer, item)

    payment = (
        await client.post(f"/api/v1/customer/orders/{order['id']}/pay", headers=customer["headers"])
    ).json()["payment"]

    confirmed = await client.post(
        f"/api/v1/customer/orders/{order['id']}/pay/confirm",
        json={
            "razorpayOrderId": payment["razorpayOrderId"],
            "razorpayPaymentId": payment_id,
            "razorpaySignature": sign_payment(payment["razorpayOrderId"], payment_id),
        },
        headers=customer["headers"],
    )
    assert confirmed.status_code == 200, confirmed.text

    return order, customer, payment


async def owner_session(client):
    # make_menu_item created this owner; signing in finds the same account.
    code = (await client.post("/api/v1/auth/otp/request", json={"phone": "9000000001"})).json()["devCode"]
    body = (
        await client.post(
            "/api/v1/auth/otp/verify",
            json={"phone": "9000000001", "code": code, "role": "restaurant_owner"},
        )
    ).json()

    return {"authorization": f"Bearer {body['accessToken']}"}


class TestRestaurantReject:
    async def test_rejecting_a_paid_order_refunds_it_in_full(self, client, fake_gateway, refund_gateway):
        order, _, _ = await paid_order(client, fake_gateway)
        owner = await owner_session(client)

        response = await client.post(
            f"/api/v1/restaurant/orders/{order['id']}/reject",
            json={"reason": "Out of chicken"},
            headers=owner,
        )

        assert response.status_code == 200, response.text
        rejected = response.json()["order"]
        assert rejected["status"] == "cancelled"
        assert rejected["paymentStatus"] == "refunded"
        assert rejected["refund"]["status"] == "pending"
        assert rejected["refund"]["amountPaise"] == order["totalPaise"]

        # Exactly one call, for the full amount, against the captured payment.
        assert refund_gateway["calls"] == [
            {
                "payment": "pay_test_1",
                "amount": order["totalPaise"],
                "notes": {"order_id": order["id"], "reason": "Out of chicken"},
            }
        ]

    async def test_rejecting_a_cash_order_refunds_nothing(self, client, refund_gateway):
        item = await make_menu_item()
        customer = await sign_in(client)
        placed = await client.post(
            "/api/v1/customer/orders",
            json={"items": [{"menuItemId": str(item), "quantity": 1}], "paymentMethod": "cod", "address": ADDRESS},
            headers=customer["headers"],
        )
        order = placed.json()["order"]
        owner = await owner_session(client)

        response = await client.post(f"/api/v1/restaurant/orders/{order['id']}/reject", json={}, headers=owner)

        assert response.status_code == 200
        assert response.json()["order"]["refund"] is None
        assert refund_gateway["calls"] == []


class TestCustomerCancel:
    async def test_cancelling_a_paid_order_refunds_it(self, client, fake_gateway, refund_gateway):
        order, customer, _ = await paid_order(client, fake_gateway)

        response = await client.post(
            f"/api/v1/customer/orders/{order['id']}/cancel",
            json={"reason": "Ordered by mistake"},
            headers=customer["headers"],
        )

        assert response.status_code == 200, response.text
        cancelled = response.json()["order"]
        assert cancelled["paymentStatus"] == "refunded"
        assert cancelled["refund"]["amountPaise"] == order["totalPaise"]
        assert len(refund_gateway["calls"]) == 1

    async def test_a_payment_landing_after_cancellation_is_sent_back(
        self, client, fake_gateway, refund_gateway
    ):
        # The customer starts paying, cancels, and then the payment completes.
        item = await make_menu_item()
        customer = await sign_in(client)
        order = await place_prepaid_order(client, customer, item)
        payment = (
            await client.post(f"/api/v1/customer/orders/{order['id']}/pay", headers=customer["headers"])
        ).json()["payment"]

        await client.post(f"/api/v1/customer/orders/{order['id']}/cancel", json={}, headers=customer["headers"])
        assert refund_gateway["calls"] == [], "nothing was paid yet, so nothing to refund"

        response = await client.post(
            f"/api/v1/customer/orders/{order['id']}/pay/confirm",
            json={
                "razorpayOrderId": payment["razorpayOrderId"],
                "razorpayPaymentId": "pay_late",
                "razorpaySignature": sign_payment(payment["razorpayOrderId"], "pay_late"),
            },
            headers=customer["headers"],
        )

        assert response.json()["orderStatus"] == "cancelled"
        assert [c["payment"] for c in refund_gateway["calls"]] == ["pay_late"]
        row = await fetchrow("select status, payment_status from orders where id = $1::uuid", order["id"])
        assert (row["status"], row["payment_status"]) == ("cancelled", "refunded")


class TestFailures:
    async def test_a_gateway_failure_still_cancels_and_records_the_debt(
        self, client, fake_gateway, refund_gateway
    ):
        order, _, _ = await paid_order(client, fake_gateway)
        owner = await owner_session(client)
        refund_gateway["behaviour"]["fail"] = True

        response = await client.post(f"/api/v1/restaurant/orders/{order['id']}/reject", json={}, headers=owner)

        # The rejection itself succeeds; the refund is marked failed, not lost.
        assert response.status_code == 200
        body = response.json()["order"]
        assert body["status"] == "cancelled"
        assert body["refund"]["status"] == "failed"
        assert body["paymentStatus"] == "paid", "money has not gone back yet, so it must not say refunded"

    async def test_a_failed_refund_can_be_retried(self, client, fake_gateway, refund_gateway):
        order, _, _ = await paid_order(client, fake_gateway)
        owner = await owner_session(client)
        refund_gateway["behaviour"]["fail"] = True
        await client.post(f"/api/v1/restaurant/orders/{order['id']}/reject", json={}, headers=owner)

        refund_gateway["behaviour"]["fail"] = False
        retried = await refund_if_paid(await fetchval("select $1::uuid", order["id"]), "Retry", None)

        assert retried["status"] == "pending"
        assert len(refund_gateway["calls"]) == 2

    async def test_a_payment_is_never_refunded_twice(self, client, fake_gateway, refund_gateway):
        order, customer, _ = await paid_order(client, fake_gateway)
        await client.post(f"/api/v1/customer/orders/{order['id']}/cancel", json={}, headers=customer["headers"])

        again = await refund_if_paid(await fetchval("select $1::uuid", order["id"]), "Again", None)

        assert again["status"] == "pending"
        assert len(refund_gateway["calls"]) == 1
        assert await fetchval("select count(*) from refunds") == 1


class TestRefundWebhooks:
    async def _refunded_order(self, client, fake_gateway):
        order, customer, _ = await paid_order(client, fake_gateway)
        await client.post(f"/api/v1/customer/orders/{order['id']}/cancel", json={}, headers=customer["headers"])

        return order, customer

    async def _send(self, client, event_id, event, refund_id):
        body = json.dumps(
            {"id": event_id, "event": event, "payload": {"refund": {"entity": {"id": refund_id}}}}
        ).encode()

        return await client.post(
            "/api/v1/webhooks/razorpay",
            content=body,
            headers={"content-type": "application/json", "x-razorpay-signature": sign_webhook(body)},
        )

    async def test_refund_processed_marks_it_done(self, client, fake_gateway, refund_gateway):
        order, customer = await self._refunded_order(client, fake_gateway)

        response = await self._send(client, "evt_r1", "refund.processed", "rfnd_test_1")

        assert response.status_code == 200
        shown = (await client.get(f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"])).json()
        assert shown["order"]["refund"]["status"] == "processed"
        assert shown["order"]["refund"]["processedAt"] is not None

    async def test_refund_failed_puts_the_money_back_on_the_books(self, client, fake_gateway, refund_gateway):
        order, _ = await self._refunded_order(client, fake_gateway)

        await self._send(client, "evt_r2", "refund.failed", "rfnd_test_1")

        row = await fetchrow("select payment_status from orders where id = $1::uuid", order["id"])
        assert row["payment_status"] == "paid", "the bank refused it, so the customer is still owed"
        assert await fetchval("select status from refunds") == "failed"
