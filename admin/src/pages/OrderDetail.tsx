import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Card, ConfirmDialog, Details, ErrorBox, Loadable, PageHeader, StatusBadge } from '../components/ui'
import { api } from '../lib/api'
import {
  DELIVERY_STATUS,
  formatDateTime,
  formatMoney,
  formatPhone,
  formatTime,
  ORDER_STATUS,
  PAYMENT_METHOD,
  paymentStatusLabel,
  REFUND_STATUS,
  titleCase,
} from '../lib/format'
import { useToast } from '../lib/toast'
import type { Order } from '../lib/types'
import { useLoad } from '../lib/useLoad'

const LIVE = ['pending', 'confirmed', 'preparing', 'ready', 'picked_up', 'on_the_way']

export default function OrderDetail() {
  const { id = '' } = useParams()
  const toast = useToast()
  const [cancelling, setCancelling] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')

  const state = useLoad(
    async () => (await api<{ order: Order }>(`/api/v1/admin/orders/${id}`)).order,
    id,
    // Keep a live order current while someone is watching it.
    15_000
  )

  async function cancel(reason: string) {
    const { order } = await api<{ order: Order }>(`/api/v1/admin/orders/${id}/cancel`, {
      method: 'POST',
      body: { reason },
    })
    state.setData(order)
    toast(
      order.refund?.status === 'failed'
        ? 'Order cancelled, but the refund failed. Retry it below'
        : order.refund
          ? 'Order cancelled and the refund has started'
          : 'Order cancelled'
    )
  }

  async function retryRefund() {
    setRetrying(true)
    setRetryError('')

    try {
      const { order } = await api<{ order: Order }>(`/api/v1/admin/orders/${id}/refund`, { method: 'POST' })
      state.setData(order)

      if (order.refund?.status === 'failed') setRetryError('Razorpay refused the refund again. Check the payment in the Razorpay dashboard')
      else toast('Refund started')
    } catch (caught: any) {
      setRetryError(caught?.message || 'Could not retry the refund')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Loadable state={state}>
      {(order) => {
        const address = order.deliveryAddress || {}
        const addressText = [address.line1, address.line2, address.city, address.pincode].filter(Boolean).join(', ')
        const isLive = LIVE.includes(order.status)

        return (
          <>
            <PageHeader
              back={{ to: '/orders', label: 'Orders' }}
              title={
                <>
                  <span className="mono">{order.orderNumber}</span> <StatusBadge map={ORDER_STATUS} value={order.status} />
                </>
              }
              subtitle={`Placed ${formatDateTime(order.placedAt)} · ${PAYMENT_METHOD[order.paymentMethod] || order.paymentMethod} · ${formatMoney(order.totalPaise)}`}
              actions={
                order.actions.canCancel && (
                  <button className="btn btn-danger" onClick={() => setCancelling(true)}>
                    Cancel order
                  </button>
                )
              }
            />

            {order.status === 'cancelled' && (
              <div className="notice notice-danger">
                Cancelled {formatDateTime(order.cancelledAt)} by{' '}
                {order.cancelledBy === 'admin' ? 'Foodos' : order.cancelledBy || 'unknown'}
                {order.cancellationReason ? `: "${order.cancellationReason}"` : ''}
              </div>
            )}

            {order.actions.canRetryRefund && (
              <div className="notice notice-danger notice-row">
                <span>
                  <strong>{formatMoney(order.totalPaise)} has not been refunded.</strong> The customer paid online and the
                  order was cancelled, but the refund did not go through.
                </span>
                <button className="btn btn-primary" disabled={retrying} onClick={retryRefund}>
                  {retrying ? 'Retrying…' : 'Retry refund'}
                </button>
              </div>
            )}
            {retryError && <ErrorBox error={retryError} />}

            <div className="grid-2 align-start">
              <div className="stack">
                <Card title="Items">
                  <table className="table compact">
                    <tbody>
                      {order.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <span className={item.isVeg ? 'veg' : 'nonveg'} aria-label={item.isVeg ? 'Veg' : 'Non-veg'} />
                            {item.quantity} × {item.name}
                            {item.addons.length > 0 && (
                              <div className="sub">+ {item.addons.map((addon) => addon.name).join(', ')}</div>
                            )}
                          </td>
                          <td className="num">{formatMoney(item.lineTotalPaise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <table className="table compact bill">
                    <tbody>
                      <tr>
                        <td>Item total</td>
                        <td className="num">{formatMoney(order.subtotalPaise)}</td>
                      </tr>
                      {order.packagingFeePaise > 0 && (
                        <tr>
                          <td>Packaging</td>
                          <td className="num">{formatMoney(order.packagingFeePaise)}</td>
                        </tr>
                      )}
                      <tr>
                        <td>Delivery fee</td>
                        <td className="num">{formatMoney(order.deliveryFeePaise)}</td>
                      </tr>
                      <tr>
                        <td>GST</td>
                        <td className="num">{formatMoney(order.taxPaise)}</td>
                      </tr>
                      {order.tipPaise > 0 && (
                        <tr>
                          <td>Rider tip</td>
                          <td className="num">{formatMoney(order.tipPaise)}</td>
                        </tr>
                      )}
                      {order.discountPaise > 0 && (
                        <tr>
                          <td>Discount</td>
                          <td className="num">−{formatMoney(order.discountPaise)}</td>
                        </tr>
                      )}
                      <tr className="total">
                        <td>Total</td>
                        <td className="num">{formatMoney(order.totalPaise)}</td>
                      </tr>
                    </tbody>
                  </table>
                  {order.specialInstructions && (
                    <p className="note">
                      <strong>Instructions:</strong> {order.specialInstructions}
                    </p>
                  )}
                </Card>

                <Card title="Payment">
                  <Details
                    rows={[
                      ['Method', PAYMENT_METHOD[order.paymentMethod] || order.paymentMethod],
                      ['Status', paymentStatusLabel(order.paymentMethod, order.paymentStatus)],
                      [
                        `Commission (${order.commissionPct}%)`,
                        `${formatMoney(order.commissionPaise)} on ${formatMoney(order.subtotalPaise)} of food`,
                      ],
                    ]}
                  />
                  {order.payments.length > 0 && (
                    <table className="table compact">
                      <thead>
                        <tr>
                          <th>Attempt</th>
                          <th>Razorpay payment</th>
                          <th>Status</th>
                          <th className="num">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.payments.map((payment, index) => (
                          <tr key={index}>
                            <td>{formatDateTime(payment.createdAt)}</td>
                            <td className="mono small">{payment.providerPaymentId || payment.providerOrderId || '—'}</td>
                            <td>
                              {titleCase(payment.status)}
                              {payment.failureReason && <div className="sub">{payment.failureReason}</div>}
                            </td>
                            <td className="num">{formatMoney(payment.amountPaise)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {order.refunds.length > 0 && (
                    <>
                      <h3 className="subhead">Refunds</h3>
                      <table className="table compact">
                        <tbody>
                          {order.refunds.map((refund, index) => (
                            <tr key={index}>
                              <td>
                                <StatusBadge map={REFUND_STATUS} value={refund.status} />
                                <div className="sub">
                                  {formatDateTime(refund.requestedAt)}
                                  {refund.requestedBy ? ` · ${refund.requestedBy}` : ''}
                                </div>
                              </td>
                              <td className="mono small">{refund.providerRefundId || '—'}</td>
                              <td className="num">{formatMoney(refund.amountPaise)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {order.refund?.status === 'pending' && (
                        <p className="muted small">
                          Razorpay has accepted the refund. Banks usually return the money in 5–7 working days.
                        </p>
                      )}
                    </>
                  )}
                </Card>
              </div>

              <div className="stack">
                <Card title="Customer">
                  <Details
                    rows={[
                      [
                        'Name',
                        <Link key="c" to={`/customers/${order.customer.id}`}>
                          {order.customer.name || 'No name yet'}
                        </Link>,
                      ],
                      ['Phone', <a key="p" href={`tel:${order.customer.phone}`}>{formatPhone(order.customer.phone)}</a>],
                      ['Deliver to', addressText || '—'],
                    ]}
                  />
                  {order.customer.blocked && <Badge tone="danger">Account blocked</Badge>}
                </Card>

                <Card title="Restaurant">
                  <Details
                    rows={[
                      ['Name', <Link key="r" to={`/restaurants/${order.restaurant.id}`}>{order.restaurant.name}</Link>],
                      ['Address', order.restaurant.address],
                      [
                        'Owner',
                        <>
                          {order.restaurantOwner.name || '—'} ·{' '}
                          <a href={`tel:${order.restaurantOwner.phone}`}>{formatPhone(order.restaurantOwner.phone)}</a>
                        </>,
                      ],
                    ]}
                  />
                </Card>

                <Card title="Rider">
                  {order.rider ? (
                    <Details
                      rows={[
                        ['Name', <Link key="d" to={`/riders/${order.rider.id}`}>{order.rider.name || 'No name'}</Link>],
                        ['Phone', <a key="t" href={`tel:${order.rider.phone}`}>{formatPhone(order.rider.phone)}</a>],
                        ['Status', DELIVERY_STATUS[order.rider.deliveryStatus] || order.rider.deliveryStatus],
                        [
                          'Rider pay',
                          `${formatMoney(order.rider.payPaise)}${order.rider.distanceKm !== null ? ` · ${order.rider.distanceKm} km` : ''}`,
                        ],
                      ]}
                    />
                  ) : order.deliveryStatus === 'searching' ? (
                    <p className="muted">
                      Offered to riders online in the city since the restaurant accepted. Nobody has taken it yet.
                    </p>
                  ) : (
                    <p className="muted">
                      {order.status === 'pending' || order.status === 'confirmed'
                        ? 'A rider is looked for once the restaurant accepts the order.'
                        : isLive
                          ? 'No rider has been requested for this order.'
                          : 'No rider was assigned.'}
                    </p>
                  )}
                </Card>

                <Card title="Timeline">
                  <ol className="timeline">
                    {order.timeline.map((event, index) => (
                      <li key={index}>
                        <span className="timeline-time">{formatTime(event.at)}</span>
                        <span>
                          <strong>{ORDER_STATUS[event.status]?.label || titleCase(event.status)}</strong>
                          {event.note && <span className="sub"> · {event.note}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </Card>
              </div>
            </div>

            {cancelling && (
              <ConfirmDialog
                title={`Cancel ${order.orderNumber}?`}
                danger
                confirmLabel="Cancel order"
                body={
                  <>
                    <p>
                      {order.rider
                        ? 'The customer, the restaurant and the rider will see this order as cancelled. The rider is freed to take another order.'
                        : 'The customer and the restaurant will see this order as cancelled.'}
                    </p>
                    {order.paymentMethod !== 'cod' && order.paymentStatus === 'paid' ? (
                      <p>
                        <strong>{formatMoney(order.totalPaise)} will be refunded</strong> to the customer's original
                        payment method.
                      </p>
                    ) : (
                      <p>
                        {order.paymentMethod === 'cod' ? 'Cash order: there is nothing to refund.' : 'The customer has not paid, so there is nothing to refund.'}
                      </p>
                    )}
                  </>
                }
                reasonLabel="Reason"
                reasonHint="The customer and the restaurant both see this reason in their apps."
                onConfirm={cancel}
                onClose={() => setCancelling(false)}
              />
            )}
          </>
        )
      }}
    </Loadable>
  )
}
