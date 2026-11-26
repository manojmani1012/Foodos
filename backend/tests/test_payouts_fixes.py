"""Payout fixes (client answers of 2026-11-21): commission on food + packaging
plus a gateway fee, who funds a discount, bank-only restaurant accounts, rider
bank accounts staff verify, payouts only to verified accounts, whole-batch
controls, rider TDS and the new defaults."""

import datetime

from app.components.payouts import ledger, schedule
from app.components.payouts import settings as payment_settings
from app.database import execute, fetch, fetchrow, fetchval, transaction

from test_admin import admin  # noqa: F401 - fixture
from test_delivery import rider
from test_payouts_phase1 import (
    delivered_cash_order,
    day,
    entry,
    india_today,
    one_payout,
    settings_body,
    started_on,
)
from test_restaurant_portal import ADDRESS, make_item, owner_with_restaurant, sign_in

BANK = {"holder": "Ravi Kumar", "accountNumber": "123456781234", "ifsc": "hdfc0001234", "bankName": "HDFC"}


async def save_settings(client, admin, **changes):
    response = await client.put("/api/v1/admin/finance/settings", json=settings_body(**changes), headers=admin)
    assert response.status_code == 200, response.text


async def rewrite(order_id, **changes) -> dict:
    """Changes the order, then writes its restaurant ledger row again under the
    current settings (the way a delivered order is written)."""
    for column, value in changes.items():
        if column == "discount_paise":
            # The database checks the total is the sum of its parts.
            await execute(
                "update orders set total_paise = total_paise + discount_paise - $2, discount_paise = $2 where id = $1::uuid",
                order_id,
                value,
            )
        else:
            await execute(f"update orders set {column} = $2 where id = $1::uuid", order_id, value)

    await execute("delete from earnings_entries where order_id = $1::uuid", order_id)

    async with transaction() as connection:
        await ledger.record_order(connection, __import__("uuid").UUID(order_id))

    return dict(await fetchrow("select * from earnings_entries where source = $1", f"order:{order_id}:restaurant"))


def breakdown(row) -> dict:
    import json

    value = row["breakdown"]

    return json.loads(value) if isinstance(value, str) else value


# --- The earnings formula -----------------------------------------------------------


class TestFormula:
    def test_commission_is_on_food_plus_packaging_and_the_gateway_fee_is_extra(self):
        share = payment_settings.restaurant_share(10000, 1000, 20, payment_method="upi")

        assert share["commissionBasePaise"] == 11000
        assert share["commissionPaise"] == 2200
        assert share["gatewayFeePaise"] == 220
        assert share["amountPaise"] == 11000 - 2200 - 220

    def test_cash_orders_pay_no_gateway_fee(self):
        share = payment_settings.restaurant_share(10000, 1000, 20, payment_method="cod")

        assert share["gatewayFeePaise"] == 0
        assert share["commissionPaise"] == 2200

    def test_a_restaurant_funded_coupon_comes_off_the_payout_a_bank_offer_does_not(self):
        restaurant = payment_settings.restaurant_share(10000, 1000, 20, 500, "restaurant", "upi")
        bank = payment_settings.restaurant_share(10000, 1000, 20, 500, "bank", "upi")

        assert restaurant["discountPaise"] == 500 and restaurant["bankOfferPaise"] == 0
        assert bank["discountPaise"] == 0 and bank["bankOfferPaise"] == 500
        assert restaurant["amountPaise"] == bank["amountPaise"] - 500

    async def test_commission_base_before_and_after_the_discount(self, client, admin):
        before = payment_settings.restaurant_share(10000, 1000, 20, 1000, "restaurant", "upi")
        assert before["commissionBasePaise"] == 11000 and before["commissionPaise"] == 2200

        await save_settings(client, admin, commissionBase="after_discount")
        after = payment_settings.restaurant_share(10000, 1000, 20, 1000, "restaurant", "upi")

        assert after["commissionBasePaise"] == 10000
        assert after["commissionPaise"] == 2000
        assert after["gatewayFeePaise"] == 200

        # A bank offer never reduces the base.
        bank = payment_settings.restaurant_share(10000, 1000, 20, 1000, "bank", "upi")
        assert bank["commissionBasePaise"] == 11000

        # The base cannot go below zero.
        assert payment_settings.restaurant_share(100, 0, 20, 900, "restaurant", "upi")["commissionBasePaise"] == 0

    async def test_gst_is_on_commission_plus_gateway_fee(self, client, admin):
        await save_settings(client, admin, gstOnCommissionPct=18, restaurantTdsPct=1)
        share = payment_settings.restaurant_share(10000, 1000, 20, payment_method="upi")

        assert share["gstOnCommissionPaise"] == round((2200 + 220) * 0.18)
        assert share["tdsPaise"] == 110, "TDS is on food + packaging"
        assert share["amountPaise"] == 11000 - 2200 - 220 - share["gstOnCommissionPaise"] - 110


