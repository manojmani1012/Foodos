"""Bulk bank payments: the balance and reserve, oldest dues first, the file for
the bank, and uploading the bank's result."""

import csv
import io

from app.components.payouts import schedule
from app.database import execute, fetchval

from test_admin import admin  # noqa: F401 - fixture
from test_delivery import rider
from test_payouts_phase1 import day, entry, settings_body, started_on, verify_bank
from test_restaurant_portal import owner_with_restaurant

FINANCE = "/api/v1/admin/finance"
RESERVE = 1_000_000


async def setup(client, *amounts):
    """One restaurant payout per amount, all due today, the first the oldest due."""
    ids = []

    for index, amount in enumerate(amounts):
        _, restaurant_id = await owner_with_restaurant(client, f"900000000{index + 1}", f"Kitchen {index + 1}")
        await verify_bank("restaurant", restaurant_id)
        ids.append(restaurant_id)

    await started_on(day(-14))

    for restaurant_id, amount in zip(ids, amounts):
        await entry("restaurant", restaurant_id, amount, day(0))

    await schedule.run(today=day(2))

    payouts = []

    for index, restaurant_id in enumerate(ids):
        payouts.append(
            str(
                await fetchval(
                    """update payouts set scheduled_for = (now() at time zone 'Asia/Kolkata')::date,
                              period_start = $2::date + $3::int
                       where restaurant_id = $1 returning id""",
                    restaurant_id,
                    day(-10),
                    index,
                )
            )
        )

    return payouts


async def funds(client, admin):
    return (await client.get(f"{FINANCE}/funds", headers=admin)).json()["funds"]


async def set_balance(client, admin, paise):
    response = await client.put(f"{FINANCE}/bank-balance", json={"balancePaise": paise}, headers=admin)
    assert response.status_code == 200, response.text

    return response.json()["funds"]


async def make_file(client, admin):
    response = await client.post(f"{FINANCE}/bank-files", headers=admin)
    assert response.status_code == 201, response.text

    return response.json()["file"]


async def file_rows(client, admin, file_id):
    response = await client.get(f"{FINANCE}/bank-files/{file_id}/download", headers=admin)
    assert response.status_code == 200, response.text

    return list(csv.DictReader(io.StringIO(response.text)))


def result_csv(rows) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Payment Reference", "Status", "UTR Number", "Reason"])

    for row in rows:
        writer.writerow(row)

    return out.getvalue()


async def upload(client, admin, text, apply):
    response = await client.post(f"{FINANCE}/bank-results", json={"csv": text, "apply": apply}, headers=admin)
    assert response.status_code == 200, response.text

    return response.json()


async def status_of(payout_id):
    return await fetchval("select status from payouts where id = $1::uuid", payout_id)


