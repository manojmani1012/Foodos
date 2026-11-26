"""Login hours, the shift rule for the per-order incentive, extra earning
offers by day, weekly earnings and thanking a customer for a tip."""

import datetime

import pytest

from app.components.delivery import shifts
from app.components.payouts import ledger
from app.components.payouts import settings as payment_settings
from app.database import execute, fetch, fetchrow, fetchval

from test_admin import admin  # noqa: F401 - fixture
from test_delivery import accepted_order, hand_over, requests_for, rider
from test_payouts_phase1 import delivered_cash_order, settings_body


async def mine(client, session, path):
    response = await client.get(f"/api/v1/delivery/{path}", headers=session["headers"])
    assert response.status_code == 200, response.text

    return response.json()


async def sessions():
    return await fetch("select * from rider_online_sessions order by started_at")


async def session_at(partner_id, day, start: str, end: str):
    """A past stretch online, in India time."""
    def at(clock):
        return datetime.datetime.combine(day, datetime.time.fromisoformat(clock))

    await execute(
        """insert into rider_online_sessions (partner_id, started_at, last_seen_at, ended_at)
           values ($1::uuid, $2::timestamp at time zone 'Asia/Kolkata', $3::timestamp at time zone 'Asia/Kolkata',
                   $3::timestamp at time zone 'Asia/Kolkata')""",
        str(partner_id), at(start), at(end),
    )


class TestLoginHours:
    async def test_online_and_offline_make_one_session(self, client):
        arjun = await rider(client, "9100000001")

        assert len(await sessions()) == 1 and (await sessions())[0]["ended_at"] is None

        await client.post("/api/v1/delivery/online", json={"isOnline": False}, headers=arjun["headers"])
        assert (await sessions())[0]["ended_at"] is not None

        # Reports while offline count for nothing.
        await client.post(
            "/api/v1/delivery/location", json={"latitude": 13.08, "longitude": 80.21}, headers=arjun["headers"]
        )
        assert len(await sessions()) == 1

    async def test_a_long_silence_is_not_counted(self, client):
        arjun = await rider(client, "9100000001")
        await execute(
            """update rider_online_sessions set started_at = now() - interval '3 hours',
                   last_seen_at = now() - interval '2 hours'"""
        )
        await client.post(
            "/api/v1/delivery/location", json={"latitude": 13.08, "longitude": 80.21}, headers=arjun["headers"]
        )
        rows = await sessions()

        assert len(rows) == 2
        assert rows[0]["ended_at"] == rows[0]["last_seen_at"], "ends at the last report, not at the return"
        assert rows[1]["ended_at"] is None

    async def test_going_offline_after_silence_ends_at_the_last_report(self, client):
        arjun = await rider(client, "9100000001")
        await execute(
            """update rider_online_sessions set started_at = now() - interval '3 hours',
                   last_seen_at = now() - interval '2 hours'"""
        )
        await client.post("/api/v1/delivery/online", json={"isOnline": False}, headers=arjun["headers"])
        row = (await sessions())[0]

        assert row["ended_at"] == row["last_seen_at"]
        assert round((row["ended_at"] - row["started_at"]).total_seconds() / 60) == 60

    async def test_shift_minutes_count_only_the_overlap(self, client):
        arjun = await rider(client, "9100000001")
        await execute("delete from rider_online_sessions")
        day = datetime.date(2026, 11, 20)
        await session_at(arjun["userId"], day, "10:00", "14:45")  # 3h45m inside lunch
        await session_at(arjun["userId"], day, "18:30", "23:30")  # 4h30m inside dinner
        report = await shifts.day_report(__import__("uuid").UUID(arjun["userId"]), day)

        assert [(s["name"], s["doneMinutes"], s["met"]) for s in report["shifts"]] == [
            ("Lunch", 225, True), ("Dinner", 270, True)
        ]
        assert report["onlineMinutes"] == 285 + 300 and report["eligible"] is True


