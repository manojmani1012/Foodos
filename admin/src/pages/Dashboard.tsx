import { Link } from 'react-router-dom'
import BarChart from '../components/BarChart'
import { Card, Empty, Loadable, PageHeader, Stat } from '../components/ui'
import { api } from '../lib/api'
import { formatMoney, formatWait, ORDER_STATUS } from '../lib/format'
import type { Dashboard as DashboardData, StuckOrder } from '../lib/types'
import { useLoad } from '../lib/useLoad'

function StuckList({ orders, empty, money }: { orders: StuckOrder[]; empty: string; money?: boolean }) {
  if (!orders.length) return <p className="muted small">{empty}</p>

  return (
    <ul className="stuck-list">
      {orders.map((order) => (
        <li key={order.id}>
          <Link to={`/orders/${order.id}`}>
            <span className="mono">{order.orderNumber}</span>
            <span className="stuck-where">
              {order.restaurant} · {ORDER_STATUS[order.status]?.label || order.status}
            </span>
            <span className="stuck-time">
              {money && order.amountPaise ? `${formatMoney(order.amountPaise)} · ` : ''}
              {formatWait(order.minutes)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default function Dashboard() {
  const state = useLoad(() => api<DashboardData>('/api/v1/admin/dashboard'), 'dashboard', 30_000)

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Today in India time. Refreshes every 30 seconds." />
      <Loadable state={state}>
        {(data) => {
          const attention = data.attention
          const attentionCount =
            attention.failedRefunds.length + attention.waitingForRestaurant.length + attention.waitingForRider.length

          return (
            <>
              <div className="stats">
                <Stat label="Orders today" value={data.today.orders} hint={`${data.today.cancelled} cancelled`} to="/orders" />
                <Stat
                  label="Delivered value"
                  value={formatMoney(data.today.deliveredPaise, { whole: true })}
                  hint={`${data.today.delivered} delivered · avg ${formatMoney(data.today.averageOrderPaise, { whole: true })}`}
                />
                <Stat
                  label="Commission earned"
                  value={formatMoney(data.today.commissionPaise, { whole: true })}
                  hint="On delivered orders"
                />
                <Stat
                  label="Riders online"
                  value={`${data.riders.online} / ${data.riders.active}`}
                  hint={`${data.riders.busy} on a delivery`}
                  to="/riders"
                />
              </div>

              <div className="grid-2">
                <Card title="Live orders" actions={<Link to="/orders?view=live">Open</Link>}>
                  <div className="pipeline">
                    <Stat label="Awaiting payment" value={data.live.awaitingPayment} />
                    <Stat label="Waiting for restaurant" value={data.live.awaitingRestaurant} />
                    <Stat label="Preparing" value={data.live.preparing} />
                    <Stat label="Ready for pickup" value={data.live.ready} />
                    <Stat label="On the way" value={data.live.onTheWay} />
                  </div>
                </Card>

                <Card title="Waiting on Foodos">
                  <div className="pipeline">
                    <Stat
                      label="Riders to approve"
                      value={data.riders.pending}
                      to="/riders?status=pending"
                      tone={data.riders.pending ? 'warning' : undefined}
                    />
                    <Stat
                      label="Restaurants to launch"
                      value={data.restaurants.pending}
                      to="/restaurants?status=pending"
                      tone={data.restaurants.pending ? 'warning' : undefined}
                    />
                    <Stat
                      label="Failed refunds"
                      value={attention.failedRefunds.length}
                      to="/orders?view=refund_failed"
                      tone={attention.failedRefunds.length ? 'danger' : undefined}
                    />
                    <Stat label="Restaurants live" value={data.restaurants.live} hint={`${data.restaurants.accepting} taking orders`} />
                    <Stat label="Customers" value={data.customers.total} hint={`${data.customers.newToday} new today`} />
                  </div>
                </Card>
              </div>

              <Card title={attentionCount ? `Needs attention (${attentionCount})` : 'Needs attention'}>
                {attentionCount === 0 ? (
                  <Empty title="Nothing stuck right now" body="Orders that wait too long, and refunds that fail, appear here." />
                ) : (
                  <div className="grid-3">
                    <div>
                      <h3 className="subhead">Refunds that failed</h3>
                      <p className="muted small">The customer is owed this money. Open the order and retry.</p>
                      <StuckList orders={attention.failedRefunds} empty="None." money />
                    </div>
                    <div>
                      <h3 className="subhead">Not accepted by the restaurant</h3>
                      <p className="muted small">Waiting over 10 minutes. Call the restaurant.</p>
                      <StuckList orders={attention.waitingForRestaurant} empty="None." />
                    </div>
                    <div>
                      <h3 className="subhead">No rider yet</h3>
                      <p className="muted small">Searching over 10 minutes. Check riders online nearby.</p>
                      <StuckList orders={attention.waitingForRider} empty="None." />
                    </div>
                  </div>
                )}
              </Card>

              <Card title="Orders, last 14 days">
                <BarChart
                  label="Orders placed per day over the last 14 days"
                  points={data.daily.map((day) => ({
                    date: day.date,
                    value: day.orders,
                    detail: `${day.orders} orders, ${day.cancelled} cancelled, ${formatMoney(day.deliveredPaise, { whole: true })} delivered`,
                  }))}
                />
              </Card>
            </>
          )
        }}
      </Loadable>
    </>
  )
}
