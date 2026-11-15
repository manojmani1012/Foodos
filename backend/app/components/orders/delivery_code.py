"""The 4-digit code a customer gives the rider at the door.

The rider cannot mark an order delivered without it, so an order is only
finished when the food is really in the customer's hands, and a slip of the
thumb on the rider's phone cannot end someone else's order.
"""

import secrets

from ...config import get_settings

# Wrong guesses allowed before the rider has to wait, and how long.
MAX_ATTEMPTS = 5
LOCK_SECONDS = 120


def new_code() -> str:
    return f"{secrets.randbelow(10000):04d}"


def code_required(payment_method: str) -> bool:
    """Whether this order needs the code, under the current setting."""
    rule = get_settings().delivery_code_required

    return rule == "all" or (rule == "prepaid" and payment_method != "cod")
