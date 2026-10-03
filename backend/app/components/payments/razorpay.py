"""Razorpay API client and signature checks.

The key secret never leaves the server. The app only ever receives the key id,
which is public by design — anyone can read it out of an installed app, which is
exactly why it alone cannot authorise anything.
"""

import base64
import hashlib
import hmac
from typing import Any, Optional

import httpx

from ...config import get_settings
from ...errors import AppError

API_BASE = "https://api.razorpay.com/v1"
TIMEOUT_SECONDS = 20


class RazorpayNotConfigured(AppError):
    def __init__(self) -> None:
        super().__init__(
            503,
            "payments_unavailable",
            "Online payment is not available right now. Please choose cash on delivery",
        )


def is_configured() -> bool:
    settings = get_settings()

    return bool(settings.razorpay_key_id and settings.razorpay_key_secret)


def _auth_header() -> dict[str, str]:
    settings = get_settings()
    token = base64.b64encode(
        f"{settings.razorpay_key_id}:{settings.razorpay_key_secret}".encode()
    ).decode()

    return {"Authorization": f"Basic {token}"}


async def create_order(amount_paise: int, receipt: str, notes: Optional[dict] = None) -> dict:
    """Creates the Razorpay order the checkout will be opened against.

    Razorpay works in paise, which is what the database stores, so no conversion
    happens anywhere in this path.
    """
    if not is_configured():
        raise RazorpayNotConfigured()

    payload: dict[str, Any] = {
        "amount": amount_paise,
        "currency": "INR",
        "receipt": receipt,
        # Razorpay captures automatically rather than leaving funds authorised
        # and needing a second call.
        "payment_capture": 1,
    }

    if notes:
        payload["notes"] = notes

    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
        response = await client.post(f"{API_BASE}/orders", json=payload, headers=_auth_header())

    if response.status_code >= 400:
        detail = ""

        try:
            detail = response.json().get("error", {}).get("description", "")
        except Exception:  # noqa: BLE001 - the body may not be JSON
            detail = response.text[:200]

        raise AppError(
            502,
            "payment_gateway_error",
            f"The payment provider refused this order. {detail}".strip(),
        )

    return response.json()


def verify_payment_signature(razorpay_order_id: str, razorpay_payment_id: str, signature: str) -> bool:
    """Confirms the payment really came from Razorpay.

    The app reports its own success, which cannot be trusted on its own: anyone
    can call the verify endpoint claiming a payment went through. Razorpay signs
    `order_id|payment_id` with the key secret, and only the server holds that
    secret, so a forged claim fails here.
    """
    settings = get_settings()

    if not settings.razorpay_key_secret:
        return False

    expected = hmac.new(
        settings.razorpay_key_secret.encode(),
        f"{razorpay_order_id}|{razorpay_payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, signature or "")


def verify_webhook_signature(body: bytes, signature: str) -> bool:
    """Webhooks are signed with their own secret, set in the Razorpay dashboard.

    Without this check anyone could post a 'payment captured' event and mark
    orders paid.
    """
    settings = get_settings()

    if not settings.razorpay_webhook_secret:
        return False

    expected = hmac.new(
        settings.razorpay_webhook_secret.encode(), body, hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(expected, signature or "")
