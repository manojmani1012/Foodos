"""The admin home screen: today's numbers, what is live, and what needs a person.

"Today" is the India calendar day (the connection time zone), matching the
restaurant and rider apps, so the figures agree with what partners see.
"""

from ...database import fetch, fetchrow

# How long an order can sit before someone at Foodos should look at it.
RESTAURANT_WAIT_MINUTES = 10
RIDER_WAIT_MINUTES = 10

LIVE_STATUSES = ("pending", "confirmed", "preparing", "ready", "picked_up", "on_the_way")


def _stuck_order(row) -> dict:
    return {
        "id": str(row["id"]),
        "orderNumber": row["order_number"],
        "status": row["status"],
        "restaurant": row["restaurant_name"],
        "since": row["since"].isoformat(),
        "minutes": int(row["minutes"]),
    }


async def overview() -> dict:
    today = await fetchrow(
        """
        select
          count(*)::int as placed,
          count(*) filter (where o.status = 'delivered')::int as delivered,
          count(*) filter (where o.status = 'cancelled')::int as cancelled,
          coalesce(sum(o.total_paise) filter (where o.status = 'delivered'), 0)::bigint as delivered_paise,
          coalesce(sum(round(o.subtotal_paise * r.commission_pct / 100)) filter (where o.status = 'delivered'), 0)::bigint
            as commission_paise
        from orders o
        join restaurants r on r.id = o.restaurant_id
        where o.placed_at >= date_trunc('day', now())
        """
    )

    live = await fetchrow(
        """
        select
          count(*) filter (where status = 'pending')::int as awaiting_payment,
          count(*) filter (where status = 'confirmed')::int as awaiting_restaurant,
          count(*) filter (where status = 'preparing')::int as preparing,
          count(*) filter (where status = 'ready')::int as ready,
          count(*) filter (where status in ('picked_up', 'on_the_way'))::int as on_the_way
        from orders
        where status = any($1::text[])
        """,
        list(LIVE_STATUSES),
    )

    riders = await fetchrow(
        """
        select
          count(*) filter (where status = 'active')::int as active,
          count(*) filter (where status = 'active' and is_online)::int as online,
          count(*) filter (where status = 'pending')::int as pending,
          (select count(distinct partner_id)::int from deliveries
            where status in ('accepted', 'reached_restaurant', 'picked_up', 'arrived')) as busy
        from delivery_partners
        """
    )

    restaurants = await fetchrow(
        """
        select
          count(*) filter (where status = 'active')::int as live,
          count(*) filter (where status = 'active' and is_accepting_orders)::int as accepting,
          count(*) filter (where status = 'pending')::int as pending
        from restaurants
        """
    )

    customers = await fetchrow(
        """
        select count(*)::int as total,
               count(*) filter (where u.created_at >= date_trunc('day', now()))::int as new_today
        from user_roles ur
        join users u on u.id = ur.user_id
        where ur.role = 'customer'
        """
    )

    # Orders a restaurant has not accepted after a while: the customer is
    # waiting on a kitchen that may not have seen it.
    waiting_for_restaurant = await fetch(
        """
        select o.id, o.order_number, o.status, r.name as restaurant_name, o.placed_at as since,
               extract(epoch from now() - o.placed_at) / 60 as minutes
        from orders o
        join restaurants r on r.id = o.restaurant_id
        where o.status = 'confirmed' and o.placed_at < now() - make_interval(mins => $1)
        order by o.placed_at
        limit 20
        """,
        RESTAURANT_WAIT_MINUTES,
    )

    # Accepted orders no rider has taken: nobody online nearby, or every
    # rider skipped it.
    waiting_for_rider = await fetch(
        """
        select o.id, o.order_number, o.status, r.name as restaurant_name, d.created_at as since,
               extract(epoch from now() - d.created_at) / 60 as minutes
        from deliveries d
        join orders o on o.id = d.order_id
        join restaurants r on r.id = o.restaurant_id
        where d.status = 'searching'
          and o.status in ('preparing', 'ready')
          and d.created_at < now() - make_interval(mins => $1)
        order by d.created_at
        limit 20
        """,
        RIDER_WAIT_MINUTES,
    )

    # A customer is owed money and the gateway refused: the latest refund on
    # a cancelled, still-captured payment failed.
    failed_refunds = await fetch(
        """
        select o.id, o.order_number, o.status, r.name as restaurant_name, f.created_at as since,
               extract(epoch from now() - f.created_at) / 60 as minutes, f.amount_paise
        from orders o
        join restaurants r on r.id = o.restaurant_id
        join lateral (
          select status, amount_paise, created_at from refunds
          where refunds.order_id = o.id
          order by created_at desc
          limit 1
        ) f on true
        where f.status = 'failed' and o.status = 'cancelled' and o.payment_status = 'paid'
        order by f.created_at
        limit 20
        """
    )

    daily = await fetch(
        """
        with days as (
          select generate_series(current_date - 13, current_date, interval '1 day')::date as day
        )
        select d.day,
               count(o.id) filter (where o.status <> 'cancelled')::int as orders,
               count(o.id) filter (where o.status = 'cancelled')::int as cancelled,
               coalesce(sum(o.total_paise) filter (where o.status = 'delivered'), 0)::bigint as delivered_paise
        from days d
        left join orders o on o.placed_at::date = d.day
        group by d.day
        order by d.day
        """
    )

    delivered = today["delivered"]

    return {
        "today": {
            "orders": today["placed"],
            "delivered": delivered,
            "cancelled": today["cancelled"],
            "deliveredPaise": int(today["delivered_paise"]),
            "commissionPaise": int(today["commission_paise"]),
            "averageOrderPaise": int(today["delivered_paise"]) // delivered if delivered else 0,
        },
        "live": {
            "awaitingPayment": live["awaiting_payment"],
            "awaitingRestaurant": live["awaiting_restaurant"],
            "preparing": live["preparing"],
            "ready": live["ready"],
            "onTheWay": live["on_the_way"],
        },
        "riders": {
            "active": riders["active"],
            "online": riders["online"],
            "busy": riders["busy"],
            "pending": riders["pending"],
        },
        "restaurants": {
            "live": restaurants["live"],
            "accepting": restaurants["accepting"],
            "pending": restaurants["pending"],
        },
        "customers": {"total": customers["total"], "newToday": customers["new_today"]},
        "attention": {
            "waitingForRestaurant": [_stuck_order(row) for row in waiting_for_restaurant],
            "waitingForRider": [_stuck_order(row) for row in waiting_for_rider],
            "failedRefunds": [
                {**_stuck_order(row), "amountPaise": row["amount_paise"]} for row in failed_refunds
            ],
        },
        "daily": [
            {
                "date": row["day"].isoformat(),
                "orders": row["orders"],
                "cancelled": row["cancelled"],
                "deliveredPaise": int(row["delivered_paise"]),
            }
            for row in daily
        ],
    }
