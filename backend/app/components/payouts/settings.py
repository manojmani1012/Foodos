"""Payment settings, edited in the admin panel instead of environment variables.

They live in `platform_settings` under the key 'payments', as one JSON
document. Rider pay is worked out synchronously in many places (offers,
accepting, admin assignment), so the settings are also kept in memory: loaded
at startup, refreshed by the background loop, and replaced straight after an
admin saves. A missing or partial document falls back to the defaults the
client asked for, so a fresh database works without anyone visiting Settings.
"""

import copy
import datetime
import json
import re
import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from ...config import get_settings
from ...database import fetch, fetchrow, transaction
from ...errors import bad_request
from ..admin import audit

DEFAULTS: dict[str, Any] = {
    # Commission is on food + packaging. "22% + tax" is 20% commission plus a
    # 2% payment-gateway fee; "12%" is 10% plus the same 2%.
    "commissionStandardPct": 20,
    "commissionSubscriptionPct": 10,
    "paymentGatewayFeePct": 2,
    # Whether commission is worked out before or after the restaurant-funded
    # coupon comes off. Undecided with the client, so it is a setting.
    "commissionBase": "before_discount",
    # GST on Foodos's commission and TDS under 194-O: 0 until the client's CA
    # confirms the rates (likely 18% and 1%).
    "gstOnCommissionPct": 0,
    "restaurantTdsPct": 0,
    # TDS on rider pay (base + distance + incentives, never tips): compulsory,
    # rate pending the CA.
    "riderTdsPct": 0,
    "riderBasePaise": 2000,
    "riderBaseKm": 3,
    "riderPerKmPaise": 800,
    "riderOrderIncentivePaise": 1000,
    # When on, that incentive is paid after the day, only to a rider online
    # long enough in every shift who turned down no more offers than allowed.
    # Off until the client says whether it replaces the every-order incentive.
    "riderIncentiveNeedsShifts": False,
    "riderShifts": [
        {"name": "Lunch", "start": "11:00", "end": "15:00", "minMinutes": 225},
        {"name": "Dinner", "start": "18:00", "end": "23:00", "minMinutes": 270},
    ],
    "riderMaxRejections": 1,
    # 'trip': rider to restaurant plus restaurant to customer; 'drop': the
    # restaurant-to-customer leg only (what the client wants).
    "riderDistanceBasis": "drop",
    # ISO weekdays, 1 = Monday. Mon+Tue are paid Thursday, Wed+Thu next
    # Monday, Fri to Sun next Tuesday.
    "payoutSchedule": [
        {"days": [1, 2], "payWeekday": 4},
        {"days": [3, 4], "payWeekday": 1},
        {"days": [5, 6, 7], "payWeekday": 2},
    ],
    # The earnings day runs 05:30 to 05:29 the next morning.
    "cutoffTime": "05:30",
    # Whether customers can choose cash on delivery (off at launch).
    "codEnabled": True,
    # The most cash a rider may hold ("floating cash"). None: the server's
    # RIDER_CASH_LIMIT_PAISE. 0: no limit.
    "riderCashLimitPaise": None,
    # What a rider at the limit stops getting.
    "riderCashBlock": "cash_orders",
    "minPayoutPaise": 10000,
    # Money that always stays in the bank account when paying out.
    "reservePaise": 1_000_000,
    "refundChargedToDefault": "restaurant",
    # A partial refund taken off a restaurant's or rider's pay needs a photo.
    "refundPhotoRequired": True,
    # When staff pay on a payout day. Shown in the apps; nothing runs at it.
    "payoutTime": "10:00",
}

TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class ScheduleGroup(BaseModel):
    days: list[int] = Field(min_length=1, max_length=7)
    payWeekday: int = Field(ge=1, le=7)

    @field_validator("days")
    @classmethod
    def _weekdays(cls, value: list[int]) -> list[int]:
        if any(day < 1 or day > 7 for day in value):
            raise ValueError("Weekdays are 1 (Monday) to 7 (Sunday)")

        if len(set(value)) != len(value):
            raise ValueError("A weekday appears twice in one group")

        return value


def _consecutive(days: list[int]) -> bool:
    """True when the days are one unbroken run of the week, wrapping past
    Sunday if need be (Fri-Sat-Sun, or Sun-Mon)."""
    present = set(days)

    if len(present) == 7:
        return True

    starts = [day for day in present if ((day - 2) % 7) + 1 not in present]

    return len(starts) == 1


class RiderShift(BaseModel):
    name: str = Field(min_length=2, max_length=30)
    start: str
    end: str
    minMinutes: int = Field(ge=1, le=1440)

    @field_validator("start", "end")
    @classmethod
    def _time(cls, value: str) -> str:
        if not TIME_PATTERN.match(value.strip()):
            raise ValueError("Use a 24-hour time like 11:00")

        return value.strip()

    @model_validator(mode="after")
    def _fits(self) -> "RiderShift":
        def minutes(text: str) -> int:
            return int(text[:2]) * 60 + int(text[3:])

        length = (minutes(self.end) - minutes(self.start)) % 1440

        if length == 0 or self.minMinutes > length:
            raise ValueError("The minimum online time must fit inside the shift")

        return self


