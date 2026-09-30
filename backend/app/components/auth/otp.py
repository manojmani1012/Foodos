"""One-time passcodes: generation, rate limiting and verification.

Only a hash of each code is ever stored.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timezone

from ...config import get_settings
from ...database import execute, fetchrow
from ...errors import bad_request, too_many_requests, unauthorized


def generate_otp_code() -> str:
    settings = get_settings()

    # secrets is drawn from the OS CSPRNG; random would be guessable.
    ceiling = 10**settings.otp_length

    return str(secrets.randbelow(ceiling)).zfill(settings.otp_length)


def hash_otp_code(phone: str, code: str) -> str:
    """The code is bound to the phone number, so a hash captured for one number
    is useless against another."""
    settings = get_settings()

    return hmac.new(
        settings.otp_pepper.encode("utf-8"),
        f"{phone}:{code}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _assert_within_send_limits(phone: str, purpose: str) -> None:
    """Caps how often one number can be targeted: a short cooldown between sends
    and a ceiling per hour. Keyed on the phone number rather than the IP, because
    that is what costs money and what an attacker is actually after."""
    settings = get_settings()

    row = await fetchrow(
        """
        select
          count(*) filter (where created_at > now() - interval '1 hour')::int as last_hour,
          max(created_at) as last_sent_at
        from otp_codes
        where phone = $1 and purpose = $2
        """,
        phone,
        purpose,
    )

    last_sent_at = row["last_sent_at"]

    if last_sent_at is not None:
        elapsed = (_now() - last_sent_at).total_seconds()
        remaining = int(-(-(settings.otp_resend_cooldown_seconds - elapsed) // 1))

        if remaining > 0:
            raise too_many_requests(
                "otp_cooldown",
                f"Wait {remaining}s before requesting another code",
                {"retryAfterSeconds": remaining},
            )

    if row["last_hour"] >= settings.otp_max_per_hour:
        raise too_many_requests("otp_limit_reached", "Too many codes requested. Try again in an hour")


async def create_otp(phone: str, purpose: str = "login") -> dict:
    settings = get_settings()

    await _assert_within_send_limits(phone, purpose)

    code = generate_otp_code()

    await execute(
        """
        insert into otp_codes (phone, purpose, code_hash, expires_at)
        values ($1, $2, $3, now() + make_interval(secs => $4))
        """,
        phone,
        purpose,
        hash_otp_code(phone, code),
        float(settings.otp_ttl_seconds),
    )

    return {"code": code, "expiresInSeconds": settings.otp_ttl_seconds}


async def consume_otp(phone: str, code: str, purpose: str = "login") -> None:
    """Consumes the newest unused code for the number. Returns nothing on success
    and raises otherwise, so a caller cannot mistake a failure for a pass."""
    settings = get_settings()

    if not str(code or "").isdigit():
        raise bad_request("otp_invalid", "Enter the code from the SMS")

    record = await fetchrow(
        """
        select id, code_hash, attempts, expires_at
        from otp_codes
        where phone = $1 and purpose = $2 and consumed_at is null
        order by created_at desc
        limit 1
        """,
        phone,
        purpose,
    )

    if record is None:
        raise unauthorized("otp_not_found", "Request a new code")

    if record["expires_at"] <= _now():
        raise unauthorized("otp_expired", "That code has expired. Request a new one")

    if record["attempts"] >= settings.otp_max_attempts:
        raise too_many_requests("otp_attempts_exceeded", "Too many wrong attempts. Request a new code")

    if not hmac.compare_digest(record["code_hash"], hash_otp_code(phone, code)):
        await execute("update otp_codes set attempts = attempts + 1 where id = $1", record["id"])

        remaining = settings.otp_max_attempts - record["attempts"] - 1

        raise unauthorized(
            "otp_incorrect",
            f"Incorrect code. {remaining} attempt(s) left" if remaining > 0 else "Incorrect code. Request a new one",
        )

    # Guarded update: if two requests race, only one marks the code consumed and
    # the loser is rejected rather than both being let through.
    consumed = await fetchrow(
        "update otp_codes set consumed_at = now() where id = $1 and consumed_at is null returning id",
        record["id"],
    )

    if consumed is None:
        raise unauthorized("otp_already_used", "That code was already used. Request a new one")
