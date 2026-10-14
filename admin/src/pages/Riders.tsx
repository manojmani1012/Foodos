import { Link, useNavigate } from 'react-router-dom'
import { Badge, Card, Empty, Loadable, PageHeader, Pagination, SearchBox, StatusBadge, Tabs } from '../components/ui'
import { api } from '../lib/api'
import { formatDate, formatPhone, PARTNER_STATUS, timeAgo, VEHICLE } from '../lib/format'
import type { Counts, RiderRow } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { useFilters } from '../lib/useParams'

const LIMIT = 50

type Status = 'all' | 'online' | 'pending' | 'active' | 'suspended' | 'rejected'

export default function Riders() {
  const navigate = useNavigate()
  const [filters, setFilters] = useFilters({ status: 'all', search: '', offset: '0' })
  const offset = Number(filters.offset) || 0
  const online = filters.status === 'online'

  const state = useLoad(
    () =>
      api<{ total: number; counts: Counts; riders: RiderRow[] }>('/api/v1/admin/riders', {
        query: {
          status: filters.status === 'all' || online ? undefined : filters.status,
          online: online ? true : undefined,
          search: filters.search,
          limit: LIMIT,
          offset,
        },
      }),
    JSON.stringify(filters),
    online ? 20_000 : undefined
  )

  const counts = state.data?.counts

  return (
    <>
      <PageHeader
        title="Riders"
        subtitle="Riders sign up in the Foodos Delivery app and wait here until approved."
      />

      <Tabs<Status>
        value={filters.status as Status}
        onChange={(status) => setFilters({ status })}
        options={[
          { value: 'all', label: 'All', count: counts?.all },
          { value: 'pending', label: 'To approve', count: counts?.pending, alert: true },
          { value: 'online', label: 'Online now' },
          { value: 'active', label: 'Active', count: counts?.active },
          { value: 'suspended', label: 'Suspended', count: counts?.suspended },
          { value: 'rejected', label: 'Rejected', count: counts?.rejected },
        ]}
      />

      <div className="toolbar">
        <SearchBox value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Name, phone, city or vehicle number" />
      </div>

      <Card flush>
        <Loadable state={state}>
          {(data) =>
            data.riders.length === 0 ? (
              <Empty
                title={online ? 'No riders online right now' : filters.status === 'pending' ? 'Nobody waiting for approval' : 'No riders match'}
              />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table clickable">
                    <thead>
                      <tr>
                        <th>Rider</th>
                        <th>City</th>
                        <th>Vehicle</th>
                        <th>Status</th>
                        <th>Right now</th>
                        <th className="num">Deliveries</th>
                        <th>Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.riders.map((rider) => (
                        <tr key={rider.id} onClick={() => navigate(`/riders/${rider.id}`)}>
                          <td>
                            <Link to={`/riders/${rider.id}`} onClick={(e) => e.stopPropagation()}>
                              {rider.name || 'No name yet'}
                            </Link>
                            <div className="sub">{formatPhone(rider.phone)}</div>
                          </td>
                          <td>{rider.city || <Badge tone="warning">Not set</Badge>}</td>
                          <td>
                            {VEHICLE[rider.vehicleType] || rider.vehicleType}
                            <div className="sub mono">{rider.vehicleNumber || 'No number'}</div>
                          </td>
                          <td>
                            <StatusBadge map={PARTNER_STATUS} value={rider.status} />
                            {rider.accountBlocked && (
                              <div className="sub">
                                <Badge tone="danger">Blocked</Badge>
                              </div>
                            )}
                          </td>
                          <td>
                            {rider.carryingOrder ? (
                              <Badge tone="progress">On {rider.carryingOrder}</Badge>
                            ) : rider.isOnline ? (
                              <Badge tone="success">Online</Badge>
                            ) : (
                              <span className="muted">Offline</span>
                            )}
                            {rider.lastSeenAt && <div className="sub">Location {timeAgo(rider.lastSeenAt)}</div>}
                          </td>
                          <td className="num">
                            {rider.deliveries}
                            <div className="sub">{rider.deliveriesToday} today</div>
                          </td>
                          <td>{formatDate(rider.joinedAt)}</td>
                        </tr>
                      ))}
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
