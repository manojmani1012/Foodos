"""Photo proof for partial refunds, what went wrong and who pays, and refunds a
restaurant asks for."""

import pytest

from app.database import execute, fetchrow, fetchval

from test_admin import admin  # noqa: F401 - fixture
from test_delivery import hand_over, requests_for, rider
from test_payouts_phase1 import delivered_cash_order
from test_restaurant_portal import owner_with_restaurant

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


async def upload(client, url, headers, data=PNG):
    return await client.post(url, files={"file": ("p.png", data, "image/png")}, headers=headers)


async def admin_photo(client, admin, order_id) -> str:
    response = await upload(client, f"/api/v1/admin/orders/{order_id}/refund-photos", admin)
    assert response.status_code == 201, response.text

    return response.json()["photo"]["id"]


async def refund(client, admin, order_id, **body):
    return await client.post(
        f"/api/v1/admin/orders/{order_id}/refunds",
        json={"amountPaise": 1000, "reason": "Gravy had spilled", **body},
        headers=admin,
    )


class TestAdminProof:
    async def test_taking_it_off_someones_pay_needs_a_photo(self, client, admin):
        order, *_ = await delivered_cash_order(client)

        for charged in ("restaurant", "rider"):
            response = await refund(client, admin, order["id"], chargedTo=charged)
            assert response.status_code == 400 and response.json()["code"] == "photo_required", response.text

        assert await fetchval("select count(*) from refunds") == 0
        # Foodos paying needs none.
        assert (await refund(client, admin, order["id"], chargedTo="foodos")).status_code == 200

    @pytest.mark.parametrize("issue,charged", [("food", "restaurant"), ("delivery", "rider"), ("app", "foodos")])
    async def test_the_problem_decides_who_pays(self, client, admin, issue, charged):
        order, *_ = await delivered_cash_order(client)
        photo = await admin_photo(client, admin, order["id"])
        response = await refund(client, admin, order["id"], issue=issue, photoIds=[photo])

        assert response.status_code == 200, response.text
        shown = response.json()["order"]["refunds"][0]
        assert (shown["issue"], shown["chargedTo"], shown["photoIds"]) == (issue, charged, [photo])

        image = await client.get(f"/api/v1/admin/refund-photos/{photo}/file", headers=admin)
        assert image.status_code == 200 and image.content == PNG
        assert (await client.get(f"/api/v1/admin/refund-photos/{photo}/file")).status_code == 401
        media = await fetchrow("select id, is_private from media")
        assert media["is_private"] is True
        assert (await client.get(f"/media/{media['id']}")).status_code == 404

    async def test_a_photo_is_used_once_and_only_for_its_order(self, client, admin):
        order, *_ = await delivered_cash_order(client)
        photo = await admin_photo(client, admin, order["id"])
        assert (await refund(client, admin, order["id"], issue="food", photoIds=[photo])).status_code == 200

        again = await refund(client, admin, order["id"], issue="food", photoIds=[photo])
        assert again.status_code == 400 and again.json()["code"] == "photo_not_found"

    async def test_neither_problem_nor_payer_is_refused(self, client, admin):
        order, *_ = await delivered_cash_order(client)
        assert (await refund(client, admin, order["id"])).status_code == 400

    async def test_only_photos_are_accepted(self, client, admin):
        order, *_ = await delivered_cash_order(client)
        response = await upload(client, f"/api/v1/admin/orders/{order['id']}/refund-photos", admin, b"%PDF-1.4")

        assert response.status_code == 400 and response.json()["code"] == "image_unsupported"


async def asked(client, amount=1000):
    """A delivered order with a refund request from its restaurant."""
    order, owner, *_ = await delivered_cash_order(client)
    base = f"/api/v1/restaurant/orders/{order['id']}"
    photo = (await upload(client, f"{base}/refund-photos", owner["headers"])).json()["photo"]["id"]
    response = await client.post(
        f"{base}/refund-requests",
        json={"amountPaise": amount, "reason": "We forgot the raita", "photoIds": [photo]},
        headers=owner["headers"],
    )

    return order, owner, response


