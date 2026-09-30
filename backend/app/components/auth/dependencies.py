"""FastAPI dependencies for authenticated routes."""

import uuid
from dataclasses import dataclass, field
from typing import Optional

from fastapi import Depends, Request

from ...errors import forbidden, unauthorized
from .tokens import verify_access_token


@dataclass
class CurrentUser:
    id: uuid.UUID
    role: str
    roles: list[str] = field(default_factory=list)


def _read_bearer_token(request: Request) -> Optional[str]:
    header = request.headers.get("authorization", "")
    parts = header.split(" ", 1)

    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        return None

    return parts[1].strip()


async def authenticate(request: Request) -> CurrentUser:
    """Verifies the access token and returns the caller."""
    token = _read_bearer_token(request)

    if token is None:
        raise unauthorized("token_missing", "Sign in to continue")

    payload = verify_access_token(token)

    try:
        # asyncpg will not accept a string where a uuid column is expected, so
        # the subject is converted once here rather than at every query.
        user_id = uuid.UUID(str(payload.get("sub")))
    except (ValueError, TypeError):
        raise unauthorized("token_invalid", "Sign in again")

    return CurrentUser(id=user_id, role=payload.get("role", ""), roles=payload.get("roles") or [])


async def optional_authenticate(request: Request) -> Optional[CurrentUser]:
    """Identifies the caller when a valid token is present, and returns None
    otherwise.

    Browsing works before signing in, but a signed-in customer should still see
    which restaurants they have favourited. An invalid or expired token is
    treated as "not signed in" rather than an error, so a stale token never
    blocks the menu from loading.
    """
    if _read_bearer_token(request) is None:
        return None

    try:
        return await authenticate(request)
    except Exception:
        return None


def require_role(*allowed: str):
    """Checks the role this session was issued for, not every role the user
    holds, so a rider who also orders food cannot reach rider endpoints from the
    customer app."""

    async def dependency(user: CurrentUser = Depends(authenticate)) -> CurrentUser:
        if user.role not in allowed:
            raise forbidden("role_forbidden", "This account cannot access that")

        return user

    return dependency