class TestLedgerRows:
    async def test_the_row_carries_the_new_breakdown_and_nets_out(self, client, admin):
        order, *_ = await delivered_cash_order(client)
        await save_settings(client, admin, gstOnCommissionPct=18)
        food, packaging = order["subtotalPaise"], order["packagingFeePaise"]

        row = await rewrite(order["id"], payment_method="upi", discount_paise=1000, discount_funded_by="restaurant")
        b = breakdown(row)
        commission = round((food + packaging) * 0.20)
        gateway = round((food + packaging) * 0.02)
        gst = round((commission + gateway) * 0.18)

        assert b["commissionBasePaise"] == food + packaging
        assert (b["commissionPaise"], b["gatewayFeePaise"], b["gstOnCommissionPaise"]) == (commission, gateway, gst)
        assert b["discountPaise"] == 1000 and b["bankOfferPaise"] == 0
        assert row["amount_paise"] == food + packaging - 1000 - commission - gateway - gst

    async def test_a_bank_offer_is_recorded_but_not_charged(self, client):
        order, *_ = await delivered_cash_order(client)
        food, packaging = order["subtotalPaise"], order["packagingFeePaise"]

        row = await rewrite(order["id"], payment_method="card", discount_paise=700, discount_funded_by="bank")
        b = breakdown(row)

        assert b["bankOfferPaise"] == 700 and b["discountPaise"] == 0
        assert row["amount_paise"] == food + packaging - b["commissionPaise"] - b["gatewayFeePaise"]

    async def test_existing_rows_are_not_recomputed(self, client, admin):
        order, *_ = await delivered_cash_order(client)
        before = await fetchval("select amount_paise from earnings_entries where source = $1", f"order:{order['id']}:restaurant")

        await save_settings(client, admin, commissionStandardPct=30, paymentGatewayFeePct=5)
        await ledger.sweep()

        after = await fetchval("select amount_paise from earnings_entries where source = $1", f"order:{order['id']}:restaurant")
        assert after == before

    async def test_a_payout_nets_to_the_sum_of_its_breakdown_lines(self, client, admin):
        order, owner, _, _, restaurant_id = await delivered_cash_order(client)
        await rewrite(order["id"], payment_method="upi", discount_paise=500, discount_funded_by="restaurant")
        await started_on(day(-14))
        await execute("update earnings_entries set business_date = $1, excluded_reason = null", day(0))
        await schedule.run(today=day(2))

        payout = (
            await client.get("/api/v1/restaurant/payouts", headers=owner["headers"])
        ).json()["upcoming"][0]
        b = payout["breakdown"]

        assert (
            b["foodPaise"] + b["packagingPaise"] - b["discountPaise"] - b["commissionPaise"] - b["gatewayFeePaise"]
            - b["gstOnCommissionPaise"] - b["tdsPaise"] - b["refundsPaise"] + b["adjustmentsPaise"]
        ) == payout["netPaise"]
        assert payout["commissionPaise"] == b["commissionPaise"] + b["gatewayFeePaise"] + b["gstOnCommissionPaise"]

    async def test_the_new_defaults(self, client, admin):
        settings = (await client.get("/api/v1/admin/finance/settings", headers=admin)).json()["settings"]

        assert settings["riderDistanceBasis"] == "drop"
        assert settings["cutoffTime"] == "05:30"
        assert settings["commissionStandardPct"] == 20
        assert settings["paymentGatewayFeePct"] == 2
        assert settings["commissionBase"] == "before_discount"
        assert settings["riderTdsPct"] == 0

    async def test_a_standard_restaurant_starts_at_twenty_percent(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        row = await fetchrow("select commission_plan, commission_pct from restaurants where id = $1", restaurant_id)

        assert row["commission_plan"] == "standard" and float(row["commission_pct"]) == 20
        assert await fetchval(
            "select column_default from information_schema.columns "
            "where table_name = 'restaurants' and column_name = 'commission_pct'"
        ) == "20"


class TestRestaurantSurfaces:
    async def test_the_partner_earnings_follow_the_formula(self, client, admin):
        order, owner, *_ = await delivered_cash_order(client)
        await rewrite(order["id"], payment_method="upi")
        food, packaging = order["subtotalPaise"], order["packagingFeePaise"]

        body = (await client.get("/api/v1/restaurant/earnings?days=7", headers=owner["headers"])).json()
        totals = body["totals"]
        commission = round((food + packaging) * 0.20)
        gateway = round((food + packaging) * 0.02)

        assert body["gatewayFeePct"] == 2
        assert totals["commissionPaise"] == commission
        assert totals["gatewayFeePaise"] == gateway
        assert totals["gstOnCommissionPaise"] == 0 and totals["tdsPaise"] == 0
        assert totals["earningsPaise"] == food + packaging - commission - gateway
        assert body["daily"][-1]["gatewayFeePaise"] == gateway

        me = (await client.get("/api/v1/restaurant/me", headers=owner["headers"])).json()["restaurant"]
        assert me["gatewayFeePct"] == 2

        plan = (await client.get("/api/v1/restaurant/payouts", headers=owner["headers"])).json()["plan"]
        assert plan["gatewayFeePct"] == 2 and plan["commissionPct"] == 20

    async def test_admin_order_detail_and_finance_overview_agree(self, client, admin):
        order, *_ = await delivered_cash_order(client)
        await rewrite(order["id"], payment_method="upi")
        food, packaging = order["subtotalPaise"], order["packagingFeePaise"]

        detail = (await client.get(f"/api/v1/admin/orders/{order['id']}", headers=admin)).json()["order"]
        assert detail["commissionPaise"] == round((food + packaging) * 0.20)
        assert detail["gatewayFeePaise"] == round((food + packaging) * 0.02)

        overview = (await client.get("/api/v1/admin/finance/overview", headers=admin)).json()
        assert overview["commission"]["commissionPaise"] == detail["commissionPaise"]
        assert overview["commission"]["gatewayFeePaise"] == detail["gatewayFeePaise"]
        assert set(overview["commission"]) == {
            "commissionPaise", "gatewayFeePaise", "gstOnCommissionPaise", "deliveryFeesPaise"
        }

        report = await client.get("/api/v1/admin/finance/reports/commission.csv", headers=admin)
        assert "Gateway fee" in report.text.splitlines()[0]

    async def test_a_coupons_funder_is_copied_onto_the_order(self, client, admin):
        owner, restaurant_id = await owner_with_restaurant(client)
        item = await make_item(restaurant_id)
        customer = await sign_in(client, "9876543210", "customer")

        for code, funder in (("BANK10", "bank"), ("REST10", "restaurant")):
            created = await client.post(
                "/api/v1/admin/offers",
                json={"name": "Ten off", "code": code, "type": "percent", "percentOff": 10, "fundedBy": funder},
                headers=admin,
            )
            assert created.status_code == 201, created.text
            assert created.json()["offer"]["fundedBy"] == funder

            placed = await client.post(
                "/api/v1/customer/orders",
                json={
                    "items": [{"menuItemId": str(item), "quantity": 1}],
                    "paymentMethod": "cod",
                    "address": ADDRESS,
                    "couponCode": code,
                },
                headers=customer["headers"],
            )
            assert placed.status_code == 201, placed.text
            assert placed.json()["order"]["discountPaise"] > 0
            assert await fetchval(
                "select discount_funded_by from orders where id = $1::uuid", placed.json()["order"]["id"]
            ) == funder

        # Default, and changed later without touching the old order.
        default = (
            await client.post(
                "/api/v1/admin/offers",
                json={"name": "Flat", "code": "FLAT5", "type": "flat", "flatOffPaise": 500},
                headers=admin,
            )
        ).json()["offer"]
        assert default["fundedBy"] == "restaurant"

        edited = await client.patch(f"/api/v1/admin/offers/{default['id']}", json={"fundedBy": "bank"}, headers=admin)
        assert edited.json()["offer"]["fundedBy"] == "bank"
        listed = (await client.get("/api/v1/admin/offers", headers=admin)).json()["offers"]
        assert {o["code"]: o["fundedBy"] for o in listed}["FLAT5"] == "bank"
        assert (await client.patch(f"/api/v1/admin/offers/{default['id']}", json={"fundedBy": "x"}, headers=admin)).status_code == 400


# --- Bank details ----------------------------------------------------------------------------


class TestRestaurantBank:
    async def test_upi_is_refused_and_the_bank_is_all_or_nothing(self, client):
        owner, _ = await owner_with_restaurant(client)
        url = "/api/v1/restaurant/payout-account"

        upi = await client.put(url, json={"upiId": "ravi@okhdfcbank"}, headers=owner["headers"])
        assert upi.status_code == 400 and upi.json()["code"] == "upi_not_supported"

        with_bank = await client.put(url, json={**BANK, "upiId": "ravi@okhdfcbank"}, headers=owner["headers"])
        assert with_bank.json()["code"] == "upi_not_supported"

        assert (await client.put(url, json={"holder": "Ravi Kumar"}, headers=owner["headers"])).status_code == 400
        assert (await client.put(url, json={}, headers=owner["headers"])).status_code == 400

        saved = await client.put(url, json=BANK, headers=owner["headers"])
        assert saved.status_code == 200 and saved.json()["account"]["status"] == "pending"

    async def test_admin_enters_the_details_which_then_await_verification(self, client, admin):
        _, restaurant_id = await owner_with_restaurant(client)
        url = f"/api/v1/admin/restaurants/{restaurant_id}/payout-account"

        assert (await client.put(url, json={"upiId": "a@okhdfcbank"}, headers=admin)).status_code == 400
        assert (await client.put(url, json={"holder": "Ravi Kumar"}, headers=admin)).status_code == 400

        saved = await client.put(url, json=BANK, headers=admin)
        assert saved.status_code == 200, saved.text
        account = saved.json()["restaurant"]["payoutAccount"]
        assert account["accountNumber"] == "123456781234" and account["ifsc"] == "HDFC0001234"
        assert account["status"] == "pending"

        await client.post(f"{url}/verify", json={"approve": True}, headers=admin)
        edited = await client.put(url, json={"bankName": "HDFC Bank"}, headers=admin)
        assert edited.json()["restaurant"]["payoutAccount"]["status"] == "pending", "an edit needs checking again"

        assert (await client.put(f"/api/v1/admin/restaurants/{fake_id()}/payout-account", json=BANK, headers=admin)).status_code == 404
        activity = (await client.get("/api/v1/admin/activity", params={"module": "Restaurants"}, headers=admin)).json()["activity"]
        assert any(a["action"] == "Entered bank details" for a in activity)

    async def test_the_migration_cleared_upi_only_accounts_by_design(self, pool):
        assert await fetchval(
            "select count(*) from information_schema.table_constraints where constraint_name = 'payout_account_has_bank'"
        ) == 1


def fake_id() -> str:
    return "00000000-0000-0000-0000-000000000001"


class TestRiderBank:
    async def test_the_rider_enters_their_own(self, client):
        session = await rider(client, "9100000001")
        url = "/api/v1/delivery/payout-account"

        assert (await client.get(url, headers=session["headers"])).json()["account"] is None
        assert (await client.put(url, json={}, headers=session["headers"])).status_code == 400
        assert (await client.put(url, json={"holder": "Arjun"}, headers=session["headers"])).status_code == 400
        assert (await client.put(url, json={"upiId": "not-a-upi"}, headers=session["headers"])).status_code == 400

        upi = await client.put(url, json={"upiId": "arjun@okaxis"}, headers=session["headers"])
        assert upi.status_code == 200, upi.text
        assert upi.json()["account"]["upiId"] == "arjun@okaxis" and upi.json()["account"]["status"] == "pending"

        both = (await client.put(url, json=BANK, headers=session["headers"])).json()["account"]
        assert both["accountNumberMasked"] == "XXXXXX1234" and both["upiId"] == "arjun@okaxis"

        # Removing the UPI id keeps the bank; removing the bank too leaves nothing to pay to.
        assert (await client.put(url, json={"upiId": None}, headers=session["headers"])).json()["account"]["upiId"] is None
        nothing = await client.put(
            url, json={"holder": None, "accountNumber": None, "ifsc": None}, headers=session["headers"]
        )
        assert nothing.status_code == 400

    async def test_admin_sees_enters_and_verifies(self, client, admin):
        session = await rider(client, "9100000001")
        rider_id = session["userId"]
        base = f"/api/v1/admin/riders/{rider_id}"

        assert (await client.get(base, headers=admin)).json()["rider"]["payoutAccount"] is None

        entered = await client.put(f"{base}/payout-account", json={"upiId": "arjun@okaxis"}, headers=admin)
        assert entered.status_code == 200, entered.text
        assert entered.json()["rider"]["payoutAccount"]["status"] == "pending"

        await client.put("/api/v1/delivery/payout-account", json=BANK, headers=session["headers"])
        seen = (await client.get(base, headers=admin)).json()["rider"]["payoutAccount"]
        assert seen["accountNumber"] == "123456781234", "the admin sees it in full"

        verify = f"{base}/payout-account/verify"
        assert (await client.post(verify, json={"approve": False}, headers=admin)).status_code == 400
        approved = await client.post(verify, json={"approve": True}, headers=admin)
        assert approved.json()["rider"]["payoutAccount"]["status"] == "verified"
        mine = (await client.get("/api/v1/delivery/payout-account", headers=session["headers"])).json()["account"]
        assert mine["status"] == "verified"

        await client.put("/api/v1/delivery/payout-account", json={"bankName": "HDFC Bank"}, headers=session["headers"])
        assert (await client.get(base, headers=admin)).json()["rider"]["payoutAccount"]["status"] == "pending"

        rejected = await client.post(verify, json={"approve": False, "reason": "Name mismatch"}, headers=admin)
        assert rejected.json()["rider"]["payoutAccount"]["rejectReason"] == "Name mismatch"

        none_yet = await rider(client, "9100000002")
        assert (await client.post(f"/api/v1/admin/riders/{none_yet['userId']}/payout-account/verify", json={"approve": True}, headers=admin)).status_code == 409
        assert (await client.put(f"/api/v1/admin/riders/{fake_id()}/payout-account", json=BANK, headers=admin)).status_code == 404

    async def test_the_old_upi_is_copied_by_the_migration_shape(self, pool):
        assert await fetchval("select count(*) from information_schema.tables where table_name = 'rider_payout_accounts'") == 1


# --- Payouts only to verified accounts ---------------------------------------------------------


class TestVerifiedOnly:
    async def test_paying_is_blocked_until_verified(self, client, admin):
        owner, restaurant_id, payout_id = await one_payout(client)
        paid = f"/api/v1/admin/finance/payouts/{payout_id}/paid"
        detail_url = f"/api/v1/admin/finance/payouts/{payout_id}"
        account = f"/api/v1/admin/restaurants/{restaurant_id}/payout-account"

        missing = await client.post(paid, json={"reference": "UTR998877"}, headers=admin)
        assert missing.status_code == 409 and missing.json()["code"] == "bank_not_verified"
        assert missing.json()["details"]["blocker"] == "bank_missing"
        assert (await client.get(detail_url, headers=admin)).json()["payout"]["blocker"] == "bank_missing"

        overview = (await client.get("/api/v1/admin/finance/overview", headers=admin)).json()["payouts"]
        assert overview["blocked"] == {"count": 1, "netPaise": 50000}

        await client.put(account, json=BANK, headers=admin)
        pending = await client.post(paid, json={"reference": "UTR998877"}, headers=admin)
        assert pending.json()["details"]["blocker"] == "bank_pending"

        await client.post(f"{account}/verify", json={"approve": False, "reason": "Wrong IFSC"}, headers=admin)
        rejected = await client.post(paid, json={"reference": "UTR998877"}, headers=admin)
        assert rejected.json()["details"]["blocker"] == "bank_rejected"
        row = (await client.get("/api/v1/admin/finance/payouts", headers=admin)).json()["payouts"][0]
        assert row["blocker"] == "bank_rejected"

        # Everything else is still allowed.
        assert (await client.post(f"/api/v1/admin/finance/payouts/{payout_id}/hold", json={"reason": "Fix bank"}, headers=admin)).status_code == 200
        blocked = (await client.get("/api/v1/admin/finance/overview", headers=admin)).json()["payouts"]["blocked"]
        assert blocked["count"] == 1, "on hold still counts as blocked"
        await client.post(f"/api/v1/admin/finance/payouts/{payout_id}/release", headers=admin)

        await client.post(f"{account}/verify", json={"approve": True}, headers=admin)
        ok = await client.post(paid, json={"reference": "UTR998877"}, headers=admin)
        assert ok.status_code == 200 and ok.json()["payout"]["status"] == "paid"
        assert ok.json()["payout"]["blocker"] is None
        assert (await client.get("/api/v1/admin/finance/overview", headers=admin)).json()["payouts"]["blocked"]["count"] == 0

    async def test_riders_too_and_a_verified_upi_is_enough(self, client, admin):
        session = await rider(client, "9100000001")
        await started_on(day(-14))
        await entry("delivery_partner", session["userId"], 50000, day(0))
        await schedule.run(today=day(2))
        payout_id = str(await fetchval("select id from payouts"))
        paid = f"/api/v1/admin/finance/payouts/{payout_id}/paid"

        blocked = await client.post(paid, json={"reference": "UTR123456"}, headers=admin)
        assert blocked.json()["details"]["blocker"] == "bank_missing"

        await client.put("/api/v1/delivery/payout-account", json={"upiId": "arjun@okaxis"}, headers=session["headers"])
        row = (await client.get(f"/api/v1/admin/finance/payouts/{payout_id}", headers=admin)).json()["payout"]
        assert row["blocker"] == "bank_pending"
        assert row["bank"] == {"verified": False, "summary": "arjun@okaxis"}

        await client.post(f"/api/v1/admin/riders/{session['userId']}/payout-account/verify", json={"approve": True}, headers=admin)
        row = (await client.get(f"/api/v1/admin/finance/payouts/{payout_id}", headers=admin)).json()["payout"]
        assert row["bank"]["verified"] is True and row["bankDetails"]["upiId"] == "arjun@okaxis"
        assert (await client.post(paid, json={"reference": "UTR123456"}, headers=admin)).status_code == 200


# --- Whole-batch controls --------------------------------------------------------------------------


async def two_payouts(client):
    _, first = await owner_with_restaurant(client)
    _, second = await owner_with_restaurant(client, "9000000002", "Pizza Corner")
    await started_on(day(-14))
    await entry("restaurant", first, 50000, day(0))
    await entry("restaurant", second, 30000, day(0))
    await schedule.run(today=day(2))

    # Earlier, empty periods get batches too: the one that matters holds the payouts.
    return str(await fetchval("select batch_id from payouts limit 1"))


class TestBatches:
    async def test_listing(self, client, admin):
        batch_id = await two_payouts(client)

        body = (await client.get("/api/v1/admin/finance/batches", headers=admin)).json()
        batch = body["batches"][0]

        assert batch["id"] == batch_id
        assert batch["payoutCount"] == 2 and batch["netPaise"] == 80000
        assert batch["counts"] == {
            "scheduled": 2, "on_hold": 0, "failed": 0, "paid": 0, "cancelled": 0, "processing": 0
        }
        assert batch["blockedCount"] == 2 and batch["holdReason"] is None
        assert batch["payDate"] == day(3).isoformat()
        assert (batch["periodStart"], batch["periodEnd"]) == (day(0).isoformat(), day(1).isoformat()), "the Mon-Tue group"

        await execute("update payouts set status = 'paid'")
        assert (await client.get("/api/v1/admin/finance/batches", headers=admin)).json()["batches"] == []
        assert len((await client.get("/api/v1/admin/finance/batches?status=all", headers=admin)).json()["batches"]) == 1

    async def test_hold_release_and_reschedule_touch_only_the_right_payouts(self, client, admin):
        batch_id = await two_payouts(client)
        base = f"/api/v1/admin/finance/batches/{batch_id}"
        first = str(await fetchval("select id from payouts order by net_paise desc limit 1"))
        second = str(await fetchval("select id from payouts order by net_paise limit 1"))

        assert (await client.post(f"{base}/hold", json={}, headers=admin)).status_code == 400
        assert (await client.post(f"{base}/hold", json={"reason": "no"}, headers=admin)).status_code == 400

        # One is already paid-out, so it must stay.
        await execute("update payouts set status = 'paid' where id = $1::uuid", second)
        held = await client.post(f"{base}/hold", json={"reason": "Bank holiday"}, headers=admin)
        assert held.status_code == 200, held.text
        assert held.json()["changed"] == 1
        assert held.json()["batch"]["holdReason"] == "Bank holiday"
        assert held.json()["batch"]["counts"]["on_hold"] == 1 and held.json()["batch"]["counts"]["paid"] == 1
        assert await fetchval("select status from payouts where id = $1::uuid", second) == "paid"
        assert await fetchval("select hold_reason from payouts where id = $1::uuid", first) == "Bank holiday"

        again = await client.post(f"{base}/hold", json={"reason": "Bank holiday"}, headers=admin)
        assert again.json()["changed"] == 0, "nothing left to hold"

        later = (await india_today() + datetime.timedelta(days=4)).isoformat()
        moved = await client.post(f"{base}/reschedule", json={"date": later}, headers=admin)
        assert moved.json()["changed"] == 1, "the on-hold one moves; the paid one does not"
        assert moved.json()["batch"]["payDate"] == later
        assert (await fetchval("select scheduled_for from payouts where id = $1::uuid", first)).isoformat() == later
        assert await fetchval("select scheduled_for from payouts where id = $1::uuid", second) == day(3)
        assert (await client.post(f"{base}/reschedule", json={"date": "2020-01-01"}, headers=admin)).status_code == 400

        released = await client.post(f"{base}/release", headers=admin)
        assert released.json()["changed"] == 1
        assert released.json()["batch"]["holdReason"] is None
        assert await fetchval("select status from payouts where id = $1::uuid", first) == "scheduled"
        assert (await client.post(f"{base}/release", headers=admin)).json()["changed"] == 0

        activity = (await client.get("/api/v1/admin/activity", params={"module": "Payouts"}, headers=admin)).json()["activity"]
        assert {"Held payout batch", "Released payout batch", "Rescheduled payout batch"} <= {a["action"] for a in activity}

    async def test_a_missing_batch_is_404(self, client, admin):
        for path, body in (("hold", {"reason": "Because"}), ("release", None), ("reschedule", {"date": "2099-01-01"})):
            response = await client.post(f"/api/v1/admin/finance/batches/{fake_id()}/{path}", json=body, headers=admin)
            assert response.status_code == 404, path


# --- Rider TDS -----------------------------------------------------------------------------------


class TestRiderTds:
    async def test_tds_is_on_pay_without_tips(self, client, admin):
        await save_settings(client, admin, riderTdsPct=10)
        order, _, _, arjun, _ = await delivered_cash_order(client)
        delivery = await fetchrow(
            "select base_earning_paise, incentive_paise, tip_paise from deliveries where order_id = $1::uuid", order["id"]
        )
        await execute("update deliveries set tip_paise = 500 where order_id = $1::uuid", order["id"])
        await execute("delete from earnings_entries where order_id = $1::uuid", order["id"])
        async with transaction() as connection:
            await ledger.record_order(connection, __import__("uuid").UUID(order["id"]))

        pay = delivery["base_earning_paise"] + delivery["incentive_paise"]
        tds = round(pay * 0.10)
        row = await fetchrow("select * from earnings_entries where source = $1", f"order:{order['id']}:rider")

        assert breakdown(row)["tdsPaise"] == tds
        assert row["amount_paise"] == pay - tds + 500, "tips are paid in full"

        earnings = (await client.get("/api/v1/delivery/earnings?days=7", headers=arjun["headers"])).json()
        assert earnings["totals"]["tdsPaise"] == tds
        assert earnings["daily"][-1]["tdsPaise"] == tds

    async def test_a_payout_shows_the_tds_and_the_lines_sum_to_the_net(self, client, admin):
        await save_settings(client, admin, riderTdsPct=10, minPayoutPaise=0)
        order, _, _, arjun, _ = await delivered_cash_order(client)
        await started_on(day(-14))
        await execute("update earnings_entries set business_date = $1, excluded_reason = null", day(0))
        rider_id = await fetchval("select partner_id from earnings_entries where party_type = 'delivery_partner' limit 1")
        await entry("delivery_partner", str(rider_id), 500000, day(0))
        await schedule.run(today=day(2))

        payout = (await client.get("/api/v1/delivery/payouts", headers=arjun["headers"])).json()["upcoming"][0]
        b = payout["breakdown"]

        assert b["tdsPaise"] > 0
        assert (
            b["basePaise"] + b["distancePaise"] + b["incentivePaise"] + b["tipsPaise"] - b["tdsPaise"]
            - b["cashCollectedPaise"] + b["cashDepositedPaise"] + b["adjustmentsPaise"] - b["refundsPaise"]
        ) == payout["netPaise"]

    async def test_existing_rows_keep_their_tds(self, client, admin):
        order, *_ = await delivered_cash_order(client)
        await save_settings(client, admin, riderTdsPct=50)
        await ledger.sweep()

        row = await fetchrow("select * from earnings_entries where source = $1", f"order:{order['id']}:rider")
        assert breakdown(row)["tdsPaise"] == 0

    async def test_the_financial_year_summary(self, client, admin):
        await save_settings(client, admin, riderTdsPct=10)
        order, _, _, arjun, _ = await delivered_cash_order(client)
        pay = await fetchval(
            "select base_earning_paise + incentive_paise from deliveries where order_id = $1::uuid", order["id"]
        )
        business_day = await fetchval("select business_date(now(), $1::interval)", payment_settings.cutoff())
        start_year = business_day.year if business_day.month >= 4 else business_day.year - 1

        # delivered_cash_order ran under the 0% default, so write a fresh row.
        await execute("delete from earnings_entries where order_id = $1::uuid", order["id"])
        async with transaction() as connection:
            await ledger.record_order(connection, __import__("uuid").UUID(order["id"]))

        body = (await client.get("/api/v1/delivery/tds", headers=arjun["headers"])).json()
        assert body["financialYear"] == f"{start_year}-{str(start_year + 1)[2:]}"
        assert len(body["months"]) == 12
        assert body["months"][0]["month"] == f"{start_year}-04" and body["months"][-1]["month"] == f"{start_year + 1}-03"
        month = next(m for m in body["months"] if m["month"] == business_day.strftime("%Y-%m"))
        assert month["earningsPaise"] == pay and month["tdsPaise"] == round(pay * 0.10)
        assert body["earningsPaise"] == pay and body["tdsPaise"] == month["tdsPaise"]

        other = (await client.get(f"/api/v1/delivery/tds?fy={start_year - 1}", headers=arjun["headers"])).json()
        assert other["financialYear"] == f"{start_year - 1}-{str(start_year)[2:]}" and other["tdsPaise"] == 0

    async def test_the_tds_report(self, client, admin):
        await save_settings(client, admin, riderTdsPct=10)
        order, _, _, arjun, _ = await delivered_cash_order(client)
        await execute("delete from earnings_entries where order_id = $1::uuid", order["id"])
        async with transaction() as connection:
            await ledger.record_order(connection, __import__("uuid").UUID(order["id"]))
        pay = await fetchval(
            "select base_earning_paise + incentive_paise from deliveries where order_id = $1::uuid", order["id"]
        )

        response = await client.get("/api/v1/admin/finance/reports/tds.csv", headers=admin)
        lines = response.text.strip().splitlines()

        assert response.status_code == 200 and "text/csv" in response.headers["content-type"]
        assert lines[0].split(",")[:3] == ["Rider", "Phone", "Deliveries"]
        assert len(lines) == 2
        assert lines[1].endswith(f",1,{pay // 100}.{pay % 100:02d},{round(pay * 0.10) // 100}.{round(pay * 0.10) % 100:02d}")

        statement = await client.get("/api/v1/admin/finance/reports/nonsense.csv", headers=admin)
        assert statement.status_code in (400, 404, 422)
