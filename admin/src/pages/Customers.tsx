import { Link, useNavigate } from 'react-router-dom'
import { Badge, Card, Empty, Loadable, PageHeader, Pagination, SearchBox, Tabs } from '../components/ui'
import { api } from '../lib/api'
import { formatDate, formatMoney, formatPhone, timeAgo } from '../lib/format'
import type { CustomerRow } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { useFilters } from '../lib/useParams'

const LIMIT = 50

type Status = 'all' | 'blocked'

export default function Customers() {
  const navigate = useNavigate()
  const [filters, setFilters] = useFilters({ status: 'all', search: '', offset: '0' })
  const offset = Number(filters.offset) || 0

  const state = useLoad(
    () =>
      api<{ total: number; customers: CustomerRow[] }>('/api/v1/admin/customers', {
        query: {
          status: filters.status === 'blocked' ? 'blocked' : undefined,
          search: filters.search,
          limit: LIMIT,
          offset,
        },
      }),
    JSON.stringify(filters)
  )

  return (
    <>
      <PageHeader title="Customers" subtitle="Everyone who has signed in to the Foodos app." />

      <Tabs<Status>
        value={filters.status as Status}
        onChange={(status) => setFilters({ status })}
        options={[
          { value: 'all', label: 'All' },
          { value: 'blocked', label: 'Blocked' },
        ]}
      />

      <div className="toolbar">
        <SearchBox value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Phone number, name or email" />
      </div>

      <Card flush>
        <Loadable state={state}>
          {(data) =>
            data.customers.length === 0 ? (
              <Empty title={filters.search ? 'Nobody matches' : 'No customers here'} />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table clickable">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th className="num">Orders</th>
                        <th className="num">Spent</th>
                        <th>Last order</th>
                        <th>Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.customers.map((customer) => (
                        <tr key={customer.id} onClick={() => navigate(`/customers/${customer.id}`)}>
                          <td>
                            <Link to={`/customers/${customer.id}`} onClick={(e) => e.stopPropagation()}>
                              {customer.name || 'No name yet'}
                            </Link>{' '}
                            {customer.blocked && <Badge tone="danger">Blocked</Badge>}
                            <div className="sub">{formatPhone(customer.phone)}</div>
                          </td>
                          <td className="num">{customer.orders}</td>
                          <td className="num">{formatMoney(customer.spentPaise, { whole: true })}</td>
                          <td>{customer.lastOrderAt ? timeAgo(customer.lastOrderAt) : <span className="muted">No orders</span>}</td>
                          <td>{formatDate(customer.joinedAt)}</td>
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