class TestRestaurantRequests:
    async def test_asking_moves_no_money(self, client, admin):
        order, owner, response = await asked(client)

        assert response.status_code == 201, response.text
        assert response.json()["canRequest"] is False
        assert response.json()["requests"][0]["status"] == "pending"
        assert await fetchval("select count(*) from refunds") == 0

        waiting = (await client.get("/api/v1/admin/refund-requests", headers=admin)).json()["requests"]
        assert len(waiting) == 1 and waiting[0]["amountPaise"] == 1000 and len(waiting[0]["photoIds"]) == 1
        dashboard = (await client.get("/api/v1/admin/dashboard", headers=admin)).json()
        assert dashboard["refundRequests"]["waiting"] == 1

    async def test_approving_refunds_and_charges_the_restaurant(self, client, admin):
        order, owner, response = await asked(client)
        request_id = response.json()["requests"][0]["id"]
        url = f"/api/v1/admin/refund-requests/{request_id}/approve"

        too_much = await client.post(url, json={"amountPaise": 1001}, headers=admin)
        assert too_much.json()["code"] == "amount_above_request"

        approved = await client.post(url, json={"amountPaise": 800}, headers=admin)
        assert approved.status_code == 200, approved.text
        assert approved.json()["request"]["status"] == "approved"
        assert approved.json()["request"]["refundedPaise"] == 800

        row = await fetchrow("select amount_paise, charged_to, issue from refunds")
        assert (row["amount_paise"], row["charged_to"], row["issue"]) == (800, "restaurant", "food")
        assert await fetchval("select amount_paise from earnings_entries where kind = 'refund'") == -800
        assert await fetchval("select count(*) from refund_photos where refund_id is not null") == 1

        twice = await client.post(url, json={}, headers=admin)
        assert twice.status_code == 409 and await fetchval("select count(*) from refunds") == 1

    async def test_rejecting_tells_the_restaurant_why(self, client, admin):
        order, owner, response = await asked(client)
        request_id = response.json()["requests"][0]["id"]
        rejected = await client.post(
            f"/api/v1/admin/refund-requests/{request_id}/reject", json={"reason": "Photo is unclear"}, headers=admin
        )

        assert rejected.status_code == 200, rejected.text
        mine = (await client.get(f"/api/v1/restaurant/orders/{order['id']}/refunds", headers=owner["headers"])).json()
        assert mine["requests"][0]["rejectReason"] == "Photo is unclear" and mine["canRequest"] is True
        assert await fetchval("select count(*) from refunds") == 0

    async def test_if_the_refund_fails_the_request_waits_again(self, client, admin):
        order, owner, response = await asked(client)
        request_id = response.json()["requests"][0]["id"]
        # Refunded in full by other means in the meantime.
        await refund(client, admin, order["id"], chargedTo="foodos", amountPaise=order["totalPaise"])

        approved = await client.post(f"/api/v1/admin/refund-requests/{request_id}/approve", json={}, headers=admin)

        assert approved.json()["code"] == "refund_too_large"
        assert await fetchval("select status from refund_requests") == "pending"

    async def test_limits(self, client, admin):
        order, owner, response = await asked(client)
        base = f"/api/v1/restaurant/orders/{order['id']}"
        body = {"amountPaise": 100, "reason": "Another problem", "photoIds": []}

        none = await client.post(f"{base}/refund-requests", json=body, headers=owner["headers"])
        assert none.json()["code"] == "photo_required"

        photo = (await upload(client, f"{base}/refund-photos", owner["headers"])).json()["photo"]["id"]
        second = await client.post(
            f"{base}/refund-requests", json={**body, "photoIds": [photo]}, headers=owner["headers"]
        )
        assert second.json()["code"] == "refund_request_waiting"

        await execute("delete from refund_requests")
        big = await client.post(
            f"{base}/refund-requests",
            json={**body, "amountPaise": order["totalPaise"] + 1, "photoIds": [photo]},
            headers=owner["headers"],
        )
        assert big.json()["code"] == "refund_too_large"

        await execute("update orders set delivered_at = now() - interval '8 days'")
        late = await client.post(
            f"{base}/refund-requests", json={**body, "photoIds": [photo]}, headers=owner["headers"]
        )
        assert late.json()["code"] == "refund_window_closed"

    async def test_another_restaurant_cannot_touch_the_order(self, client):
        order, *_ = await delivered_cash_order(client)
        other, _ = await owner_with_restaurant(client, "9000000002", "Pizza Corner")
        base = f"/api/v1/restaurant/orders/{order['id']}"

        assert (await client.get(f"{base}/refunds", headers=other["headers"])).status_code == 404
        assert (await upload(client, f"{base}/refund-photos", other["headers"])).status_code == 404
