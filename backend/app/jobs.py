"""The background loop.

Every few seconds: cancel orders no restaurant accepted, drop unpaid ones, and
move each open delivery to its next rider. Every minute: reread the payment
settings and fill in the earnings ledger. Every few minutes: make the payout
batches that are due and send payout reminders. Each pass picks up exactly
where the database is, so a restart or a missed pass loses nothing.

It runs inside the API process. Every step locks the rows it changes and skips
rows that are already locked, so two servers running it at once are safe.
"""

import asyncio
import logging
import time

from .components.delivery import dispatch, shifts
from .components.orders import timeouts
from .components.payouts import ledger, schedule
from .components.payouts import settings as payment_settings
from .config import get_settings

logger = logging.getLogger("foodos.jobs")


LEDGER_EVERY_SECONDS = 60
PAYOUTS_EVERY_SECONDS = 5 * 60

# When each slower step last ran, by the monotonic clock.
_last_run = {"ledger": 0.0, "payouts": 0.0}


def _due(step: str, every: float) -> bool:
    now = time.monotonic()

    if now - _last_run[step] < every:
        return False

    _last_run[step] = now

    return True


async def payouts_pass() -> None:
    """The slower, money side of the loop. Its own try, so a payout problem
    never holds up offers and timeouts."""
    try:
        if _due("ledger", LEDGER_EVERY_SECONDS):
            # Picks up a settings change made on another server.
            await payment_settings.load()
            await ledger.sweep()
            await shifts.settle()

        if _due("payouts", PAYOUTS_EVERY_SECONDS):
            await schedule.run()
            await schedule.send_reminders()
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001 - retried on the next pass
        logger.exception("[jobs] payouts pass failed")


async def run_once() -> None:
    await timeouts.cancel_unaccepted()
    await timeouts.expire_unpaid()
    await dispatch.dispatch_all()
    await payouts_pass()


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
