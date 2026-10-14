import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import MapPicker from '../components/Map'
import {
  Badge,
  Card,
  Check,
  ConfirmDialog,
  Details,
  Empty,
  Loadable,
  PageHeader,
  Stat,
  StatusBadge,
  Tabs,
} from '../components/ui'
import { api, mediaUrl } from '../lib/api'
import { formatDateTime, formatMoney, formatPhone, ORDER_STATUS, RESTAURANT_STATUS, timeAgo } from '../lib/format'
import { useToast } from '../lib/toast'
import type { Activity, MenuCategory, Restaurant } from '../lib/types'
import { useLoad } from '../lib/useLoad'

type Action = { status: 'active' | 'suspended' | 'rejected'; title: string; label: string; danger?: boolean; body: string }

function actionsFor(restaurant: Restaurant): Action[] {
  const live: Action = {
    status: 'active',
    title: `Make ${restaurant.name} live?`,
    label: restaurant.status === 'pending' ? 'Make live' : 'Reactivate',
    body: 'Customers in the city will see it and can order straight away, whenever the owner has it switched on in their app.',
  }
  const suspend: Action = {
    status: 'suspended',
    title: `Suspend ${restaurant.name}?`,
    label: 'Suspend',
    danger: true,
    body: 'It disappears from the customer app at once and takes no new orders. Orders already placed still have to be finished. The owner can still sign in.',
  }
  const reject: Action = {
    status: 'rejected',
    title: `Reject ${restaurant.name}?`,
    label: 'Reject',
    danger: true,
    body: 'It will not go live. You can make it live later if things change.',
  }

  switch (restaurant.status) {
    case 'pending':
      return [live, reject]
    case 'active':
      return [suspend]
    default:
      return [live]
  }
}

