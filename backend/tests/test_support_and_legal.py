"""Policy pages and Help & support: the five pages the Play Store and Razorpay
ask for, and tickets raised from the apps and answered from the admin panel."""

from app.config import get_settings
from app.database import fetchval

from test_admin import admin, latest_activity  # noqa: F401 - the admin fixture
from test_delivery import rider
from test_restaurant_portal import make_item, owner_with_restaurant, place_customer_order, sign_in


async def raise_ticket(client, session, topic="order_late", message="My order is 30 minutes late", **extra):
    return await client.post(
        "/api/v1/support/tickets", json={"topic": topic, "message": message, **extra}, headers=session["headers"]
    )


class TestPolicyPages:
    async def test_every_page_is_public_plain_html_with_placeholders_until_details_are_set(self, client, monkeypatch):
        for page in ("terms", "privacy", "refund", "delivery", "contact"):
            response = await client.get(f"/legal/{page}")

            assert response.status_code == 200, page
            assert response.headers["content-type"].startswith("text/html")
            assert "script-src" not in response.headers["content-security-policy"]
            assert "<script" not in response.text

        contact = (await client.get("/legal/contact")).text
        assert "[Company legal name]" in contact and "[Grievance Officer name]" in contact

        monkeypatch.setattr(get_settings(), "company_legal_name", "Foodos Technologies Private Limited")
        monkeypatch.setattr(get_settings(), "support_email", "help@example.in")
        named = (await client.get("/legal/contact")).text

        assert "Foodos Technologies Private Limited" in named and "[Company legal name]" not in named
        # The Grievance Officer's email falls back to the support email.
        assert named.count("help@example.in") >= 2
        assert (await client.get("/legal")).status_code == 200
        assert (await client.get("/legal/cookies")).status_code == 404

    async def test_the_refund_page_states_the_apps_real_rules(self, client):
        page = (await client.get("/legal/refund")).text

        assert "until the restaurant accepts your order" in page
        assert "within 5 minutes" in page and "5-7 working days" in page

    async def test_support_info_lists_contacts_only_once_set(self, client, monkeypatch):
        bare = (await client.get("/api/v1/support/info")).json()
        monkeypatch.setattr(get_settings(), "support_phone", "+91 44 4000 0000")
        filled = (await client.get("/api/v1/support/info")).json()

        assert bare["supportPhone"] is None and bare["supportEmail"] is None
        assert filled["supportPhone"] == "+91 44 4000 0000"
        assert [p["path"] for p in bare["policies"]][:2] == ["/legal/terms", "/legal/privacy"]