class TestFunds:
    async def test_without_a_balance_nothing_is_limited(self, client, admin):
        await setup(client, 50000, 30000)
        body = await funds(client, admin)

        assert body["balancePaise"] is None and body["availablePaise"] is None
        assert body["reservePaise"] == RESERVE
        assert body["due"] == {"count": 2, "netPaise": 80000}
        assert body["ready"] == {"count": 2, "netPaise": 80000}
        assert body["shortfallPaise"] == 0

    async def test_the_reserve_is_kept_and_oldest_dues_come_first(self, client, admin):
        # 60,000 paise is spendable: the oldest (50,000) fits, the next does
        # not, and the small newest one must not jump the queue.
        await setup(client, 50000, 30000, 50000)
        body = await set_balance(client, admin, RESERVE + 60000)

        assert body["availablePaise"] == 60000
        assert body["ready"] == {"count": 1, "netPaise": 50000}
        assert body["waitingForFunds"]["count"] == 2
        assert body["shortfallPaise"] == 130000 - 60000
        assert body["oldestWaiting"]["partyName"] == "Kitchen 2"

    async def test_a_balance_below_the_reserve_pays_nothing(self, client, admin):
        await setup(client, 50000)
        body = await set_balance(client, admin, RESERVE - 1)

        assert body["availablePaise"] == -1
        assert body["shortfallPaise"] == 50001

        response = await client.post(f"{FINANCE}/bank-files", headers=admin)
        assert response.status_code == 409 and response.json()["code"] == "not_enough_funds"

    async def test_the_reserve_is_a_setting(self, client, admin):
        await setup(client, 50000)
        await client.put(f"{FINANCE}/settings", json=settings_body(reservePaise=0), headers=admin)
        body = await set_balance(client, admin, 50000)

        assert body["ready"]["count"] == 1 and body["shortfallPaise"] == 0

    async def test_waiting_and_later_paid_money_is_taken_off(self, client, admin):
        first, second = await setup(client, 50000, 30000)
        await set_balance(client, admin, RESERVE + 100000)

        await client.post(f"{FINANCE}/payouts/{second}/paid", json={"reference": "UTRMANUAL1"}, headers=admin)
        assert (await funds(client, admin))["availablePaise"] == 70000

        await make_file(client, admin)
        body = await funds(client, admin)
        assert body["waitingOnBankPaise"] == 50000 and body["availablePaise"] == 20000

        # Typing the balance in again starts the count from the new figure.
        body = await set_balance(client, admin, RESERVE + 70000)
        assert body["paidSinceBalancePaise"] == 0 and body["availablePaise"] == 20000

    async def test_the_balance_is_logged_and_admin_only(self, client, admin):
        await set_balance(client, admin, 12345)
        assert await fetchval("select count(*) from audit_logs where action = 'Updated bank balance'") == 1
        assert (await client.get(f"{FINANCE}/funds")).status_code == 401
        negative = await client.put(f"{FINANCE}/bank-balance", json={"balancePaise": -1}, headers=admin)
        assert negative.status_code == 400


