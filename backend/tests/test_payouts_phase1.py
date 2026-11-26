"""Payouts, phase 1: payment settings, commission plans, the new rider pay,
the earnings ledger, payouts made on the schedule, what staff do with them,
partial refunds, restaurant bank details, statements and the finance page.

The schedule tests fix "today" and the day automatic payouts began, so they
say the same thing whatever day they run on. Push is switched off in tests,
so every notification path runs and sends nothing.
"""

import datetime
import uuid

import pytest

from app.components.delivery import cash
from app.components.payouts import dates, ledger, schedule
from app.components.payouts import settings as payment_settings
from app.database import execute, fetch, fetchrow, fetchval

from test_admin import admin  # noqa: F401 - fixture
from test_delivery import accepted_order, hand_over, requests_for, rider
from test_payments import fake_gateway, razorpay_configured  # noqa: F401 - fixtures
from test_refunds import paid_order, refund_gateway  # noqa: F401 - fixture
from test_restaurant_portal import owner_with_restaurant

DEFAULT_SCHEDULE = payment_settings.DEFAULTS["payoutSchedule"]

# A Monday, for the schedule tests.
MON = datetime.date(2026, 11, 16)


def day(offset: int) -> datetime.date:
    return MON + datetime.timedelta(days=offset)


async def started_on(when: datetime.date) -> None:
    await execute(
        "update platform_settings set value = to_jsonb($1::text) where key = 'payouts_started_on'", when.isoformat()
    )
    await payment_settings.load()


async def entry(party_type: str, party_id, amount: int, on: datetime.date, kind: str = "adjustment") -> int:
    column = "restaurant_id" if party_type == "restaurant" else "partner_id"

    return await fetchval(
        f"""
        insert into earnings_entries (party_type, {column}, kind, amount_paise, business_date, source)
        values ($1, $2::uuid, $3, $4, $5, $6)
        returning id
        """,
        party_type,
        str(party_id),
        kind,
        amount,
        on,
        f"test:{uuid.uuid4()}",
    )


def settings_body(**changes) -> dict:
    return {**payment_settings.DEFAULTS, **changes}


async def india_today() -> datetime.date:
    return await fetchval("select (now() at time zone 'Asia/Kolkata')::date")


async def delivered_cash_order(client):
    """A cash order delivered by Arjun, with its ledger rows written."""
    order, owner, customer = await accepted_order(client)
    arjun = await rider(client, "9100000001")
    delivery_id = (await requests_for(client, arjun))[0]["id"]
    await hand_over(client, arjun, delivery_id, owner, order["id"])
    restaurant_id = await fetchval("select restaurant_id from orders where id = $1::uuid", order["id"])

    return order, owner, customer, arjun, restaurant_id


async def verify_bank(party_type: str, party_id) -> None:
    """A verified bank account, so a payout can be marked paid."""
    if party_type == "restaurant":
        await execute(
            """insert into restaurant_payout_accounts
               (restaurant_id, account_holder_name, account_number, ifsc, bank_name, status)
               values ($1::uuid, 'Test Holder', '123456781234', 'HDFC0001234', 'HDFC', 'verified')
               on conflict (restaurant_id) do update set status = 'verified'""",
            str(party_id),
        )
    else:
        await execute(
            """insert into rider_payout_accounts (partner_id, upi_id, status)
               values ($1::uuid, 'rider@okaxis', 'verified')
               on conflict (partner_id) do update set status = 'verified'""",
            str(party_id),
        )


async def one_payout(client, amount=50000):
    """A restaurant payout of `amount`, scheduled for Thursday day(3)."""
    owner, restaurant_id = await owner_with_restaurant(client)
    await started_on(day(-14))
    await entry("restaurant", restaurant_id, amount, day(0))
    await schedule.run(today=day(2))

    return owner, restaurant_id, str(await fetchval("select id from payouts"))


# --- Settings -----------------------------------------------------------------


