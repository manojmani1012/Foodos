import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Card, ConfirmDialog, Details, ErrorBox, Field, Loadable, Modal, PageHeader, Stat, StatusBadge } from '../components/ui'
import { api } from '../lib/api'
import { formatDateTime, formatMoney, formatPhone, ORDER_STATUS, PAYMENT_METHOD, timeAgo } from '../lib/format'
import { TestAccountCard, TestBadge } from '../components/TestAccount'
import { useToast } from '../lib/toast'
import type { Customer } from '../lib/types'
import { useLoad } from '../lib/useLoad'

const ROLE_NAMES: Record<string, string> = {
  restaurant_owner: 'restaurant owner',
  delivery_partner: 'rider',
}

// Foodos adding to or taking from a wallet: goodwill for a bad order, or
// putting right a mistake. The reason is kept with the entry and in Activity.
function AdjustWallet({ customer, onSaved, onClose }: { customer: Customer; onSaved: () => void; onClose: () => void }) {
  const [kind, setKind] = useState<'credit' | 'debit'>('credit')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event?: FormEvent) {
    event?.preventDefault()
    const paise = Math.round(Number(amount) * 100)

    if (!(paise >= 100)) {
      setError('Enter the amount in rupees')
      return
    }

    if (reason.trim().length < 5) {
      setError('Say why. It is kept with the entry and shown to the customer')
      return
    }

    setBusy(true)
    setError('')

    try {
      await api(`/api/v1/admin/customers/${customer.id}/wallet`, {
        method: 'POST',
        body: { type: kind, amountPaise: paise, reason: reason.trim() },
      })
      onSaved()
      onClose()
    } catch (caught: any) {
      setError(caught?.message || 'Could not change the wallet')
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Change wallet balance"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => save()} disabled={busy}>
            {busy ? 'Saving…' : kind === 'credit' ? 'Add money' : 'Take money'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={save}>
        <p className="muted small">
          {customer.name || 'This customer'} has {formatMoney(customer.wallet.balancePaise)}. The reason appears in their wallet
          history, so write it for them.
        </p>
        <div className="form-grid two">
          <Field label="Change">
            {(id) => (
              <select id={id} className="input" value={kind} onChange={(e) => setKind(e.target.value as 'credit' | 'debit')}>
                <option value="credit">Add money</option>
                <option value="debit">Take money back</option>
              </select>
            )}
          </Field>
          <Field label="Amount (₹)">
            {(id) => <input id={id} className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
        </div>
        <Field label="Reason">
          {(id) => <input id={id} className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  )
}

export default function CustomerDetail() {
  const { id = '' } = useParams()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [adjusting, setAdjusting] = useState(false)

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
                  {customer.name || 'No name yet'} {customer.blocked && <Badge tone="danger">Blocked</Badge>} {customer.isTest && <TestBadge />}
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

              <Card
                title="Foodos wallet"
                actions={
                  <button className="btn btn-small" onClick={() => setAdjusting(true)}>
                    Change balance
                  </button>
                }
              >
                <p>
                  <strong>{formatMoney(customer.wallet.balancePaise)}</strong>
                </p>
                {customer.wallet.transactions.length === 0 ? (
                  <p className="muted">Nothing added or spent yet.</p>
                ) : (
                  <Details
                    rows={customer.wallet.transactions.map((entry) => [
                      formatDateTime(entry.createdAt),
                      <div key={entry.id}>
                        {entry.type === 'credit' ? '+' : '−'}
                        {formatMoney(entry.amountPaise)} · {entry.label}
                        {entry.orderNumber ? ` #${entry.orderNumber}` : ''}
                        <div className="sub">
                          Balance {formatMoney(entry.balanceAfterPaise)}
                          {entry.note ? ` · ${entry.note}` : ''}
                        </div>
                      </div>,
                    ])}
                  />
                )}
              </Card>

              <TestAccountCard
                userId={customer.id}
                phone={customer.phone}
                isTest={customer.isTest}
                onChange={(isTest) => state.setData({ ...customer, isTest })}
              />

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

            {adjusting && (
              <AdjustWallet
                customer={customer}
                onSaved={() => {
                  state.reload()
                  toast("Wallet updated")
                }}
                onClose={() => setAdjusting(false)}
              />
            )}

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
