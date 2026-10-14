import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import MapPicker from '../components/Map'
import { Badge, Card, ConfirmDialog, Details, ErrorBox, Field, Loadable, Modal, PageHeader, Stat, StatusBadge } from '../components/ui'
import { api } from '../lib/api'
import {
  DELIVERY_STATUS,
  formatDateTime,
  formatMoney,
  formatPhone,
  PARTNER_STATUS,
  PAYMENT_METHOD,
  timeAgo,
  titleCase,
  VEHICLE,
} from '../lib/format'
import { useToast } from '../lib/toast'
import type { Rider } from '../lib/types'
import { useLoad } from '../lib/useLoad'

type Action = { status: 'active' | 'suspended' | 'rejected'; title: string; label: string; danger?: boolean; body: string }

function actionsFor(rider: Rider): Action[] {
  const name = rider.name || 'this rider'
  const approve: Action = {
    status: 'active',
    title: rider.status === 'pending' ? `Approve ${name}?` : `Reactivate ${name}?`,
    label: rider.status === 'pending' ? 'Approve' : 'Reactivate',
    body: `They can go online in the Delivery app and will be offered orders from restaurants in ${rider.city || 'their city'}.`,
  }
  const suspend: Action = {
    status: 'suspended',
    title: `Suspend ${name}?`,
    label: 'Suspend',
    danger: true,
    body: 'They are taken offline now and cannot go back online. A delivery already in their hands can still be finished.',
  }
  const reject: Action = {
    status: 'rejected',
    title: `Reject ${name}?`,
    label: 'Reject',
    danger: true,
    body: 'They cannot go online. You can approve them later if things change.',
  }

  switch (rider.status) {
    case 'pending':
      return [approve, reject]
    case 'active':
      return [suspend]
    default:
      return [approve]
  }
}

function EditRider({ rider, onSaved, onClose }: { rider: Rider; onSaved: (rider: Rider) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    fullName: rider.name || '',
    city: rider.city || '',
    vehicleType: rider.vehicleType,
    vehicleNumber: rider.vehicleNumber || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event?: FormEvent) {
    event?.preventDefault()
    setBusy(true)
    setError('')

    try {
      const { rider: saved } = await api<{ rider: Rider }>(`/api/v1/admin/riders/${rider.id}`, {
        method: 'PATCH',
        body: {
          fullName: form.fullName.trim() || undefined,
          city: form.city.trim() || undefined,
          vehicleType: form.vehicleType,
          vehicleNumber: form.vehicleNumber.trim() || null,
        },
      })
      onSaved(saved)
      onClose()
    } catch (caught: any) {
      setError(caught?.message || 'Could not save')
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Edit rider details"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={save}>
        <Field label="Full name">
          {(id) => <input id={id} className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />}
        </Field>
        <Field label="City" hint="They are offered orders from restaurants in this city.">
          {(id) => <input id={id} className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />}
        </Field>
        <div className="form-grid two">
          <Field label="Vehicle">
            {(id) => (
              <select id={id} className="input" value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })}>
                {Object.entries(VEHICLE).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Vehicle number">
            {(id) => (
              <input
                id={id}
                className="input"
                value={form.vehicleNumber}
                placeholder="TN 09 AB 1234"
                onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })}
              />
            )}
          </Field>
        </div>
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  )
}

