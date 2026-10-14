import { Link } from 'react-router-dom'
import { Card, Empty, Loadable, PageHeader, Pagination, Tabs } from '../components/ui'
import { api } from '../lib/api'
import { formatDateTime, formatMoney } from '../lib/format'
import type { Activity as ActivityRow } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { useFilters } from '../lib/useParams'

const LIMIT = 50
const MODULES = ['all', 'Orders', 'Restaurants', 'Riders', 'Customers', 'Offers', 'Payouts', 'Auth'] as const

const LINKS: Record<string, string> = {
  order: '/orders/',
  restaurant: '/restaurants/',
  rider: '/riders/',
  delivery_partner: '/riders/',
  customer: '/customers/',
}

function describe(row: ActivityRow) {
  const details = row.details || {}
  const parts: string[] = []

  for (const key of ['name', 'orderNumber', 'code', 'email', 'phone']) {
    if (details[key]) {
      parts.push(String(details[key]))
      break
    }
  }

  if (details.from && details.to) parts.push(`${details.from} → ${details.to}`)
  if (details.period) parts.push(details.period)
  if (typeof details.netPaise === 'number') parts.push(formatMoney(details.netPaise))
  if (details.reference) parts.push(`ref ${details.reference}`)
  if (Array.isArray(details.fields)) parts.push(`changed ${details.fields.join(', ')}`)
  if (details.result) parts.push(`refund ${details.result}`)

  return parts.join(' · ')
}

export default function Activity() {
  const [filters, setFilters] = useFilters({ module: 'all', offset: '0' })
  const offset = Number(filters.offset) || 0

  const state = useLoad(
    () =>
      api<{ total: number; activity: ActivityRow[] }>('/api/v1/admin/activity', {
        query: { module: filters.module === 'all' ? undefined : filters.module, limit: LIMIT, offset },
      }),
    JSON.stringify(filters)
  )

  return (
    <>
      <PageHeader title="Activity log" subtitle="Every change made in this panel, who made it, and from where." />

      <Tabs
        value={filters.module}
        onChange={(module) => setFilters({ module })}
        options={MODULES.map((module) => ({ value: module, label: module === 'all' ? 'All' : module === 'Auth' ? 'Sign-ins' : module }))}
      />

      <Card flush>
        <Loadable state={state}>
          {(data) =>
            data.activity.length === 0 ? (
              <Empty title="Nothing recorded yet" />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Who</th>
                        <th>What</th>
                        <th>Details</th>
                        <th>Reason</th>
                        <th>IP address</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.activity.map((row) => {
                        const link = row.entityType && row.entityId && LINKS[row.entityType]
                        return (
                          <tr key={row.id}>
                            <td className="nowrap">{formatDateTime(row.at)}</td>
                            <td>{row.actor || <span className="muted">Unknown</span>}</td>
                            <td>
                              {link ? <Link to={`${link}${row.entityId}`}>{row.action}</Link> : row.action}
                            </td>
                            <td className="sub">{describe(row)}</td>
                            <td>{row.details?.reason || ''}</td>
                            <td className="mono small">{row.ip || '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={(next) => setFilters({ offset: String(next) })} />
              </>
            )
          }
        </Loadable>
      </Card>
    </>
  )
}
