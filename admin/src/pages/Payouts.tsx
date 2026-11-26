import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Badge,
  Card,
  ConfirmDialog,
  Empty,
  ErrorBox,
  Field,
  Loadable,
  Modal,
  PageHeader,
  Pagination,
  SearchBox,
  Stat,
  StatusBadge,
  Tabs,
} from '../components/ui'
import { api, apiDownload } from '../lib/api'
import {
  addDays,
  formatDate,
  formatDay,
  formatMoney,
  formatPayDay,
  formatPhone,
  formatSigned,
  indiaToday,
  PARTY_LABEL,
  PAYOUT_STATUS,
  plural,
} from '../lib/format'
import { useToast } from '../lib/toast'
import type { FinanceOverview, PartyType, PayoutRow, RestaurantRow, RiderRow, Unpaid, UnpaidParty } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { useFilters } from '../lib/useParams'

const LIMIT = 50

type Status = 'scheduled' | 'on_hold' | 'failed' | 'paid' | 'cancelled' | 'all'

const PRESETS = [
  { label: 'Last 7 days', range: () => ({ from: indiaToday(-7), to: indiaToday() }) },
  { label: 'Last 30 days', range: () => ({ from: indiaToday(-30), to: indiaToday() }) },
  { label: 'This month', range: () => ({ from: `${indiaToday().slice(0, 7)}-01`, to: indiaToday() }) },
  {
    label: 'Last month',
    range: () => {
      const lastOfPrevious = addDays(`${indiaToday().slice(0, 7)}-01`, -1)
      return { from: `${lastOfPrevious.slice(0, 7)}-01`, to: lastOfPrevious }
    },
  },
]

const REPORTS = [
  { kind: 'collections', label: 'Collections', hint: 'Every delivered order: how the customer paid, and refunds.' },
  { kind: 'payouts', label: 'Payouts', hint: 'Payouts with their status, pay date and bank reference.' },
  { kind: 'ledger', label: 'Ledger', hint: 'Every earning, refund, cash and adjustment line per partner.' },
  { kind: 'commission', label: 'Commission', hint: 'Foodos commission and GST on it, per restaurant.' },
]

export function partyLink(partyType: PartyType, partyId: string) {
  return partyType === 'restaurant' ? `/restaurants/${partyId}` : `/riders/${partyId}`
}

// "Due today" or "Overdue" beside a scheduled payout whose day has come.
export function DueBadge({ payout }: { payout: Pick<PayoutRow, 'status' | 'scheduledFor'> }) {
  if (!payout.scheduledFor || !['scheduled', 'on_hold', 'failed'].includes(payout.status)) return null
  const today = indiaToday()
  if (payout.scheduledFor === today) return <Badge tone="warning">Due today</Badge>
  if (payout.scheduledFor < today) return <Badge tone="danger">Overdue</Badge>
  return null
}

