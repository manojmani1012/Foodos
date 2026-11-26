"""Bank details for payouts, for restaurants and riders.

The owner or rider enters them in their app, or staff enter them in the admin
panel; Foodos staff check them (a penny drop, or a cancelled cheque) and mark
them verified. Any change sends them back to 'pending', so a verified account
can never be swapped quietly, and money is only sent to a verified account.
Restaurants need a bank account (holder, number, IFSC); riders a bank account,
a UPI id, or both.

The owner sees the account number masked; the admin, who sends the money,
sees it in full.
"""

import re
import uuid
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from ...database import fetchrow, transaction
from ...errors import bad_request, conflict, not_found
from ..admin import audit

IFSC_PATTERN = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
ACCOUNT_PATTERN = re.compile(r"^\d{9,18}$")
UPI_PATTERN = re.compile(r"^[\w.\-]{2,}@[a-zA-Z]{2,}$")

FIELDS = {
    "holder": "account_holder_name",
    "accountNumber": "account_number",
    "ifsc": "ifsc",
    "bankName": "bank_name",
    "upiId": "upi_id",
}


def _blank(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None

    value = value.strip()

    return value or None


class PayoutAccountBody(BaseModel):
    """Only the fields sent change. A field sent as null (or blank) is removed."""

    holder: Optional[str] = Field(default=None, max_length=100)
    accountNumber: Optional[str] = Field(default=None, max_length=30)
    ifsc: Optional[str] = Field(default=None, max_length=20)
    bankName: Optional[str] = Field(default=None, max_length=100)
    upiId: Optional[str] = Field(default=None, max_length=100)

    @field_validator("holder", "bankName")
    @classmethod
    def _tidy(cls, value: Optional[str]) -> Optional[str]:
        value = _blank(value)

        if value is not None and len(value) < 2:
            raise ValueError("Enter the full name")

        return value

    @field_validator("accountNumber")
    @classmethod
    def _account(cls, value: Optional[str]) -> Optional[str]:
        value = _blank(value)

        if value is None:
            return None

        value = value.replace(" ", "")

        if not ACCOUNT_PATTERN.match(value):
            raise ValueError("An account number is 9 to 18 digits")

        return value

    @field_validator("ifsc")
    @classmethod
    def _ifsc(cls, value: Optional[str]) -> Optional[str]:
        value = _blank(value)

        if value is None:
            return None

        value = value.upper()

        if not IFSC_PATTERN.match(value):
            raise ValueError("Enter the 11-character IFSC, like HDFC0001234")

        return value

    @field_validator("upiId")
    @classmethod
    def _upi(cls, value: Optional[str]) -> Optional[str]:
        value = _blank(value)

        if value is not None and not UPI_PATTERN.match(value):
            raise ValueError("Enter a UPI id like name@okhdfcbank")

        return value


class VerifyAccountBody(BaseModel):
    approve: bool
    reason: Optional[str] = Field(default=None, max_length=300)


def mask(number: Optional[str]) -> Optional[str]:
    return f"XXXXXX{number[-4:]}" if number else None


def _iso(value: Any) -> Optional[str]:
    return value.isoformat() if value is not None else None


def owner_view(row: Optional[Any]) -> Optional[dict]:
    if row is None:
        return None

    return {
        "holder": row["account_holder_name"],
        "accountNumberMasked": mask(row["account_number"]),
        "ifsc": row["ifsc"],
        "bankName": row["bank_name"],
        "upiId": row["upi_id"],
        "status": row["status"],
        "rejectReason": row["reject_reason"],
        "updatedAt": _iso(row["updated_at"]),
    }


def admin_view(row: Optional[Any]) -> Optional[dict]:
    if row is None:
        return None

    return {
        "holder": row["account_holder_name"],
        "accountNumber": row["account_number"],
        "ifsc": row["ifsc"],
        "bankName": row["bank_name"],
        "upiId": row["upi_id"],
        "status": row["status"],
        "rejectReason": row["reject_reason"],
        "updatedAt": _iso(row["updated_at"]),
    }


class _Kind:
    def __init__(self, table: str, key: str, audit_module: str, entity: str, upi_allowed: bool) -> None:
        self.table, self.key, self.audit_module, self.entity, self.upi_allowed = table, key, audit_module, entity, upi_allowed


RESTAURANT = _Kind("restaurant_payout_accounts", "restaurant_id", "Restaurants", "restaurant", False)
RIDER = _Kind("rider_payout_accounts", "partner_id", "Riders", "rider", True)


async def account_row(restaurant_id: Any) -> Optional[Any]:
    return await fetchrow("select * from restaurant_payout_accounts where restaurant_id = $1", restaurant_id)


async def rider_account_row(partner_id: Any) -> Optional[Any]:
    return await fetchrow("select * from rider_payout_accounts where partner_id = $1", partner_id)


async def get_for_owner(restaurant_id: Any) -> dict:
    return {"account": owner_view(await account_row(restaurant_id))}


async def get_for_rider(partner_id: Any) -> dict:
    return {"account": owner_view(await rider_account_row(partner_id))}


async def _save(
    kind: _Kind, party_id: Any, body: PayoutAccountBody, actor_id: Optional[uuid.UUID] = None, ip: Optional[str] = None
) -> None:
    changes = body.model_dump(exclude_unset=True)

    if not kind.upi_allowed and changes.get("upiId"):
        raise bad_request("upi_not_supported", "Restaurants are paid to a bank account. Enter the account details")

    if not kind.upi_allowed:
        changes.pop("upiId", None)

    async with transaction() as connection:
        current = await connection.fetchrow(
            f"select * from {kind.table} where {kind.key} = $1 for update", party_id
        )
        merged = {field: (current[column] if current is not None else None) for field, column in FIELDS.items()}
        merged.update(changes)

        bank = [merged["holder"], merged["accountNumber"], merged["ifsc"]]

        if any(bank) and not all(bank):
            raise bad_request(
                "bank_details_incomplete",
                "For a bank account, enter the account holder's name, the account number and the IFSC",
            )

        if not all(bank) and not (kind.upi_allowed and merged["upiId"]):
            raise bad_request(
                "payout_account_required",
                "Enter the bank account details, so Foodos can pay"
                if not kind.upi_allowed
                else "Enter bank account details or a UPI id, so Foodos can pay",
            )

        if not all(bank):
            merged["bankName"] = None

        unchanged = current is not None and all(merged[f] == current[c] for f, c in FIELDS.items())

        if not unchanged:
            # Anything new must be checked again before money is sent to it.
            await connection.execute(
                f"""
                insert into {kind.table}
                  ({kind.key}, account_holder_name, account_number, ifsc, bank_name, upi_id, status)
                values ($1, $2, $3, $4, $5, $6, 'pending')
                on conflict ({kind.key}) do update
                  set account_holder_name = excluded.account_holder_name,
                      account_number = excluded.account_number, ifsc = excluded.ifsc,
                      bank_name = excluded.bank_name, upi_id = excluded.upi_id,
                      status = 'pending', reject_reason = null, verified_by = null, verified_at = null,
                      updated_at = now()
                """,
                party_id,
                merged["holder"],
                merged["accountNumber"],
                merged["ifsc"],
                merged["bankName"],
                merged["upiId"],
            )

            if actor_id is not None:
                await audit.record(
                    actor_id,
                    "Entered bank details",
                    kind.audit_module,
                    kind.entity,
                    party_id,
                    {"ifsc": merged["ifsc"], "upi": bool(merged["upiId"])},
                    ip,
                    connection,
                )


async def save_for_owner(restaurant_id: Any, body: PayoutAccountBody) -> dict:
    await _save(RESTAURANT, restaurant_id, body)

    return await get_for_owner(restaurant_id)


async def save_for_rider(partner_id: Any, body: PayoutAccountBody) -> dict:
    await _save(RIDER, partner_id, body)

    return await get_for_rider(partner_id)


async def admin_save_restaurant(restaurant_id: uuid.UUID, body: PayoutAccountBody, actor_id: uuid.UUID, ip: Optional[str]) -> None:
    if not await fetchrow("select 1 from restaurants where id = $1", restaurant_id):
        raise not_found("restaurant_not_found", "That restaurant could not be found")

    await _save(RESTAURANT, restaurant_id, body, actor_id, ip)


async def admin_save_rider(partner_id: uuid.UUID, body: PayoutAccountBody, actor_id: uuid.UUID, ip: Optional[str]) -> None:
    if not await fetchrow("select 1 from delivery_partners where user_id = $1", partner_id):
        raise not_found("rider_not_found", "That rider could not be found")

    await _save(RIDER, partner_id, body, actor_id, ip)


async def _verify(
    kind: _Kind, party_id: uuid.UUID, approve: bool, reason: Optional[str], actor_id: uuid.UUID, ip: Optional[str]
) -> None:
    reason = _blank(reason)

    if not approve and (not reason or len(reason) < 3):
        raise bad_request("reason_required", "Say what is wrong, so they know what to fix")

    name_sql = (
        "select a.status, r.name from restaurant_payout_accounts a join restaurants r on r.id = a.restaurant_id "
        "where a.restaurant_id = $1 for update of a"
        if kind is RESTAURANT
        else "select a.status, u.full_name as name from rider_payout_accounts a join users u on u.id = a.partner_id "
        "where a.partner_id = $1 for update of a"
    )

    async with transaction() as connection:
        current = await connection.fetchrow(name_sql, party_id)

        if current is None:
            if kind is RESTAURANT:
                exists = await connection.fetchval("select 1 from restaurants where id = $1", party_id)
            else:
                exists = await connection.fetchval("select 1 from delivery_partners where user_id = $1", party_id)

            if not exists:
                raise not_found(
                    "restaurant_not_found" if kind is RESTAURANT else "rider_not_found",
                    "That restaurant could not be found" if kind is RESTAURANT else "That rider could not be found",
                )

            raise conflict("no_payout_account", "No bank details have been added yet")

        await connection.execute(
            f"""
            update {kind.table}
            set status = $2, reject_reason = $3, verified_by = $4,
                verified_at = case when $2 = 'verified' then now() end, updated_at = now()
            where {kind.key} = $1
            """,
            party_id,
            "verified" if approve else "rejected",
            None if approve else reason,
            actor_id,
        )
        await audit.record(
            actor_id,
            "Verified bank details" if approve else "Rejected bank details",
            kind.audit_module,
            kind.entity,
            party_id,
            {"name": current["name"], "reason": None if approve else reason},
            ip,
            connection,
        )


async def verify(restaurant_id: uuid.UUID, approve: bool, reason: Optional[str], actor_id: uuid.UUID, ip: Optional[str]) -> None:
    await _verify(RESTAURANT, restaurant_id, approve, reason, actor_id, ip)


async def verify_rider(partner_id: uuid.UUID, approve: bool, reason: Optional[str], actor_id: uuid.UUID, ip: Optional[str]) -> None:
    await _verify(RIDER, partner_id, approve, reason, actor_id, ip)