class TestTickets:
    async def test_a_customer_raises_a_ticket_about_their_order_and_follows_it(self, client):
        owner, restaurant_id = await owner_with_restaurant(client)
        order, customer = await place_customer_order(client, await make_item(restaurant_id))

        created = await raise_ticket(client, customer, orderId=order["id"])
        ticket = created.json()["ticket"]
        listed = (await client.get("/api/v1/support/tickets", headers=customer["headers"])).json()["tickets"]

        assert created.status_code == 201, created.text
        assert ticket["subject"] == "Order is late or not delivered" and ticket["status"] == "open"
        assert ticket["order"]["orderNumber"] == order["orderNumber"]
        assert [m["fromSupport"] for m in ticket["messages"]] == [False]
        assert [t["id"] for t in listed] == [ticket["id"]]
        assert await fetchval("select priority from support_tickets where id = $1::uuid", ticket["id"]) == "high"

        # The restaurant's own app does not list the customer's tickets.
        assert (await client.get("/api/v1/support/tickets", headers=owner["headers"])).json()["tickets"] == []

    async def test_nobody_sees_or_uses_someone_elses_ticket_or_order(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        order, customer = await place_customer_order(client, await make_item(restaurant_id))
        stranger = await sign_in(client, "9876500000", "customer")
        ticket = (await raise_ticket(client, customer)).json()["ticket"]

        peek = await client.get(f"/api/v1/support/tickets/{ticket['id']}", headers=stranger["headers"])
        write = await client.post(
            f"/api/v1/support/tickets/{ticket['id']}/messages", json={"message": "hi"}, headers=stranger["headers"]
        )
        borrowed = await raise_ticket(client, stranger, orderId=order["id"])
        bad_topic = await raise_ticket(client, stranger, topic="lottery")
        blank = await raise_ticket(client, stranger, message="   ")

        assert peek.status_code == 404 and write.status_code == 404
        assert borrowed.json()["code"] == "order_not_found"
        assert bad_topic.status_code == 400 and blank.status_code == 400

    async def test_open_tickets_are_limited(self, client):
        customer = await sign_in(client, "9876543210", "customer")

        for number in range(5):
            assert (await raise_ticket(client, customer, topic="other", message=f"Question {number}")).status_code == 201

        sixth = await raise_ticket(client, customer, topic="other", message="One more")

        assert sixth.json()["code"] == "too_many_open_tickets"

    async def test_riders_and_restaurants_can_raise_tickets_too(self, client):
        owner, _ = await owner_with_restaurant(client)
        arjun = await rider(client, "9100000001")

        from_kitchen = (await raise_ticket(client, owner, topic="payouts", message="Payout not received")).json()["ticket"]
        from_rider = (await raise_ticket(client, arjun, topic="app_problem", message="Map does not open")).json()["ticket"]

        roles = await fetchval(
            "select string_agg(raised_by_role, ',' order by raised_by_role) from support_tickets"
        )

        assert from_kitchen["status"] == from_rider["status"] == "open"
        assert roles == "delivery_partner,restaurant_owner"


class TestAdminSupport:
    async def test_foodos_replies_notes_privately_and_resolves(self, client, admin):
        customer = await sign_in(client, "9876543210", "customer")
        ticket = (await raise_ticket(client, customer, topic="payment_refund", message="Refund not received")).json()["ticket"]
        path = f"/api/v1/admin/support/tickets/{ticket['id']}"

        waiting = (await client.get("/api/v1/admin/support/tickets", params={"status": "waiting"}, headers=admin)).json()
        badge = (await client.get("/api/v1/admin/dashboard", headers=admin)).json()["support"]["waiting"]
        await client.post(f"{path}/messages", json={"message": "Checked Razorpay: refund started", "internal": True}, headers=admin)
        answered = await client.post(f"{path}/messages", json={"message": "Your refund is on its way."}, headers=admin)
        seen = (await client.get(f"/api/v1/support/tickets/{ticket['id']}", headers=customer["headers"])).json()["ticket"]

        assert waiting["counts"]["waiting"] == 1 and [t["id"] for t in waiting["tickets"]] == [ticket["id"]]
        assert badge == 1
        assert answered.json()["ticket"]["status"] == "in_progress"
        assert [m["internal"] for m in answered.json()["ticket"]["messages"]] == [False, True, False]
        # The customer sees the reply, never the internal note.
        assert [(m["fromSupport"], m["body"]) for m in seen["messages"]] == [
            (False, "Refund not received"),
            (True, "Your refund is on its way."),
        ]
        assert seen["awaitingYou"] is True

        resolved = await client.post(f"{path}/status", json={"status": "resolved"}, headers=admin)
        reopened = await client.post(
            f"/api/v1/support/tickets/{ticket['id']}/messages", json={"message": "Still not received"}, headers=customer["headers"]
        )

        assert resolved.json()["ticket"]["status"] == "resolved"
        assert reopened.json()["ticket"]["status"] == "open"
        assert (await latest_activity(client, admin, "Support"))[0]["action"] == "Resolved ticket"

        await client.post(f"{path}/status", json={"status": "closed"}, headers=admin)
        after_close = await client.post(
            f"/api/v1/support/tickets/{ticket['id']}/messages", json={"message": "Hello?"}, headers=customer["headers"]
        )

        assert after_close.json()["code"] == "ticket_closed"