class TestSettings:
    async def test_the_defaults_are_what_the_client_asked_for(self, client, admin):
        body = (await client.get("/api/v1/admin/finance/settings", headers=admin)).json()

        assert body["settings"]["commissionStandardPct"] == 20
        assert body["settings"]["commissionSubscriptionPct"] == 10
        assert body["settings"]["riderBasePaise"] == 2000
        assert body["settings"]["minPayoutPaise"] == 10000
        assert body["holidays"] == []

    async def test_saving_changes_the_plan_rates_and_is_logged(self, client, admin):
        _, standard_id = await owner_with_restaurant(client)
        _, custom_id = await owner_with_restaurant(client, "9000000002", "Pizza Corner")
        await execute("update restaurants set commission_plan = 'custom', commission_pct = 15 where id = $1", custom_id)

        response = await client.put(
            "/api/v1/admin/finance/settings", json=settings_body(commissionStandardPct=25), headers=admin
        )

        assert response.status_code == 200, response.text
        assert response.json()["settings"]["commissionStandardPct"] == 25
        assert float(await fetchval("select commission_pct from restaurants where id = $1", standard_id)) == 25
        assert float(await fetchval("select commission_pct from restaurants where id = $1", custom_id)) == 15
        assert payment_settings.current()["commissionStandardPct"] == 25
        assert await fetchval("select action from audit_logs where module = 'Settings'") == "Changed payment settings"

    @pytest.mark.parametrize(
        "schedule_groups",
        [
            [{"days": [1, 2], "payWeekday": 4}, {"days": [3, 4], "payWeekday": 1}],  # no Fri-Sun
            [{"days": [1, 2, 3], "payWeekday": 4}, {"days": [3, 4, 5, 6, 7], "payWeekday": 2}],  # Wed twice
            [{"days": [1, 3], "payWeekday": 4}, {"days": [2, 4, 5, 6, 7], "payWeekday": 2}],  # not consecutive
        ],
    )
    async def test_the_schedule_must_cover_each_weekday_once(self, client, admin, schedule_groups):
        response = await client.put(
            "/api/v1/admin/finance/settings", json=settings_body(payoutSchedule=schedule_groups), headers=admin
        )

        assert response.status_code == 400

    async def test_other_bad_values_are_refused(self, client, admin):
        for change in ({"cutoffTime": "25:00"}, {"commissionStandardPct": 120}, {"riderDistanceBasis": "air"}):
            response = await client.put("/api/v1/admin/finance/settings", json=settings_body(**change), headers=admin)
            assert response.status_code == 400, change

    async def test_a_weekly_schedule_wrapping_sunday_is_fine(self, client, admin):
        weekly = [{"days": [7, 1, 2, 3, 4, 5, 6], "payWeekday": 3}]

        response = await client.put(
            "/api/v1/admin/finance/settings", json=settings_body(payoutSchedule=weekly), headers=admin
        )

        assert response.status_code == 200, response.text

    async def test_holidays(self, client, admin):
        added = await client.post(
            "/api/v1/admin/finance/holidays", json={"day": "2026-12-25", "name": "Christmas"}, headers=admin
        )
        assert added.json()["holidays"] == [{"day": "2026-12-25", "name": "Christmas"}]

        removed = await client.delete("/api/v1/admin/finance/holidays/2026-12-25", headers=admin)
        assert removed.json()["holidays"] == []


# --- Commission plans -----------------------------------------------------------


class TestPlans:
    async def test_plan_rates_and_custom_deals(self, client, admin):
        _, restaurant_id = await owner_with_restaurant(client)
        url = f"/api/v1/admin/restaurants/{restaurant_id}"

        subscription = (await client.patch(url, json={"commissionPlan": "subscription"}, headers=admin)).json()
        assert subscription["restaurant"]["commissionPlan"] == "subscription"
        assert subscription["restaurant"]["commissionPct"] == 10

        custom = (await client.patch(url, json={"commissionPlan": "custom", "commissionPct": 15}, headers=admin)).json()
        assert custom["restaurant"]["commissionPct"] == 15

        # A rate sent with a plan is ignored: the plan decides.
        standard = (
            await client.patch(url, json={"commissionPlan": "standard", "commissionPct": 30}, headers=admin)
        ).json()
        assert standard["restaurant"]["commissionPlan"] == "standard"
        assert standard["restaurant"]["commissionPct"] == 20

    async def test_a_new_restaurant_can_start_on_a_plan(self, client, admin):
        from test_admin import NEW_RESTAURANT

        body = {**NEW_RESTAURANT, "commissionPlan": "subscription"}
        created = await client.post("/api/v1/admin/restaurants", json=body, headers=admin)

        assert created.status_code == 201, created.text
        assert created.json()["restaurant"]["commissionPlan"] == "subscription"
        assert created.json()["restaurant"]["commissionPct"] == 10
        assert created.json()["restaurant"]["payoutAccount"] is None

    async def test_the_restaurants_share_uses_its_plan(self, client):
        order, owner, _, _, _ = await delivered_cash_order(client)
        share = await fetchval(
            "select amount_paise from earnings_entries where source = $1", f"order:{order['id']}:restaurant"
        )
        food, packaging = order["subtotalPaise"], order["packagingFeePaise"]

        # A cash order: commission on food + packaging, no gateway fee.
        assert share == food + packaging - round((food + packaging) * 0.20)

        payouts = (await client.get("/api/v1/restaurant/payouts", headers=owner["headers"])).json()
        assert payouts["plan"] == {"commissionPlan": "standard", "commissionPct": 20, "gatewayFeePct": 2}


# --- Rider pay ----------------------------------------------------------------------


