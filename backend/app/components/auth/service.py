"""Authentication use cases: OTP login, admin login, refresh, logout."""

from typing import Any, Optional

import asyncpg

from ...config import get_settings
from ...database import execute, fetchrow, transaction
from ...errors import forbidden, too_many_requests, unauthorized
from ..admin import audit
from ..notifications.sms import otp_message, send_sms
from .otp import consume_otp, create_otp
from .passwords import DUMMY_HASH, verify_password
from .phone import normalize_phone
from .tokens import get_user_roles, issue_session, revoke_session, rotate_session

# Roles a phone login may grant. Admin access is deliberately absent: it is only
# ever handed out through the password login below, never by knowing a number.
PHONE_LOGIN_ROLES = ["customer", "restaurant_owner", "delivery_partner"]

# The admin login is on the public internet, so password guessing is slowed
# down: a few wrong tries lock that email for a while, and one address trying
# many emails is stopped too.
ADMIN_LOGIN_WINDOW_MINUTES = 15
ADMIN_LOGIN_MAX_FAILURES_PER_EMAIL = 5
ADMIN_LOGIN_MAX_FAILURES_PER_IP = 20
ADMIN_LOGIN_FAILED = "Admin sign-in failed"


async def request_login_otp(raw_phone: str) -> dict[str, Any]:
    settings = get_settings()
    phone = normalize_phone(raw_phone)

    blocked = await fetchrow("select 1 from users where phone = $1 and status = 'blocked'", phone)

    if blocked is not None:
        raise forbidden("account_blocked", "This account has been blocked. Contact support")

    created = await create_otp(phone, "login")

    await send_sms(phone, otp_message(created["code"]))

    result = {"phone": phone, "expiresInSeconds": created["expiresInSeconds"]}

    # Development convenience so the apps work before an SMS gateway exists.
    # Settings force this off when NODE_ENV=production.
    if settings.expose_otp_in_response:
        result["devCode"] = created["code"]

    return result


async def _grant_role(connection: asyncpg.Connection, user_id: Any, role: str) -> None:
    """A person may hold several roles on one phone number - a rider who also
    orders food. `role` says which app they are signing in to."""
    await connection.execute(
        "insert into user_roles (user_id, role) values ($1, $2) on conflict do nothing",
        user_id,
        role,
    )

    # Partner roles start unapproved. Signing in works, but the app should keep
    # them out of live orders until an admin moves them to active.
    if role == "delivery_partner":
        await connection.execute(
            "insert into delivery_partners (user_id) values ($1) on conflict (user_id) do nothing",
            user_id,
        )


async def _find_or_create_user_by_phone(
    connection: asyncpg.Connection, phone: str
) -> tuple[asyncpg.Record, bool]:
    existing = await connection.fetchrow(
        "select id, full_name, status from users where phone = $1", phone
    )

    if existing is not None:
        return existing, False

    created = await connection.fetchrow(
        "insert into users (phone) values ($1) returning id, full_name, status", phone
    )

    return created, True


async def verify_login_otp(
    raw_phone: str,
    code: str,
    role: str,
    user_agent: Optional[str] = None,
    ip: Optional[str] = None,
) -> dict[str, Any]:
    phone = normalize_phone(raw_phone)

    if role not in PHONE_LOGIN_ROLES:
        raise forbidden("role_not_allowed", "This role cannot sign in with a phone number")

    await consume_otp(phone, code, "login")

    async with transaction() as connection:
        user, is_new_user = await _find_or_create_user_by_phone(connection, phone)

        if user["status"] == "blocked":
            raise forbidden("account_blocked", "This account has been blocked. Contact support")

        await _grant_role(connection, user["id"], role)
        await connection.execute("update users set last_login_at = now() where id = $1", user["id"])

        role_rows = await connection.fetch(
            "select role from user_roles where user_id = $1 order by role", user["id"]
        )
        roles = [row["role"] for row in role_rows]

        session = await issue_session(connection, user["id"], role, roles, user_agent, ip)

    return {
        **session,
        "isNewUser": is_new_user,
        "user": {
            "id": str(user["id"]),
            "phone": phone,
            "fullName": user["full_name"],
            "role": role,
            "roles": roles,
        },
    }


