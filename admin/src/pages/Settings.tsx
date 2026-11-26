import { useEffect, useState, type FormEvent } from 'react'
import { Card, ErrorBox, Field, Loadable, PageHeader } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { CHARGED_TO, formatDay, formatMoney, indiaToday, WEEKDAY_LONG, WEEKDAY_SHORT } from '../lib/format'
import { useToast } from '../lib/toast'
import type { Holiday, PaymentSettings, RefundChargedTo } from '../lib/types'
import { useLoad } from '../lib/useLoad'

type Group = { days: number[]; payWeekday: number }

type Form = {
  commissionStandardPct: string
  commissionSubscriptionPct: string
  paymentGatewayFeePct: string
  commissionBase: 'before_discount' | 'after_discount'
  gstOnCommissionPct: string
  restaurantTdsPct: string
  riderTdsPct: string
  riderBase: string
  riderBaseKm: string
  riderPerKm: string
  riderOrderIncentive: string
  riderDistanceBasis: 'trip' | 'drop'
  cutoffTime: string
  minPayout: string
  reserve: string
  codEnabled: boolean
  // Empty: the server's own limit.
  cashLimit: string
  riderCashBlock: 'cash_orders' | 'all_orders'
  refundChargedToDefault: RefundChargedTo
  refundPhotoRequired: boolean
  needsShifts: boolean
  shifts: { name: string; start: string; end: string; hours: string }[]
  maxRejections: string
  payoutSchedule: Group[]
}

const DAYS = [1, 2, 3, 4, 5, 6, 7]

const rupees = (paise: number) => String(paise / 100)
const toPaise = (value: string) => Math.round(Number(value) * 100)

function toForm(settings: PaymentSettings): Form {
  return {
    commissionStandardPct: String(settings.commissionStandardPct),
    commissionSubscriptionPct: String(settings.commissionSubscriptionPct),
    paymentGatewayFeePct: String(settings.paymentGatewayFeePct ?? 2),
    commissionBase: settings.commissionBase ?? 'before_discount',
    gstOnCommissionPct: String(settings.gstOnCommissionPct),
    restaurantTdsPct: String(settings.restaurantTdsPct),
    riderTdsPct: String(settings.riderTdsPct ?? 0),
    riderBase: rupees(settings.riderBasePaise),
    riderBaseKm: String(settings.riderBaseKm),
    riderPerKm: rupees(settings.riderPerKmPaise),
    riderOrderIncentive: rupees(settings.riderOrderIncentivePaise),
    riderDistanceBasis: settings.riderDistanceBasis,
    cutoffTime: settings.cutoffTime,
    minPayout: rupees(settings.minPayoutPaise),
    reserve: rupees(settings.reservePaise ?? 1_000_000),
    codEnabled: settings.codEnabled ?? true,
    cashLimit: settings.riderCashLimitPaise == null ? '' : rupees(settings.riderCashLimitPaise),
    riderCashBlock: settings.riderCashBlock ?? 'cash_orders',
    refundChargedToDefault: settings.refundChargedToDefault,
    refundPhotoRequired: settings.refundPhotoRequired ?? true,
    needsShifts: settings.riderIncentiveNeedsShifts ?? false,
    shifts: (settings.riderShifts ?? []).map((shift) => ({
      name: shift.name,
      start: shift.start,
      end: shift.end,
      hours: String(shift.minMinutes / 60),
    })),
    maxRejections: String(settings.riderMaxRejections ?? 1),
    payoutSchedule: settings.payoutSchedule.map((group) => ({ days: [...group.days].sort(), payWeekday: group.payWeekday })),
  }
}

// "Mon, Tue → paid Thursday", or "paid the next Monday" when the pay day comes
// round only in the following week.
export function describeGroup(group: Group) {
  if (group.days.length === 0) return 'No days chosen'
  const days = [...group.days].sort()
  const last = days[days.length - 1]
  const when = group.payWeekday > last ? WEEKDAY_LONG[group.payWeekday] : `the next ${WEEKDAY_LONG[group.payWeekday]}`
  return `${days.map((day) => WEEKDAY_SHORT[day]).join(', ')} → paid ${when}`
}

