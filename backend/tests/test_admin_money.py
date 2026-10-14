"""Admin money: refunds that need a person, and paying partners.

A failed refund is money a customer is owed, so it is surfaced on the
dashboard and can be retried. Payout statements must agree with what the
restaurant and rider apps show, and a period can only be paid once.
"""

import datetime

import pytest

from app.database import execute, fetchrow, fetchval

from test_admin import admin, make_admin  # noqa: F401 - fixture
from test_delivery import ANNA_NAGAR, T_NAGAR, accepted_order, requests_for, rider, step
from test_refunds import paid_order, refund_gateway  # noqa: F401 - fixture
from test_payments import fake_gateway, razorpay_configured  # noqa: F401 - fixtures


class TestRefunds:
    async def test_admin_cancel_refunds_a_paid_order(self, client, admin, fake_gateway, refund_gateway):
        order, customer, _ = await paid_order(client, fake_gateway)

        response = await client.post(
            f"/api/v1/admin/orders/{order['id']}/cancel", json={"reason": "Restaurant closed early"}, headers=admin
        )

        assert response.status_code == 200, response.text
        cancelled = response.json()["order"]
        assert cancelled["paymentStatus"] == "refunded"
        assert cancelled["refund"]["status"] == "pending"
        assert cancelled["refunds"][0]["requestedBy"] == "Priya Sharma"
        assert len(refund_gateway["calls"]) == 1

    async def test_a_failed_refund_is_flagged_and_can_be_retried(self, client, admin, fake_gateway, refund_gateway):
        order, _, _ = await paid_order(client, fake_gateway)
        refund_gateway["behaviour"]["fail"] = True

        failed = (
            await client.post(f"/api/v1/admin/orders/{order['id']}/cancel", json={"reason": "Duplicate"}, headers=admin)
        ).json()["order"]

        assert failed["refund"]["status"] == "failed"
        assert failed["paymentStatus"] == "paid"
        assert failed["actions"]["canRetryRefund"] is True

        # The dashboard and the orders list both point at it.
        attention = (await client.get("/api/v1/admin/dashboard", headers=admin)).json()["attention"]
        listed = (await client.get("/api/v1/admin/orders", params={"view": "refund_failed"}, headers=admin)).json()
        assert [o["id"] for o in attention["failedRefunds"]] == [order["id"]]
        assert [o["id"] for o in listed["orders"]] == [order["id"]]

        refund_gateway["behaviour"]["fail"] = False
        retried = await client.post(f"/api/v1/admin/orders/{order['id']}/refund", headers=admin)

        assert retried.status_code == 200, retried.text
        body = retried.json()["order"]
        assert body["refund"]["status"] == "pending"
        assert body["paymentStatus"] == "refunded"
        assert [r["status"] for r in body["refunds"]] == ["failed", "pending"]
        assert body["actions"]["canRetryRefund"] is False

        # Once it is moving, a second press does nothing.
        again = await client.post(f"/api/v1/admin/orders/{order['id']}/refund", headers=admin)
        assert again.status_code == 409
        assert again.json()["code"] == "refund_in_progress"
        assert len(refund_gateway["calls"]) == 2

    async def test_a_live_order_cannot_be_refunded(self, client, admin, fake_gateway, refund_gateway):
        order, _, _ = await paid_order(client, fake_gateway)

        response = await client.post(f"/api/v1/admin/orders/{order['id']}/refund", headers=admin)

        assert response.status_code == 409
        assert response.json()["code"] == "order_not_cancelled"
        assert refund_gateway["calls"] == []


async def delivered_yesterday(client):
    """A cash order, carried by Arjun from Anna Nagar to T Nagar, delivered and
    then moved back a day so its day is over and can be paid."""
    arjun = await rider(client, "9100000001")
    await execute(
        "update delivery_partners set current_latitude = $2, current_longitude = $3 where user_id = $1::uuid",
        arjun["userId"],
        *ANNA_NAGAR,
    )
    order, owner, customer = await accepted_order(client, lat_lng=ANNA_NAGAR)
    await execute(
        """
        update orders set delivery_address = delivery_address || jsonb_build_object('latitude', $2::float, 'longitude', $3::float)
        where id = $1::uuid
        """,
        order["id"],
        *T_NAGAR,
    )

    offer = (await requests_for(client, arjun))[0]
    await step(client, arjun, offer["id"], "accept")
    await client.post(f"/api/v1/restaurant/orders/{order['id']}/ready", headers=owner["headers"])
    await step(client, arjun, offer["id"], "picked-up")
    delivered = await step(client, arjun, offer["id"], "delivered", cashCollected=True)
    assert delivered.status_code == 200, delivered.text

    await execute(
        "update orders set placed_at = placed_at - interval '1 day' where id = $1::uuid", order["id"]
    )
    await execute(
        "update deliveries set delivered_at = delivered_at - interval '1 day' where order_id = $1::uuid", order["id"]
    )

    return order, arjun, offer