class TestRiderPay:
    def test_the_formula(self):
        assert sum(payment_settings.rider_pay_parts(2.5, 2.5)) == 2000, "Rs 20 up to 3 km"
        assert payment_settings.rider_pay_parts(5, 5) == (2000, 1600), "Rs 36 for 5 km"
        assert sum(payment_settings.rider_pay_parts(None, None)) == 2000

    async def test_the_drop_basis_counts_only_the_drop(self, client, admin):
        assert sum(payment_settings.rider_pay_parts(8, 5)) == 3600, "'drop' is the default"

        await client.put("/api/v1/admin/finance/settings", json=settings_body(riderDistanceBasis="trip"), headers=admin)

        assert sum(payment_settings.rider_pay_parts(8, 5)) == 2000 + 4000

    async def test_a_delivered_trip_earns_the_per_order_incentive(self, client):
        order, _, _, arjun, _ = await delivered_cash_order(client)
        delivery = await fetchrow(
            """select base_pay_paise, distance_pay_paise, base_earning_paise, order_incentive_paise, incentive_paise
               from deliveries where order_id = $1::uuid""",
            order["id"],
        )

        assert delivery["order_incentive_paise"] == 1000
        assert delivery["incentive_paise"] >= 1000
        assert delivery["base_pay_paise"] == 2000
        assert delivery["base_earning_paise"] == delivery["base_pay_paise"] + delivery["distance_pay_paise"]

        earnings = (await client.get("/api/v1/delivery/earnings?days=7", headers=arjun["headers"])).json()
        totals = earnings["totals"]
        assert totals["basePaise"] == 2000
        assert totals["distancePaise"] == delivery["distance_pay_paise"]
        assert totals["earningsPaise"] == (
            totals["basePaise"] + totals["distancePaise"] + totals["incentivePaise"] + totals["tipsPaise"]
        )
        assert earnings["payRule"]["orderIncentivePaise"] == 1000
        assert earnings["payRule"]["distanceBasis"] == "drop"


# --- The ledger --------------------------------------------------------------------


class TestLedger:
    async def test_a_delivered_order_writes_its_rows_once(self, client):
        order, *_ = await delivered_cash_order(client)
        rows = await fetch("select kind, amount_paise from earnings_entries order by id")

        assert [r["kind"] for r in rows] == ["order", "delivery", "cash_collected"]
        rider_pay = await fetchval(
            "select base_earning_paise + incentive_paise + tip_paise from deliveries where order_id = $1::uuid",
            order["id"],
        )
        assert rows[1]["amount_paise"] == rider_pay
        assert rows[2]["amount_paise"] == -order["totalPaise"]

        assert await ledger.sweep() == 0, "the sweeper finds nothing missing"

        await execute("delete from earnings_entries")
        assert await ledger.sweep() == 3, "and puts back what was lost"
        assert await ledger.sweep() == 0

    async def test_test_orders_get_no_rows(self, client):
        order, *_ = await delivered_cash_order(client)
        await execute("delete from earnings_entries")
        await execute("update orders set is_test = true where id = $1::uuid", order["id"])

        assert await ledger.sweep() == 0
        assert await fetchval("select count(*) from earnings_entries") == 0

    async def test_rows_from_before_automatic_payouts_are_held_out(self, client, admin):
        order, *_ = await delivered_cash_order(client)
        await execute("delete from earnings_entries")
        await execute(
            "update orders set delivered_at = delivered_at - interval '40 days' where id = $1::uuid", order["id"]
        )
        await execute(
            "update deliveries set delivered_at = delivered_at - interval '40 days' where order_id = $1::uuid",
            order["id"],
        )

        await ledger.sweep()

        reasons = {r["excluded_reason"] for r in await fetch("select excluded_reason from earnings_entries")}
        assert reasons == {ledger.BEFORE_START}

        unpaid = (await client.get("/api/v1/admin/finance/unpaid", headers=admin)).json()
        assert unpaid["parties"] == []
        assert unpaid["excluded"]["count"] == 3

        included = (await client.post("/api/v1/admin/finance/include-excluded", json={}, headers=admin)).json()
        assert included["included"] == 3
        assert len((await client.get("/api/v1/admin/finance/unpaid", headers=admin)).json()["parties"]) == 2

    async def test_a_day_paid_by_hand_is_tied_to_that_payout(self, client):
        order, _, _, _, restaurant_id = await delivered_cash_order(client)
        await execute("delete from earnings_entries")
        legacy = await fetchval(
            """
            insert into payouts (party_type, restaurant_id, period_start, period_end, net_paise, status, paid_at)
            values ('restaurant', $1, $2, $2, 100, 'paid', now()) returning id
            """,
            restaurant_id,
            await india_today(),
        )

        await ledger.sweep()

        assert await fetchval("select payout_id from earnings_entries where kind = 'order'") == legacy

    def test_the_cutoff_decides_the_business_day(self):
        two_am_tuesday = datetime.datetime(2026, 11, 17, 2, 0, tzinfo=dates.INDIA)

        assert dates.business_date(two_am_tuesday, datetime.timedelta(hours=4)) == day(0), "counts for Monday"
        assert dates.business_date(two_am_tuesday, datetime.timedelta(0)) == day(1)

    async def test_the_database_agrees_on_the_cutoff(self, pool):
        result = await fetchval("select business_date('2026-11-16 20:30:00+00'::timestamptz, interval '4 hours')")

        assert result == day(0), "02:00 Tuesday India time is Monday's business"


