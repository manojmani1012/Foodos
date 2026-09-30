"""SMS delivery.

One place to swap in a real gateway. MSG91 also needs DLT-registered templates
before it will deliver in India, so development stays on the console provider.
"""

import logging

from ...config import get_settings

logger = logging.getLogger("foodos.sms")


async def _console_provider(to: str, message: str) -> dict:
    logger.info("[sms] to %s: %s", to, message)
    print(f"[sms] to {to}: {message}", flush=True)
    return {"delivered": True, "provider": "console"}


async def _msg91_provider(to: str, message: str) -> dict:
    raise RuntimeError("MSG91 is not configured yet; set SMS_PROVIDER=console for development")


PROVIDERS = {
    "console": _console_provider,
    "msg91": _msg91_provider,
}


async def send_sms(to: str, message: str) -> dict:
    settings = get_settings()
    provider = PROVIDERS.get(settings.sms_provider)

    if provider is None:
        raise RuntimeError(f'Unknown SMS_PROVIDER "{settings.sms_provider}"')

    return await provider(to, message)


def otp_message(code: str) -> str:
    return (
        f"{code} is your Foodos verification code. It expires in 5 minutes. "
        "Do not share it with anyone."
    )
