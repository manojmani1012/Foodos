"""Paying many payouts through the bank at once, and the money to pay them with.

Funds    Staff type in the bank balance. What can be spent is that balance,
         less the reserve that must stay in the account, less payments waiting
         on a bank file and payouts marked paid since the balance was typed in.
         Due payouts are covered strictly oldest first: when one does not fit,
         everything newer waits too, so an old due is never jumped.
File     One CSV of covered payouts for the bank's bulk upload (NEFT, or RTGS
         from Rs 2 lakh). Its payouts become 'processing', so they cannot go
         into a second file.
Result   The bank's reply, uploaded as CSV. Previewed first; then each line
         marks its payout paid (with the UTR) or failed (with the reason).

The column layout is a general one. When the client's bank gives its sample
files, only `FILE_COLUMNS` and `RESULT_ALIASES` need to change.
"""

import csv
import io
import re
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from ...database import fetch, fetchrow, fetchval, transaction
from ...errors import AppError, bad_request, conflict, not_found
from ..admin import audit
from . import schedule
from . import settings as payment_settings
from .views import PAYOUT_SELECT, blocker

# RBI's smallest RTGS transfer is Rs 2,00,000.
RTGS_MIN_PAISE = 20_000_000
MAX_FILE_LINES = 500
MAX_RESULT_ROWS = 2000

FILE_COLUMNS = [
    "Payment reference", "Mode", "Beneficiary name", "Account number", "IFSC", "Amount", "Remarks",
]

# Column names a bank's result file may use, compared without case, spaces or punctuation.
RESULT_ALIASES = {
    "reference": ("paymentreference", "reference", "referenceno", "customerreference", "customerrefno", "clientreference"),
    "status": ("status", "transactionstatus", "paymentstatus"),
    "utr": ("utr", "utrno", "utrnumber", "bankreference", "bankreferenceno", "transactionid"),
    "reason": ("reason", "remarks", "failurereason", "rejectreason", "message"),
    "amount": ("amount", "transactionamount", "paymentamount"),
}

PAID_WORDS = {"success", "successful", "succeeded", "paid", "processed", "completed", "settled", "executed"}
FAILED_WORDS = {"failed", "failure", "rejected", "returned", "declined", "reversed", "cancelled", "canceled"}


# --- The money available ------------------------------------------------------


async def balance_row(connection: Any = None) -> Optional[dict]:
    query = "select value, updated_at, updated_by from platform_settings where key = 'bank_balance'"
    row = await (connection.fetchrow(query) if connection else fetchrow(query))

    if row is None:
        return None

    value = row["value"]

    if isinstance(value, str):
        import json

        value = json.loads(value)

    return {"balancePaise": int(value["balancePaise"]), "at": row["updated_at"], "by": row["updated_by"]}