class PaymentSettings(BaseModel):
    """The whole settings document. PUT sends all of it."""

    commissionStandardPct: float = Field(ge=0, le=100)
    commissionSubscriptionPct: float = Field(ge=0, le=100)
    paymentGatewayFeePct: float = Field(default=2, ge=0, le=100)
    commissionBase: Literal["before_discount", "after_discount"] = "before_discount"
    gstOnCommissionPct: float = Field(ge=0, le=100)
    restaurantTdsPct: float = Field(ge=0, le=100)
    riderTdsPct: float = Field(default=0, ge=0, le=100)
    riderBasePaise: int = Field(ge=0, le=100_000)
    riderBaseKm: float = Field(ge=0, le=50)
    riderPerKmPaise: int = Field(ge=0, le=10_000)
    riderOrderIncentivePaise: int = Field(ge=0, le=100_000)
    riderIncentiveNeedsShifts: bool = False
    riderShifts: list[RiderShift] = Field(
        default_factory=lambda: [RiderShift(**shift) for shift in DEFAULTS["riderShifts"]], min_length=1, max_length=4
    )
    riderMaxRejections: int = Field(default=1, ge=0, le=100)
    riderDistanceBasis: Literal["trip", "drop"]
    payoutSchedule: list[ScheduleGroup] = Field(min_length=1, max_length=7)
    cutoffTime: str
    codEnabled: bool = True
    riderCashLimitPaise: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    riderCashBlock: Literal["cash_orders", "all_orders"] = "cash_orders"
    minPayoutPaise: int = Field(ge=0, le=10_000_000)
    reservePaise: int = Field(default=1_000_000, ge=0, le=1_000_000_000)
    refundChargedToDefault: Literal["restaurant", "rider", "foodos"]
    refundPhotoRequired: bool = True
    payoutTime: str

    @field_validator("cutoffTime", "payoutTime")
    @classmethod
    def _time(cls, value: str) -> str:
        value = value.strip()

        if not TIME_PATTERN.match(value):
            raise ValueError("Use a 24-hour time like 04:00")

        return value

    @model_validator(mode="after")
    def _schedule_covers_the_week(self) -> "PaymentSettings":
        seen = [day for group in self.payoutSchedule for day in group.days]

        if sorted(seen) != [1, 2, 3, 4, 5, 6, 7]:
            raise ValueError("The payout schedule must cover each weekday exactly once")

        for group in self.payoutSchedule:
            if not _consecutive(group.days):
                raise ValueError("Each payout group must be consecutive days, like Mon-Tue or Fri-Sun")

        return self


def _merge(stored: Optional[dict]) -> dict:
    merged = copy.deepcopy(DEFAULTS)

    for key, value in (stored or {}).items():
        if key in merged:
            merged[key] = value

    try:
        return PaymentSettings(**merged).model_dump()
    except Exception:  # noqa: BLE001 - a bad stored document must not stop pay
        return copy.deepcopy(DEFAULTS)


# The cache. Starts at the defaults, so code running before the first load
# (and the tests, which load explicitly) still works.
_current: dict = _merge(None)
_started_on: Optional[datetime.date] = None


def current() -> dict:
    return _current


def started_on() -> datetime.date:
    """The day automatic payouts began. Before the first load: a day far
    enough back that nothing is wrongly held out."""
    return _started_on or datetime.date(2000, 1, 1)


def cutoff() -> datetime.timedelta:
    hours, minutes = (int(part) for part in _current["cutoffTime"].split(":"))

    return datetime.timedelta(hours=hours, minutes=minutes)


