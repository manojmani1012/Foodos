import { Link, useNavigate } from 'react-router-dom'
import { Badge, Card, Empty, Loadable, PageHeader, Pagination, SearchBox, StatusBadge, Tabs } from '../components/ui'
import { api } from '../lib/api'
import { formatPhone, timeAgo } from '../lib/format'
import type { SupportTicketRow } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { useFilters } from '../lib/useParams'

const LIMIT = 50

type Status = 'waiting' | 'open' | 'resolved' | 'closed' | 'all'

export const TICKET_STATUS: Record<string, { label: string; tone: 'warning' | 'progress' | 'success' | 'neutral' }> = {
  open: { label: 'Needs a reply', tone: 'warning' },
  in_progress: { label: 'In progress', tone: 'progress' },
  resolved: { label: 'Resolved', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
}

export const RAISED_BY: Record<string, string> = {
  customer: 'Customer',
  restaurant_owner: 'Restaurant',
  delivery_partner: 'Rider',
}

export default function Support() {
  const navigate = useNavigate()
  const [filters, setFilters] = useFilters({ status: 'waiting', search: '', offset: '0' })
  const offset = Number(filters.offset) || 0

  const state = useLoad(
    () =>
      api<{ total: number; counts: Record<string, number>; tickets: SupportTicketRow[] }>('/api/v1/admin/support/tickets', {
        query: {
          status: filters.status === 'all' ? undefined : filters.status,
          search: filters.search,
          limit: LIMIT,
          offset,
        },
      }),
    JSON.stringify(filters),
    30_000
  )

  const counts = state.data?.counts

  return (
    <>
      <PageHeader title="Support" subtitle="Tickets raised from Help & support in the Foodos apps. Replies reach the person's app." />

      <Tabs<Status>
        value={filters.status as Status}
        onChange={(status) => setFilters({ status })}
        options={[
          { value: 'waiting', label: 'To do', count: counts?.waiting, alert: true },
          { value: 'open', label: 'Needs a reply', count: counts?.open },
          { value: 'resolved', label: 'Resolved', count: counts?.resolved },
          { value: 'closed', label: 'Closed', count: counts?.closed },
          { value: 'all', label: 'All', count: counts?.all },
        ]}
      />

      <div className="toolbar">
        <SearchBox value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Ticket, order number, phone or name" />
      </div>

      <Card flush>
        <Loadable state={state}>
          {(data) =>
            data.tickets.length === 0 ? (
              <Empty title={filters.status === 'waiting' ? 'Nothing waiting. All caught up' : 'No tickets here'} />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table clickable stack-on-phone">
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>From</th>
                        <th>Order</th>
                        <th>Status</th>
                        <th>Last activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.tickets.map((ticket) => (
                        <tr key={ticket.id} onClick={() => navigate(`/support/${ticket.id}`)}>
                          <td data-label="Ticket">
                            <Link to={`/support/${ticket.id}`} onClick={(e) => e.stopPropagation()}>
                              {ticket.subject}
                            </Link>{' '}
                            {ticket.priority === 'high' && <Badge tone="danger">Urgent</Badge>}
                            <div className="sub">
                              <span className="mono">{ticket.ticketNumber}</span>
                              {ticket.lastMessage ? ` · ${ticket.lastMessage.slice(0, 80)}` : ''}
                            </div>
                          </td>
                          <td data-label="From">
                            {ticket.person.name || 'No name'}
                            <div className="sub">
                              {RAISED_BY[ticket.role] || ticket.role} · {formatPhone(ticket.person.phone)}
                            </div>
                          </td>
                          <td data-label="Order">
                            {ticket.order ? (
                              <Link className="mono" to={`/orders/${ticket.order.id}`} onClick={(e) => e.stopPropagation()}>
                                {ticket.order.orderNumber}
                              </Link>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td data-label="Status">
                            <StatusBadge map={TICKET_STATUS} value={ticket.status} />
                          </td>
                          <td data-label="Last activity">{timeAgo(ticket.updatedAt)}</td>
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