async def save_balance(balance_paise: int, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    async with transaction() as connection:
        await connection.execute("select pg_advisory_xact_lock(hashtext($1))", schedule.BATCH_LOCK)
        old = await balance_row(connection)
        # clock_timestamp: a payment recorded a moment earlier must not count as "since".
        await connection.execute(
            """
            insert into platform_settings (key, value, updated_by, updated_at)
            values ('bank_balance', jsonb_build_object('balancePaise', $1::bigint), $2, clock_timestamp())
            on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by,
                                            updated_at = excluded.updated_at
            """,
            balance_paise,
            actor_id,
        )
        await audit.record(
            actor_id,
            "Updated bank balance",
            "Payouts",
            "settings",
            "bank_balance",
            {"from": old["balancePaise"] if old else None, "to": balance_paise},
            ip,
            connection,
        )

    return await funds()


async def _due_rows(due_by: Any, connection: Any = None) -> list[Any]:
    """Scheduled payouts due by `due_by`, oldest dues first."""
    query = f"""
        select * from ({PAYOUT_SELECT}) p
        where p.status = 'scheduled' and p.scheduled_for <= $1
        order by p.period_start, p.period_end, p.scheduled_for, p.created_at, p.id
    """

    return await (connection.fetch(query, due_by) if connection else fetch(query, due_by))


def _destination(row: Any) -> Optional[dict]:
    """The bank account a payout can be sent to. None for a UPI-only rider."""
    if row["party_type"] == "restaurant":
        number, ifsc, holder = row["account_number"], row["ifsc"], row["account_holder_name"]
    else:
        number, ifsc, holder = row["rider_account_number"], row["rider_ifsc"], row["rider_holder"]

    if not (number and ifsc and holder):
        return None

    return {"accountNumber": number, "ifsc": ifsc, "holder": holder}


def _plan(rows: list[Any], available: Optional[int]) -> list[dict]:
    """Each due payout with where it stands: in the file, or why not.

    state: 'ready'    verified bank account and the money is there
           'no_funds' the money runs out at or before this one
           'blocked'  bank details missing or not verified
           'upi'      a verified rider with only a UPI id: paid by hand
    Blocked and UPI payouts do not use up the file's money, except that a UPI
    one is still a due that has to be funded, so it does count against it.
    """
    left = available
    short = False
    plan = []

    for row in rows:
        why = blocker(row)

        if why is not None:
            plan.append({"row": row, "state": "blocked", "why": why})
            continue

        amount = row["net_paise"]

        if left is not None:
            if short or amount > left:
                short = True
                plan.append({"row": row, "state": "no_funds", "why": None})
                continue

            left -= amount

        plan.append({"row": row, "state": "ready" if _destination(row) else "upi", "why": None})

    return plan


async def _available(connection: Any = None) -> dict:
    balance = await balance_row(connection)
    value = connection.fetchval if connection else fetchval
    waiting = int(await value("select coalesce(sum(net_paise), 0)::bigint from payouts where status = 'processing'"))
    reserve = int(payment_settings.current()["reservePaise"])

    if balance is None:
        return {"balance": None, "waiting": waiting, "paidSince": 0, "reserve": reserve, "available": None}

    paid_since = int(
        await value(
            "select coalesce(sum(net_paise), 0)::bigint from payouts where status = 'paid' and paid_at > $1",
            balance["at"],
        )
    )

    return {
        "balance": balance,
        "waiting": waiting,
        "paidSince": paid_since,
        "reserve": reserve,
        "available": balance["balancePaise"] - waiting - paid_since - reserve,
    }


def _sum(plan: list[dict], *states: str) -> dict:
    picked = [item for item in plan if item["state"] in states]

    return {"count": len(picked), "netPaise": sum(item["row"]["net_paise"] for item in picked)}


async def funds() -> dict:
    """The money card on the payouts page, including the shortfall alert."""
    today = await schedule.india_today()
    money = await _available()
    rows = await _due_rows(today)
    spendable = None if money["available"] is None else max(0, money["available"])
    plan = _plan(rows, spendable)
    payable = _sum(plan, "ready", "upi", "no_funds")
    shortfall = 0

    if money["available"] is not None:
        shortfall = max(0, payable["netPaise"] - money["available"])

    waiting = next((item["row"] for item in plan if item["state"] == "no_funds"), None)
    balance = money["balance"]

    return {
        "balancePaise": balance["balancePaise"] if balance else None,
        "balanceAt": balance["at"].isoformat() if balance else None,
        "reservePaise": money["reserve"],
        "waitingOnBankPaise": money["waiting"],
        "paidSinceBalancePaise": money["paidSince"],
        "availablePaise": money["available"],
        "due": payable,
        "ready": _sum(plan, "ready"),
        "upi": _sum(plan, "upi"),
        "blocked": _sum(plan, "blocked"),
        "waitingForFunds": _sum(plan, "no_funds"),
        "shortfallPaise": shortfall,
        "oldestWaiting": None
        if waiting is None
        else {
            "payoutId": str(waiting["id"]),
            "partyName": waiting["party_name"],
            "netPaise": waiting["net_paise"],
            "periodStart": waiting["period_start"].isoformat(),
        },
    }


# --- The file for the bank ----------------------------------------------------


def _cell(value: str) -> str:
    """Text a spreadsheet will not run as a formula."""
    value = " ".join(str(value).split())

    return value.lstrip("=+-@ ") if value[:1] in "=+-@" else value


def _rupees(paise: int) -> str:
    return f"{paise // 100}.{paise % 100:02d}"


def _file_row(row: Any) -> dict:
    return {
        "id": str(row["id"]),
        "number": row["number"],
        "createdAt": row["created_at"].isoformat(),
        "createdBy": row["created_by_name"],
        "paymentCount": row["payment_count"],
        "totalPaise": int(row["total_paise"]),
        "cancelledAt": row["cancelled_at"].isoformat() if row["cancelled_at"] else None,
        "waiting": row["waiting"],
        "paid": row["paid"],
        "failed": row["failed"],
    }


FILE_SELECT = """
    select f.id, f.number, f.created_at, f.payment_count, f.total_paise, f.cancelled_at,
           coalesce(u.full_name, u.email) as created_by_name,
           count(p.id) filter (where p.status = 'processing' and p.bank_file_id = f.id)::int as waiting,
           count(p.id) filter (where p.status = 'paid' and p.bank_file_id = f.id)::int as paid,
           count(p.id) filter (where p.status = 'failed' and p.bank_file_id = f.id)::int as failed
    from payout_bank_files f
    left join users u on u.id = f.created_by
    left join payout_bank_file_items i on i.file_id = f.id
    left join payouts p on p.id = i.payout_id
"""


async def list_files(limit: int = 20) -> dict:
    rows = await fetch(f"{FILE_SELECT} group by f.id, u.id order by f.number desc limit $1", limit)

    return {"files": [_file_row(row) for row in rows]}


async def _file(file_id: uuid.UUID) -> dict:
    row = await fetchrow(f"{FILE_SELECT} where f.id = $1 group by f.id, u.id", file_id)

    if row is None:
        raise not_found("bank_file_not_found", "That bank file could not be found")

    return _file_row(row)


def _file_id(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise not_found("bank_file_not_found", "That bank file could not be found")


async def create_file(actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    """Puts every due payout that can be sent into a new file."""
    today = await schedule.india_today()

    async with transaction() as connection:
        await connection.execute("select pg_advisory_xact_lock(hashtext($1))", schedule.BATCH_LOCK)
        # Locked so a hold or a "mark paid" cannot slip in while the file is made.
        await connection.fetch(
            "select id from payouts where status = 'scheduled' and scheduled_for <= $1 for update", today
        )

        money = await _available(connection)
        spendable = None if money["available"] is None else max(0, money["available"])
        plan = _plan(await _due_rows(today, connection), spendable)
        ready = [item["row"] for item in plan if item["state"] == "ready"][:MAX_FILE_LINES]

        if not ready:
            if any(item["state"] == "no_funds" for item in plan):
                raise AppError(
                    409,
                    "not_enough_funds",
                    "The bank balance, after the reserve, does not cover the oldest due payout",
                )

            raise conflict(
                "nothing_to_send",
                "No due payout can go into a bank file. Check that bank details are verified",
            )

        file = await connection.fetchrow(
            """
            insert into payout_bank_files (payment_count, total_paise, created_by)
            values ($1, $2, $3) returning id, number
            """,
            len(ready),
            sum(row["net_paise"] for row in ready),
            actor_id,
        )

        for line, row in enumerate(ready, start=1):
            account = _destination(row)
            await connection.execute(
                """
                insert into payout_bank_file_items
                  (file_id, line, payout_id, reference, mode, beneficiary_name, account_number, ifsc, amount_paise)
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                file["id"],
                line,
                row["id"],
                f"FDP{file['number']:05d}{line:04d}",
                "RTGS" if row["net_paise"] >= RTGS_MIN_PAISE else "NEFT",
                account["holder"],
                account["accountNumber"],
                account["ifsc"],
                row["net_paise"],
            )

        await connection.execute(
            "update payouts set status = 'processing', bank_file_id = $2, updated_at = now() where id = any($1::uuid[])",
            [row["id"] for row in ready],
            file["id"],
        )

        for row in ready:
            await audit.record(
                actor_id, "Added payout to bank file", "Payouts", "payout", row["id"],
                {"reference": f"Bank file {file['number']}"}, ip, connection,
            )

        await audit.record(
            actor_id, "Created bank file", "Payouts", "bank_file", file["id"],
            {"number": file["number"], "count": len(ready), "totalPaise": sum(row["net_paise"] for row in ready)},
            ip, connection,
        )

    return {"file": await _file(file["id"])}


async def file_csv(file_id: str, actor_id: uuid.UUID, ip: Optional[str]) -> tuple[str, str]:
    identifier = _file_id(file_id)
    file = await _file(identifier)

    if file["cancelledAt"]:
        raise conflict("bank_file_cancelled", "This bank file was cancelled, so it must not be sent to the bank")

    items = await fetch("select * from payout_bank_file_items where file_id = $1 order by line", identifier)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(FILE_COLUMNS)

    for item in items:
        writer.writerow(
            [item["reference"], item["mode"], _cell(item["beneficiary_name"]), item["account_number"], item["ifsc"],
             _rupees(item["amount_paise"]), f"Foodos payout {item['reference']}"]
        )

    # It holds full account numbers, so every download is on record.
    async with transaction() as connection:
        await audit.record(
            actor_id, "Downloaded bank file", "Payouts", "bank_file", identifier, {"number": file["number"]}, ip, connection
        )

    return f"foodos-bank-file-{file['number']}.csv", out.getvalue()


async def cancel_file(file_id: str, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    """For a file that never reached the bank: its payouts go back to scheduled.
    Refused once any line has a result, because the bank clearly has the file."""
    identifier = _file_id(file_id)

    async with transaction() as connection:
        await connection.execute("select pg_advisory_xact_lock(hashtext($1))", schedule.BATCH_LOCK)
        file = await connection.fetchrow("select * from payout_bank_files where id = $1 for update", identifier)

        if file is None:
            raise not_found("bank_file_not_found", "That bank file could not be found")

        if file["cancelled_at"] is not None:
            raise conflict("bank_file_cancelled", "This bank file is already cancelled")

        settled = await connection.fetchval(
            """
            select count(*) from payout_bank_file_items i join payouts p on p.id = i.payout_id
            where i.file_id = $1 and (p.bank_file_id is distinct from $1 or p.status <> 'processing')
            """,
            identifier,
        )

        if settled:
            raise conflict(
                "bank_file_has_results",
                "Some payments in this file already have a result, so it cannot be cancelled",
            )

        rows = await connection.fetch(
            """
            update payouts set status = 'scheduled', bank_file_id = null, updated_at = now()
            where bank_file_id = $1 and status = 'processing' returning id
            """,
            identifier,
        )
        await connection.execute(
            "update payout_bank_files set cancelled_at = now(), cancelled_by = $2 where id = $1", identifier, actor_id
        )

        for row in rows:
            await audit.record(
                actor_id, "Removed payout from cancelled bank file", "Payouts", "payout", row["id"],
                {"reference": f"Bank file {file['number']}"}, ip, connection,
            )

        await audit.record(
            actor_id, "Cancelled bank file", "Payouts", "bank_file", identifier, {"number": file["number"]}, ip, connection
        )

    return {"file": await _file(identifier)}


# --- The bank's result --------------------------------------------------------


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def parse_result(text: str) -> list[dict]:
    """The rows of a result CSV, with our field names."""
    text = text.lstrip("﻿").strip()

    if not text:
        raise bad_request("result_empty", "The file is empty")

    try:
        rows = list(csv.reader(io.StringIO(text)))
    except csv.Error:
        raise bad_request("result_unreadable", "That file is not a CSV file")

    header = [_key(cell) for cell in rows[0]]
    columns: dict[str, int] = {}

    for field, aliases in RESULT_ALIASES.items():
        for alias in aliases:
            if alias in header:
                columns[field] = header.index(alias)
                break

    missing = [label for field, label in (("reference", "Payment reference"), ("status", "Status")) if field not in columns]

    if missing:
        raise bad_request("result_columns_missing", f"The file needs these columns: {', '.join(missing)}")

    parsed = []

    for number, row in enumerate(rows[1:], start=2):
        if not any(cell.strip() for cell in row):
            continue

        values = {field: (row[index].strip() if index < len(row) else "") for field, index in columns.items()}
        parsed.append({"row": number, **values})

    if len(parsed) > MAX_RESULT_ROWS:
        raise bad_request("result_too_long", f"Upload at most {MAX_RESULT_ROWS} rows at a time")

    return parsed


def _amount_paise(text: str) -> Optional[int]:
    try:
        return int((Decimal(text.replace(",", "").replace("₹", "").strip()) * 100).to_integral_value())
    except (InvalidOperation, ValueError, OverflowError):
        return None


async def _judge(row: dict, seen: set, utrs: set) -> dict:
    """What this result row would do. outcome: 'paid' | 'failed' | 'done' |
    'problem'. Only the first two change anything."""
    reference = row.get("reference", "").upper()
    result = {"row": row["row"], "reference": reference, "utr": None, "reason": None, "payoutId": None,
              "partyName": None, "amountPaise": None, "outcome": "problem", "message": None}

    def problem(message: str) -> dict:
        result["message"] = message
        return result

    item = await fetchrow(
        f"""
        select i.file_id, i.payout_id, i.amount_paise, f.cancelled_at, p.status, p.bank_file_id,
               p.payout_reference, p.party_name
        from payout_bank_file_items i
        join payout_bank_files f on f.id = i.file_id
        join ({PAYOUT_SELECT}) p on p.id = i.payout_id
        where i.reference = $1
        """,
        reference,
    )

    if item is None:
        return problem("This payment reference is not from a Foodos bank file")

    result.update(payoutId=str(item["payout_id"]), partyName=item["party_name"], amountPaise=item["amount_paise"])

    if reference in seen:
        return problem("This reference appears twice in the file")

    seen.add(reference)
    word = _key(row.get("status", ""))
    utr = row.get("utr", "").strip()

    if word in PAID_WORDS:
        outcome = "paid"
    elif word in FAILED_WORDS:
        outcome = "failed"
    else:
        return problem(f"Status '{row.get('status', '')}' is not a success or a failure, so it is left waiting")

    if row.get("amount"):
        amount = _amount_paise(row["amount"])

        if amount != item["amount_paise"]:
            return problem("The amount does not match what Foodos asked the bank to send")

    same_file = item["bank_file_id"] == item["file_id"]

    if same_file and item["status"] == "paid" and outcome == "paid" and (item["payout_reference"] or "").lower() == utr.lower():
        result.update(outcome="done", utr=utr, message="Already marked paid with this UTR")
        return result

    if same_file and item["status"] == "failed" and outcome == "failed":
        result.update(outcome="done", message="Already marked failed")
        return result

    if item["cancelled_at"] is not None:
        return problem("This line is from a cancelled bank file. Check with the bank before paying again")

    if not same_file or item["status"] != "processing":
        return problem("This payout is no longer waiting on this file. Check it by hand")

    if outcome == "paid":
        if not 4 <= len(utr) <= 60:
            return problem("A successful payment needs its UTR number")

        used = await fetchval("select 1 from payouts where lower(payout_reference) = lower($1) and id <> $2", utr, item["payout_id"])

        if used or utr.lower() in utrs:
            return problem("This UTR number is already used by another payout")

        utrs.add(utr.lower())
        result.update(outcome="paid", utr=utr)
    else:
        reason = row.get("reason", "").strip() or "The bank rejected this payment"
        result.update(outcome="failed", reason=reason[:300] if len(reason) >= 3 else "The bank rejected this payment")

    return result


async def apply_result(text: str, apply: bool, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    """Previews a result file, or carries it out. Rows with problems are never
    applied; the others still are."""
    rows = parse_result(text)
    seen: set = set()
    utrs: set = set()
    judged = [await _judge(row, seen, utrs) for row in rows]

    if apply:
        for result in judged:
            if result["outcome"] not in ("paid", "failed"):
                continue

            try:
                await schedule.act(
                    result["payoutId"], result["outcome"], actor_id, ip,
                    reason=result["reason"], reference=result["utr"],
                )
            except AppError as error:
                # Changed by someone else between the preview and now.
                result.update(outcome="problem", message=error.message)

    return {
        "applied": apply,
        "rows": judged,
        "summary": {
            outcome: sum(1 for result in judged if result["outcome"] == outcome)
            for outcome in ("paid", "failed", "done", "problem")
        },
    }
