import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { formatDate, formatMoney } from '../lib/format'
import { useToast } from '../lib/toast'
import type { DailyTarget } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { Badge, Card, ConfirmDialog, Empty, ErrorBox, Field, Loadable, Modal } from './ui'

// "Complete 15 trips, earn ₹250 extra": targets every rider sees in the
// Delivery app. Each runs every day, counting trips since midnight, until it
// is stopped. The bonus is paid on the trip that reaches the target and shows
// in the rider's earnings and payout like the rest of their pay.

function AddTarget({ onSaved, onClose }: { onSaved: (target: DailyTarget) => void; onClose: () => void }) {
  const [form, setForm] = useState({ trips: '15', bonus: '250' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const trips = Number(form.trips)
  const bonus = Number(form.bonus)
  const valid = Number.isInteger(trips) && trips >= 1 && trips <= 60 && bonus >= 1 && bonus <= 10_000

  async function save(event?: FormEvent) {
    event?.preventDefault()

    if (!valid) {
      setError('Trips must be 1 to 60 and the bonus ₹1 to ₹10,000')
      return
    }

    setBusy(true)
    setError('')

    try {
      const { target } = await api<{ target: DailyTarget }>('/api/v1/admin/targets', {
        method: 'POST',
        body: { targetTrips: trips, bonusPaise: Math.round(bonus * 100) },
      })
      onSaved(target)
      onClose()
    } catch (caught: any) {
      setError(caught?.message || 'Could not start the target')
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New daily target"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => save()} disabled={busy}>
            {busy ? 'Starting…' : 'Start target'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={save}>
        <div className="form-grid two">
          <Field label="Trips in a day">
            {(id) => (
              <input id={id} className="input" inputMode="numeric" value={form.trips} onChange={(e) => setForm({ ...form, trips: e.target.value })} />
            )}
          </Field>
          <Field label="Bonus (₹)">
            {(id) => (
              <input id={id} className="input" inputMode="decimal" value={form.bonus} onChange={(e) => setForm({ ...form, bonus: e.target.value })} />
            )}
          </Field>
        </div>
        {valid && (
          <p className="muted small">
            Riders see: “Complete {trips} trips, earn {formatMoney(Math.round(bonus * 100))} extra”. It starts now and runs every day
            until you stop it.
          </p>
        )}
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  )
}

export function DailyTargets() {
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [stopping, setStopping] = useState<DailyTarget | null>(null)

  const state = useLoad(async () => (await api<{ targets: DailyTarget[] }>('/api/v1/admin/targets')).targets, 'targets')

  async function stop() {
    if (!stopping) return

    await api(`/api/v1/admin/targets/${stopping.id}/stop`, { method: 'POST' })
    await state.reload()
    toast('Target stopped')
  }

  return (
    <Card
      title="Daily targets"
      actions={
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          New target
        </button>
      }
      flush
    >
      <Loadable state={state}>
        {(targets) =>
          targets.length === 0 ? (
            <Empty title="No targets yet" body="Add one such as “Complete 15 trips, earn ₹250 extra”. Riders see their progress on the Delivery app home screen." />
          ) : (
            <div className="table-wrap">
              <table className="table stack-on-phone">
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>Status</th>
                    <th className="num">Reached today</th>
                    <th className="num">Paid so far</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {targets.map((target) => (
                    <tr key={target.id}>
                      <td data-label="Target">
                        {target.name}
                        <div className="sub">
                          {target.targetTrips} trips · {formatMoney(target.bonusPaise)} bonus · from {formatDate(target.startsAt)}
                          {target.endsAt ? ` to ${formatDate(target.endsAt)}` : ''}
                        </div>
                      </td>
                      <td data-label="Status">{target.live ? <Badge tone="success">Running</Badge> : <Badge>Stopped</Badge>}</td>
                      <td className="num" data-label="Reached today">
                        {target.reachedToday}
                      </td>
                      <td className="num" data-label="Paid so far">
                        {formatMoney(target.paidTotalPaise)}
                        <div className="sub">{target.reachedTotal} times</div>
                      </td>
                      <td className="num">
                        {target.live && (
                          <button className="btn btn-small" onClick={() => setStopping(target)}>
                            Stop
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>

      {adding && (
        <AddTarget
          onSaved={() => {
            state.reload()
            toast('Target started')
          }}
          onClose={() => setAdding(false)}
        />
      )}

      {stopping && (
        <ConfirmDialog
          title={`Stop “${stopping.name}”?`}
          body={<p>Riders stop seeing it now. Bonuses already earned stay paid.</p>}
          confirmLabel="Stop target"
          danger
          onConfirm={stop}
          onClose={() => setStopping(null)}
        />
      )}
    </Card>
  )
}