class TestShiftRule:
    async def delivered(self, client, admin, **changes):
        response = await client.put(
            "/api/v1/admin/finance/settings",
            json=settings_body(riderIncentiveNeedsShifts=True, **changes),
            headers=admin,
        )
        assert response.status_code == 200, response.text
        order, _, _, arjun, _ = await delivered_cash_order(client)

        return order, arjun

    async def make_yesterday(self):
        """The trip happened yesterday at 1 pm, so its day is over."""
        day = await payment_settings.business_today() - datetime.timedelta(days=1)
        moment = datetime.datetime.combine(day, datetime.time(13, 0))
        await execute("update deliveries set delivered_at = $1::timestamp at time zone 'Asia/Kolkata'", moment)
        await execute("update orders set delivered_at = $1::timestamp at time zone 'Asia/Kolkata'", moment)
        await execute("delete from earnings_entries")
        await execute("delete from rider_online_sessions")
        await ledger.sweep()

        return day

    async def test_the_incentive_waits_and_is_not_promised(self, client, admin):
        await self.delivered(client, admin)
        row = await fetchrow("select order_incentive_paise, deferred_incentive_paise from deliveries")

        assert (row["order_incentive_paise"], row["deferred_incentive_paise"]) == (0, 1000)
        assert await shifts.settle() == 0, "today is not over"

    async def test_a_rider_who_did_both_shifts_is_paid_once(self, client, admin):
        _, arjun = await self.delivered(client, admin, riderTdsPct=10)
        day = await self.make_yesterday()
        await session_at(arjun["userId"], day, "11:00", "15:00")
        await session_at(arjun["userId"], day, "18:00", "23:00")

        assert await shifts.settle() == 1
        assert await shifts.settle() == 0

        entry = await fetchrow("select amount_paise, business_date from earnings_entries where kind = 'incentive'")
        assert entry["amount_paise"] == 900 and entry["business_date"] == day, "less 10% TDS"
        assert await fetchval("select order_incentive_paise from deliveries") == 1000
        result = await fetchrow("select eligible, trips, amount_paise from rider_incentive_days")
        assert (result["eligible"], result["trips"], result["amount_paise"]) == (True, 1, 1000)

        await ledger.sweep()
        assert await fetchval("select count(*) from earnings_entries where kind = 'incentive'") == 1
        tds = await mine(client, arjun, "tds")
        assert tds["tdsPaise"] >= 100

    async def test_a_short_shift_earns_nothing(self, client, admin):
        _, arjun = await self.delivered(client, admin)
        day = await self.make_yesterday()
        await session_at(arjun["userId"], day, "11:00", "15:00")
        await session_at(arjun["userId"], day, "18:00", "22:29")

        assert await shifts.settle() == 1
        assert await fetchval("select eligible from rider_incentive_days") is False
        assert await fetchval("select count(*) from earnings_entries where kind = 'incentive'") == 0
        assert await fetchval("select deferred_incentive_paise from deliveries") is None

    @pytest.mark.parametrize("allowed,eligible", [(1, True), (0, False)])
    async def test_too_many_rejections_lose_it(self, client, admin, allowed, eligible):
        _, arjun = await self.delivered(client, admin, riderMaxRejections=allowed)
        day = await self.make_yesterday()
        await session_at(arjun["userId"], day, "11:00", "15:00")
        await session_at(arjun["userId"], day, "18:00", "23:00")
        await execute(
            """update delivery_requests set status = 'rejected',
                   responded_at = ($1::date + time '12:00') at time zone 'Asia/Kolkata'""",
            day,
        )

        await shifts.settle()
        assert await fetchval("select eligible from rider_incentive_days") is eligible

    async def test_off_by_default_the_incentive_is_paid_on_the_trip(self, client):
        await delivered_cash_order(client)

        assert await fetchval("select order_incentive_paise from deliveries") == 1000
        assert await fetchval("select deferred_incentive_paise from deliveries") is None

    async def test_a_shift_shorter_than_its_minimum_is_refused(self, client, admin):
        bad = [{"name": "Lunch", "start": "11:00", "end": "12:00", "minMinutes": 120}]
        response = await client.put(
            "/api/v1/admin/finance/settings", json=settings_body(riderShifts=bad), headers=admin
        )

        assert response.status_code == 400


class TestEarningOffers:
    async def create(self, client, admin, **body):
        response = await client.post(
            "/api/v1/admin/targets", json={"targetTrips": 5, "bonusPaise": 5000, **body}, headers=admin
        )

        return response

    async def test_offers_apply_only_on_their_days(self, client, admin):
        today = await fetchval("select current_date")
        weekend = today.isoweekday() >= 6
        for trips, kind in ((3, "every_day"), (4, "weekday"), (5, "weekend")):
            assert (await self.create(client, admin, targetTrips=trips, dayType=kind)).status_code == 201

        later_day = (today + datetime.timedelta(days=10)).isoformat()
        await self.create(client, admin, targetTrips=6, dayType="festival", festivalFrom=later_day)
        await self.create(client, admin, targetTrips=7, dayType="festival", festivalFrom=today.isoformat())

        arjun = await rider(client, "9100000001")
        body = await mine(client, arjun, "offers")

        assert [o["targetTrips"] for o in body["today"]] == [3, 5 if weekend else 4, 7]
        assert sorted(o["targetTrips"] for o in body["later"]) == [4 if weekend else 5, 6]
        assert body["tripsToday"] == 0

    async def test_a_festival_offer_needs_sensible_dates(self, client, admin):
        assert (await self.create(client, admin, dayType="festival")).status_code == 400
        backwards = await self.create(
            client, admin, dayType="festival", festivalFrom="2026-12-25", festivalTo="2026-12-24"
        )
        assert backwards.status_code == 400

    async def test_an_offer_for_another_day_pays_nothing_today(self, client, admin):
        tomorrow = (await fetchval("select current_date") + datetime.timedelta(days=1)).isoformat()
        await self.create(client, admin, targetTrips=1, dayType="festival", festivalFrom=tomorrow)
        await delivered_cash_order(client)

        assert await fetchval("select count(*) from incentive_awards") == 0