async def yesterday() -> datetime.date:
    return await fetchval("select current_date - 1")


class TestPayouts:
    async def test_the_restaurant_statement_matches_its_earnings_screen(self, client, admin):
        order, _, _ = await delivered_yesterday(client)
        day = (await yesterday()).isoformat()

        statement = (
            await client.get(
                "/api/v1/admin/payouts/statement",
                params={"party": "restaurant", "from": day, "to": day},
                headers=admin,
            )
        ).json()

        line = statement["lines"][0]
        food = order["subtotalPaise"]
        packaging = order["packagingFeePaise"]
        commission = round(food * 0.20)

        assert statement["canRecord"] is True
        assert line["count"] == 1
        assert line["commissionPaise"] == commission
        assert line["netPaise"] == food + packaging - commission
        assert line["payout"] is None

    async def test_the_rider_statement_nets_off_cash_collected(self, client, admin):
        order, arjun, offer = await delivered_yesterday(client)
        day = (await yesterday()).isoformat()
        earned = await fetchval(
            "select base_earning_paise + incentive_paise + tip_paise from deliveries where order_id = $1::uuid",
            order["id"],
        )

        line = (
            await client.get(
                "/api/v1/admin/payouts/statement",
                params={"party": "delivery_partner", "from": day, "to": day},
                headers=admin,
            )
        ).json()["lines"][0]

        assert line["breakdown"]["cashCollectedPaise"] == order["totalPaise"]
        assert line["grossPaise"] == earned
        # The rider holds the customer's cash, which is more than one trip pays.
        assert line["netPaise"] == earned - order["totalPaise"]
        assert line["netPaise"] < 0

    async def test_a_period_is_paid_once(self, client, admin):
        order, _, _ = await delivered_yesterday(client)
        restaurant_id = await fetchval("select restaurant_id from orders where id = $1::uuid", order["id"])
        day = await yesterday()
        body = {
            "partyType": "restaurant",
            "partyId": str(restaurant_id),
            "periodStart": day.isoformat(),
            "periodEnd": day.isoformat(),
            "reference": "UTR123456789",
        }

        first = await client.post("/api/v1/admin/payouts", json=body, headers=admin)
        overlapping = await client.post(
            "/api/v1/admin/payouts",
            json={**body, "periodStart": (day - datetime.timedelta(days=6)).isoformat()},
            headers=admin,
        )

        assert first.status_code == 201, first.text
        assert overlapping.status_code == 409
        assert overlapping.json()["code"] == "payout_overlaps"

        stored = await fetchrow("select net_paise, payout_reference, status from payouts")
        assert stored["net_paise"] == first.json()["line"]["netPaise"]
        assert stored["payout_reference"] == "UTR123456789"
        assert stored["status"] == "paid"

        statement = (
            await client.get(
                "/api/v1/admin/payouts/statement",
                params={"party": "restaurant", "from": day.isoformat(), "to": day.isoformat()},
                headers=admin,
            )
        ).json()
        assert statement["lines"][0]["payout"]["reference"] == "UTR123456789"
        assert statement["totals"]["unpaidNetPaise"] == 0

        history = (await client.get("/api/v1/admin/payouts", headers=admin)).json()
        assert history["payouts"][0]["partyName"] == "The Biryani House"

    async def test_today_cannot_be_paid_yet(self, client, admin):
        order, _, _ = await delivered_yesterday(client)
        restaurant_id = await fetchval("select restaurant_id from orders where id = $1::uuid", order["id"])
        today = await fetchval("select current_date")

        response = await client.post(
            "/api/v1/admin/payouts",
            json={
                "partyType": "restaurant",
                "partyId": str(restaurant_id),
                "periodStart": (today - datetime.timedelta(days=1)).isoformat(),
                "periodEnd": today.isoformat(),
                "reference": "UTR123456789",
            },
            headers=admin,
        )

        assert response.status_code == 400
        assert response.json()["code"] == "period_not_over"

    async def test_nothing_delivered_means_nothing_to_pay(self, client, admin):
        order, _, _ = await delivered_yesterday(client)
        restaurant_id = await fetchval("select restaurant_id from orders where id = $1::uuid", order["id"])
        long_ago = (await yesterday()) - datetime.timedelta(days=30)

        response = await client.post(
            "/api/v1/admin/payouts",
            json={
                "partyType": "restaurant",
                "partyId": str(restaurant_id),
                "periodStart": long_ago.isoformat(),
                "periodEnd": long_ago.isoformat(),
                "reference": "UTR123456789",
            },
            headers=admin,
        )

        assert response.status_code == 400
        assert response.json()["code"] == "nothing_to_pay"