function scheduleProblem(groups: Group[]): string {
  if (groups.length === 0) return 'Add at least one group'
  if (groups.some((group) => group.days.length === 0)) return 'Every group needs at least one day. Remove empty groups'

  for (const day of DAYS) {
    const count = groups.filter((group) => group.days.includes(day)).length
    if (count === 0) return `${WEEKDAY_LONG[day]} is not in any group`
    if (count > 1) return `${WEEKDAY_LONG[day]} is in more than one group`
  }

  return ''
}

function ScheduleEditor({ groups, onChange }: { groups: Group[]; onChange: (groups: Group[]) => void }) {
  function update(index: number, group: Group) {
    onChange(groups.map((current, i) => (i === index ? group : current)))
  }

  function toggle(index: number, day: number) {
    const group = groups[index]
    const days = group.days.includes(day) ? group.days.filter((d) => d !== day) : [...group.days, day].sort()
    update(index, { ...group, days })
  }

  const problem = scheduleProblem(groups)

  return (
    <div className="stack">
      {groups.map((group, index) => (
        <div key={index} className="schedule-group">
          <div className="row-between">
            <strong>Group {index + 1}</strong>
            {groups.length > 1 && (
              <button type="button" className="btn btn-small btn-ghost" onClick={() => onChange(groups.filter((_, i) => i !== index))}>
                Remove
              </button>
            )}
          </div>
          <p className="field-label">Earnings from these days</p>
          <div className="day-picks" role="group" aria-label={`Days in group ${index + 1}`}>
            {DAYS.map((day) => {
              const elsewhere = groups.some((other, i) => i !== index && other.days.includes(day))
              const on = group.days.includes(day)
              return (
                <label key={day} className={on ? 'day-pick on' : elsewhere ? 'day-pick taken' : 'day-pick'}>
                  <input type="checkbox" checked={on} onChange={() => toggle(index, day)} />
                  {WEEKDAY_SHORT[day]}
                </label>
              )
            })}
          </div>
          <label className="inline-field">
            are paid on
            <select
              className="input"
              value={group.payWeekday}
              onChange={(e) => update(index, { ...group, payWeekday: Number(e.target.value) })}
            >
              {DAYS.map((day) => (
                <option key={day} value={day}>
                  {WEEKDAY_LONG[day]}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">{describeGroup(group)}</p>
        </div>
      ))}
      <div>
        <button type="button" className="btn btn-small" onClick={() => onChange([...groups, { days: [], payWeekday: 1 }])}>
          Add a group
        </button>
      </div>
      {problem ? <p className="field-error">{problem}</p> : <p className="muted small">Every day of the week is covered once.</p>}
    </div>
  )
}

function Holidays({ initial }: { initial: Holiday[] }) {
  const toast = useToast()
  const [holidays, setHolidays] = useState(initial)
  const [day, setDay] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => setHolidays(initial), [initial])

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!day || name.trim().length < 2) {
      setError('Pick a date and give the holiday a name')
      return
    }

    setBusy(true)
    setError('')

    try {
      const result = await api<{ holidays: Holiday[] }>('/api/v1/admin/finance/holidays', {
        method: 'POST',
        body: { day, name: name.trim() },
      })
      setHolidays(result.holidays)
      setDay('')
      setName('')
      toast('Holiday added')
    } catch (caught: any) {
      setError(caught?.message || 'Could not add the holiday')
    } finally {
      setBusy(false)
    }
  }

  async function remove(holiday: Holiday) {
    setError('')
    try {
      const result = await api<{ holidays: Holiday[] }>(`/api/v1/admin/finance/holidays/${holiday.day}`, { method: 'DELETE' })
      setHolidays(result.holidays)
      toast(`${holiday.name} removed`)
    } catch (caught: any) {
      setError(caught?.message || 'Could not remove the holiday')
    }
  }

  const upcoming = holidays.filter((holiday) => holiday.day >= indiaToday())
  const past = holidays.length - upcoming.length

  return (
    <Card title="Bank holidays">
      <p className="muted small">
        A pay day that falls on one of these days, or on a Sunday, moves to the next working day. Saved as soon as you add or
        remove one.
      </p>
      {upcoming.length === 0 ? (
        <p className="muted">No upcoming holidays added.</p>
      ) : (
        <table className="table compact">
          <tbody>
            {upcoming.map((holiday) => (
              <tr key={holiday.day}>
                <td className="nowrap">{formatDay(holiday.day)} {holiday.day.slice(0, 4)}</td>
                <td>{holiday.name}</td>
                <td className="row-actions">
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => remove(holiday)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {past > 0 && <p className="muted small">{past} past holidays are kept for the record.</p>}
      <form className="toolbar" onSubmit={add}>
        <input className="input" type="date" aria-label="Holiday date" min={indiaToday()} value={day} onChange={(e) => setDay(e.target.value)} />
        <input className="input" placeholder="Name, e.g. Pongal" aria-label="Holiday name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-small" disabled={busy}>
          {busy ? 'Adding…' : 'Add holiday'}
        </button>
      </form>
      {error && <ErrorBox error={error} />}
    </Card>
  )
}

function SettingsForm({
  settings,
  serverCashLimitPaise,
  onSaved,
}: {
  settings: PaymentSettings
  serverCashLimitPaise?: number
  onSaved: (settings: PaymentSettings) => void
}) {
  const toast = useToast()
  const [form, setForm] = useState<Form>(() => toForm(settings))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function number(value: string) {
    return value.trim() === '' ? NaN : Number(value)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setError('')
    setFieldErrors({})

    const problem = scheduleProblem(form.payoutSchedule)
    if (problem) {
      setError(`Payout schedule: ${problem}`)
      return
    }

    const body: PaymentSettings = {
      ...settings,
      commissionStandardPct: number(form.commissionStandardPct),
      commissionSubscriptionPct: number(form.commissionSubscriptionPct),
      paymentGatewayFeePct: number(form.paymentGatewayFeePct),
      commissionBase: form.commissionBase,
      gstOnCommissionPct: number(form.gstOnCommissionPct),
      restaurantTdsPct: number(form.restaurantTdsPct),
      riderTdsPct: number(form.riderTdsPct),
      riderBasePaise: toPaise(form.riderBase),
      riderBaseKm: number(form.riderBaseKm),
      riderPerKmPaise: toPaise(form.riderPerKm),
      riderOrderIncentivePaise: toPaise(form.riderOrderIncentive),
      riderDistanceBasis: form.riderDistanceBasis,
      cutoffTime: form.cutoffTime,
      minPayoutPaise: toPaise(form.minPayout),
      reservePaise: toPaise(form.reserve),
      codEnabled: form.codEnabled,
      riderCashLimitPaise: form.cashLimit.trim() === '' ? null : toPaise(form.cashLimit),
      riderCashBlock: form.riderCashBlock,
      refundChargedToDefault: form.refundChargedToDefault,
      refundPhotoRequired: form.refundPhotoRequired,
      riderIncentiveNeedsShifts: form.needsShifts,
      riderShifts: form.shifts.map((shift) => ({
        name: shift.name.trim(),
        start: shift.start,
        end: shift.end,
        minMinutes: Math.round(Number(shift.hours) * 60),
      })),
      riderMaxRejections: number(form.maxRejections),
      payoutSchedule: form.payoutSchedule.map((group) => ({ days: [...group.days].sort(), payWeekday: group.payWeekday })),
    }

    const bad = Object.entries(body).find(([, value]) => typeof value === 'number' && !(Number.isFinite(value) && value >= 0))
    if (bad) {
      setError('Fill in every number. None can be negative')
      return
    }
    if (!/^\d{2}:\d{2}$/.test(body.cutoffTime)) {
      setError('Enter the cutoff time as HH:MM')
      return
    }

    setBusy(true)

    try {
      const result = await api<{ settings: PaymentSettings }>('/api/v1/admin/finance/settings', { method: 'PUT', body })
      onSaved(result.settings)
      setForm(toForm(result.settings))
      toast('Payment settings saved')
    } catch (caught: any) {
      if (caught instanceof ApiError && Object.keys(caught.fields).length) {
        const fields: Record<string, string> = {}
        for (const [key, message] of Object.entries(caught.fields)) {
          fields[key.split('.').slice(-1)[0]] = String(message).replace(/^Value error, /, '')
        }
        setFieldErrors(fields)
      }
      setError(caught?.message || 'Could not save the settings')
    } finally {
      setBusy(false)
    }
  }

  const caNote = 'Confirm with your CA before changing.'

  return (
    <form className="stack form-page" onSubmit={save} noValidate>
      <Card title="Restaurant commission and tax">
        <div className="form-grid two">
          <Field
            label="Foodos commission, standard plan (%)"
            hint="Taken on food + packaging. Restaurants on the standard plan. Changing it updates every standard restaurant."
            error={fieldErrors.commissionStandardPct}
          >
            {(id) => (
              <input id={id} className="input" type="number" min={0} max={100} step={0.5} value={form.commissionStandardPct} onChange={(e) => set('commissionStandardPct', e.target.value)} />
            )}
          </Field>
          <Field
            label="Foodos commission, subscription plan (%)"
            hint="Taken on food + packaging. Restaurants on the subscription plan. Restaurants with a custom rate keep theirs."
            error={fieldErrors.commissionSubscriptionPct}
          >
            {(id) => (
              <input id={id} className="input" type="number" min={0} max={100} step={0.5} value={form.commissionSubscriptionPct} onChange={(e) => set('commissionSubscriptionPct', e.target.value)} />
            )}
          </Field>
          <Field
            label="Payment gateway fee (%)"
            hint="Charged to the restaurant on food + packaging of online-paid orders. Not charged on cash orders."
            error={fieldErrors.paymentGatewayFeePct}
          >
            {(id) => (
              <input id={id} className="input" type="number" min={0} max={100} step={0.1} value={form.paymentGatewayFeePct} onChange={(e) => set('paymentGatewayFeePct', e.target.value)} />
            )}
          </Field>
          <Field
            label="Commission is worked out"
            hint="Pending the client's decision. Only affects orders that use a restaurant-paid coupon."
            error={fieldErrors.commissionBase}
          >
            {(id) => (
              <select id={id} className="input" value={form.commissionBase} onChange={(e) => set('commissionBase', e.target.value as Form['commissionBase'])}>
                <option value="before_discount">Before the restaurant coupon discount</option>
                <option value="after_discount">After the restaurant coupon discount</option>
              </select>
            )}
          </Field>
          <Field
            label="GST on commission (%)"
            hint={`Charged on commission + gateway fee, taken off the restaurant's payout. ${caNote}`}
            error={fieldErrors.gstOnCommissionPct}
          >
            {(id) => (
              <input id={id} className="input" type="number" min={0} max={100} step={0.5} value={form.gstOnCommissionPct} onChange={(e) => set('gstOnCommissionPct', e.target.value)} />
            )}
          </Field>
          <Field
            label="TDS on restaurant sales (%)"
            hint={`Deducted from food + packaging on each order (section 194-O). ${caNote}`}
            error={fieldErrors.restaurantTdsPct}
          >
            {(id) => (
              <input id={id} className="input" type="number" min={0} max={100} step={0.1} value={form.restaurantTdsPct} onChange={(e) => set('restaurantTdsPct', e.target.value)} />
            )}
          </Field>
        </div>
        <p className="muted small">Tax rates apply to orders delivered after you save. {caNote}</p>
      </Card>

      <Card title="Rider pay">
        <div className="form-grid two">
          <Field label="Base pay per trip (₹)" error={fieldErrors.riderBasePaise}>
            {(id) => <input id={id} className="input" inputMode="decimal" value={form.riderBase} onChange={(e) => set('riderBase', e.target.value)} />}
          </Field>
          <Field label="Base pay covers the first (km)" error={fieldErrors.riderBaseKm}>
            {(id) => (
              <input id={id} className="input" type="number" min={0} step={0.5} value={form.riderBaseKm} onChange={(e) => set('riderBaseKm', e.target.value)} />
            )}
          </Field>
          <Field label="Pay per km after that (₹)" error={fieldErrors.riderPerKmPaise}>
            {(id) => <input id={id} className="input" inputMode="decimal" value={form.riderPerKm} onChange={(e) => set('riderPerKm', e.target.value)} />}
          </Field>
          <Field label="Incentive per delivered order (₹)" error={fieldErrors.riderOrderIncentivePaise}>
            {(id) => (
              <input id={id} className="input" inputMode="decimal" value={form.riderOrderIncentive} onChange={(e) => set('riderOrderIncentive', e.target.value)} />
            )}
          </Field>
          <Field
            label="TDS on riders (%)"
            hint="Deducted from base pay, distance pay and incentives. Not charged on tips. Confirm with your CA."
            error={fieldErrors.riderTdsPct}
          >
            {(id) => (
              <input id={id} className="input" type="number" min={0} max={100} step={0.1} value={form.riderTdsPct} onChange={(e) => set('riderTdsPct', e.target.value)} />
            )}
          </Field>
          <Field label="Distance counted" error={fieldErrors.riderDistanceBasis}>
            {(id) => (
              <select id={id} className="input" value={form.riderDistanceBasis} onChange={(e) => set('riderDistanceBasis', e.target.value as Form['riderDistanceBasis'])}>
                <option value="drop">Restaurant to customer only (client's rule)</option>
                <option value="trip">Whole trip: rider to restaurant, then to the customer</option>
              </select>
            )}
          </Field>
        </div>
        <p className="muted small">
          Example: a {form.riderBaseKm || 0} km + 2 km trip pays{' '}
          {formatMoney(toPaise(form.riderBase || '0') + Math.round((2 * toPaise(form.riderPerKm || '0')) / 100) * 100)} +{' '}
          {formatMoney(toPaise(form.riderOrderIncentive || '0'))} incentive, plus any tip. Applies to trips accepted after you save.
        </p>
      </Card>

      <Card title="Shift rule for the delivery incentive">
        <label className="check-row">
          <input type="checkbox" checked={form.needsShifts} onChange={(e) => set('needsShifts', e.target.checked)} />
          <span>Pay the per-order incentive only to riders who meet the shift hours</span>
        </label>
        <p className="muted small">
          Off: the incentive above is paid on every delivered order. On: it is paid after the day ends, for all of that day's
          orders, only if the rider was online long enough in <strong>every</strong> shift. Confirm with the client first.
        </p>
        {form.shifts.map((shift, index) => (
          <div key={index} className="toolbar">
            <strong>{shift.name}</strong>
            <label className="inline-field">
              from
              <input className="input" type="time" value={shift.start} onChange={(e) => set('shifts', form.shifts.map((s, i) => (i === index ? { ...s, start: e.target.value } : s)))} />
            </label>
            <label className="inline-field">
              to
              <input className="input" type="time" value={shift.end} onChange={(e) => set('shifts', form.shifts.map((s, i) => (i === index ? { ...s, end: e.target.value } : s)))} />
            </label>
            <label className="inline-field">
              hours online needed
              <input className="input" type="number" min={0.25} max={24} step={0.25} value={shift.hours} onChange={(e) => set('shifts', form.shifts.map((s, i) => (i === index ? { ...s, hours: e.target.value } : s)))} />
            </label>
          </div>
        ))}
        <div className="form-grid two">
          <Field label="Orders a rider may turn down in a day" error={fieldErrors.riderMaxRejections}>
            {(id) => <input id={id} className="input" type="number" min={0} step={1} value={form.maxRejections} onChange={(e) => set('maxRejections', e.target.value)} />}
          </Field>
        </div>
      </Card>

      <Card title="Cash on delivery and floating cash">
        <label className="check-row">
          <input type="checkbox" checked={form.codEnabled} onChange={(e) => set('codEnabled', e.target.checked)} />
          <span>Customers can pay cash on delivery</span>
        </label>
        <p className="muted small">
          Turn this off at launch. Orders already placed are not affected.
        </p>
        <div className="form-grid two">
          <Field
            label="Most cash a rider may hold (₹)"
            hint={`0 means no limit. Leave empty to use the server's limit${
              serverCashLimitPaise == null ? '' : ` (${formatMoney(serverCashLimitPaise, { whole: true })})`
            }.`}
            error={fieldErrors.riderCashLimitPaise}
          >
            {(id) => <input id={id} className="input" inputMode="decimal" value={form.cashLimit} onChange={(e) => set('cashLimit', e.target.value)} />}
          </Field>
          <Field label="At the limit the rider gets" hint="Riders clear it with Deposit now in their app, or by handing cash to staff.">
            {(id) => (
              <select id={id} className="input" value={form.riderCashBlock} onChange={(e) => set('riderCashBlock', e.target.value as Form['riderCashBlock'])}>
                <option value="cash_orders">Prepaid orders only</option>
                <option value="all_orders">No new orders</option>
              </select>
            )}
          </Field>
        </div>
      </Card>

      <Card title="Payout schedule">
        <p className="muted small">
          Earnings are grouped by the day they were made. Each group is paid on its pay day by Foodos staff, who send the money
          from the bank and mark the payout paid here.
        </p>
        <ScheduleEditor groups={form.payoutSchedule} onChange={(groups) => set('payoutSchedule', groups)} />
      </Card>

      <Card title="Payout rules">
        <div className="form-grid two">
          <Field
            label="Business day starts at"
            hint="India time. The client's day runs 5:30 AM to 5:29 AM, so set 05:30."
            error={fieldErrors.cutoffTime}
          >
            {(id) => <input id={id} className="input" type="time" value={form.cutoffTime} onChange={(e) => set('cutoffTime', e.target.value)} />}
          </Field>
          <Field
            label="Minimum payout (₹)"
            hint="Smaller amounts are carried into the next payout."
            error={fieldErrors.minPayoutPaise}
          >
            {(id) => <input id={id} className="input" inputMode="decimal" value={form.minPayout} onChange={(e) => set('minPayout', e.target.value)} />}
          </Field>
          <Field
            label="Always keep in the bank (₹)"
            hint="Bank files never use this part of the balance."
            error={fieldErrors.reservePaise}
          >
            {(id) => <input id={id} className="input" inputMode="decimal" value={form.reserve} onChange={(e) => set('reserve', e.target.value)} />}
          </Field>
          <Field
            label="Partial refunds are charged to"
            hint="Pre-selected when refunding part of an order. You can change it on each refund."
            error={fieldErrors.refundChargedToDefault}
          >
            {(id) => (
              <select id={id} className="input" value={form.refundChargedToDefault} onChange={(e) => set('refundChargedToDefault', e.target.value as RefundChargedTo)}>
                {Object.entries(CHARGED_TO).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={form.refundPhotoRequired} onChange={(e) => set('refundPhotoRequired', e.target.checked)} />
          <span>A refund taken off a restaurant's or rider's pay needs a photo</span>
        </label>
      </Card>

      {error && <ErrorBox error={error} />}

      <div className="form-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => setForm(toForm(settings))}>
          Undo changes
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  )
}

export default function Settings() {
  const state = useLoad(
    () => api<{ settings: PaymentSettings; holidays: Holiday[]; serverCashLimitPaise?: number }>('/api/v1/admin/finance/settings'),
    'payment-settings'
  )

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Commission, rider pay and when partners are paid. Every change is kept in the activity log."
      />
      <Loadable state={state}>
        {(data) => (
          <div className="stack">
            <SettingsForm settings={data.settings} serverCashLimitPaise={data.serverCashLimitPaise} onSaved={(settings) => state.setData({ ...data, settings })} />
            <Holidays initial={data.holidays} />
          </div>
        )}
      </Loadable>
    </>
  )
}
