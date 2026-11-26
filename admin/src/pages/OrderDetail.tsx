import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { RiderFinder } from '../components/RiderFinder'
import { TestBadge } from '../components/TestAccount'
import { Badge, Card, ConfirmDialog, Details, ErrorBox, Field, Loadable, Modal, PageHeader, StatusBadge } from '../components/ui'
import { api, mediaUrl } from '../lib/api'
import {
  cancelledByLabel,
  CHARGED_TO,
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
import type { Order, PaymentSettings, RefundChargedTo } from '../lib/types'
import { useLoad } from '../lib/useLoad'

const LIVE = ['pending', 'confirmed', 'preparing', 'ready', 'picked_up', 'on_the_way']

// Minutes without a rider before the page raises it, then insists.
const RIDER_WAIT_WARN = 5
const RIDER_WAIT_URGENT = 20

// The invoice opens in a new tab through a link that works for 15 minutes. The
// tab is opened within the click, or the browser would block it.
async function openInvoice(orderId: string) {
  const tab = window.open('', '_blank')

  try {
    const { url } = await api<{ url: string }>(`/api/v1/admin/orders/${orderId}/invoice`, { method: 'POST' })
    if (tab) tab.location.href = mediaUrl(url) || url
  } catch (error) {
    tab?.close()
    window.alert(error instanceof Error ? error.message : 'Could not open the invoice')
  }
}

// Money goes back where it came from: online payments to the card or UPI
// through Razorpay; wallet and cash orders to the customer's Foodos wallet.
function refundsToWallet(order: Order) {
  return order.paymentMethod === 'wallet' || order.paymentMethod === 'cod'
}

function PartialRefund({ order, onDone, onClose }: { order: Order; onDone: (order: Order) => void; onClose: () => void }) {
  const refunded = order.refunds.filter((refund) => refund.status !== 'failed').reduce((sum, refund) => sum + refund.amountPaise, 0)
  const left = Math.max(0, order.totalPaise - refunded)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [chargedTo, setChargedTo] = useState<RefundChargedTo>('restaurant')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const wallet = refundsToWallet(order)

  // Pre-select who bears it as set in Settings; Restaurant if that cannot load.
  useEffect(() => {
    api<{ settings: PaymentSettings }>('/api/v1/admin/finance/settings')
      .then(({ settings }) => settings.refundChargedToDefault && setChargedTo(settings.refundChargedToDefault))
      .catch(() => {})
  }, [])

  async function save(event?: FormEvent) {
    event?.preventDefault()
    const paise = Math.round(Number(amount) * 100)

    if (!(paise > 0)) return setError('Enter the amount to refund, in rupees')
    if (paise > left) return setError(`At most ${formatMoney(left)} can still be refunded on this order`)
    if (reason.trim().length < 5) return setError('Write the reason (at least 5 characters)')

    setBusy(true)
    setError('')

    try {
      const result = await api<{ order: Order }>(`/api/v1/admin/orders/${order.id}/refunds`, {
        method: 'POST',
        body: { amountPaise: paise, reason: reason.trim(), chargedTo },
      })
      onDone(result.order)
      onClose()
    } catch (caught: any) {
      setError(caught?.message || 'Could not refund')
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Refund part of ${order.orderNumber}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Go back
          </button>
          <button className="btn btn-primary" onClick={() => save()} disabled={busy}>
            {busy ? 'Refunding…' : 'Refund'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={save}>
        <p className="muted small">
          Order total {formatMoney(order.totalPaise)}
          {refunded > 0 ? `, ${formatMoney(refunded)} already refunded` : ''}. Up to {formatMoney(left)} can be refunded.
        </p>
        <div className="form-grid two">
          <Field label="Amount (₹)">
            {(id) => <input id={id} className="input" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
          <Field
            label="Charged to"
            hint={
              chargedTo === 'foodos'
                ? 'Foodos bears it. Nobody\'s payout changes.'
                : `Taken off the ${chargedTo === 'rider' ? 'rider' : 'restaurant'}'s next payout.`
            }
          >
            {(id) => (
              <select id={id} className="input" value={chargedTo} onChange={(e) => setChargedTo(e.target.value as RefundChargedTo)}>
                {Object.entries(CHARGED_TO).map(([value, label]) => (
                  <option key={value} value={value} disabled={value === 'rider' && !order.rider}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field label="Reason" hint="The customer sees this with the refund.">
          {(id) => <textarea id={id} className="input" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="notice notice-info">
          {wallet
            ? `This was a ${order.paymentMethod === 'cod' ? 'cash' : 'wallet'} order, so the money goes to the customer's Foodos wallet straight away.`
            : 'The customer paid online, so Razorpay sends the money back to their card or UPI. Banks usually take 5–7 working days.'}
        </div>
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  )
}

export default function OrderDetail() {
  const { id = '' } = useParams()
  const toast = useToast()
  const [cancelling, setCancelling] = useState(false)
  const [refunding, setRefunding] = useState(false)
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
        const addressText = [
          address.line1,
          address.line2,
          address.landmark ? `near ${address.landmark}` : null,
          address.city,
          address.pincode,
        ]
          .filter(Boolean)
          .join(', ')
        const waited = order.deliveryStatus === 'searching' ? order.riderWaitMinutes ?? 0 : 0
        const isLive = LIVE.includes(order.status)

        return (
          <>
            <PageHeader
              back={{ to: '/orders', label: 'Orders' }}
              title={
                <>
                  <span className="mono">{order.orderNumber}</span> <StatusBadge map={ORDER_STATUS} value={order.status} />{' '}
                  {order.isTest && <TestBadge />}
                </>
              }
              subtitle={`Placed ${formatDateTime(order.placedAt)} · ${PAYMENT_METHOD[order.paymentMethod] || order.paymentMethod} · ${formatMoney(order.totalPaise)}`}
              actions={
                <>
                  {order.status === 'delivered' && (
                    <button className="btn" onClick={() => openInvoice(order.id)}>
                      GST invoice
                    </button>
                  )}
                  {order.status === 'delivered' && !order.isTest && order.paymentStatus !== 'refunded' && (
                    <button className="btn" onClick={() => setRefunding(true)}>
                      Refund part of this order
                    </button>
                  )}
                  {order.actions.canCancel && (
                    <button className="btn btn-danger" onClick={() => setCancelling(true)}>
                      Cancel order
                    </button>
                  )}
                </>
              }
            />

            {order.status === 'cancelled' && (
              <div className="notice notice-danger">
                Cancelled {formatDateTime(order.cancelledAt)} by {cancelledByLabel(order.cancelledBy)}
                {order.cancellationReason ? `: "${order.cancellationReason}"` : ''}
              </div>
            )}

            {waited >= RIDER_WAIT_WARN && (
              <div className={`notice ${waited >= RIDER_WAIT_URGENT ? 'notice-danger' : 'notice-warning'}`}>
                <strong>No rider for {waited} minutes.</strong>{' '}
                {waited >= RIDER_WAIT_URGENT
                  ? 'Assign a rider below now, or cancel the order so the customer is not left waiting.'
                  : 'Nobody nearby has taken it. Assign a rider below.'}
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
                      {order.roundOffPaise !== 0 && (
                        <tr>
                          <td>Round off</td>
                          <td className="num">
                            {order.roundOffPaise < 0 ? '−' : ''}
                            {formatMoney(Math.abs(order.roundOffPaise))}
                          </td>
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
                                {(refund.chargedTo || refund.destination || refund.reason) && (
                                  <div className="sub">
                                    {[
                                      refund.destination === 'wallet'
                                        ? 'To Foodos wallet'
                                        : refund.destination === 'original'
                                          ? 'To card / UPI'
                                          : null,
                                      refund.chargedTo ? `charged to ${CHARGED_TO[refund.chargedTo] || refund.chargedTo}` : null,
                                      refund.reason ? `“${refund.reason}”` : null,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </div>
                                )}
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
                      ...(order.deliveryCode
                        ? ([['Delivery code', <span key="code" className="code-chip">{order.deliveryCode}</span>]] as [
                            string,
                            ReactNode,
                          ][])
                        : []),
                    ]}
                  />
                  {order.deliveryCode && (
                    <p className="muted small">
                      The rider needs this code to mark the order delivered. Give it to them only after checking with the
                      customer.
                    </p>
                  )}
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
                        [
                          'Phone',
                          <span key="t">
                            <a href={`tel:${order.rider.phone}`}>{formatPhone(order.rider.phone)}</a>
                            {order.rider.city ? ` · ${order.rider.city}` : ''}
                          </span>,
                        ],
                        ['Status', DELIVERY_STATUS[order.rider.deliveryStatus] || order.rider.deliveryStatus],
                        [
                          'Rider pay',
                          `${formatMoney(order.rider.payPaise)}${order.rider.distanceKm !== null ? ` · ${order.rider.distanceKm} km` : ''}`,
                        ],
                      ]}
                    />
                  ) : order.deliveryStatus === 'searching' ? (
                    <p className="muted">
                      Offered to the nearest free riders, one at a time, since the restaurant accepted
                      {order.riderWaitMinutes !== null ? ` ${order.riderWaitMinutes} min ago` : ''}. Nobody has taken it
                      yet.
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

                  {order.actions.canAssignRider && (
                    <>
                      {order.rider && <h3 className="subhead">Move to another rider</h3>}
                      <RiderFinder order={order} onAssigned={state.setData} />
                    </>
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

            {refunding && (
              <PartialRefund
                order={order}
                onDone={(updated) => {
                  state.setData(updated)
                  toast(refundsToWallet(order) ? 'Refunded to the customer\'s Foodos wallet' : 'Refund started with Razorpay')
                }}
                onClose={() => setRefunding(false)}
              />
            )}

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
