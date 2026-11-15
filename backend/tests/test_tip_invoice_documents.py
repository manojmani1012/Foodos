"""Three pre-launch features: a tip chosen at checkout, a GST invoice for each
delivered order, and rider documents that Foodos checks before approving."""

import re
import uuid

from app.components.orders.invoice import _signature, financial_year
from app.database import fetchval

from test_admin import admin, latest_activity  # noqa: F401 - the admin fixture
from test_delivery import accepted_order, hand_over, requests_for, rider
from test_dish_photos import JPEG
from test_restaurant_portal import ADDRESS, make_item, owner_with_restaurant, sign_in


async def delivered_order(client):
    order, owner, customer = await accepted_order(client)
    arjun = await rider(client, "9100000001")
    delivery_id = (await requests_for(client, arjun))[0]["id"]
    await hand_over(client, arjun, delivery_id, owner, order["id"])

    return order, customer


async def invoice_page(client, session, order_id):
    link = await client.post(f"/api/v1/customer/orders/{order_id}/invoice", headers=session["headers"])
    assert link.status_code == 200, link.text

    return await client.get(link.json()["url"])


class TestTipAtCheckout:
    async def test_the_quote_and_the_order_carry_the_tip_and_the_rider_gets_all_of_it(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id, price=11000)
        customer = await sign_in(client, "9876543210", "customer")
        cart = {"items": [{"menuItemId": str(item), "quantity": 1}]}

        plain = (await client.post("/api/v1/customer/cart/quote", json=cart)).json()
        tipped = (await client.post("/api/v1/customer/cart/quote", json={**cart, "tipPaise": 2000})).json()

        assert tipped["tipPaise"] == 2000
        assert tipped["totalPaise"] == plain["totalPaise"] + 2000

        response = await client.post(
            "/api/v1/customer/orders",
            json={**cart, "paymentMethod": "cod", "tipPaise": 2000, "address": ADDRESS},
            headers=customer["headers"],
        )
        assert response.status_code == 201, response.text
        order = response.json()["order"]
        assert order["totalPaise"] == tipped["totalPaise"]

        await client.post(f"/api/v1/restaurant/orders/{order['id']}/accept", headers=owner["headers"])
        offer = (await requests_for(client, await rider(client, "9100000001")))[0]
        assert await fetchval("select tip_paise from orders where id = $1::uuid", order["id"]) == 2000
        assert offer["earningPaise"] > 2000, "the rider's offer includes the whole tip"

    async def test_a_tip_cannot_be_negative(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        response = await client.post(
            "/api/v1/customer/cart/quote",
            json={"items": [{"menuItemId": str(item), "quantity": 1}], "tipPaise": -100},
        )

        assert response.status_code in (400, 422)


class TestGstInvoice:
    async def test_there_is_no_invoice_before_delivery(self, client):
        order, _, customer = await accepted_order(client)

        response = await client.post(f"/api/v1/customer/orders/{order['id']}/invoice", headers=customer["headers"])

        assert response.status_code == 409
        assert response.json()["code"] == "invoice_not_ready"

    async def test_a_delivered_order_gets_a_numbered_tax_invoice_that_keeps_its_number(self, client):
        order, customer = await delivered_order(client)

        page = await invoice_page(client, customer, order["id"])

        assert page.status_code == 200
        assert page.headers["content-type"].startswith("text/html")
        assert "default-src 'none'" in page.headers["content-security-policy"]
        assert page.headers["cache-control"] == "private, no-store"
        text = page.text
        year = financial_year(await fetchval("select delivered_at from orders where id = $1::uuid", order["id"]))
        number = f"FD{year}/000001"
        assert number in text and len(number) <= 16, "GST rules: at most 16 characters"
        assert "Tax invoice" in text and "The Biryani House" in text
        assert "CGST @ 2.5%" in text and "SGST @ 2.5%" in text and "996331" in text

        again = await invoice_page(client, customer, order["id"])
        assert number in again.text, "opening it again never uses up a new number"
        assert await fetchval("select last_number from invoice_counters where financial_year = $1", year) == 1

    async def test_only_the_customer_or_an_admin_can_open_it(self, client, admin):
        order, customer = await delivered_order(client)
        stranger = await sign_in(client, "9876500000", "customer")

        theirs = await client.post(f"/api/v1/customer/orders/{order['id']}/invoice", headers=stranger["headers"])
        by_admin = await client.post(f"/api/v1/admin/orders/{order['id']}/invoice", headers=admin)

        assert theirs.status_code == 404
        assert by_admin.status_code == 200
        assert (await client.get(by_admin.json()["url"])).status_code == 200

    async def test_a_changed_or_old_link_does_not_open(self, client):
        order, customer = await delivered_order(client)
        link = (
            await client.post(f"/api/v1/customer/orders/{order['id']}/invoice", headers=customer["headers"])
        ).json()["url"]

        forged = re.sub(r"s=[0-9a-f]+", "s=" + "0" * 64, link)
        stretched = re.sub(r"e=\d+", "e=9999999999", link)
        expired = f"/api/v1/invoices/{order['id']}?e=1000&s={_signature(uuid.UUID(order['id']), 1000)}"

        assert (await client.get(forged)).status_code == 404
        assert (await client.get(stretched)).status_code == 404, "the signature covers the expiry"
        assert (await client.get(expired)).status_code == 410


class TestRiderDocuments:
    async def test_upload_check_reject_and_approve(self, client, admin):
        arjun = await rider(client, "9100000001", active=False, online=False)

        start = (await client.get("/api/v1/delivery/documents", headers=arjun["headers"])).json()["documents"]
        assert [doc["status"] for doc in start] == ["missing", "missing", "missing"]

        uploaded = await client.post(
            "/api/v1/delivery/documents/driving_license",
            files={"file": ("licence.jpg", JPEG, "image/jpeg")},
            headers=arjun["headers"],
        )
        assert uploaded.status_code == 200, uploaded.text
        assert uploaded.json()["documents"][0]["status"] == "pending"

        # Identity papers never go out on the public image link.
        stored = await fetchval("select file_url from delivery_partner_documents where doc_type = 'driving_license'")
        assert (await client.get(stored)).status_code == 404

        page = (await client.get(f"/api/v1/admin/riders/{arjun['userId']}", headers=admin)).json()["rider"]
        licence = page["documents"][0]
        assert licence["status"] == "pending" and licence["fileUrl"]
        photo = await client.get(licence["fileUrl"], headers=admin)
        assert photo.status_code == 200 and photo.content == JPEG
        assert photo.headers["cache-control"] == "private, no-store"
        assert (await client.get(licence["fileUrl"], headers=arjun["headers"])).status_code == 403

        review = f"/api/v1/admin/riders/{arjun['userId']}/documents/driving_license/review"
        assert (await client.post(review, json={"status": "rejected"}, headers=admin)).status_code in (400, 422)
        rejected = await client.post(review, json={"status": "rejected", "reason": "Photo is blurred"}, headers=admin)
        assert rejected.status_code == 200, rejected.text

        seen = (await client.get("/api/v1/delivery/documents", headers=arjun["headers"])).json()["documents"][0]
        assert seen["status"] == "rejected" and seen["rejectionReason"] == "Photo is blurred"

        await client.post(
            "/api/v1/delivery/documents/driving_license",
            files={"file": ("licence.jpg", JPEG, "image/jpeg")},
            headers=arjun["headers"],
        )
        approved = await client.post(review, json={"status": "verified"}, headers=admin)
        assert approved.json()["rider"]["documents"][0]["status"] == "verified"
        assert (await latest_activity(client, admin))[0]["action"] == "Approved rider document"

    async def test_only_known_documents_and_only_riders(self, client):
        arjun = await rider(client, "9100000001", active=False, online=False)
        customer = await sign_in(client, "9876543210", "customer")
        photo = {"file": ("x.jpg", JPEG, "image/jpeg")}

        unknown = await client.post("/api/v1/delivery/documents/passport", files=photo, headers=arjun["headers"])
        not_rider = await client.post("/api/v1/delivery/documents/aadhaar", files=photo, headers=customer["headers"])
        not_image = await client.post(
            "/api/v1/delivery/documents/aadhaar",
            files={"file": ("x.jpg", b"not an image at all", "image/jpeg")},
            headers=arjun["headers"],
        )

        assert unknown.status_code == 404
        assert not_rider.status_code == 403
        assert not_image.status_code == 400
