"""TDS deducted from riders: the rider's own financial-year summary and the
admin's rider-wise report.

Both read the ledger's delivery rows, which record the TDS taken at the time,
so a later change of rate never rewrites what was already deducted. "Earnings"
here is pay excluding tips, the amount TDS is charged on.
"""

import datetime
import uuid
from typing import Optional

from ...database import fetch
from . import settings as payment_settings

# pay excluding tips = amount + TDS - tip
EARNINGS_SQL = "(e.amount_paise + coalesce((e.breakdown->>'tdsPaise')::bigint, 0) - coalesce((e.breakdown->>'tipPaise')::bigint, 0))"
TDS_SQL = "coalesce((e.breakdown->>'tdsPaise')::bigint, 0)"


def financial_year_of(day: datetime.date) -> int:
    """The year a financial year starts: 1 Apr to 31 Mar."""
    return day.year if day.month >= 4 else day.year - 1


async def rider_year(partner_id: uuid.UUID, fy: Optional[int]) -> dict:
    if fy is None:
        fy = financial_year_of(await payment_settings.business_today())

    start, end = datetime.date(fy, 4, 1), datetime.date(fy + 1, 3, 31)
    rows = await fetch(
        f"""
        select to_char(e.business_date, 'YYYY-MM') as month,
               coalesce(sum({EARNINGS_SQL}), 0)::bigint as earnings, coalesce(sum({TDS_SQL}), 0)::bigint as tds
        from earnings_entries e
        where e.partner_id = $1 and e.kind in ('delivery', 'incentive') and e.business_date between $2 and $3
        group by 1
        """,
        partner_id,
        start,
        end,
    )
    by_month = {row["month"]: row for row in rows}
    months = []

    for index in range(12):
        year, month = (fy, 4 + index) if index < 9 else (fy + 1, index - 8)
        key = f"{year}-{month:02d}"
        row = by_month.get(key)
        months.append(
            {"month": key, "earningsPaise": int(row["earnings"]) if row else 0, "tdsPaise": int(row["tds"]) if row else 0}
        )

    return {
        "financialYear": f"{fy}-{str(fy + 1)[2:]}",
        "earningsPaise": sum(m["earningsPaise"] for m in months),
        "tdsPaise": sum(m["tdsPaise"] for m in months),
        "months": months,
    }


async def report_rows(start: datetime.date, end: datetime.date, partner_id: Optional[uuid.UUID] = None) -> list:
    """Rider-wise: deliveries, earnings excluding tips, TDS deducted."""
    return await fetch(
        f"""
        select u.full_name, u.phone, (count(*) filter (where e.kind = 'delivery'))::int as deliveries,
               coalesce(sum({EARNINGS_SQL}), 0)::bigint as earnings, coalesce(sum({TDS_SQL}), 0)::bigint as tds
        from earnings_entries e
        join users u on u.id = e.partner_id
        where e.kind in ('delivery', 'incentive') and e.business_date between $1 and $2
          and ($3::uuid is null or e.partner_id = $3)
        group by u.id
        order by u.full_name
        """,
        start,
        end,
        partner_id,
    )