# --- The schedule ------------------------------------------------------------------


class TestScheduleDates:
    @pytest.mark.parametrize(
        "worked, paid",
        # Mon/Tue -> Thu, Wed/Thu -> next Mon, Fri/Sat/Sun -> next Tue.
        [(0, 3), (1, 3), (2, 7), (3, 7), (4, 8), (5, 8), (6, 8)],
    )
    def test_pay_dates(self, worked, paid):
        _, end, weekday = dates.period_of(day(worked), DEFAULT_SCHEDULE)

        assert dates.pay_date(end, weekday, set()) == day(paid)

    def test_periods(self):
        assert dates.period_of(day(6), DEFAULT_SCHEDULE)[:2] == (day(4), day(6))
        assert [p[:2] for p in dates.periods_between(day(0), day(6), DEFAULT_SCHEDULE)] == [
            (day(0), day(1)),
            (day(2), day(3)),
            (day(4), day(6)),
        ]

    def test_holidays_and_sundays_move_the_pay_date(self):
        # Mon+Tue are paid Thursday; a holiday that Thursday moves it to Friday.
        assert dates.pay_date(day(1), 4, {day(3)}) == day(4)
        # A Sunday pay day moves to Monday, and past a holiday that Monday.
        assert dates.pay_date(day(1), 7, set()) == day(7)
        assert dates.pay_date(day(1), 7, {day(7)}) == day(8)


class TestBatches:
    async def test_a_batch_pays_each_party_once(self, client):
        _, restaurant_id = await owner_with_restaurant(client)
        await started_on(day(-14))
        await entry("restaurant", restaurant_id, 50000, day(0))
        await entry("restaurant", restaurant_id, 2000, day(1))

        assert await schedule.run(today=day(2)) == 1
        assert await schedule.run(today=day(2)) == 0, "a rerun makes nothing new"

        payout = await fetchrow("select * from payouts")
        assert payout["net_paise"] == 52000
        assert payout["status"] == "scheduled"
        assert payout["scheduled_for"] == day(3)
        assert (payout["period_start"], payout["period_end"]) == (day(0), day(1))
        assert payout["notified_scheduled_at"] is not None, "the scheduled notification ran"
        assert await fetchval("select count(*) from earnings_entries where payout_id = $1", payout["id"]) == 2

    async def test_below_the_minimum_is_carried_forward(self, client):
        session = await rider(client, "9100000001")
        await started_on(day(-14))
        await entry("delivery_partner", session["userId"], 5000, day(0))

        assert await schedule.run(today=day(2)) == 0

        await entry("delivery_partner", session["userId"], 6000, day(2))
        assert await schedule.run(today=day(4)) == 1

        payout = await fetchrow("select * from payouts")
        assert payout["net_paise"] == 11000
        assert payout["period_start"] == day(0), "the carried row's day starts the period"
        assert payout["scheduled_for"] == day(7)

    async def test_a_rider_owing_foodos_is_not_paid(self, client):
        session = await rider(client, "9100000001")
        await started_on(day(-14))
        await entry("delivery_partner", session["userId"], 4000, day(0), kind="delivery")
        await entry("delivery_partner", session["userId"], -60000, day(0), kind="cash_collected")

        assert await schedule.run(today=day(2)) == 0

    async def test_a_holiday_moves_a_new_batch(self, client, admin):
        _, restaurant_id = await owner_with_restaurant(client)
        await started_on(day(-14))
        await client.post(
            "/api/v1/admin/finance/holidays", json={"day": day(3).isoformat(), "name": "Test"}, headers=admin
        )
        await entry("restaurant", restaurant_id, 50000, day(0))

        await schedule.run(today=day(2))

        assert await fetchval("select scheduled_for from payouts") == day(4)