export default function RestaurantDetail() {
  const { id = '' } = useParams()
  const toast = useToast()
  const [tab, setTab] = useState<'overview' | 'menu' | 'activity'>('overview')
  const [action, setAction] = useState<Action | null>(null)

  const state = useLoad(async () => (await api<{ restaurant: Restaurant }>(`/api/v1/admin/restaurants/${id}`)).restaurant, id)
  const menu = useLoad(
    async () =>
      tab === 'menu' ? (await api<{ categories: MenuCategory[] }>(`/api/v1/admin/restaurants/${id}/menu`)).categories : [],
    `${id}:${tab}`
  )
  const activity = useLoad(
    async () =>
      tab === 'activity'
        ? (await api<{ activity: Activity[] }>('/api/v1/admin/activity', { query: { entityId: id, limit: 50 } })).activity
        : [],
    `${id}:${tab}:activity`
  )

  async function changeStatus(reason: string) {
    if (!action) return

    const { restaurant } = await api<{ restaurant: Restaurant }>(`/api/v1/admin/restaurants/${id}/status`, {
      method: 'POST',
      body: { status: action.status, reason: reason || null },
    })

    state.setData(restaurant)
    toast(`${restaurant.name} is now ${RESTAURANT_STATUS[restaurant.status]?.label.toLowerCase()}`)
  }

  return (
    <Loadable state={state}>
      {(restaurant) => {
        const checklist = restaurant.checklist
        const location =
          restaurant.latitude !== null && restaurant.longitude !== null
            ? { latitude: restaurant.latitude, longitude: restaurant.longitude }
            : null

        return (
          <>
            <PageHeader
              back={{ to: '/restaurants', label: 'Restaurants' }}
              title={
                <>
                  {restaurant.name} <StatusBadge map={RESTAURANT_STATUS} value={restaurant.status} />
                </>
              }
              subtitle={`${restaurant.cuisines.join(', ')} · ${restaurant.addressLine}, ${restaurant.city}`}
              actions={
                <>
                  <Link className="btn" to={`/restaurants/${id}/edit`}>
                    Edit details
                  </Link>
                  {actionsFor(restaurant).map((candidate) => (
                    <button
                      key={candidate.status}
                      className={candidate.danger ? 'btn btn-danger' : 'btn btn-primary'}
                      onClick={() => setAction(candidate)}
                    >
                      {candidate.label}
                    </button>
                  ))}
                </>
              }
            />

            {restaurant.status === 'active' && !restaurant.isAcceptingOrders && (
              <div className="notice notice-warning">
                The owner has switched off new orders in the Restaurant app, so customers see it as closed.
              </div>
            )}

            <Tabs
              value={tab}
              onChange={setTab}
              options={[
                { value: 'overview', label: 'Overview' },
                { value: 'menu', label: 'Menu', count: restaurant.menu.items },
                { value: 'activity', label: 'Activity' },
              ]}
            />

            {tab === 'overview' && (
              <div className="grid-2 align-start">
                <div className="stack">
                  {restaurant.status !== 'active' && (
                    <Card title="Before going live">
                      <ul className="checklist">
                        <Check ok={checklist.ownerSignedIn}>
                          Owner has signed in to the Restaurant app
                          {!checklist.ownerSignedIn && (
                            <span className="sub"> · ask them to install it and sign in with {formatPhone(restaurant.owner.phone)}</span>
                          )}
                        </Check>
                        <Check ok={checklist.hasMenu}>
                          At least one dish on the menu <span className="sub">(required)</span>
                        </Check>
                        <Check ok={checklist.hasLocation}>Map pin set, so riders can find it</Check>
                        <Check ok={checklist.hasFssai}>FSSAI licence number added</Check>
                        <Check ok={checklist.hasCoverPhoto}>Cover photo uploaded by the owner</Check>
                      </ul>
                    </Card>
                  )}

                  <div className="stats stats-3">
                    <Stat label="Orders, last 30 days" value={restaurant.orders.last30Days} hint={`${restaurant.orders.total} all time`} />
                    <Stat
                      label="Delivered, last 30 days"
                      value={restaurant.orders.deliveredLast30Days}
                      hint={formatMoney(restaurant.orders.deliveredPaiseLast30Days, { whole: true })}
                    />
                    <Stat
                      label="Cancelled, last 30 days"
                      value={restaurant.orders.cancelledLast30Days}
                      tone={restaurant.orders.cancelledLast30Days > 0 ? 'warning' : undefined}
                    />
                  </div>

                  <Card title="Details">
                    <Details
                      rows={[
                        ['Owner', `${restaurant.owner.name || '—'} · ${formatPhone(restaurant.owner.phone)}`],
                        ['Owner last signed in', restaurant.owner.lastSignedInAt ? timeAgo(restaurant.owner.lastSignedInAt) : 'Not yet'],
                        ['Restaurant phone', formatPhone(restaurant.phone)],
                        ['Address', `${restaurant.addressLine}, ${restaurant.city}${restaurant.pincode ? ` ${restaurant.pincode}` : ''}`],
                        ['Type', restaurant.isVeg ? <Badge key="v" tone="success">Pure veg</Badge> : 'Veg and non-veg'],
                        ['FSSAI', restaurant.fssaiNumber || <Badge key="f" tone="warning">Missing</Badge>],
                        ['GSTIN', restaurant.gstNumber],
                        ['Commission', `${restaurant.commissionPct}% of food value`],
                        ['Preparation time', `${restaurant.avgPrepMinutes} min`],
                        [
                          'Opening hours',
                          restaurant.opensAt && restaurant.closesAt ? `${restaurant.opensAt} – ${restaurant.closesAt} (set by owner)` : 'Not set',
                        ],
                        ['Rating', restaurant.ratingCount ? `${restaurant.rating.toFixed(1)} from ${restaurant.ratingCount} reviews` : 'No reviews yet'],
                        ['Added', formatDateTime(restaurant.createdAt)],
                      ]}
                    />
                  </Card>
                </div>

                <div className="stack">
                  <Card title="Cover photo">
                    {restaurant.imageUrl ? (
                      <img className="cover" src={mediaUrl(restaurant.imageUrl)!} alt={`${restaurant.name} cover`} />
                    ) : (
                      <p className="muted">The owner adds this from the Restaurant app.</p>
                    )}
                  </Card>
                  <Card title="On the map">
                    {location ? (
                      <MapPicker value={location} readOnly height={240} />
                    ) : (
                      <Empty title="No map pin" body={<Link to={`/restaurants/${id}/edit`}>Set it under Edit details</Link>} />
                    )}
                  </Card>
                  <Card title="Recent orders" actions={<Link to={`/orders?search=${encodeURIComponent(restaurant.name)}&view=all`}>All orders</Link>}>
                    {restaurant.recentOrders.length === 0 ? (
                      <p className="muted">No orders yet.</p>
                    ) : (
                      <table className="table compact">
                        <tbody>
                          {restaurant.recentOrders.map((order) => (
                            <tr key={order.id}>
                              <td>
                                <Link className="mono" to={`/orders/${order.id}`}>
                                  {order.orderNumber}
                                </Link>
                                <div className="sub">{formatDateTime(order.placedAt)}</div>
                              </td>
                              <td>
                                <StatusBadge map={ORDER_STATUS} value={order.status} />
                              </td>
                              <td className="num">{formatMoney(order.totalPaise)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </Card>
                </div>
              </div>
            )}

            {tab === 'menu' && (
              <Card title="Menu" actions={<span className="muted small">The owner edits the menu in the Restaurant app.</span>}>
                <Loadable state={menu}>
                  {(categories) =>
                    categories.length === 0 ? (
                      <Empty title="No dishes yet" body="The owner adds dishes, prices and photos from the Restaurant app." />
                    ) : (
                      <div className="stack">
                        {categories.map((category) => (
                          <div key={category.id || 'none'}>
                            <h3 className="subhead">
                              {category.name} <span className="muted">({category.items.length})</span>
                            </h3>
                            <table className="table compact">
                              <tbody>
                                {category.items.map((item) => (
                                  <tr key={item.id} className={item.isAvailable ? '' : 'dim'}>
                                    <td className="with-thumb">
                                      {item.imageUrl ? (
                                        <img className="thumb" src={mediaUrl(item.imageUrl)!} alt="" loading="lazy" />
                                      ) : (
                                        <span className="thumb thumb-empty" aria-hidden="true" />
                                      )}
                                      <div>
                                        <span className={item.isVeg ? 'veg' : 'nonveg'} aria-label={item.isVeg ? 'Veg' : 'Non-veg'} />
                                        {item.name}
                                        {item.description && <div className="sub">{item.description}</div>}
                                      </div>
                                    </td>
                                    <td>
                                      {!item.isAvailable && <Badge tone="warning">Sold out</Badge>}
                                      {item.addons > 0 && <span className="sub"> {item.addons} add-ons</span>}
                                    </td>
                                    <td className="num">{formatMoney(item.pricePaise)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    )
                  }
                </Loadable>
              </Card>
            )}

            {tab === 'activity' && (
              <Card title="Changes made by Foodos">
                <Loadable state={activity}>
                  {(rows) =>
                    rows.length === 0 ? (
                      <p className="muted">Nothing recorded yet.</p>
                    ) : (
                      <ul className="activity-list">
                        {rows.map((row) => (
                          <li key={row.id}>
                            <strong>{row.action}</strong>
                            {row.details?.reason && <span> · “{row.details.reason}”</span>}
                            <div className="sub">
                              {row.actor || 'System'} · {formatDateTime(row.at)}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )
                  }
                </Loadable>
              </Card>
            )}

            {action && (
              <ConfirmDialog
                title={action.title}
                body={<p>{action.body}</p>}
                confirmLabel={action.label}
                danger={action.danger}
                reasonLabel={action.status === 'active' ? undefined : 'Reason'}
                reasonHint="Kept in the activity log for the team. The owner is not shown it."
                onConfirm={changeStatus}
                onClose={() => setAction(null)}
              />
            )}
          </>
        )
      }}
    </Loadable>
  )
}
