"""The background loop.

Every few seconds: cancel orders no restaurant accepted, drop unpaid ones, and
move each open delivery to its next rider. Each pass picks up exactly where the
database is, so a restart or a missed pass loses nothing.

It runs inside the API process. Every step locks the rows it changes and skips
rows that are already locked, so two servers running it at once are safe.
"""

import asyncio
import logging

from .components.delivery import dispatch
from .components.orders import timeouts
from .config import get_settings

logger = logging.getLogger("foodos.jobs")


async def run_once() -> None:
    await timeouts.cancel_unaccepted()
    await timeouts.expire_unpaid()
    await dispatch.dispatch_all()


async def run_forever() -> None:
    interval = get_settings().background_interval_seconds

    while True:
        try:
            await run_once()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - a failed pass is retried next time
            logger.exception("[jobs] background pass failed")

        await asyncio.sleep(interval)