class TestBankFile:
    async def test_the_file_lists_each_payment_and_marks_it_processing(self, client, admin):
        first, second = await setup(client, 50000, 25_000_000)
        file = await make_file(client, admin)

        assert file["paymentCount"] == 2 and file["totalPaise"] == 25_050_000 and file["waiting"] == 2
        assert await status_of(first) == "processing" and await status_of(second) == "processing"

        rows = await file_rows(client, admin, file["id"])
        assert [row["Mode"] for row in rows] == ["NEFT", "RTGS"], "RTGS from 2 lakh rupees"
        assert rows[0]["Amount"] == "500.00" and rows[1]["Amount"] == "250000.00"
        assert rows[0]["Account number"] == "123456781234" and rows[0]["IFSC"] == "HDFC0001234"
        assert rows[0]["Payment reference"].startswith("FDP")
        assert await fetchval("select count(*) from audit_logs where action = 'Downloaded bank file'") == 1

    async def test_a_payout_cannot_go_into_two_files(self, client, admin):
        await setup(client, 50000)
        await make_file(client, admin)
        again = await client.post(f"{FINANCE}/bank-files", headers=admin)

        assert again.status_code == 409 and again.json()["code"] == "nothing_to_send"

    async def test_unverified_upi_only_held_and_future_payouts_stay_out(self, client, admin):
        verified, unverified, held, later = await setup(client, 50000, 40000, 30000, 20000)
        await execute("delete from restaurant_payout_accounts where restaurant_id = (select restaurant_id from payouts where id = $1::uuid)", unverified)
        await execute("update payouts set status = 'on_hold' where id = $1::uuid", held)
        await execute("update payouts set scheduled_for = scheduled_for + 3 where id = $1::uuid", later)

        arjun = await rider(client, "9100000001")
        await entry("delivery_partner", arjun["userId"], 45000, day(0))
        await verify_bank("delivery_partner", arjun["userId"])  # UPI only
        await execute("delete from payout_batches where not exists (select 1 from payouts p where p.batch_id = payout_batches.id)")
        await execute(
            """insert into payouts (party_type, partner_id, period_start, period_end, scheduled_for, gross_paise,
                      commission_paise, adjustments_paise, net_paise, status)
               values ('delivery_partner', $1::uuid, $2, $2, (now() at time zone 'Asia/Kolkata')::date, 45000, 0, 0, 45000, 'scheduled')""",
            arjun["userId"],
            day(0),
        )

        body = await funds(client, admin)
        assert body["blocked"]["count"] == 1 and body["upi"] == {"count": 1, "netPaise": 45000}

        file = await make_file(client, admin)
        assert file["paymentCount"] == 1 and file["totalPaise"] == 50000
        assert await status_of(verified) == "processing"
        assert await status_of(unverified) == "scheduled" and await status_of(later) == "scheduled"

    async def test_only_what_the_money_covers_goes_in(self, client, admin):
        first, second = await setup(client, 50000, 30000)
        await set_balance(client, admin, RESERVE + 60000)
        file = await make_file(client, admin)

        assert file["totalPaise"] == 50000
        assert await status_of(second) == "scheduled"

    async def test_a_formula_in_a_name_is_defused(self, client, admin):
        await setup(client, 50000)
        await execute("update restaurant_payout_accounts set account_holder_name = '=HYPERLINK(1)'")
        file = await make_file(client, admin)

        assert (await file_rows(client, admin, file["id"]))[0]["Beneficiary name"] == "HYPERLINK(1)"

    async def test_cancelling_puts_payouts_back(self, client, admin):
        (payout,) = await setup(client, 50000)
        file = await make_file(client, admin)
        response = await client.post(f"{FINANCE}/bank-files/{file['id']}/cancel", headers=admin)

        assert response.status_code == 200, response.text
        assert await status_of(payout) == "scheduled"

        download = await client.get(f"{FINANCE}/bank-files/{file['id']}/download", headers=admin)
        assert download.status_code == 409 and download.json()["code"] == "bank_file_cancelled"

        # And it can go into a new file.
        assert (await make_file(client, admin))["number"] > file["number"]

    async def test_a_processing_payout_cannot_be_held_or_cancelled(self, client, admin):
        (payout,) = await setup(client, 50000)
        await make_file(client, admin)

        for action in ("hold", "cancel"):
            response = await client.post(f"{FINANCE}/payouts/{payout}/{action}", json={"reason": "Checking"}, headers=admin)
            assert response.status_code == 409, action

        listed = (await client.get(f"{FINANCE}/payouts?status=processing", headers=admin)).json()
        assert listed["total"] == 1 and listed["counts"]["processing"] == 1