class TestActions:
    async def test_the_life_of_a_payout(self, client, admin):
        _, restaurant_id, payout_id = await one_payout(client)
        base = f"/api/v1/admin/finance/payouts/{payout_id}"

        held = await client.post(f"{base}/hold", json={"reason": "Bank details unclear"}, headers=admin)
        assert held.json()["payout"]["status"] == "on_hold"
        assert held.json()["payout"]["holdReason"] == "Bank details unclear"

        again = await client.post(f"{base}/hold", json={"reason": "Twice"}, headers=admin)
        assert again.status_code == 409

        assert (await client.post(f"{base}/failed", json={"reason": "Bounced"}, headers=admin)).status_code == 409

        released = await client.post(f"{base}/release", headers=admin)
        assert released.json()["payout"]["status"] == "scheduled"

        past = await client.post(f"{base}/reschedule", json={"date": "2020-01-01"}, headers=admin)
        assert past.status_code == 400

        later = (await india_today() + datetime.timedelta(days=5)).isoformat()
        moved = await client.post(f"{base}/reschedule", json={"date": later}, headers=admin)
        assert moved.json()["payout"]["scheduledFor"] == later

        failed = await client.post(f"{base}/failed", json={"reason": "Account closed"}, headers=admin)
        assert failed.json()["payout"]["failureReason"] == "Account closed"

        retried = await client.post(f"{base}/retry", json={}, headers=admin)
        assert retried.json()["payout"]["status"] == "scheduled"
        assert retried.json()["payout"]["failureReason"] is None

        short = await client.post(f"{base}/paid", json={"reference": "UT"}, headers=admin)
        assert short.status_code == 400

        assert (await client.post(f"{base}/paid", json={"reference": "UTR998877"}, headers=admin)).status_code == 409

        await verify_bank("restaurant", restaurant_id)
        paid = await client.post(f"{base}/paid", json={"reference": "UTR998877"}, headers=admin)
        body = paid.json()["payout"]
        assert body["status"] == "paid"
        assert body["reference"] == "UTR998877"
        assert body["paidAt"]

        assert (await client.post(f"{base}/cancel", json={"reason": "Too late"}, headers=admin)).status_code == 409

        detail = (await client.get(base, headers=admin)).json()["payout"]
        history = detail["history"]
        assert history[0]["action"] == "Scheduled"
        assert set(history[-1]) == {"action", "by", "at", "note"}
        assert history[-1] == {**history[-1], "action": "Marked payout paid", "by": "Priya Sharma", "note": "UTR998877"}
        assert detail["entries"][0]["amountPaise"] == 50000
        assert detail["bank"]["verified"] is True
        assert detail["bankDetails"] is not None

    async def test_cancelling_returns_the_rows_to_the_next_batch(self, client, admin):
        _, _, payout_id = await one_payout(client)

        cancelled = await client.post(
            f"/api/v1/admin/finance/payouts/{payout_id}/cancel", json={"reason": "Wrong amount"}, headers=admin
        )
        assert cancelled.json()["payout"]["status"] == "cancelled"
        assert await fetchval("select count(*) from earnings_entries where payout_id is not null") == 0

        assert await schedule.run(today=day(4)) == 1
        new = await fetchrow("select net_paise, scheduled_for from payouts where status = 'scheduled'")
        assert new["net_paise"] == 50000
        assert new["scheduled_for"] == day(7)

    async def test_the_list_counts_and_filters(self, client, admin):
        await one_payout(client)

        body = (await client.get("/api/v1/admin/finance/payouts?status=scheduled", headers=admin)).json()

        assert body["total"] == 1
        assert body["counts"]["scheduled"] == 1
        assert body["counts"]["dueToday"] == 1, "its pay date has passed"
        row = body["payouts"][0]
        assert row["partyName"] == "The Biryani House"
        assert row["entryCount"] == 1
        assert row["contact"]["phone"]

        assert (await client.get("/api/v1/admin/finance/payouts?status=paid", headers=admin)).json()["total"] == 0
        found = (await client.get("/api/v1/admin/finance/payouts?search=biryani", headers=admin)).json()
        assert found["total"] == 1

    async def test_the_reminder_goes_the_day_before_once(self, client):
        await one_payout(client)
        await execute("update payouts set scheduled_for = $1", await india_today() + datetime.timedelta(days=1))

        assert await schedule.send_reminders() == 1
        assert await schedule.send_reminders() == 0
        assert await fetchval("select reminded_at is not null from payouts") is True

    async def test_run_now(self, client, admin):
        await delivered_cash_order(client)

        response = await client.post("/api/v1/admin/finance/run", headers=admin)

        assert response.status_code == 200, response.text
        assert response.json()["created"] == 0, "today's earnings are paid after their period ends"


# --- Partial refunds -----------------------------------------------------------------


async def deliver(order_id):
    await execute(
        "update orders set status = 'delivered', delivered_at = now(), payment_status = 'paid' where id = $1::uuid",
        order_id,
    )