class TestTipsAndWeeks:
    async def tipped(self, client):
        order, _, customer, arjun, _ = await delivered_cash_order(client)
        await execute("update deliveries set tip_paise = 3000")

        return order, customer, arjun

    async def test_say_thanks_once(self, client):
        order, customer, arjun = await self.tipped(client)
        banner = (await mine(client, arjun, "me"))["partner"]["tipToThank"]

        assert banner["tipPaise"] == 3000 and banner["orderNumber"] == order["orderNumber"]

        url = f"/api/v1/delivery/deliveries/{banner['deliveryId']}/thank"
        for _ in range(2):
            assert (await client.post(url, headers=arjun["headers"])).status_code == 200

        assert (await mine(client, arjun, "me"))["partner"]["tipToThank"] is None
        shown = await client.get(f"/api/v1/customer/orders/{order['id']}", headers=customer["headers"])
        assert shown.json()["order"]["tipThanked"] is True

        other = await rider(client, "9100000002")
        assert (await client.post(url, headers=other["headers"])).status_code == 404

    async def test_nothing_to_thank_without_a_tip(self, client):
        _, _, _, arjun, _ = await delivered_cash_order(client)
        delivery_id = await fetchval("select id from deliveries")
        response = await client.post(f"/api/v1/delivery/deliveries/{delivery_id}/thank", headers=arjun["headers"])

        assert response.status_code == 409

    async def test_weeks_show_tips_apart_from_pay(self, client):
        _, _, arjun = await self.tipped(client)
        weeks = (await mine(client, arjun, "earnings/weekly?weeks=4"))["weeks"]

        assert len(weeks) == 4
        first = weeks[0]
        assert first["deliveries"] == 1 and first["tipsPaise"] == 3000 and first["tippedDeliveries"] == 1
        assert first["earningsPaise"] == first["payPaise"] + first["incentivePaise"] + 3000
        assert datetime.date.fromisoformat(first["weekStart"]).isoweekday() == 1
        assert weeks[1]["deliveries"] == 0


class TestActiveTipAndWeekChart:
    async def test_thanks_can_be_sent_while_carrying_the_order(self, client):
        _, _, _ = await accepted_order(client)
        arjun = await rider(client, "9100000001")
        delivery_id = (await requests_for(client, arjun))[0]["id"]
        url = f"/api/v1/delivery/deliveries/{delivery_id}/thank"

        assert (await client.post(url, headers=arjun["headers"])).status_code == 404, "not theirs yet"

        await client.post(f"/api/v1/delivery/deliveries/{delivery_id}/accept", headers=arjun["headers"])
        # Accepting copies the order's tip, so it is set afterwards here.
        await execute("update deliveries set tip_paise = 2000")
        assert (await client.post(url, headers=arjun["headers"])).status_code == 200
        assert (await mine(client, arjun, "active"))["delivery"]["tipThanked"] is True

    async def test_a_week_has_seven_days_and_its_bank_transfer(self, client):
        order, _, _, arjun, _ = await delivered_cash_order(client)
        await execute(
            """insert into payouts (party_type, partner_id, period_start, period_end, scheduled_for, gross_paise,
                      commission_paise, adjustments_paise, net_paise, status, payout_reference, paid_at)
               values ('delivery_partner', $1::uuid, current_date, current_date, current_date, 5000, 0, 0, 5000,
                       'paid', 'UTR123456', now())""",
            arjun["userId"],
        )
        week = (await mine(client, arjun, "earnings/weekly?weeks=2"))["weeks"][0]

        assert len(week["days"]) == 7
        assert sum(day["earningsPaise"] for day in week["days"]) == week["earningsPaise"] > 0
        assert week["payouts"] == [
            {"status": "paid", "netPaise": 5000, "reference": "UTR123456", "paidAt": week["payouts"][0]["paidAt"],
             "scheduledFor": week["payouts"][0]["scheduledFor"]}
        ]
