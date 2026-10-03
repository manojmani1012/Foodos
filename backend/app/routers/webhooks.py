"""Payment provider callbacks.

Open to the internet by necessity, so nothing here trusts the caller: every
request is rejected unless it carries a signature made with the webhook secret.
"""

from fastapi import APIRouter, Header, Request

from ..components.payments import service as payment_service

router = APIRouter(prefix="/api/v1/webhooks", tags=["webhooks"])


@router.post("/razorpay")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str = Header(default=""),
):
    """Razorpay's own account of what happened, and the authoritative one.

    The signature is computed over the exact bytes received, so the raw body is
    read rather than the parsed JSON — re-serialising would change the bytes and
    every signature would fail.
    """
    body = await request.body()

    result = await payment_service.handle_webhook(body, x_razorpay_signature)

    # Always 200 once the signature checks out. A non-2xx makes Razorpay retry,
    # and an event we deliberately ignore is not a failure worth retrying.
    return {"ok": True, **result}
