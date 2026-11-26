"""The finance reports in CSV, Excel and PDF, their filters, and the PDF
payout statement."""

import csv
import datetime
import io

import pytest
from openpyxl import load_workbook

from app.components.payouts import export, statements
from app.database import execute, fetchval

from test_admin import admin  # noqa: F401 - fixture
from test_payouts_phase1 import delivered_cash_order, one_payout

KINDS = ("collections", "commission", "payouts", "refunds", "tax", "riders", "ledger", "tds")
BASE = "/api/v1/admin/finance/reports"


async def get(client, admin, path):
    return await client.get(f"{BASE}/{path}", headers=admin)


async def rows(client, admin, path):
    response = await get(client, admin, path)
    assert response.status_code == 200, response.text

    return list(csv.DictReader(io.StringIO(response.text)))


async def with_data(client, admin):
    order, _, _, arjun, restaurant_id = await delivered_cash_order(client)
    await execute("update deliveries set tip_paise = 2000")
    # A refund and an adjustment, so every report has something to say.
    done = await client.post(
        f"/api/v1/admin/orders/{order['id']}/refunds",
        json={"amountPaise": 1500, "reason": "App charged twice", "issue": "app"},
        headers=admin,
    )
    assert done.status_code == 200, done.text
    await client.post(
        "/api/v1/admin/finance/adjustments",
        json={"partyType": "restaurant", "partyId": str(restaurant_id), "amountPaise": -2500, "note": "Packaging penalty"},
        headers=admin,
    )

    return order, arjun, restaurant_id


@pytest.mark.parametrize("kind", KINDS)
async def test_every_report_downloads_in_every_format(client, admin, kind):
    await with_data(client, admin)

    plain = await get(client, admin, f"{kind}.csv")
    assert plain.status_code == 200, plain.text
    assert plain.headers["content-type"].startswith("text/csv")
    header = plain.text.splitlines()[0]

    excel = await get(client, admin, f"{kind}.xlsx")
    assert excel.status_code == 200, excel.text
    sheet = load_workbook(io.BytesIO(excel.content)).active
    assert [cell.value for cell in sheet[1]] == next(csv.reader(io.StringIO(header)))

    pdf = await get(client, admin, f"{kind}.pdf")
    assert pdf.status_code == 200, pdf.text
    assert pdf.content.startswith(b"%PDF") and pdf.headers["content-type"] == "application/pdf"
    assert f"foodos-{kind}-" in pdf.headers["content-disposition"]


@pytest.mark.parametrize("kind", KINDS)
async def test_an_empty_period_still_downloads(client, admin, kind):
    for format_ in ("csv", "xlsx", "pdf"):
        response = await get(client, admin, f"{kind}.{format_}?dateFrom=2020-01-01&dateTo=2020-01-31")
        assert response.status_code == 200, (format_, response.text)


async def test_daily_collections_split_online_wallet_and_cash(client, admin):
    order, *_ = await with_data(client, admin)
    (day,) = await rows(client, admin, "collections.csv")
    total = f"{order['totalPaise'] / 100:.2f}"

    assert day["Orders"] == "1" and day["Cash on delivery"] == total and day["Online (Razorpay)"] == "0.00"
    assert day["Refunded"] == "15.00"
    assert day["Net of refunds"] == f"{(order['totalPaise'] - 1500) / 100:.2f}"


async def test_refunds_and_adjustments_say_who_paid(client, admin):
    await with_data(client, admin)
    found = await rows(client, admin, "refunds.csv")

    assert [(r["Type"], r["Who paid"], r["Amount"]) for r in found] == [
        ("Partial refund", "Foodos", "15.00"),
        ("Adjustment", "Restaurant", "-25.00"),
    ]
    assert found[0]["Problem"] == "app" and found[0]["Refunded to"] == "Foodos wallet"


