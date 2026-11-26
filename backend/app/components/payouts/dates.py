"""Business days, schedule periods and pay dates. Pure functions, so the
schedule rules can be tested without a database.

The schedule is a list of groups of consecutive weekdays, each paid on a
weekday after it ends: by default Mon+Tue are paid Thursday, Wed+Thu the next
Monday, Fri to Sun the next Tuesday. A pay date that is a holiday or a Sunday
moves to the next day that is neither.
"""

import datetime
from typing import Iterable

INDIA = datetime.timezone(datetime.timedelta(hours=5, minutes=30))


def business_date(moment: datetime.datetime, cutoff: datetime.timedelta) -> datetime.date:
    """The business day of a moment: day D runs from D at the cutoff to D+1
    at the cutoff, India time. Same rule as the SQL business_date()."""
    return (moment.astimezone(INDIA) - cutoff).date()


def _group_for(weekday: int, schedule: list[dict]) -> dict:
    for group in schedule:
        if weekday in group["days"]:
            return group

    raise ValueError(f"weekday {weekday} is not in the payout schedule")


def _first_day(days: Iterable[int]) -> int:
    """The weekday a group starts on: the one whose previous day is not in it."""
    present = set(days)

    if len(present) == 7:
        return 1

    return next(day for day in sorted(present) if ((day - 2) % 7) + 1 not in present)


def period_of(day: datetime.date, schedule: list[dict]) -> tuple[datetime.date, datetime.date, int]:
    """(first day, last day, pay weekday) of the schedule period holding `day`."""
    weekday = day.isoweekday()
    group = _group_for(weekday, schedule)
    offset = (weekday - _first_day(group["days"])) % 7
    start = day - datetime.timedelta(days=offset)
    end = start + datetime.timedelta(days=len(group["days"]) - 1)

    return start, end, group["payWeekday"]


def shift_for_holidays(day: datetime.date, holidays: set[datetime.date]) -> datetime.date:
    while day.isoweekday() == 7 or day in holidays:
        day += datetime.timedelta(days=1)

    return day


def pay_date(period_end: datetime.date, pay_weekday: int, holidays: set[datetime.date]) -> datetime.date:
    """The first day after the period that falls on the pay weekday, moved
    past Sundays and holidays."""
    ahead = (pay_weekday - period_end.isoweekday()) % 7 or 7

    return shift_for_holidays(period_end + datetime.timedelta(days=ahead), holidays)


def periods_between(
    first: datetime.date, last: datetime.date, schedule: list[dict]
) -> list[tuple[datetime.date, datetime.date, int]]:
    """Every whole schedule period that ends between `first` and `last`,
    oldest first."""
    found = []
    day = first

    while day <= last:
        start, end, weekday = period_of(day, schedule)

        if first <= end <= last and (start, end, weekday) not in found:
            found.append((start, end, weekday))

        day = end + datetime.timedelta(days=1)

    return found