async def _check_admin_login_attempts(email: str, ip: Optional[str]) -> None:
    failures = await fetchrow(
        """
        select count(*) filter (where metadata->>'email' = $1)::int as for_email,
               count(*) filter (where $2::text is not null and host(ip) = $2)::int as for_ip
        from audit_logs
        where module = 'Auth' and action = $3
          and created_at > now() - make_interval(mins => $4)
        """,
        email,
        audit.valid_ip(ip),
        ADMIN_LOGIN_FAILED,
        ADMIN_LOGIN_WINDOW_MINUTES,
    )

    if (
        failures["for_email"] >= ADMIN_LOGIN_MAX_FAILURES_PER_EMAIL
        or failures["for_ip"] >= ADMIN_LOGIN_MAX_FAILURES_PER_IP
    ):
        raise too_many_requests(
            "login_attempts_exceeded",
            f"Too many wrong attempts. Try again in {ADMIN_LOGIN_WINDOW_MINUTES} minutes",
        )


async def login_with_password(
    email: str,
    password: str,
    user_agent: Optional[str] = None,
    ip: Optional[str] = None,
) -> dict[str, Any]:
    normalized_email = str(email or "").strip().lower()

    await _check_admin_login_attempts(normalized_email, ip)

    user = await fetchrow(
        """
        select u.id, u.full_name, u.password_hash, u.status,
               coalesce(array_agg(r.role order by r.role) filter (where r.role is not null), '{}') as roles
        from users u
        left join user_roles r on r.user_id = u.id
        where u.email = $1
        group by u.id
        """,
        normalized_email,
    )

    # Verify against a dummy hash when the account is missing so a wrong email
    # and a wrong password take the same time to answer.
    stored_hash = user["password_hash"] if user and user["password_hash"] else DUMMY_HASH
    password_matches = verify_password(password, stored_hash)

    if user is None or not password_matches:
        await audit.record(
            user["id"] if user else None,
            ADMIN_LOGIN_FAILED,
            "Auth",
            "user",
            user["id"] if user else None,
            {"email": normalized_email},
            ip,
        )

        raise unauthorized("credentials_invalid", "Incorrect email or password")

    if user["status"] == "blocked":
        raise forbidden("account_blocked", "This account has been blocked")

    roles = list(user["roles"])

    if "admin" not in roles and "super_admin" not in roles:
        raise forbidden("role_not_allowed", "This account cannot sign in here")

    role = "super_admin" if "super_admin" in roles else "admin"

    await execute("update users set last_login_at = now() where id = $1", user["id"])
    await audit.record(user["id"], "Signed in", "Auth", "user", user["id"], {"email": normalized_email}, ip)

    session = await issue_session(None, user["id"], role, roles, user_agent, ip)

    return {
        **session,
        "user": {
            "id": str(user["id"]),
            "email": normalized_email,
            "fullName": user["full_name"],
            "role": role,
            "roles": roles,
        },
    }


async def refresh_session(
    refresh_token: str, user_agent: Optional[str] = None, ip: Optional[str] = None
) -> dict[str, Any]:
    return await rotate_session(refresh_token, user_agent, ip)


async def logout(refresh_token: str) -> None:
    await revoke_session(refresh_token)


async def get_current_user(user_id: Any) -> dict[str, Any]:
    user = await fetchrow(
        "select id, phone, email, full_name, avatar_url, status, created_at from users where id = $1",
        user_id,
    )

    if user is None:
        raise unauthorized("user_not_found", "Sign in again")

    return {
        "id": str(user["id"]),
        "phone": user["phone"],
        "email": user["email"],
        "fullName": user["full_name"],
        "avatarUrl": user["avatar_url"],
        "status": user["status"],
        "createdAt": user["created_at"].isoformat(),
        "roles": await get_user_roles(user["id"]),
    }
