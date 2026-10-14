import { Link, useNavigate } from 'react-router-dom'
import { Badge, Card, Empty, Loadable, PageHeader, Pagination, SearchBox, StatusBadge, Tabs } from '../components/ui'
import { api, mediaUrl } from '../lib/api'
import { formatDate, formatPhone, RESTAURANT_STATUS } from '../lib/format'
import type { Counts, RestaurantRow } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { useFilters } from '../lib/useParams'

const LIMIT = 50

type Status = 'all' | 'pending' | 'active' | 'suspended' | 'rejected'

export default function Restaurants() {
  const navigate = useNavigate()
  const [filters, setFilters] = useFilters({ status: 'all', search: '', offset: '0' })
  const offset = Number(filters.offset) || 0

  const state = useLoad(
    () =>
      api<{ total: number; counts: Counts; restaurants: RestaurantRow[] }>('/api/v1/admin/restaurants', {
        query: {
          status: filters.status === 'all' ? undefined : filters.status,
          search: filters.search,
          limit: LIMIT,
          offset,
        },
      }),
    JSON.stringify(filters)
  )

  const counts = state.data?.counts

  return (
    <>
      <PageHeader
        title="Restaurants"
        actions={
          <Link className="btn btn-primary" to="/restaurants/new">
            Add restaurant
          </Link>
        }
      />

      <Tabs<Status>
        value={filters.status as Status}
        onChange={(status) => setFilters({ status })}
        options={[
          { value: 'all', label: 'All', count: counts?.all },
          { value: 'pending', label: 'Pending', count: counts?.pending, alert: true },
          { value: 'active', label: 'Live', count: counts?.active },
          { value: 'suspended', label: 'Suspended', count: counts?.suspended },
          { value: 'rejected', label: 'Rejected', count: counts?.rejected },
        ]}
      />

      <div className="toolbar">
        <SearchBox
          value={filters.search}
          onChange={(search) => setFilters({ search })}
          placeholder="Name, area, city, owner name or phone"
        />
      </div>

      <Card flush>
        <Loadable state={state}>
          {(data) =>
            data.restaurants.length === 0 ? (
              <Empty
                title={filters.search ? 'No restaurants match' : 'No restaurants here yet'}
                body={!filters.search && filters.status === 'all' ? 'Add the first one with the button above.' : undefined}
              />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table clickable">
                    <thead>
                      <tr>
                        <th>Restaurant</th>
                        <th>Owner</th>
                        <th>Status</th>
                        <th className="num">Dishes</th>
                        <th className="num">Delivered (30 days)</th>
                        <th className="num">Commission</th>
                        <th>Added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.restaurants.map((restaurant) => (
                        <tr key={restaurant.id} onClick={() => navigate(`/restaurants/${restaurant.id}`)}>
                          <td>
                            <div className="with-thumb">
                              {restaurant.imageUrl ? (
                                <img className="thumb" src={mediaUrl(restaurant.imageUrl)!} alt="" loading="lazy" />
                              ) : (
                                <span className="thumb thumb-empty" aria-hidden="true">
                                  {restaurant.name.slice(0, 1)}
                                </span>
                              )}
                              <div>
                                <Link to={`/restaurants/${restaurant.id}`} onClick={(e) => e.stopPropagation()}>
                                  {restaurant.name}
                                </Link>
                                <div className="sub">
                                  {restaurant.area}, {restaurant.city}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            {restaurant.owner.name || '—'}
                            <div className="sub">{formatPhone(restaurant.owner.phone)}</div>
                          </td>
                          <td>
                            <StatusBadge map={RESTAURANT_STATUS} value={restaurant.status} />
                            {restaurant.status === 'active' && !restaurant.isAcceptingOrders && (
                              <div className="sub">
                                <Badge tone="warning">Paused by owner</Badge>
                              </div>
                            )}
                            {!restaurant.hasLocation && (
                              <div className="sub">
                                <Badge tone="warning">No map pin</Badge>
                              </div>
                            )}
                          </td>
                          <td className="num">{restaurant.menuItems}</td>
                          <td className="num">{restaurant.deliveredLast30Days}</td>
                          <td className="num">{restaurant.commissionPct}%</td>
                          <td>{formatDate(restaurant.createdAt)}</td>
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
