"""Access and refresh tokens.

Access tokens are short-lived JWTs the API verifies without touching the
database. Refresh tokens are opaque random strings; only their hash is stored,
so a leaked database dump cannot be replayed as a login.
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import asyncpg
import jwt

from ...config import get_settings
from ...database import execute, fetch, fetchrow
from ...errors import unauthorized


def sign_access_token(user_id: str, role: str, roles: list[str]) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)

    return jwt.encode(
        {
            "sub": str(user_id),
            "role": role,
            "roles": roles,
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "iat": now,
            "exp": now + timedelta(seconds=settings.access_token_ttl_seconds),
        },
        settings.jwt_access_secret,
        algorithm="HS256",
    )


def verify_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()

    try:
        return jwt.decode(
            token,
            settings.jwt_access_secret,
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
        )
    except jwt.ExpiredSignatureError:
        raise unauthorized("token_expired", "Session expired. Sign in again")
    except jwt.PyJWTError:
        raise unauthorized("token_invalid", "Sign in again")


def _generate_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def _hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def _insert_refresh_token(
    connection: Optional[asyncpg.Connection],
    user_id: Any,
    role: str,
    family_id: Any,
    user_agent: Optional[str],
    ip: Optional[str],
) -> dict[str, Any]:
    """`connection` lets the caller keep this inside the transaction that created
    the user."""
    settings = get_settings()
    token = _generate_refresh_token()

    sql = """
        insert into refresh_tokens (user_id, role, family_id, token_hash, user_agent, ip, expires_at)
        values ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))
        returning expires_at
    """
    args = (
        user_id,
        role,
        family_id,
        _hash_refresh_token(token),
        user_agent,
        ip,
        float(settings.refresh_token_ttl_seconds),
    )

    row = await (connection.fetchrow(sql, *args) if connection else fetchrow(sql, *args))

    return {"token": token, "expiresAt": row["expires_at"]}


async def issue_session(
    connection: Optional[asyncpg.Connection],
    user_id: Any,
    role: str,
    roles: list[str],
    user_agent: Optional[str] = None,
    ip: Optional[str] = None,
) -> dict[str, Any]:
    settings = get_settings()
    refresh = await _insert_refresh_token(connection, user_id, role, uuid.uuid4(), user_agent, ip)

    return {
        "accessToken": sign_access_token(str(user_id), role, roles),
        "refreshToken": refresh["token"],
        "expiresInSeconds": settings.access_token_ttl_seconds,
        "refreshTokenExpiresAt": refresh["expiresAt"].isoformat(),
    }


async def rotate_session(
    refresh_token: str,
    user_agent: Optional[str] = None,
    ip: Optional[str] = None,
) -> dict[str, Any]:
    """Exchanges a refresh token for a new pair and retires the old one.

    A token that has already been rotated should never appear again. If one does,
    it was probably stolen and the thief and the real user now hold tokens from
    the same family, so every token in that family is revoked and both are
    logged out.
    """
    settings = get_settings()

    if not refresh_token or not isinstance(refresh_token, str):
        raise unauthorized("refresh_token_required", "Sign in again")

    record = await fetchrow(
        """
        select t.id, t.user_id, t.role, t.family_id, t.revoked_at, t.expires_at, u.status
        from refresh_tokens t
        join users u on u.id = t.user_id
        where t.token_hash = $1
        """,
        _hash_refresh_token(refresh_token),
    )

    if record is None:
        raise unauthorized("refresh_token_invalid", "Sign in again")

    if record["revoked_at"] is not None:
        await execute(
            "update refresh_tokens set revoked_at = now() where family_id = $1 and revoked_at is null",
            record["family_id"],
        )

        raise unauthorized("refresh_token_reused", "Session ended for security. Sign in again")

    if record["expires_at"] <= datetime.now(timezone.utc):
        raise unauthorized("refresh_token_expired", "Session expired. Sign in again")

    if record["status"] == "blocked":
        raise unauthorized("account_blocked", "This account has been blocked")

    await execute("update refresh_tokens set revoked_at = now() where id = $1", record["id"])

    roles = await get_user_roles(record["user_id"])
    nxt = await _insert_refresh_token(
        None, record["user_id"], record["role"], record["family_id"], user_agent, ip
    )

    return {
        "accessToken": sign_access_token(str(record["user_id"]), record["role"], roles),
        "refreshToken": nxt["token"],
        "expiresInSeconds": settings.access_token_ttl_seconds,
        "refreshTokenExpiresAt": nxt["expiresAt"].isoformat(),
    }


async def revoke_session(refresh_token: Optional[str]) -> None:
    """Logout revokes the whole family, so the token's successors die with it."""
    if not refresh_token or not isinstance(refresh_token, str):
        return

    await execute(
        """
        update refresh_tokens set revoked_at = now()
        where revoked_at is null
          and family_id = (select family_id from refresh_tokens where token_hash = $1)
        """,
        _hash_refresh_token(refresh_token),
    )


async def revoke_all_sessions_for_user(user_id: Any) -> None:
    await execute(
        "update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null",
        user_id,
    )


async def get_user_roles(user_id: Any) -> list[str]:
    rows = await fetch("select role from user_roles where user_id = $1 order by role", user_id)

    return [row["role"] for row in rows]
