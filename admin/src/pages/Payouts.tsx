import { useState, type FormEvent } from 'react'
import { Badge, Card, Empty, ErrorBox, Field, Loadable, Modal, PageHeader, Tabs } from '../components/ui'
import { api } from '../lib/api'
import { addDays, formatDateTime, formatDay, formatMoney, formatPhone, indiaToday } from '../lib/format'
import { useToast } from '../lib/toast'
import type { PayoutHistoryRow, Statement, StatementLine } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { useFilters } from '../lib/useParams'

type Party = 'restaurant' | 'delivery_partner'

// Monday to Sunday of last week, the usual settlement cycle.
function lastWeek() {
  const today = indiaToday()
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
  const start = addDays(today, -weekday - 7)
  return { from: start, to: addDays(start, 6) }
}

const PRESETS = [
  { label: 'Yesterday', range: () => ({ from: indiaToday(-1), to: indiaToday(-1) }) },
  { label: 'Last week', range: lastWeek },
  { label: 'Last 7 days', range: () => ({ from: indiaToday(-7), to: indiaToday(-1) }) },
  {
    label: 'Last month',
    range: () => {
      const firstOfThisMonth = `${indiaToday().slice(0, 7)}-01`
      const lastOfPrevious = addDays(firstOfThisMonth, -1)
      return { from: `${lastOfPrevious.slice(0, 7)}-01`, to: lastOfPrevious }
    },
  },
]

