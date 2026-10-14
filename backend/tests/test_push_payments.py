"""An online order reaches the restaurant only once it is paid, and the
restaurant hears about it once, however many ways the payment is reported."""

import json

from app.components.notifications import push

from test_push import OWNER_TOKEN, phones  # noqa: F401 - fixture
from test_payments import (  # noqa: F401 - fixtures
    fake_gateway,
    make_menu_item,
    place_prepaid_order,
    razorpay_configured,
    sign_in,
    sign_payment,
    sign_webhook,
)
from app.database import fetchval


async def owner_phone():
    # make_menu_item created this owner directly; give them a phone.
    owner_id = await fetchval("select id from users where phone = '+919000000001'")
    await push.register(owner_id, "restaurant_owner", OWNER_TOKEN, "android")


class TestPaidOnline:
    async def test_the_restaurant_hears_once_paid_and_only_once(self, client, phones, fake_gateway):
        item = await make_menu_item()
        await owner_phone()
        customer = await sign_in(client)
        order = await place_prepaid_order(client, customer, item)

        # Not paid yet: the restaurant cannot see it, so it is not told.
        assert phones.to(OWNER_TOKEN) == []

        payment = (
            await client.post(f"/api/v1/customer/orders/{order['id']}/pay", headers=customer["headers"])
        ).json()["payment"]
        confirmed = await client.post(
            f"/api/v1/customer/orders/{order['id']}/pay/confirm",
            json={
                "razorpayOrderId": payment["razorpayOrderId"],
                "razorpayPaymentId": "pay_push_1",
                "razorpaySignature": sign_payment(payment["razorpayOrderId"], "pay_push_1"),
            },
            headers=customer["headers"],
        )
        assert confirmed.status_code == 200, confirmed.text

        # Razorpay's own report of the same payment arrives afterwards.
        body = json.dumps(
            {
                "id": "evt_push_1",
                "event": "payment.captured",
                "payload": {"payment": {"entity": {"id": "pay_push_1", "order_id": payment["razorpayOrderId"]}}},
            }
        ).encode()
        hook = await client.post(
            "/api/v1/webhooks/razorpay",
            content=body,
            headers={"content-type": "application/json", "x-razorpay-signature": sign_webhook(body)},
        )
        assert hook.status_code == 200

        [message] = phones.to(OWNER_TOKEN)
        assert message["title"] == f"New order #{order['orderNumber']}"
        assert "Paid online" in message["body"]

    async def test_a_payment_reported_only_by_the_webhook_still_rings(self, client, phones, fake_gateway):
        item = await make_menu_item()
        await owner_phone()
        customer = await sign_in(client)
        order = await place_prepaid_order(client, customer, item)
        payment = (
            await client.post(f"/api/v1/customer/orders/{order['id']}/pay", headers=customer["headers"])
        ).json()["payment"]

        # The customer's phone died after paying: only Razorpay reports it.
        body = json.dumps(
            {
                "id": "evt_push_2",
                "event": "payment.captured",
                "payload": {"payment": {"entity": {"id": "pay_push_2", "order_id": payment["razorpayOrderId"]}}},
            }
        ).encode()
        await client.post(
            "/api/v1/webhooks/razorpay",
            content=body,
            headers={"content-type": "application/json", "x-razorpay-signature": sign_webhook(body)},
        )

        assert [m["title"] for m in phones.to(OWNER_TOKEN)] == [f"New order #{order['orderNumber']}"]