export default function RiderDetail() {
  const { id = '' } = useParams()
  const toast = useToast()
  const [action, setAction] = useState<Action | null>(null)
  const [editing, setEditing] = useState(false)

  const state = useLoad(async () => (await api<{ rider: Rider }>(`/api/v1/admin/riders/${id}`)).rider, id, 30_000)

  async function changeStatus(reason: string) {
    if (!action) return

    const { rider } = await api<{ rider: Rider }>(`/api/v1/admin/riders/${id}/status`, {
      method: 'POST',
      body: { status: action.status, reason: reason || null },
    })

    state.setData(rider)
    toast(`${rider.name || 'Rider'} is now ${PARTNER_STATUS[rider.status]?.label.toLowerCase()}`)
  }

  return (
    <Loadable state={state}>
      {(rider) => (
        <>
          <PageHeader
            back={{ to: '/riders', label: 'Riders' }}
            title={
              <>
                {rider.name || 'No name yet'} <StatusBadge map={PARTNER_STATUS} value={rider.status} />{' '}
                {rider.isOnline && <Badge tone="success">Online</Badge>}
              </>
            }
            subtitle={`${formatPhone(rider.phone)} · ${rider.city || 'City not set'} · joined ${formatDateTime(rider.joinedAt)}`}
            actions={
              <>
                <button className="btn" onClick={() => setEditing(true)}>
                  Edit details
                </button>
                {actionsFor(rider).map((candidate) => (
                  <button
                    key={candidate.status}
                    className={candidate.danger ? 'btn btn-danger' : 'btn btn-primary'}
                    onClick={() => setAction(candidate)}
                  >
                    {candidate.label}
                  </button>
                ))}
              </>
            }
          />

          {rider.status === 'pending' && (
            <div className="notice notice-warning">
              Before approving, call {formatPhone(rider.phone)} and check their driving licence, vehicle RC and ID. The
              Delivery app does not collect documents yet.
              {!rider.city && ' Set their city first: it decides which orders they are offered.'}
            </div>
          )}
          {rider.accountBlocked && (
            <div className="notice notice-danger">This phone number is blocked under Customers, so it cannot sign in to any Foodos app.</div>
          )}

          <div className="stats">
            <Stat label="Deliveries" value={rider.stats.deliveries} hint={`${rider.stats.deliveriesLast7Days} in the last 7 days`} />
            <Stat label="Earned, last 7 days" value={formatMoney(rider.stats.earnedPaiseLast7Days, { whole: true })} hint={`${rider.stats.distanceKmLast7Days} km`} />
            <Stat
              label="Cash held today"
              value={formatMoney(rider.stats.cashHeldTodayPaise, { whole: true })}
              hint="Collected at the door; owed to Foodos"
              tone={rider.stats.cashHeldTodayPaise > 0 ? 'warning' : undefined}
            />
            <Stat label="Rating" value={rider.ratingCount ? rider.rating.toFixed(1) : '—'} hint={rider.ratingCount ? `${rider.ratingCount} ratings` : 'No ratings yet'} />
          </div>

          <div className="grid-2 align-start">
            <div className="stack">
              <Card title="Details">
                <Details
                  rows={[
                    ['Phone', <a key="p" href={`tel:${rider.phone}`}>{formatPhone(rider.phone)}</a>],
                    ['City', rider.city || <Badge key="c" tone="warning">Not set</Badge>],
                    ['Vehicle', VEHICLE[rider.vehicleType] || rider.vehicleType],
                    ['Vehicle number', rider.vehicleNumber],
                    ['Licence number', rider.licenseNumber],
                    ['Last signed in', rider.lastSignedInAt ? timeAgo(rider.lastSignedInAt) : 'Never'],
                  ]}
                />
              </Card>

              <Card title="Documents">
                {rider.documents.length === 0 ? (
                  <p className="muted">None uploaded. Document upload in the Delivery app is still to come; check them over a call for now.</p>
                ) : (
                  <Details rows={rider.documents.map((doc) => [titleCase(doc.type), titleCase(doc.status)])} />
                )}
              </Card>
            </div>

            <Card title="Last known location">
              {rider.location ? (
                <>
                  <MapPicker value={rider.location} readOnly height={240} />
                  <p className="muted small">
                    Updated {timeAgo(rider.location.updatedAt)}. Shared only while the Delivery app is open and the rider is online
                    or on a delivery.
                  </p>
                </>
              ) : (
                <p className="muted">Not shared yet.</p>
              )}
            </Card>
          </div>

          <Card title="Recent deliveries" flush>
            {rider.recentDeliveries.length === 0 ? (
              <p className="muted pad">No deliveries yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Restaurant</th>
                      <th>Status</th>
                      <th>Payment</th>
                      <th className="num">Distance</th>
                      <th className="num">Rider pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rider.recentDeliveries.map((delivery) => (
                      <tr key={delivery.id}>
                        <td>
                          <Link className="mono" to={`/orders/${delivery.orderId}`}>
                            {delivery.orderNumber}
                          </Link>
                          <div className="sub">{formatDateTime(delivery.deliveredAt || delivery.acceptedAt)}</div>
                        </td>
                        <td>{delivery.restaurant}</td>
                        <td>{DELIVERY_STATUS[delivery.status] || delivery.status}</td>
                        <td>
                          {PAYMENT_METHOD[delivery.paymentMethod] || delivery.paymentMethod}
                          {delivery.paymentMethod === 'cod' && <div className="sub">Collect {formatMoney(delivery.orderTotalPaise)}</div>}
                        </td>
                        <td className="num">{delivery.distanceKm !== null ? `${delivery.distanceKm} km` : '—'}</td>
                        <td className="num">{formatMoney(delivery.earningPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {editing && <EditRider rider={rider} onSaved={(saved) => { state.setData(saved); toast('Rider details saved') }} onClose={() => setEditing(false)} />}

          {action && (
            <ConfirmDialog
              title={action.title}
              body={<p>{action.body}</p>}
              confirmLabel={action.label}
              danger={action.danger}
              reasonLabel={action.status === 'active' ? undefined : 'Reason'}
              reasonHint="Kept in the activity log for the team. The rider is not shown it."
              onConfirm={changeStatus}
              onClose={() => setAction(null)}
            />
          )}
        </>
      )}
    </Loadable>
  )
}
