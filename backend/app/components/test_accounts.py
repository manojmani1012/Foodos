"""Test accounts (migration 0016), for the client's staff to run a whole order
from home or the office.

A test customer sees, and can order from, every restaurant whatever the
distance. Their orders are test orders: those go only to test riders, at any
distance, without the "be at the pin" checks, and stay out of payouts.
"""

import uuid
from typing import Optional

from ..database import fetchval


async def is_test_account(user_id: Optional[uuid.UUID]) -> bool:
    if user_id is None:
        return False

    return bool(await fetchval("select is_test from users where id = $1", user_id))
