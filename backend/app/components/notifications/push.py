"""Push notifications, sent through Expo's push service.

Each app install registers an Expo push token. Expo hands every message to
Google (Android) or Apple (iPhone), whichever the phone uses, so the server
deals with one kind of token and one endpoint for both.

Sending never holds up the request that caused it, and never fails it: an
order is accepted whether or not the customer's phone can be reached. Tokens
Expo reports as dead (the app was uninstalled) are deleted so they are not
tried again.
"""

import asyncio
import logging
import re
import uuid
from typing import Any, Optional

import httpx

from ...config import get_settings
from ...database import execute, fetch

logger = logging.getLogger("foodos.push")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
# Expo accepts at most 100 messages per request.
BATCH_SIZE = 100

# The session's role says which app a token belongs to.
APP_FOR_ROLE = {"customer": "customer", "restaurant_owner": "restaurant", "delivery_partner": "delivery"}

TOKEN_PATTERN = re.compile(r"^Expo(nent)?PushToken\[[A-Za-z0-9_\-]+\]$")

# Android notification channels the apps create. "orders" rings loudly and
# shows over other apps: a new order or delivery is something to act on now.
CHANNEL_ORDERS = "orders"
CHANNEL_UPDATES = "updates"

# Background sends in flight. Holding a reference stops a task being
# garbage-collected half way through.
_in_flight: set[asyncio.Task] = set()


def is_valid_token(token: str) -> bool:
    return bool(TOKEN_PATTERN.match(token or ""))


async def register(user_id: uuid.UUID, role: str, token: str, platform: Optional[str]) -> None:
    app = APP_FOR_ROLE[role]

    await execute(
        """
        insert into push_tokens (user_id, app, token, platform)
        values ($1, $2, $3, $4)
        on conflict (token) do update
          set user_id = excluded.user_id,
              app = excluded.app,
              platform = excluded.platform,
              last_seen_at = now()
        """,
        user_id,
        app,
        token,
        platform,
    )


async def unregister(user_id: uuid.UUID, token: str) -> None:
    await execute("delete from push_tokens where token = $1 and user_id = $2", token, user_id)


async def _post(messages: list[dict]) -> list[dict]:
    """One request to Expo. Returns a ticket per message, in order."""
    settings = get_settings()
    headers = {"accept": "application/json", "content-type": "application/json"}

    if settings.expo_access_token:
        headers["authorization"] = f"Bearer {settings.expo_access_token}"

    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(EXPO_PUSH_URL, json=messages, headers=headers)
        response.raise_for_status()

        return response.json().get("data") or []


async def _deliver(messages: list[dict]) -> None:
    for start in range(0, len(messages), BATCH_SIZE):
        batch = messages[start : start + BATCH_SIZE]

        try:
            tickets = await _post(batch)
        except Exception as error:  # noqa: BLE001 - a push problem must never surface
            logger.warning("[push] sending %d message(s) failed: %s", len(batch), error)
            continue

        dead = [
            message["to"]
            for message, ticket in zip(batch, tickets)
            if ticket.get("status") == "error"
            and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered"
        ]

        if dead:
            await execute("delete from push_tokens where token = any($1::text[])", dead)


async def notify(
    user_ids: list[Any],
    app: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
    urgent: bool = False,
) -> int:
    """Sends one notification to every phone the given people have the app on.

    Returns how many phones it went to. `urgent` uses the loud "orders"
    channel and high priority, for things someone has to act on.
    """
    settings = get_settings()
    people = [uuid.UUID(str(user_id)) for user_id in user_ids if user_id]

    if not settings.push_enabled or not people:
        return 0

    rows = await fetch(
        "select token from push_tokens where user_id = any($1::uuid[]) and app = $2", people, app
    )

    if not rows:
        return 0

    messages = [
        {
            "to": row["token"],
            "title": title,
            "body": body,
            "data": data or {},
            "sound": "default",
            "priority": "high" if urgent else "default",
            "channelId": CHANNEL_ORDERS if urgent else CHANNEL_UPDATES,
        }
        for row in rows
    ]

    if settings.is_test:
        # Tests check what was sent, so it is sent before the request returns.
        await _deliver(messages)
    else:
        task = asyncio.create_task(_deliver(messages))
        _in_flight.add(task)
        task.add_done_callback(_in_flight.discard)

    return len(messages)