async def test_payouts_show_their_deductions_and_utr(client, admin):
    order, *_ = await delivered_cash_order(client)
    restaurant_id = await fetchval("select restaurant_id from orders")
    await execute("update earnings_entries set business_date = $1, excluded_reason = null", datetime.date(2026, 11, 16))
    await execute("update platform_settings set value = to_jsonb('2026-11-01'::text) where key = 'payouts_started_on'")
    from app.components.payouts import schedule
    from app.components.payouts import settings as payment_settings

    await payment_settings.load()
    await schedule.run(today=datetime.date(2026, 11, 18))
    await execute("update payouts set status = 'paid', payout_reference = 'UTR900001', paid_at = now()")

    found = await rows(
        client, admin, f"payouts.csv?dateFrom=2026-11-01&dateTo=2026-11-30&restaurantId={restaurant_id}"
    )
    assert len(found) == 1
    row = found[0]
    gross = order["subtotalPaise"] + order["packagingFeePaise"]
    assert row["Food and packaging"] == f"{gross / 100:.2f}" and row["Bank reference (UTR)"] == "UTR900001"
    parts = sum(float(row[k]) for k in ("Commission", "Gateway fee", "GST on fees", "TDS", "Coupons", "Refunds"))
    assert round(gross / 100 - parts + float(row["Adjustments"]), 2) == float(row["Net"])


async def test_the_rider_ledger_has_cash_incentive_and_tip(client, admin):
    order, *_ = await delivered_cash_order(client)
    found = await rows(client, admin, "riders.csv")
    by_kind = {r["What"]: r for r in found}

    assert by_kind["Cash collected"]["Cash collected"] == f"{order['totalPaise'] / 100:.2f}"
    assert by_kind["Delivery"]["Incentive"] == "10.00"


async def test_filters(client, admin):
    _, arjun, restaurant_id = await with_data(client, admin)
    other = "00000000-0000-0000-0000-000000000000"

    assert len(await rows(client, admin, f"commission.csv?restaurantId={restaurant_id}")) == 1
    assert await rows(client, admin, f"commission.csv?restaurantId={other}") == []
    assert len(await rows(client, admin, f"riders.csv?riderId={arjun['userId']}")) >= 1
    assert await rows(client, admin, f"collections.csv?riderId={other}") == []
    tax = await rows(client, admin, f"tax.csv?riderId={arjun['userId']}")
    assert [r["Party type"] for r in tax] == ["Rider"]

    for path in (
        f"commission.csv?riderId={arjun['userId']}",
        f"ledger.csv?riderId={arjun['userId']}&restaurantId={restaurant_id}",
        "ledger.csv?restaurantId=abc",
    ):
        assert (await get(client, admin, path)).status_code == 400, path


async def test_admin_only_and_unknown_names(client, admin):
    assert (await client.get(f"{BASE}/ledger.pdf")).status_code == 401
    assert (await get(client, admin, "ledger.docx")).status_code in (400, 404, 422)


def test_a_formula_stays_text_and_other_scripts_do_not_break_the_pdf():
    table = export.Table(
        "T", "T", [export.Column("Name"), export.Column("Amount", export.MONEY)],
        [["=HYPERLINK(1)", -150], ["தமிழ் ₹", 99]],
    )

    assert export.to_csv(table).decode().splitlines()[1] == "'=HYPERLINK(1),-1.50"
    sheet = load_workbook(io.BytesIO(export.to_xlsx(table, "p"))).active
    assert sheet["A2"].value == "=HYPERLINK(1)" and sheet["A2"].data_type == "s"
    assert sheet["B2"].value == -1.5 and sheet["B4"].value == -0.51, "the totals line"
    assert export.to_pdf(table, "p", "Foodos").startswith(b"%PDF")


async def test_the_statement_downloads_as_a_pdf(client, admin):
    owner, restaurant_id, payout_id = await one_payout(client)
    url = statements.link(__import__("uuid").UUID(payout_id))

    page = await client.get(url)
    assert page.status_code == 200 and "Download as PDF" in page.text

    pdf = await client.get(url + "&format=pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert "attachment" in pdf.headers["content-disposition"]

    forged = await client.get(url.replace("s=", "s=0") + "&format=pdf")
    assert forged.status_code == 404 and not forged.content.startswith(b"%PDF")


def test_the_pdf_totals_line_is_labelled_even_when_the_first_column_is_left_out(monkeypatch):
    drawn = []
    monkeypatch.setattr(export, "pdf_table", lambda pdf, titles, rows, *args, **kwargs: drawn.extend(rows))
    table = export.Table(
        "T", "T", [export.Column("Id", pdf=False), export.Column("Name"), export.Column("Net", export.MONEY)],
        [["1", "A", 100], ["2", "B", 250]],
    )
    export.to_pdf(table, "p", "Foodos")

    assert drawn[-1] == ["Total", "3.50"]