function RecordDialog({
  statement,
  line,
  onDone,
  onClose,
}: {
  statement: Statement
  line: StatementLine
  onDone: () => void
  onClose: () => void
}) {
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const owes = line.netPaise < 0

  async function save(event?: FormEvent) {
    event?.preventDefault()

    if (reference.trim().length < 4) {
      setError('Enter the bank or UPI reference (UTR) for this transfer')
      return
    }

    setBusy(true)
    setError('')

    try {
      await api('/api/v1/admin/payouts', {
        method: 'POST',
        body: {
          partyType: statement.partyType,
          partyId: line.partyId,
          periodStart: statement.periodStart,
          periodEnd: statement.periodEnd,
          reference: reference.trim(),
        },
      })
      onDone()
      onClose()
    } catch (caught: any) {
      setError(caught?.message || 'Could not record the payout')
      setBusy(false)
    }
  }

  return (
    <Modal
      title={owes ? `Record cash received from ${line.name}` : `Record payment to ${line.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => save()} disabled={busy}>
            {busy ? 'Saving…' : 'Record'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={save}>
        <p>
          {owes ? (
            <>
              {line.name} owes Foodos <strong>{formatMoney(-line.netPaise)}</strong> (cash collected at the door, less their pay)
            </>
          ) : (
            <>
              Pay {line.name} <strong>{formatMoney(line.netPaise)}</strong>
            </>
          )}{' '}
          for {formatDay(statement.periodStart)} to {formatDay(statement.periodEnd)}.
        </p>
        <p className="muted small">
          Make the transfer first, from the bank or UPI, then record it here with its reference. Foodos does not move the
          money itself. These days cannot be paid again once recorded.
        </p>
        <Field label="Bank / UPI reference (UTR)">
          {(id) => (
            <input id={id} className="input mono" value={reference} maxLength={60} autoFocus onChange={(e) => setReference(e.target.value)} />
          )}
        </Field>
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  )
}

function StatementTable({ statement, onRecord }: { statement: Statement; onRecord: (line: StatementLine) => void }) {
  const restaurants = statement.partyType === 'restaurant'

  if (statement.lines.length === 0) {
    return <Empty title="Nothing delivered in this period" body="Choose another period above." />
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{restaurants ? 'Restaurant' : 'Rider'}</th>
            <th className="num">{restaurants ? 'Orders' : 'Trips'}</th>
            {restaurants ? (
              <>
                <th className="num">Food + packaging</th>
                <th className="num">Commission</th>
              </>
            ) : (
              <>
                <th className="num">Pay + tips</th>
                <th className="num">Cash collected</th>
              </>
            )}
            <th className="num">{restaurants ? 'To pay' : 'Balance'}</th>
            <th>Payout</th>
          </tr>
        </thead>
        <tbody>
          {statement.lines.map((line) => (
            <tr key={line.partyId}>
              <td>
                {line.name}
                <div className="sub">
                  {restaurants && line.contact.name ? `${line.contact.name} · ` : ''}
                  {formatPhone(line.contact.phone)}
                  {line.contact.upi ? ` · UPI ${line.contact.upi}` : ''}
                </div>
              </td>
              <td className="num">{line.count}</td>
              {restaurants ? (
                <>
                  <td className="num">{formatMoney(line.grossPaise)}</td>
                  <td className="num">
                    −{formatMoney(line.commissionPaise)}
                    <div className="sub">{line.breakdown.commissionPct}%</div>
                  </td>
                </>
              ) : (
                <>
                  <td className="num">
                    {formatMoney(line.grossPaise)}
                    {line.breakdown.tipsPaise > 0 && <div className="sub">incl. {formatMoney(line.breakdown.tipsPaise)} tips</div>}
                  </td>
                  <td className="num">−{formatMoney(line.breakdown.cashCollectedPaise)}</td>
                </>
              )}
              <td className="num strong">
                {line.netPaise < 0 ? (
                  <>
                    {formatMoney(-line.netPaise)}
                    <div className="sub">owed to Foodos</div>
                  </>
                ) : (
                  formatMoney(line.netPaise)
                )}
              </td>
              <td>
                {line.payout ? (
                  <>
                    <Badge tone="success">Paid</Badge>
                    <div className="sub mono">{line.payout.reference}</div>
                  </>
                ) : line.overlaps.length ? (
                  <span className="sub">
                    Some days already paid ({line.overlaps.map((p) => `${formatDay(p.periodStart)}–${formatDay(p.periodEnd)}`).join(', ')}).
                    Choose a period that does not overlap.
                  </span>
                ) : statement.canRecord ? (
                  <button className="btn btn-small" onClick={() => onRecord(line)}>
                    Record
                  </button>
                ) : (
                  <span className="sub">Can be paid once the period is over</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Payouts() {
  const toast = useToast()
  const initial = lastWeek()
  const [filters, setFilters] = useFilters({ party: 'restaurant', from: initial.from, to: initial.to })
  const [recording, setRecording] = useState<StatementLine | null>(null)
  const party = filters.party as Party

  const statement = useLoad(
    () =>
      api<Statement>('/api/v1/admin/payouts/statement', {
        query: { party, from: filters.from, to: filters.to },
      }),
    JSON.stringify(filters)
  )
  const history = useLoad(
    async () => (await api<{ payouts: PayoutHistoryRow[] }>('/api/v1/admin/payouts', { query: { party, limit: 20 } })).payouts,
    `history:${party}`
  )

  return (
    <>
      <PageHeader
        title="Payouts"
        subtitle="What Foodos owes each partner for delivered orders, and a record of paying it."
      />

      <Tabs<Party>
        value={party}
        onChange={(next) => setFilters({ party: next })}
        options={[
          { value: 'restaurant', label: 'Restaurants' },
          { value: 'delivery_partner', label: 'Riders' },
        ]}
      />

      <div className="toolbar">
        <label className="inline-field">
          From
          <input className="input" type="date" value={filters.from} max={filters.to} onChange={(e) => setFilters({ from: e.target.value })} />
        </label>
        <label className="inline-field">
          To
          <input className="input" type="date" value={filters.to} min={filters.from} onChange={(e) => setFilters({ to: e.target.value })} />
        </label>
        <div className="presets">
          {PRESETS.map((preset) => (
            <button key={preset.label} className="btn btn-small btn-ghost" onClick={() => setFilters(preset.range())}>
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <Card
        title={`${formatDay(filters.from)} to ${formatDay(filters.to)}`}
        actions={
          statement.data && (
            <span className="muted small">
              Still to pay: <strong>{formatMoney(Math.max(0, statement.data.totals.unpaidNetPaise))}</strong>
            </span>
          )
        }
        flush
      >
        <Loadable state={statement}>
          {(data) => <StatementTable statement={data} onRecord={setRecording} />}
        </Loadable>
      </Card>

      <p className="muted small">
        {party === 'restaurant'
          ? 'Restaurants: food and packaging on delivered orders, less commission on the food at the restaurant’s current rate. The same figure the owner sees under Earnings in the Restaurant app. Orders count on the day they were placed.'
          : 'Riders: base pay, distance pay, incentives and every rupee of tips on delivered trips, less cash collected from customers. A negative balance is cash the rider holds for Foodos. Trips count on the day they were delivered.'}
      </p>

      <Card title="Recorded payouts" flush>
        <Loadable state={history}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="muted pad">None recorded yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{party === 'restaurant' ? 'Restaurant' : 'Rider'}</th>
                      <th>Period</th>
                      <th className="num">Amount</th>
                      <th>Reference</th>
                      <th>Recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.partyName}</td>
                        <td>
                          {formatDay(row.periodStart)} – {formatDay(row.periodEnd)}
                        </td>
                        <td className="num">
                          {row.netPaise < 0 ? `${formatMoney(-row.netPaise)} received` : formatMoney(row.netPaise)}
                        </td>
                        <td className="mono">{row.reference}</td>
                        <td>{formatDateTime(row.paidAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loadable>
      </Card>

      {recording && statement.data && (
        <RecordDialog
          statement={statement.data}
          line={recording}
          onDone={() => {
            toast('Payout recorded')
            statement.reload()
            history.reload()
          }}
          onClose={() => setRecording(null)}
        />
      )}
    </>
  )
}
