"""Phone number normalisation.

The login screens collect a bare 10-digit number next to a "+91" selector, so
accept that shape and store the full E.164 number the database expects.
"""

import re

from ...config import get_settings
from ...errors import bad_request

E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")
_STRIP = re.compile(r"[\s()\-]")


def normalize_phone(value: str | None) -> str:
    settings = get_settings()
    trimmed = _STRIP.sub("", str(value or ""))

    if not trimmed:
        raise bad_request("phone_required", "Enter a mobile number")

    phone = trimmed

    if not phone.startswith("+"):
        phone = f"{settings.default_country_code}{phone.lstrip('0')}"

    if not E164.match(phone):
        raise bad_request("phone_invalid", "Enter a valid mobile number")

    return phone


def mask_phone(phone: str) -> str:
    return phone if len(phone) < 4 else f"{'*' * (len(phone) - 4)}{phone[-4:]}"