class TestPartialRefunds:
    async def test_a_card_payment_is_partly_refunded_and_charged(self, client, admin, fake_gateway, refund_gateway):
        order, _, _ = await paid_order(client, fake_gateway)
        await deliver(order["id"])

        response = await client.post(
            f"/api/v1/admin/orders/{order['id']}/refunds",
            json={"amountPaise": 5000, "reason": "Missing raita", "chargedTo": "restaurant"},
            headers=admin,
        )

        assert response.status_code == 200, response.text
        body = response.json()["order"]
        assert refund_gateway["calls"][0]["amount"] == 5000
        assert body["refunds"][0]["chargedTo"] == "restaurant"
        assert body["refunds"][0]["destination"] == "original"
        assert body["paymentStatus"] == "paid", "only part of it went back"
        assert await fetchval("select amount_paise from earnings_entries where kind = 'refund'") == -5000

        too_much = await client.post(
            f"/api/v1/admin/orders/{order['id']}/refunds",
            json={"amountPaise": order["totalPaise"], "reason": "Everything", "chargedTo": "foodos"},
            headers=admin,
        )
        assert too_much.status_code == 400
        assert too_much.json()["code"] == "refund_too_large"

        # A second partial refund on the same payment is allowed, up to the total.
        rest = await client.post(
            f"/api/v1/admin/orders/{order['id']}/refunds",
            json={"amountPaise": order["totalPaise"] - 5000, "reason": "Whole order bad", "chargedTo": "foodos"},
            headers=admin,
        )
        assert rest.status_code == 200, rest.text
        assert rest.json()["order"]["paymentStatus"] == "refunded"

    async def test_a_cash_order_is_refunded_to_the_wallet(self, client, admin):
        order, _, customer = await accepted_order(client)
        await deliver(order["id"])

        response = await client.post(
            f"/api/v1/admin/orders/{order['id']}/refunds",
            json={"amountPaise": order["totalPaise"], "reason": "Food was spilt", "chargedTo": "foodos"},
            headers=admin,
        )

        assert response.status_code == 200, response.text
        body = response.json()["order"]
        assert body["refunds"][0]["destination"] == "wallet"
        assert body["refunds"][0]["status"] == "processed"
        assert body["paymentStatus"] == "refunded", "the whole total went back"
        wallet = (await client.get("/api/v1/customer/wallet", headers=customer["headers"])).json()
        assert wallet["balancePaise"] == order["totalPaise"]
        assert await fetchval("select count(*) from earnings_entries where kind = 'refund'") == 0, "Foodos bears it"
        assert await fetchval("select refund_id is not null from wallet_transactions where reason = 'refund'")

        mine = (await client.get(f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"])).json()
        assert mine["order"]["refund"]["destination"] == "wallet"

    async def test_charged_to_the_rider(self, client, admin):
        order, *_ = await delivered_cash_order(client)

        response = await client.post(
            f"/api/v1/admin/orders/{order['id']}/refunds",
            json={"amountPaise": 3000, "reason": "Late delivery", "chargedTo": "rider"},
            headers=admin,
        )

        assert response.status_code == 200, response.text
        refund = await fetchrow("select party_type, amount_paise from earnings_entries where kind = 'refund'")
        assert (refund["party_type"], refund["amount_paise"]) == ("delivery_partner", -3000)

    async def test_only_delivered_orders(self, client, admin):
        order, _, _ = await accepted_order(client)

        response = await client.post(
            f"/api/v1/admin/orders/{order['id']}/refunds",
            json={"amountPaise": 1000, "reason": "Not yet", "chargedTo": "foodos"},
            headers=admin,
        )

        assert response.status_code == 409


# --- Bank details -----------------------------------------------------------------------


class TestBankDetails:
    async def test_owner_saves_admin_verifies(self, client, admin):
        owner, restaurant_id = await owner_with_restaurant(client)
        url = "/api/v1/restaurant/payout-account"
        verify = f"/api/v1/admin/restaurants/{restaurant_id}/payout-account/verify"

        assert (await client.get(url, headers=owner["headers"])).json()["account"] is None

        bad = await client.put(
            url, json={"holder": "Ravi Kumar", "accountNumber": "12345678901", "ifsc": "HDFC123"}, headers=owner["headers"]
        )
        assert bad.status_code == 400

        half = await client.put(url, json={"holder": "Ravi Kumar"}, headers=owner["headers"])
        assert half.status_code == 400

        saved = await client.put(
            url,
            json={"holder": "Ravi Kumar", "accountNumber": "123456781234", "ifsc": "hdfc0001234", "bankName": "HDFC"},
            headers=owner["headers"],
        )
        assert saved.status_code == 200, saved.text
        account = saved.json()["account"]
        assert account["accountNumberMasked"] == "XXXXXX1234"
        assert account["ifsc"] == "HDFC0001234"
        assert account["status"] == "pending"

        full = (await client.get(f"/api/v1/admin/restaurants/{restaurant_id}", headers=admin)).json()["restaurant"]
        assert full["payoutAccount"]["accountNumber"] == "123456781234"

        assert (await client.post(verify, json={"approve": False}, headers=admin)).status_code == 400, "say why"

        verified = await client.post(verify, json={"approve": True}, headers=admin)
        assert verified.json()["restaurant"]["payoutAccount"]["status"] == "verified"

        # Naming the bank keeps the number but needs checking again.
        changed = (await client.put(url, json={"bankName": "HDFC Bank"}, headers=owner["headers"])).json()["account"]
        assert changed["status"] == "pending"
        assert changed["accountNumberMasked"] == "XXXXXX1234"

        # Restaurants are paid to a bank account only: UPI, or removing the bank, is refused.
        assert (await client.put(url, json={"upiId": "ravi@okhdfcbank"}, headers=owner["headers"])).status_code == 400
        removed = await client.put(url, json={"holder": None, "accountNumber": None, "ifsc": None}, headers=owner["headers"])
        assert removed.status_code == 400

        rejected = await client.post(verify, json={"approve": False, "reason": "Account not found"}, headers=admin)
        assert rejected.json()["restaurant"]["payoutAccount"]["rejectReason"] == "Account not found"

    async def test_payout_rows_carry_the_bank_flag(self, client, admin):
        owner, restaurant_id, payout_id = await one_payout(client)
        await client.put(
            "/api/v1/restaurant/payout-account",
            json={"holder": "Ravi Kumar", "accountNumber": "123456781234", "ifsc": "HDFC0001234", "bankName": "HDFC"},
            headers=owner["headers"],
        )
        await client.post(
            f"/api/v1/admin/restaurants/{restaurant_id}/payout-account/verify", json={"approve": True}, headers=admin
        )

        row = (await client.get(f"/api/v1/admin/finance/payouts/{payout_id}", headers=admin)).json()["payout"]

        assert row["bank"] == {"verified": True, "summary": "HDFC ...1234"}
        assert row["bankDetails"]["accountNumber"] == "123456781234"


# --- The apps and statements ------------------------------------------------------------


class TestPartyViews:
    async def test_the_restaurant_sees_unpaid_upcoming_and_history(self, client, admin):
        owner, restaurant_id, payout_id = await one_payout(client)
        await entry("restaurant", restaurant_id, 7000, day(3))

        body = (await client.get("/api/v1/restaurant/payouts", headers=owner["headers"])).json()

        assert body["unpaid"]["duePaise"] == 7000
        assert body["unpaid"]["belowMinimum"] is True
        assert body["unpaid"]["minPayoutPaise"] == 10000
        assert body["unpaid"]["nextPayDate"]
        assert body["unpaid"]["breakdown"]["adjustmentsPaise"] == 7000
        assert set(body["unpaid"]["breakdown"]) == {
            "foodPaise", "packagingPaise", "commissionPaise", "gatewayFeePaise", "discountPaise", "bankOfferPaise",
            "gstOnCommissionPaise", "tdsPaise", "refundsPaise", "adjustmentsPaise",
        }
        assert [p["id"] for p in body["upcoming"]] == [payout_id]
        assert body["upcoming"][0]["breakdown"]["adjustmentsPaise"] == 50000
        assert body["history"] == []

        await verify_bank("restaurant", restaurant_id)
        await client.post(
            f"/api/v1/admin/finance/payouts/{payout_id}/paid", json={"reference": "UTR11223344"}, headers=admin
        )
        body = (await client.get("/api/v1/restaurant/payouts", headers=owner["headers"])).json()
        assert body["history"][0]["reference"] == "UTR11223344"
        assert body["history"][0]["failureReason"] is None

        detail = (await client.get(f"/api/v1/restaurant/payouts/{payout_id}", headers=owner["headers"])).json()
        assert detail["payout"]["entries"][0]["kind"] == "adjustment"
        assert detail["payout"]["entries"][0]["businessDate"] == day(0).isoformat()

    async def test_another_restaurants_payout_is_not_found(self, client):
        _, _, payout_id = await one_payout(client)
        other, _ = await owner_with_restaurant(client, "9000000002", "Pizza Corner")

        response = await client.get(f"/api/v1/restaurant/payouts/{payout_id}", headers=other["headers"])

        assert response.status_code == 404

    async def test_the_statement_link(self, client):
        owner, _, payout_id = await one_payout(client)

        link = (
            await client.post(f"/api/v1/restaurant/payouts/{payout_id}/statement", headers=owner["headers"])
        ).json()["url"]
        page = await client.get(link)

        assert link.startswith("/api/v1/statements/")
        assert page.status_code == 200
        assert page.headers["content-type"].startswith("text/html")
        assert "The Biryani House" in page.text
        assert "<script" not in page.text
        assert "script-src" not in page.headers["content-security-policy"]

        forged = await client.get(link.replace("s=", "s=0"))
        assert forged.status_code == 404

    async def test_the_rider_sees_their_payouts(self, client):
        order, _, _, arjun, _ = await delivered_cash_order(client)

        body = (await client.get("/api/v1/delivery/payouts", headers=arjun["headers"])).json()

        assert body["unpaid"]["entryCount"] == 2
        assert body["unpaid"]["cashInHandPaise"] == order["totalPaise"]
        assert body["unpaid"]["breakdown"]["cashCollectedPaise"] == order["totalPaise"]
        assert body["unpaid"]["breakdown"]["basePaise"] == 2000
        assert body["unpaid"]["duePaise"] < 0, "the rider holds the customer's cash"
        assert "plan" not in body

    async def test_a_paid_payout_settles_the_cash_in_hand(self, client, admin):
        order, _, _, arjun, _ = await delivered_cash_order(client)
        partner_id = uuid.UUID(arjun["userId"])
        today = await payment_settings.business_today()
        # Enough on top of the trip that the payout is positive.
        await entry("delivery_partner", partner_id, order["totalPaise"] + 20000, today)

        assert await schedule.run(today=today + datetime.timedelta(days=7)) == 2, "the rider and the restaurant"
        assert await cash.in_hand(partner_id) == order["totalPaise"]

        await verify_bank("delivery_partner", partner_id)
        payout_id = await fetchval("select id from payouts where partner_id = $1", partner_id)
        await client.post(
            f"/api/v1/admin/finance/payouts/{payout_id}/paid", json={"reference": "UTR55667788"}, headers=admin
        )

        assert await cash.in_hand(partner_id) == 0

        link = (
            await client.post(f"/api/v1/delivery/payouts/{payout_id}/statement", headers=arjun["headers"])
        ).json()["url"]
        assert (await client.get(link)).status_code == 200


# --- The finance page ------------------------------------------------------------------


class TestFinancePage:
    async def test_overview_numbers(self, client, admin):
        order, *_ = await delivered_cash_order(client)
        commission = await fetchval(
            "select (breakdown->>'commissionPaise')::int from earnings_entries where kind = 'order'"
        )
        share = await fetchval("select amount_paise from earnings_entries where kind = 'order'")

        body = (await client.get("/api/v1/admin/finance/overview", headers=admin)).json()

        assert body["collections"]["cashPaise"] == order["totalPaise"]
        assert body["collections"]["totalPaise"] == order["totalPaise"]
        assert body["commission"]["commissionPaise"] == commission
        assert body["commission"]["deliveryFeesPaise"] == order["deliveryFeePaise"]
        assert body["payable"]["restaurantsPaise"] == share
        assert body["payable"]["ridersPaise"] == 0
        assert body["payable"]["riderOwesPaise"] > 0
        assert body["payouts"]["scheduled"] == {"count": 0, "netPaise": 0}

    async def test_reports_are_csv(self, client, admin):
        await delivered_cash_order(client)

        for kind in ("collections", "payouts", "ledger", "commission"):
            response = await client.get(f"/api/v1/admin/finance/reports/{kind}.csv", headers=admin)

            assert response.status_code == 200, kind
            assert response.headers["content-type"].startswith("text/csv")
            assert "attachment" in response.headers["content-disposition"]

        ledger_csv = (await client.get("/api/v1/admin/finance/reports/ledger.csv", headers=admin)).text
        assert len(ledger_csv.strip().splitlines()) == 4, "a header and three rows"

    async def test_adjustments(self, client, admin):
        _, restaurant_id = await owner_with_restaurant(client)

        added = await client.post(
            "/api/v1/admin/finance/adjustments",
            json={"partyType": "restaurant", "partyId": str(restaurant_id), "amountPaise": -2500, "note": "Packaging penalty"},
            headers=admin,
        )
        assert added.status_code == 201, added.text
        assert added.json()["entry"]["amountPaise"] == -2500
        assert added.json()["entry"]["kind"] == "adjustment"

        for bad in (
            {"amountPaise": 0, "note": "Nothing at all"},
            {"amountPaise": 100, "note": "x"},
            {"amountPaise": 2_000_000, "note": "Far too much"},
        ):
            response = await client.post(
                "/api/v1/admin/finance/adjustments",
                json={"partyType": "restaurant", "partyId": str(restaurant_id), **bad},
                headers=admin,
            )
            assert response.status_code == 400, bad

        unpaid = (await client.get("/api/v1/admin/finance/unpaid?party=restaurant", headers=admin)).json()
        assert unpaid["parties"][0]["duePaise"] == -2500
        assert unpaid["parties"][0]["belowMinimum"] is True

    async def test_needs_an_admin(self, client):
        owner, _ = await owner_with_restaurant(client)

        response = await client.get("/api/v1/admin/finance/overview", headers=owner["headers"])

        assert response.status_code == 403