def percent_of(amount: int, pct: float) -> int:
    """Money arithmetic rounds half up, to whole paise."""
    return int((Decimal(amount) * Decimal(str(pct)) / 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def restaurant_share(
    food: int,
    packaging: int,
    commission_pct: float,
    discount_paise: int = 0,
    funded_by: str = "restaurant",
    payment_method: str = "upi",
) -> dict:
    """What a delivered order earns the restaurant, by the current settings.
    The one place the formula lives: the ledger, the partner app, the admin
    order page, the dashboard and the reports all call it.

    commission and the gateway fee are on food + packaging (less the
    restaurant-funded coupon under 'after_discount'); cash orders pay no
    gateway fee; GST is on both fees. A bank offer is never charged to the
    restaurant, only reported.
    """
    settings = _current
    gross = food + packaging
    restaurant_discount = discount_paise if funded_by == "restaurant" else 0
    bank_offer = discount_paise if funded_by == "bank" else 0

    base = gross
    if settings["commissionBase"] == "after_discount":
        base = max(0, gross - restaurant_discount)

    commission = percent_of(base, commission_pct)
    gateway = percent_of(base, settings["paymentGatewayFeePct"]) if payment_method != "cod" else 0
    gst = percent_of(commission + gateway, settings["gstOnCommissionPct"])
    tds = percent_of(gross, settings["restaurantTdsPct"])

    return {
        "commissionBasePaise": base,
        "commissionPaise": commission,
        "gatewayFeePaise": gateway,
        "gstOnCommissionPaise": gst,
        "tdsPaise": tds,
        "discountPaise": restaurant_discount,
        "bankOfferPaise": bank_offer,
        "amountPaise": gross - restaurant_discount - commission - gateway - gst - tds,
    }


def rider_tds(base_pay: int, incentive: int) -> int:
    """TDS on rider pay. Tips are the customer's gift and are left out."""
    return percent_of(base_pay + incentive, _current["riderTdsPct"])


def plan_pct(plan: str) -> Optional[float]:
    """The commission a plan charges, or None for a custom rate."""
    if plan == "standard":
        return float(_current["commissionStandardPct"])

    if plan == "subscription":
        return float(_current["commissionSubscriptionPct"])

    return None


def rider_pay_parts(total_km: Optional[float], drop_km: Optional[float]) -> tuple[int, int]:
    """(base, distance pay) for a trip, by the current settings.

    Distance pay is in whole rupees: round(extra km x rate / 100) x 100.
    """
    settings = _current
    distance = (total_km if settings["riderDistanceBasis"] == "trip" else drop_km) or 0
    extra_km = max(0.0, float(distance) - float(settings["riderBaseKm"]))
    rupees = (Decimal(str(extra_km)) * Decimal(settings["riderPerKmPaise"]) / 100).quantize(
        Decimal(1), rounding=ROUND_HALF_UP
    )

    return int(settings["riderBasePaise"]), int(rupees) * 100


def pay_rule() -> dict:
    settings = _current

    return {
        "basePaise": settings["riderBasePaise"],
        "baseKm": settings["riderBaseKm"],
        "perKmPaise": settings["riderPerKmPaise"],
        "orderIncentivePaise": settings["riderOrderIncentivePaise"],
        "incentiveNeedsShifts": settings["riderIncentiveNeedsShifts"],
        "distanceBasis": settings["riderDistanceBasis"],
    }


async def load() -> dict:
    """Reads the settings into the cache. Called at startup, by the background
    loop, and after every change."""
    global _current, _started_on

    rows = await fetch("select key, value from platform_settings where key in ('payments', 'payouts_started_on')")
    values = {row["key"]: (json.loads(row["value"]) if isinstance(row["value"], str) else row["value"]) for row in rows}

    _current = _merge(values.get("payments"))

    started = values.get("payouts_started_on")
    _started_on = datetime.date.fromisoformat(started) if started else None

    return _current


async def holidays() -> list[dict]:
    rows = await fetch("select day, name from payout_holidays order by day")

    return [{"day": row["day"].isoformat(), "name": row["name"]} for row in rows]


async def holiday_days() -> set[datetime.date]:
    return {row["day"] for row in await fetch("select day from payout_holidays")}


async def get_all() -> dict:
    return {
        "settings": await load(),
        "holidays": await holidays(),
        # What applies while riderCashLimitPaise is left empty.
        "serverCashLimitPaise": get_settings().rider_cash_limit_paise,
    }


async def save(body: PaymentSettings, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    new = body.model_dump()
    old = await load()

    async with transaction() as connection:
        await connection.execute(
            """
            insert into platform_settings (key, value, updated_by, updated_at)
            values ('payments', $1::jsonb, $2, now())
            on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by,
                                            updated_at = now()
            """,
            json.dumps(new),
            actor_id,
        )

        # Restaurants on a plan follow its rate; custom deals stay as they are.
        for plan, key in (("standard", "commissionStandardPct"), ("subscription", "commissionSubscriptionPct")):
            await connection.execute(
                "update restaurants set commission_pct = $2 where commission_plan = $1 and commission_pct <> $2",
                plan,
                new[key],
            )

        changed = {key: {"from": old.get(key), "to": value} for key, value in new.items() if old.get(key) != value}

        await audit.record(
            actor_id, "Changed payment settings", "Settings", "settings", "payments", {"changes": changed}, ip, connection
        )

    return {"settings": await load()}


async def add_holiday(day: datetime.date, name: str, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    name = name.strip()

    if not name:
        raise bad_request("holiday_name_required", "Give the holiday a name")

    async with transaction() as connection:
        await connection.execute(
            """
            insert into payout_holidays (day, name) values ($1, $2)
            on conflict (day) do update set name = excluded.name
            """,
            day,
            name,
        )
        await audit.record(
            actor_id, "Added payout holiday", "Settings", "holiday", day.isoformat(), {"name": name}, ip, connection
        )

    return {"holidays": await holidays()}


async def remove_holiday(day: datetime.date, actor_id: uuid.UUID, ip: Optional[str]) -> dict:
    async with transaction() as connection:
        removed = await connection.fetchrow("delete from payout_holidays where day = $1 returning name", day)

        if removed is not None:
            await audit.record(
                actor_id,
                "Removed payout holiday",
                "Settings",
                "holiday",
                day.isoformat(),
                {"name": removed["name"]},
                ip,
                connection,
            )

    return {"holidays": await holidays()}


async def business_today() -> datetime.date:
    row = await fetchrow("select business_date(now(), $1::interval) as day", cutoff())

    return row["day"]
