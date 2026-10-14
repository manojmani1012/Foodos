import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Card, ConfirmDialog, Details, Loadable, PageHeader, Stat, StatusBadge } from '../components/ui'
import { api } from '../lib/api'
import { formatDateTime, formatMoney, formatPhone, ORDER_STATUS, PAYMENT_METHOD, timeAgo } from '../lib/format'
import { useToast } from '../lib/toast'
import type { Customer } from '../lib/types'
import { useLoad } from '../lib/useLoad'

const ROLE_NAMES: Record<string, string> = {
  restaurant_owner: 'restaurant owner',
  delivery_partner: 'rider',
}

export default function CustomerDetail() {
  const { id = '' } = useParams()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)

  const state = useLoad(async () => (await api<{ customer: Customer }>(`/api/v1/admin/customers/${id}`)).customer, id)

  async function toggleBlock(reason: string) {
    const blocking = !state.data?.blocked
    const { customer } = await api<{ customer: Customer }>(`/api/v1/admin/customers/${id}/block`, {
      method: 'POST',
      body: { blocked: blocking, reason: reason || null },
    })

    state.setData(customer)
    toast(blocking ? 'Account blocked' : 'Account unblocked')
  }

  return (
    <Loadable state={state}>
      {(customer) => {
        const alsoPartner = customer.otherRoles.map((role) => ROLE_NAMES[role]).filter(Boolean)

        return (
          <>
            <PageHeader
              back={{ to: '/customers', label: 'Customers' }}
              title={
                <>
                  {customer.name || 'No name yet'} {customer.blocked && <Badge tone="danger">Blocked</Badge>}
                </>
              }
              subtitle={`${formatPhone(customer.phone)} · joined ${formatDateTime(customer.joinedAt)}`}
              actions={
                <button className={customer.blocked ? 'btn' : 'btn btn-danger'} onClick={() => setConfirming(true)}>
                  {customer.blocked ? 'Unblock' : 'Block'}
                </button>
              }
            />

            <div className="stats">
              <Stat label="Orders" value={customer.stats.orders} hint={`${customer.stats.delivered} delivered`} />
              <Stat label="Spent" value={formatMoney(customer.stats.spentPaise, { whole: true })} hint="On delivered orders" />
              <Stat
                label="Cancelled"
                value={customer.stats.cancelled}
                hint={`${customer.stats.cancelledByCustomer} by the customer`}
                tone={customer.stats.cancelledByCustomer >= 3 ? 'warning' : undefined}
              />
              <Stat label="Last signed in" value={customer.lastSignedInAt ? timeAgo(customer.lastSignedInAt) : 'Never'} />
            </div>

            <div className="grid-2 align-start">
              <Card title="Details">
                <Details
                  rows={[
                    ['Phone', <a key="p" href={`tel:${customer.phone}`}>{formatPhone(customer.phone)}</a>],
                    ['Email', customer.email],
                    ['Also a', alsoPartner.length ? alsoPartner.join(' and ') : null],
                  ]}
                />
                {customer.addresses.length > 0 && (
                  <>
                    <h3 className="subhead">Saved addresses</h3>
                    <ul className="plain-list">
                      {customer.addresses.map((address, index) => (
                        <li key={index}>
                          <strong>{address.label}</strong>
                          {address.isDefault && <span className="sub"> · default</span>}
                          <div className="sub">{address.address}</div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Card>

              <Card title="Recent orders" actions={<Link to={`/orders?view=all&search=${encodeURIComponent(customer.phone.replace('+91', ''))}`}>All orders</Link>}>
                {customer.recentOrders.length === 0 ? (
                  <p className="muted">No orders yet.</p>
                ) : (
                  <table className="table compact">
                    <tbody>
                      {customer.recentOrders.map((order) => (
                        <tr key={order.id}>
                          <td>
                            <Link className="mono" to={`/orders/${order.id}`}>
                              {order.orderNumber}
                            </Link>
                            <div className="sub">
                              {order.restaurant} · {formatDateTime(order.placedAt)}
                            </div>
                          </td>
                          <td>
                            <StatusBadge map={ORDER_STATUS} value={order.status} />
                          </td>
                          <td className="num">
                            {formatMoney(order.totalPaise)}
                            <div className="sub">{PAYMENT_METHOD[order.paymentMethod] || order.paymentMethod}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>

            {confirming && (
              <ConfirmDialog
                title={customer.blocked ? 'Unblock this number?' : 'Block this number?'}
                danger={!customer.blocked}
                confirmLabel={customer.blocked ? 'Unblock' : 'Block'}
                body={
                  customer.blocked ? (
                    <p>{formatPhone(customer.phone)} will be able to sign in to Foodos again.</p>
                  ) : (
                    <>
                      <p>
                        {formatPhone(customer.phone)} will not be able to sign in to any Foodos app
                        {alsoPartner.length ? `, including as a ${alsoPartner.join(' and ')}` : ''}. Anyone signed in with it is
                        signed out within 15 minutes.
                      </p>
                      <p className="muted small">Orders already placed are not cancelled. Cancel them from the order page if needed.</p>
                    </>
                  )
                }
                reasonLabel={customer.blocked ? undefined : 'Reason'}
                reasonHint="Kept in the activity log for the team."
                onConfirm={toggleBlock}
                onClose={() => setConfirming(false)}
              />
            )}
          </>
        )
      }}
    </Loadable>
  )
}
