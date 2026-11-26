// The finance reports, as CSV, Excel or PDF, for the dates at the top of the
// page and optionally one restaurant or one rider.

import { useState } from 'react'
import { api, apiDownload } from '../lib/api'
import { formatDay } from '../lib/format'
import { useToast } from '../lib/toast'
import type { RestaurantRow, RiderRow } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { Card } from './ui'

type Narrow = 'restaurant' | 'rider'

const REPORTS: { kind: string; label: string; hint: string; narrow: Narrow[] }[] = [
  { kind: 'collections', label: 'Daily collections', hint: 'Each day: online, wallet and cash on delivery, fees, tips and refunds.', narrow: ['restaurant', 'rider'] },
  { kind: 'commission', label: 'Commission and subscription', hint: 'Per restaurant: plan, commission, gateway fee, GST and TDS. The monthly fee is not charged yet.', narrow: ['restaurant'] },
  { kind: 'payouts', label: 'Payouts', hint: 'Each payout with its deductions, status and bank reference (UTR).', narrow: ['restaurant', 'rider'] },
  { kind: 'refunds', label: 'Refunds and adjustments', hint: 'Every refund and adjustment, and who paid for it.', narrow: ['restaurant', 'rider'] },
  { kind: 'tax', label: 'GST and TDS summary', hint: 'Per restaurant and rider, for the accountant.', narrow: ['restaurant', 'rider'] },
  { kind: 'riders', label: 'Rider cash and incentives', hint: 'Cash collected and handed over, incentives and tips.', narrow: ['rider'] },
  { kind: 'ledger', label: 'Ledger', hint: 'Every earnings line per partner.', narrow: ['restaurant', 'rider'] },
  { kind: 'tds', label: 'Rider TDS', hint: 'Per rider. Use a financial-year date range for the annual summary.', narrow: ['rider'] },
]

const FORMATS = [
  { format: 'csv', label: 'CSV' },
  { format: 'xlsx', label: 'Excel' },
  { format: 'pdf', label: 'PDF' },
]

export default function Reports({ from, to }: { from: string; to: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const [restaurantId, setRestaurantId] = useState('')
  const [riderId, setRiderId] = useState('')
  // The first hundred of each: enough to choose from for now.
  const parties = useLoad(async () => {
    const [restaurants, riders] = await Promise.all([
      api<{ restaurants: RestaurantRow[] }>('/api/v1/admin/restaurants', { query: { limit: 100 } }),
      api<{ riders: RiderRow[] }>('/api/v1/admin/riders', { query: { limit: 100 } }),
    ])
    return { restaurants: restaurants.restaurants, riders: riders.riders }
  }, 'report-parties')

  async function download(kind: string, format: string) {
    setBusy(`${kind}.${format}`)
    try {
      await apiDownload(
        `/api/v1/admin/finance/reports/${kind}.${format}`,
        { dateFrom: from, dateTo: to, restaurantId, riderId },
        `foodos-${kind}-${from}-to-${to}.${format}`
      )
    } catch (caught: any) {
      toast(caught?.message || 'Could not download the report', 'error')
    } finally {
      setBusy('')
    }
  }

  // With one chosen, only the reports that can be narrowed that way are offered.
  const chosen: Narrow | null = restaurantId ? 'restaurant' : riderId ? 'rider' : null
  const shown = chosen ? REPORTS.filter((report) => report.narrow.includes(chosen)) : REPORTS

  return (
    <Card title={`Reports, ${formatDay(from)} to ${formatDay(to)}`}>
      <p className="muted small">Use the dates at the top of the page. You can also pick one restaurant or one rider.</p>
      <div className="toolbar">
        <select
          className="input"
          aria-label="Restaurant for reports"
          value={restaurantId}
          onChange={(e) => {
            setRestaurantId(e.target.value)
            setRiderId('')
          }}
        >
          <option value="">All restaurants</option>
          {parties.data?.restaurants.map((restaurant) => (
            <option key={restaurant.id} value={restaurant.id}>
              {restaurant.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Rider for reports"
          value={riderId}
          onChange={(e) => {
            setRiderId(e.target.value)
            setRestaurantId('')
          }}
        >
          <option value="">All riders</option>
          {parties.data?.riders.map((rider) => (
            <option key={rider.id} value={rider.id}>
              {rider.name || rider.phone}
            </option>
          ))}
        </select>
      </div>
      <ul className="plain-list">
        {shown.map((report) => (
          <li key={report.kind} className="row-between">
            <span>
              <strong>{report.label}</strong>
              <div className="sub">{report.hint}</div>
            </span>
            <span className="row-gap">
              {FORMATS.map(({ format, label }) => (
                <button
                  key={format}
                  className="btn btn-small"
                  disabled={!!busy}
                  aria-label={`${report.label} as ${label}`}
                  onClick={() => download(report.kind, format)}
                >
                  {busy === `${report.kind}.${format}` ? '…' : label}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