class TestBankResult:
    async def prepared(self, client, admin):
        ids = await setup(client, 50000, 30000)
        file = await make_file(client, admin)
        references = [row["Payment reference"] for row in await file_rows(client, admin, file["id"])]

        return ids, file, references

    async def test_preview_changes_nothing_and_apply_does(self, client, admin):
        (first, second), file, (a, b) = await self.prepared(client, admin)
        text = result_csv([[a, "Success", "HDFCN52026001", ""], [b, "Rejected", "", "Account closed"]])

        preview = await upload(client, admin, text, apply=False)
        assert preview["summary"] == {"paid": 1, "failed": 1, "done": 0, "problem": 0}
        assert await status_of(first) == "processing"

        applied = await upload(client, admin, text, apply=True)
        assert applied["applied"] is True
        assert await status_of(first) == "paid" and await status_of(second) == "failed"
        assert await fetchval("select payout_reference from payouts where id = $1::uuid", first) == "HDFCN52026001"
        assert await fetchval("select failure_reason from payouts where id = $1::uuid", second) == "Account closed"

        # The same file again does nothing more.
        again = await upload(client, admin, text, apply=True)
        assert again["summary"] == {"paid": 0, "failed": 0, "done": 2, "problem": 0}

    async def test_money_already_sent_is_recorded_even_if_the_account_changed(self, client, admin):
        (first, _), _, (a, _) = await self.prepared(client, admin)
        await execute("update restaurant_payout_accounts set status = 'pending'")
        await upload(client, admin, result_csv([[a, "SUCCESS", "UTR00001", ""]]), apply=True)

        assert await status_of(first) == "paid"

    async def test_problem_rows_are_reported_and_left_alone(self, client, admin):
        (first, second), _, (a, b) = await self.prepared(client, admin)
        text = result_csv(
            [
                [a, "Success", "", ""],
                [b, "In progress", "", ""],
                ["FDP999990001", "Success", "UTR55555", ""],
            ]
        )
        body = await upload(client, admin, text, apply=True)
        messages = [row["message"] for row in body["rows"]]

        assert body["summary"]["problem"] == 3
        assert "UTR" in messages[0] and "left waiting" in messages[1] and "not from a Foodos bank file" in messages[2]
        assert await status_of(first) == "processing" and await status_of(second) == "processing"

    async def test_one_utr_cannot_pay_two(self, client, admin):
        _, _, (a, b) = await self.prepared(client, admin)
        body = await upload(client, admin, result_csv([[a, "Paid", "UTR77777", ""], [b, "Paid", "utr77777", ""]]), apply=True)

        assert body["summary"]["paid"] == 1 and body["summary"]["problem"] == 1

    async def test_a_manual_paid_cannot_reuse_a_bank_utr(self, client, admin):
        (_, second), _, (a, _) = await self.prepared(client, admin)
        await upload(client, admin, result_csv([[a, "Paid", "UTR88888", ""]]), apply=True)
        response = await client.post(f"{FINANCE}/payouts/{second}/paid", json={"reference": "UTR88888"}, headers=admin)

        assert response.status_code == 409 and response.json()["code"] == "reference_used"

    async def test_a_wrong_amount_is_a_problem(self, client, admin):
        (first, _), _, (a, _) = await self.prepared(client, admin)
        text = f"reference,status,utr,amount\n{a},success,UTR12121,499.00\n"
        body = await upload(client, admin, text, apply=True)

        assert body["summary"]["problem"] == 1 and await status_of(first) == "processing"

        good = f"reference,status,utr,amount\n{a},success,UTR12121,\"500.00\"\n"
        assert (await upload(client, admin, good, apply=True))["summary"]["paid"] == 1

    async def test_a_file_with_a_result_cannot_be_cancelled(self, client, admin):
        _, file, (a, _) = await self.prepared(client, admin)
        await upload(client, admin, result_csv([[a, "Paid", "UTR31313", ""]]), apply=True)
        response = await client.post(f"{FINANCE}/bank-files/{file['id']}/cancel", headers=admin)

        assert response.status_code == 409 and response.json()["code"] == "bank_file_has_results"
        listed = (await client.get(f"{FINANCE}/bank-files", headers=admin)).json()["files"][0]
        assert (listed["waiting"], listed["paid"]) == (1, 1)

    async def test_a_failed_payment_can_be_retried_in_a_new_file(self, client, admin):
        (first, _), _, (a, _) = await self.prepared(client, admin)
        failed = result_csv([[a, "Failed", "", "Wrong IFSC"]])
        await upload(client, admin, failed, apply=True)
        await client.post(f"{FINANCE}/payouts/{first}/retry", headers=admin)
        second_file = await make_file(client, admin)
        new_reference = (await file_rows(client, admin, second_file["id"]))[0]["Payment reference"]

        assert new_reference != a
        # The old line no longer speaks for this payout.
        body = await upload(client, admin, result_csv([[a, "Paid", "UTR41414", ""]]), apply=True)
        assert body["summary"]["problem"] == 1 and await status_of(first) == "processing"

    async def test_files_without_the_columns_are_refused(self, client, admin):
        for text in ("name,amount\nx,1\n", "   "):
            response = await client.post(f"{FINANCE}/bank-results", json={"csv": text or " ", "apply": False}, headers=admin)
            assert response.status_code == 400, text
