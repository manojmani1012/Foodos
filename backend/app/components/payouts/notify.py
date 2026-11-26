"""Push notifications about payouts, to the restaurant owner's or the rider's
phone. Like the order notifications, these are sent after the change has
committed and never raise: a phone that cannot be reached must not undo a
payout being marked paid.
"""

import datetime
import logging
import uuid
from typing import Any, Optional

from ...database import execute, fetchrow
from ..notifications import push

logger = logging.getLogger("foodos.push")


def rupees(paise: int) -> str:
    value = paise / 100
    return f"₹{value:,.0f}" if value == int(value) else f"₹{value:,.2f}"


def short_date(day: datetime.date) -> str:
    """"Thu 21 Nov"."""
    return f"{day.strftime('%a')} {day.day} {day.strftime('%b')}"


async def _payout(payout_id: uuid.UUID) -> Optional[Any]:
    return await fetchrow(
        """
        select p.id, p.party_type, p.net_paise, p.scheduled_for, p.payout_reference, p.hold_reason,
               coalesce(r.owner_id, p.partner_id) as user_id
        from payouts p
        left join restaurants r on r.id = p.restaurant_id
        where p.id = $1
        """,
        payout_id,
    )


async def _send(payout_id: uuid.UUID, title: str, body_for) -> bool:
    try:
        payout = await _payout(payout_id)

        if payout is None:
            return False

        app = "restaurant" if payout["party_type"] == "restaurant" else "delivery"
        await push.notify(
            [payout["user_id"]],
            app,
            title,
            body_for(payout),
            {"type": "payout", "payoutId": str(payout_id)},
        )

        return True
    except Exception:  # noqa: BLE001 - see the module docstring
        logger.exception("[push] payout notification for %s failed", payout_id)

        return False


async def scheduled(payout_id: uuid.UUID) -> None:
    """Once per payout: when it is first scheduled."""
    sent = await _send(
        payout_id,
        "Payout scheduled",
        lambda p: f"Payout of {rupees(p['net_paise'])} on {short_date(p['scheduled_for'])}",
    )

    if sent:
        await execute("update payouts set notified_scheduled_at = now() where id = $1", payout_id)


async def reminder(payout_id: uuid.UUID) -> None:
    """Once per payout: the day before it is due."""
    sent = await _send(
        payout_id,
        "Payout tomorrow",
        lambda p: f"Your payout of {rupees(p['net_paise'])} is due tomorrow, {short_date(p['scheduled_for'])}",
    )

    if sent:
        await execute("update payouts set reminded_at = now() where id = $1", payout_id)


async def paid(payout_id: uuid.UUID) -> None:
    await _send(
        payout_id,
        "Payout sent",
        lambda p: f"{rupees(p['net_paise'])} sent. Ref {p['payout_reference']}",
    )


async def failed(payout_id: uuid.UUID) -> None:
    await _send(
        payout_id,
        "Payout not sent",
        lambda p: f"Your payout of {rupees(p['net_paise'])} could not be sent. Foodos will retry",
    )


async def rescheduled(payout_id: uuid.UUID) -> None:
    await _send(
        payout_id,
        "Payout date changed",
        lambda p: f"Your payout of {rupees(p['net_paise'])} is now due on {short_date(p['scheduled_for'])}",
    )


async def held(payout_id: uuid.UUID) -> None:
    await _send(
        payout_id,
        "Payout on hold",
        lambda p: f"Your payout of {rupees(p['net_paise'])} is on hold: {p['hold_reason']}",
    )
