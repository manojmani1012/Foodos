import { Link, useNavigate } from 'react-router-dom'
import { TestBadge } from '../components/TestAccount'
import { Badge, Card, Empty, Loadable, PageHeader, Pagination, SearchBox, StatusBadge, Tabs } from '../components/ui'
import { api } from '../lib/api'
import {
  cancelledByLabel,
  DELIVERY_STATUS,
  formatDateTime,
  formatMoney,
  formatPhone,
  ORDER_STATUS,
  PAYMENT_METHOD,
  plural,
  REFUND_STATUS,
} from '../lib/format'
import type { Counts, OrderRow } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { useFilters } from '../lib/useParams'

const LIMIT = 50

type View = 'live' | 'all' | 'delivered' | 'cancelled' | 'refund_failed'

export default function Orders() {
  const navigate = useNavigate()
  const [filters, setFilters] = useFilters({ view: 'live', search: '', from: '', to: '', offset: '0' })
  const offset = Number(filters.offset) || 0

  const state = useLoad(
    () =>
      api<{ total: number; counts: Counts; orders: OrderRow[] }>('/api/v1/admin/orders', {
        query: {
          view: filters.view === 'all' ? undefined : filters.view,
          search: filters.search,
          from: filters.from,
          to: filters.to,
          limit: LIMIT,
          offset,
        },
      }),
    JSON.stringify(filters),
    filters.view === 'live' ? 15_000 : undefined
  )

  const counts = state.data?.counts

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle={filters.view === 'live' ? 'Live orders refresh every 15 seconds.' : undefined}
      />

      <Tabs<View>
        value={filters.view as View}
        onChange={(view) => setFilters({ view })}
        options={[
          { value: 'live', label: 'Live', count: counts?.live },
          { value: 'all', label: 'All', count: counts?.all },
          { value: 'delivered', label: 'Delivered', count: counts?.delivered },
          { value: 'cancelled', label: 'Cancelled', count: counts?.cancelled },
          { value: 'refund_failed', label: 'Refund failed', count: counts?.refund_failed, alert: true },
        ]}
      />

      <div className="toolbar">
        <SearchBox
          value={filters.search}
          onChange={(search) => setFilters({ search })}
          placeholder="Order number, customer phone or name, restaurant"
        />
        <label className="inline-field">
          From
          <input className="input" type="date" value={filters.from} onChange={(e) => setFilters({ from: e.target.value })} />
        </label>
        <label className="inline-field">
          To
          <input className="input" type="date" value={filters.to} onChange={(e) => setFilters({ to: e.target.value })} />
        </label>
        {(filters.search || filters.from || filters.to) && (
          <button className="btn btn-small btn-ghost" onClick={() => setFilters({ search: '', from: '', to: '' })}>
            Clear
          </button>
        )}
      </div>

      <Card flush>
        <Loadable state={state}>
          {(data) =>
            data.orders.length === 0 ? (
              <Empty
                title={filters.view === 'live' ? 'No live orders right now' : 'No orders match'}
                body={filters.search ? 'Try a different search.' : undefined}
              />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table clickable stack-on-phone">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Placed</th>
                        <th>Restaurant</th>
                        <th>Customer</th>
                        <th>Status</th>
                        <th>Rider</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.orders.map((order) => (
                        <tr key={order.id} onClick={() => navigate(`/orders/${order.id}`)}>
                          <td data-label="Order">
                            <Link className="mono" to={`/orders/${order.id}`} onClick={(e) => e.stopPropagation()}>
                              {order.orderNumber}
                            </Link>{' '}
                            {order.isTest && <TestBadge />}
                            <div className="sub">{plural(order.itemCount, 'item')}</div>
                          </td>
                          <td data-label="Placed">{formatDateTime(order.placedAt)}</td>
                          <td data-label="Restaurant">{order.restaurant.name}</td>
                          <td data-label="Customer">
                            {order.customer.name || 'No name yet'}
                            <div className="sub">{formatPhone(order.customer.phone)}</div>
                          </td>
                          <td data-label="Status">
                            <StatusBadge map={ORDER_STATUS} value={order.status} />
                            {order.refundStatus && (
                              <div className="sub">
                                <StatusBadge map={REFUND_STATUS} value={order.refundStatus} />
                              </div>
                            )}
                            {order.status === 'cancelled' && order.cancelledBy && (
                              <div className="sub">by {cancelledByLabel(order.cancelledBy)}</div>
                            )}
                          </td>
                          <td data-label="Rider">
                            {order.riderName ? (
                              <>
                                {order.riderName}
                                {/* Two riders can share a name. */}
                                <div className="sub">
                                  {[order.riderPhone ? `••${order.riderPhone.slice(-4)}` : null, order.riderCity]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </div>
                              </>
                            ) : order.deliveryStatus === 'searching' ? (
                              <Badge tone={(order.riderWaitMinutes ?? 0) >= 5 ? 'danger' : 'warning'}>
                                Finding rider{order.riderWaitMinutes ? ` · ${order.riderWaitMinutes} min` : ''}
                              </Badge>
                            ) : (
                              '—'
                            )}
                            {order.riderName && order.deliveryStatus && (
                              <div className="sub">{DELIVERY_STATUS[order.deliveryStatus]}</div>
                            )}
                          </td>
                          <td className="num" data-label="Total">
                            {formatMoney(order.totalPaise)}
                            <div className="sub">{PAYMENT_METHOD[order.paymentMethod] || order.paymentMethod}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  total={data.total}
                  limit={LIMIT}
                  offset={offset}
                  onChange={(next) => setFilters({ offset: String(next) })}
                />
              </>
            )
          }
        </Loadable>
      </Card>
    </>
  )
}