function Overview({ data }: { data: FinanceOverview }) {
  const { collections, commission, payable, payouts } = data

  return (
    <div className="stack">
      <h3 className="subhead">Paid by customers</h3>
      <div className="stats">
        <Stat label="Online (Razorpay)" value={formatMoney(collections.onlinePaise, { whole: true })} />
        <Stat label="Foodos wallet" value={formatMoney(collections.walletPaise, { whole: true })} />
        <Stat label="Cash at the door" value={formatMoney(collections.cashPaise, { whole: true })} />
        <Stat
          label="Refunded"
          value={formatMoney(collections.refundsPaise, { whole: true })}
          hint={`of ${formatMoney(collections.totalPaise, { whole: true })} collected`}
        />
      </div>

      <h3 className="subhead">Foodos revenue</h3>
      <div className="stats stats-3">
        <Stat label="Commission" value={formatMoney(commission.commissionPaise, { whole: true })} />
        <Stat label="GST on commission" value={formatMoney(commission.gstOnCommissionPaise, { whole: true })} />
        <Stat label="Delivery fees" value={formatMoney(commission.deliveryFeesPaise, { whole: true })} />
      </div>

      <h3 className="subhead">Not paid yet (as of now)</h3>
      <div className="stats stats-3">
        <Stat label="Owed to restaurants" value={formatMoney(payable.restaurantsPaise, { whole: true })} />
        <Stat label="Owed to riders" value={formatMoney(payable.ridersPaise, { whole: true })} />
        <Stat
          label="Riders owe Foodos"
          value={formatMoney(payable.riderOwesPaise, { whole: true })}
          hint="Cash collected at the door, not handed over"
          tone={payable.riderOwesPaise > 0 ? 'warning' : undefined}
        />
      </div>

      <h3 className="subhead">Payouts</h3>
      <div className="stats">
        <Stat
          label="Due today"
          value={payouts.dueToday.count}
          hint={formatMoney(payouts.dueToday.netPaise, { whole: true })}
          tone={payouts.dueToday.count > 0 ? 'warning' : undefined}
          to="/payouts?status=scheduled"
        />
        <Stat label="Scheduled" value={payouts.scheduled.count} hint={formatMoney(payouts.scheduled.netPaise, { whole: true })} to="/payouts?status=scheduled" />
        <Stat
          label="On hold"
          value={payouts.onHold.count}
          hint={formatMoney(payouts.onHold.netPaise, { whole: true })}
          tone={payouts.onHold.count > 0 ? 'warning' : undefined}
          to="/payouts?status=on_hold"
        />
        <Stat
          label="Failed"
          value={payouts.failed.count}
          hint={formatMoney(payouts.failed.netPaise, { whole: true })}
          tone={payouts.failed.count > 0 ? 'danger' : undefined}
          to="/payouts?status=failed"
        />
      </div>
      <p className="muted small">
        Paid in this period: {plural(payouts.paid.count, 'payout')}, {formatMoney(payouts.paid.netPaise)}.
      </p>

      {data.nextPayDates.length > 0 && (
        <>
          <h3 className="subhead">Next pay days</h3>
          <table className="table compact">
            <tbody>
              {data.nextPayDates.map((day) => (
                <tr key={day.date}>
                  <td>{formatPayDay(day.date)}</td>
                  <td>{plural(day.count, 'payout')}</td>
                  <td className="num">{formatMoney(day.netPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function PayoutsTable({ payouts }: { payouts: PayoutRow[] }) {
  const navigate = useNavigate()

  return (
    <div className="table-wrap">
      <table className="table clickable stack-on-phone">
        <thead>
          <tr>
            <th>Partner</th>
            <th>Earnings from</th>
            <th>Pay date</th>
            <th className="num">Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {payouts.map((payout) => (
            <tr key={payout.id} onClick={() => navigate(`/payouts/${payout.id}`)}>
              <td data-label="Partner">
                <Link to={`/payouts/${payout.id}`} onClick={(e) => e.stopPropagation()}>
                  {payout.partyName || 'No name'}
                </Link>
                <div className="sub">
                  {PARTY_LABEL[payout.partyType]} · {formatPhone(payout.contact?.phone)}
                </div>
              </td>
              <td data-label="Earnings from">
                {formatDay(payout.periodStart)} – {formatDay(payout.periodEnd)}
                <div className="sub">{plural(payout.entryCount, 'entry', 'entries')}</div>
              </td>
              <td data-label="Pay date">
                {payout.status === 'paid' && payout.paidAt ? (
                  <>
                    Paid {formatDate(payout.paidAt)}
                    {payout.reference && <div className="sub mono">{payout.reference}</div>}
                  </>
                ) : (
                  <>
                    {formatPayDay(payout.scheduledFor)} <DueBadge payout={payout} />
                  </>
                )}
              </td>
              <td data-label="Amount" className="num strong">
                {formatSigned(payout.netPaise)}
              </td>
              <td data-label="Status">
                <StatusBadge map={PAYOUT_STATUS} value={payout.status} />{' '}
                {!payout.bank?.verified && payout.status !== 'paid' && payout.status !== 'cancelled' && (
                  <Badge tone="warning">{payout.bank?.summary ? 'Bank not verified' : 'No bank details'}</Badge>
                )}
                {payout.holdReason && payout.status === 'on_hold' && <div className="sub">{payout.holdReason}</div>}
                {payout.failureReason && payout.status === 'failed' && <div className="sub">{payout.failureReason}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Picks a restaurant or a rider by name or phone, for an adjustment.
function PartyPicker({
  partyType,
  value,
  onChange,
}: {
  partyType: PartyType
  value: { id: string; name: string } | null
  onChange: (party: { id: string; name: string } | null) => void
}) {
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<{ id: string; name: string; sub: string }[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (value || search.trim().length < 2) {
      setOptions([])
      return
    }

    let stale = false
    const timer = window.setTimeout(async () => {
      try {
        if (partyType === 'restaurant') {
          const data = await api<{ restaurants: RestaurantRow[] }>('/api/v1/admin/restaurants', { query: { search, limit: 10 } })
          if (!stale) setOptions(data.restaurants.map((r) => ({ id: r.id, name: r.name, sub: `${r.area || r.city} · ${formatPhone(r.owner.phone)}` })))
        } else {
          const data = await api<{ riders: RiderRow[] }>('/api/v1/admin/riders', { query: { search, limit: 10 } })
          if (!stale) setOptions(data.riders.map((r) => ({ id: r.id, name: r.name || 'No name', sub: `${r.city || ''} · ${formatPhone(r.phone)}` })))
        }
        if (!stale) setError('')
      } catch (caught: any) {
        if (!stale) setError(caught?.message || 'Could not search')
      }
    }, 300)

    return () => {
      stale = true
      window.clearTimeout(timer)
    }
  }, [partyType, search, value])

  if (value) {
    return (
      <div className="row-gap">
        <strong>{value.name}</strong>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    )
  }

  return (
    <div className="stack-sm">
      <input
        className="input"
        type="search"
        placeholder={partyType === 'restaurant' ? 'Restaurant name or owner phone' : 'Rider name or phone'}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {options.map((option) => (
        <button key={option.id} type="button" className="btn btn-small btn-ghost" onClick={() => onChange({ id: option.id, name: option.name })}>
          {option.name} <span className="sub">{option.sub}</span>
        </button>
      ))}
      {error && <ErrorBox error={error} />}
    </div>
  )
}

function AdjustmentDialog({
  initial,
  onDone,
  onClose,
}: {
  initial: UnpaidParty | null
  onDone: () => void
  onClose: () => void
}) {
  const [partyType, setPartyType] = useState<PartyType>(initial?.partyType || 'restaurant')
  const [party, setParty] = useState<{ id: string; name: string } | null>(
    initial ? { id: initial.partyId, name: initial.partyName || 'No name' } : null
  )
  const [direction, setDirection] = useState<'add' | 'deduct'>('add')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event?: FormEvent) {
    event?.preventDefault()
    const paise = Math.round(Number(amount) * 100)

    if (!party) return setError(`Choose the ${partyType === 'restaurant' ? 'restaurant' : 'rider'}`)
    if (!(paise > 0)) return setError('Enter the amount in rupees')
    if (paise > 1_000_000) return setError('An adjustment can be at most ₹10,000')
    if (note.trim().length < 5) return setError('Write a note saying why (at least 5 characters)')

    setBusy(true)
    setError('')

    try {
      await api('/api/v1/admin/finance/adjustments', {
        method: 'POST',
        body: { partyType, partyId: party.id, amountPaise: direction === 'add' ? paise : -paise, note: note.trim() },
      })
      onDone()
      onClose()
    } catch (caught: any) {
      setError(caught?.message || 'Could not add the adjustment')
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add an adjustment"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => save()} disabled={busy}>
            {busy ? 'Saving…' : 'Add adjustment'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={save}>
        <p className="muted small">
          An extra line in the partner's next payout: money Foodos owes them (a missed payment, a goodwill bonus) or money taken
          back (a penalty, an overpayment). The partner sees the note in their app.
        </p>
        {!initial && (
          <Field label="Partner type">
            {(id) => (
              <select
                id={id}
                className="input"
                value={partyType}
                onChange={(e) => {
                  setPartyType(e.target.value as PartyType)
                  setParty(null)
                }}
              >
                <option value="restaurant">Restaurant</option>
                <option value="delivery_partner">Rider</option>
              </select>
            )}
          </Field>
        )}
        <Field label={partyType === 'restaurant' ? 'Restaurant' : 'Rider'}>
          {() => <PartyPicker partyType={partyType} value={party} onChange={setParty} />}
        </Field>
        <div className="form-grid two">
          <Field label="Type">
            {(id) => (
              <select id={id} className="input" value={direction} onChange={(e) => setDirection(e.target.value as 'add' | 'deduct')}>
                <option value="add">Add to their pay (+)</option>
                <option value="deduct">Take off their pay (−)</option>
              </select>
            )}
          </Field>
          <Field label="Amount (₹)">
            {(id) => <input id={id} className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
        </div>
        <Field label="Note">
          {(id) => <textarea id={id} className="input" rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  )
}

function UnpaidCard({ party, refreshKey, onChanged }: { party: string; refreshKey: number; onChanged: () => void }) {
  const toast = useToast()
  const [adjusting, setAdjusting] = useState<UnpaidParty | 'new' | null>(null)
  const [including, setIncluding] = useState(false)

  const state = useLoad(
    () => api<Unpaid>('/api/v1/admin/finance/unpaid', { query: { party: party || undefined } }),
    `unpaid:${party}:${refreshKey}`
  )

  async function include() {
    const { included } = await api<{ included: number }>('/api/v1/admin/finance/include-excluded', {
      method: 'POST',
      body: {},
    })
    toast(`${plural(included, 'entry', 'entries')} will go into the next payouts`)
    state.reload()
    onChanged()
  }

  return (
    <Card
      title="Not in a payout yet"
      actions={
        <button className="btn btn-small" onClick={() => setAdjusting('new')}>
          Add adjustment
        </button>
      }
      flush
    >
      <Loadable state={state}>
        {(data) => (
          <>
            {data.excluded.count > 0 && (
              <div className="pad">
                <div className="notice notice-warning notice-row">
                  <span>
                    <strong>
                      {plural(data.excluded.count, 'entry', 'entries')} worth {formatMoney(data.excluded.amountPaise)}
                    </strong>{' '}
                    are from before automatic payouts started and were not covered by a recorded payout. They are left out
                    unless you include them.
                  </span>
                  <button className="btn btn-small" onClick={() => setIncluding(true)}>
                    Include
                  </button>
                </div>
              </div>
            )}
            {data.parties.length === 0 ? (
              <Empty title="Nothing waiting" body="Every earning so far is in a payout." />
            ) : (
              <div className="table-wrap">
                <table className="table stack-on-phone">
                  <thead>
                    <tr>
                      <th>Partner</th>
                      <th>Since</th>
                      <th className="num">Due</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.parties.map((row) => (
                      <tr key={`${row.partyType}:${row.partyId}`}>
                        <td data-label="Partner">
                          <Link to={partyLink(row.partyType, row.partyId)}>{row.partyName || 'No name'}</Link>
                          <div className="sub">
                            {PARTY_LABEL[row.partyType]} · {plural(row.entryCount, 'entry', 'entries')}
                          </div>
                        </td>
                        <td data-label="Since">{row.oldestDate ? formatDay(row.oldestDate) : '—'}</td>
                        <td data-label="Due" className="num strong">
                          {formatSigned(row.duePaise)}
                          {row.belowMinimum && (
                            <div className="sub">{row.duePaise < 0 ? 'Owes Foodos, carried forward' : 'Below minimum, carried forward'}</div>
                          )}
                        </td>
                        <td className="row-actions" data-label="">
                          <button className="btn btn-small btn-ghost" onClick={() => setAdjusting(row)}>
                            Adjust
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small pad">
              Earnings join a payout once their schedule group is over. Amounts below the minimum payout wait for the next one.
            </p>
          </>
        )}
      </Loadable>

      {adjusting && (
        <AdjustmentDialog
          initial={adjusting === 'new' ? null : adjusting}
          onDone={() => {
            toast('Adjustment added. It goes into their next payout')
            state.reload()
            onChanged()
          }}
          onClose={() => setAdjusting(null)}
        />
      )}

      {including && state.data && (
        <ConfirmDialog
          title="Include older earnings?"
          body={
            <p>
              {plural(state.data.excluded.count, 'entry', 'entries')} worth {formatMoney(state.data.excluded.amountPaise)} will
              go into the next payouts. Only do this if these partners were not already paid for those days outside Foodos
              Admin, or they will be paid twice.
            </p>
          }
          confirmLabel="Include"
          onConfirm={include}
          onClose={() => setIncluding(false)}
        />
      )}
    </Card>
  )
}

function Reports({ from, to }: { from: string; to: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState('')

  async function download(kind: string) {
    setBusy(kind)
    try {
      await apiDownload(`/api/v1/admin/finance/reports/${kind}.csv`, { dateFrom: from, dateTo: to }, `foodos-${kind}-${from}-to-${to}.csv`)
    } catch (caught: any) {
      toast(caught?.message || 'Could not download the report', 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <Card title={`Reports, ${formatDay(from)} to ${formatDay(to)}`}>
      <p className="muted small">CSV files that open in Excel or Google Sheets. Use the dates at the top of the page.</p>
      <ul className="plain-list">
        {REPORTS.map((report) => (
          <li key={report.kind} className="row-between">
            <span>
              <strong>{report.label}</strong>
              <div className="sub">{report.hint}</div>
            </span>
            <button className="btn btn-small" disabled={!!busy} onClick={() => download(report.kind)}>
              {busy === report.kind ? 'Downloading…' : 'Download CSV'}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default function Payouts() {
  const toast = useToast()
  const [filters, setFilters] = useFilters({
    from: indiaToday(-30),
    to: indiaToday(),
    status: 'scheduled',
    party: '',
    search: '',
    offset: '0',
  })
  const offset = Number(filters.offset) || 0
  const [running, setRunning] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const overview = useLoad(
    () => api<FinanceOverview>('/api/v1/admin/finance/overview', { query: { dateFrom: filters.from, dateTo: filters.to } }),
    `overview:${filters.from}:${filters.to}:${refreshKey}`
  )

  const list = useLoad(
    () =>
      api<{ total: number; counts: Record<string, number>; payouts: PayoutRow[] }>('/api/v1/admin/finance/payouts', {
        query: {
          status: filters.status,
          party: filters.party || undefined,
          search: filters.search,
          limit: LIMIT,
          offset,
        },
      }),
    `list:${filters.status}:${filters.party}:${filters.search}:${offset}:${refreshKey}`,
    60_000
  )

  async function runNow() {
    setRunning(true)
    try {
      const { created } = await api<{ created: number }>('/api/v1/admin/finance/run', { method: 'POST' })
      toast(created > 0 ? `${plural(created, 'new payout')} scheduled` : 'Checked. No new payouts are due yet')
      setRefreshKey((key) => key + 1)
    } catch (caught: any) {
      toast(caught?.message || 'Could not run the payout check', 'error')
    } finally {
      setRunning(false)
    }
  }

  const counts = list.data?.counts

  return (
    <>
      <PageHeader
        title="Payouts"
        subtitle="Money collected, what Foodos owes restaurants and riders, and their payouts. Staff send each payout from the bank and mark it paid here with the reference."
        actions={
          <>
            <Link className="btn" to="/settings">
              Payment settings
            </Link>
            <button className="btn btn-primary" disabled={running} onClick={runNow}>
              {running ? 'Checking…' : 'Run now'}
            </button>
          </>
        }
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

      <Card title={`${formatDay(filters.from)} to ${formatDay(filters.to)}`}>
        <Loadable state={overview}>{(data) => <Overview data={data} />}</Loadable>
      </Card>

      <h2 className="section-title">Payouts</h2>

      <Tabs<Status>
        value={filters.status as Status}
        onChange={(status) => setFilters({ status })}
        options={[
          { value: 'scheduled', label: counts?.dueToday ? `Scheduled (${counts.dueToday} due today)` : 'Scheduled', count: counts?.scheduled },
          { value: 'on_hold', label: 'On hold', count: counts?.on_hold, alert: true },
          { value: 'failed', label: 'Failed', count: counts?.failed, alert: true },
          { value: 'paid', label: 'Paid', count: counts?.paid },
          { value: 'cancelled', label: 'Cancelled', count: counts?.cancelled },
          { value: 'all', label: 'All' },
        ]}
      />

      <div className="toolbar">
        <select className="input" aria-label="Partner type" value={filters.party} onChange={(e) => setFilters({ party: e.target.value })}>
          <option value="">Restaurants and riders</option>
          <option value="restaurant">Restaurants</option>
          <option value="delivery_partner">Riders</option>
        </select>
        <SearchBox value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Name or phone" />
      </div>

      <Card flush>
        <Loadable state={list}>
          {(data) =>
            data.payouts.length === 0 ? (
              <Empty
                title="No payouts here"
                body={filters.status === 'scheduled' ? 'Payouts are created when a schedule group is over. Use Run now to check.' : undefined}
              />
            ) : (
              <>
                <PayoutsTable payouts={data.payouts} />
                <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={(next) => setFilters({ offset: String(next) })} />
              </>
            )
          }
        </Loadable>
      </Card>

      <UnpaidCard party={filters.party} refreshKey={refreshKey} onChanged={() => overview.reload()} />

      <Reports from={filters.from} to={filters.to} />
    </>
  )
}
