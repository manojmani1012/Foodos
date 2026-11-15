import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { formatPhone, timeAgo } from '../lib/format'
import { useToast } from '../lib/toast'
import type { Order, RidersForOrder } from '../lib/types'
import RidersMap from './RidersMap'
import { Badge, ErrorBox, Spinner } from './ui'

const OFFER_LABEL: Record<string, string> = {
  sent: 'Offer on their screen',
  rejected: 'Skipped this order',
  expired: 'Let the offer run out',
}

// "Find riders" on an order: who is available and how far away, nearest
// first, with a button to give them the order. Dispatch offers every order on
// its own; this is for when it cannot find anyone, or a rider stops moving.
export function RiderFinder({ order, onAssigned }: { order: Order; onAssigned: (order: Order) => void }) {
  const toast = useToast()
  const [data, setData] = useState<RidersForOrder | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [assigning, setAssigning] = useState<string | null>(null)
  const [showOffline, setShowOffline] = useState(false)

  async function load() {
    setLoading(true)
    setError('')

    try {
      setData(await api<RidersForOrder>(`/api/v1/admin/orders/${order.id}/riders`))
    } catch (caught: any) {
      setError(caught?.message || 'Could not load riders')
    } finally {
      setLoading(false)
    }
  }

  async function assign(riderId: string, name: string | null) {
    const replacing = order.rider && !['delivered', 'cancelled'].includes(order.rider.deliveryStatus)

    if (replacing && !window.confirm(`Move ${order.orderNumber} from ${order.rider?.name || 'the current rider'} to ${name || 'this rider'}?`)) {
      return
    }

    setAssigning(riderId)
    setError('')

    try {
      const { order: updated } = await api<{ order: Order }>(`/api/v1/admin/orders/${order.id}/assign`, {
        method: 'POST',
        body: { riderId },
      })
      onAssigned(updated)
      toast(`${name || 'The rider'} has the order. They were sent a notification`)
      await load()
    } catch (caught: any) {
      setError(caught?.message || 'Could not assign this rider')
    } finally {
      setAssigning(null)
    }
  }

  const shown = useMemo(
    () => (data ? data.riders.filter((rider) => showOffline || rider.isOnline || rider.isCurrentRider) : []),
    [data, showOffline]
  )

  const mapRiders = useMemo(
    () =>
      shown
        .filter((rider) => rider.latitude !== null && rider.longitude !== null)
        .map((rider) => ({
          id: rider.id,
          name: rider.name?.split(' ')[0] || 'Rider',
          latitude: rider.latitude!,
          longitude: rider.longitude!,
          free: rider.isOnline && rider.canAssign,
        })),
    [shown]
  )

  if (!data) {
    return (
      <div className="stack-sm">
        <button className="btn btn-primary" onClick={load} disabled={loading}>
          {loading ? 'Finding riders…' : 'Find riders'}
        </button>
        {error && <ErrorBox error={error} />}
      </div>
    )
  }

  const offlineCount = data.riders.filter((rider) => !rider.isOnline).length
  const { restaurant } = data

  return (
    <div className="stack-sm">
      {restaurant.latitude !== null && restaurant.longitude !== null && (
        <RidersMap
          restaurant={{ name: restaurant.name, latitude: restaurant.latitude, longitude: restaurant.longitude }}
          riders={mapRiders}
          height={240}
        />
      )}

      <div className="row-between">
        <span className="muted small">
          {shown.length === 0 ? 'No riders online right now.' : 'Nearest first. Distance is from the restaurant.'}
        </span>
        <span className="row-gap">
          {offlineCount > 0 && (
            <button className="btn btn-small btn-ghost" onClick={() => setShowOffline(!showOffline)}>
              {showOffline ? 'Hide offline' : `Show ${offlineCount} offline`}
            </button>
          )}
          <button className="btn btn-small btn-ghost" onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </span>
      </div>

      {error && <ErrorBox error={error} />}
      {loading && !data && <Spinner />}

      {shown.length > 0 && (
        <ul className="rider-options">
          {shown.map((rider) => {
            const stale = rider.secondsSinceLocation === null || rider.secondsSinceLocation > data.locationFreshSeconds

            return (
              <li key={rider.id} className="rider-option">
                <div className="rider-option-main">
                  <strong>{rider.name || 'No name'}</strong>{' '}
                  <span className="muted small">
                    {formatPhone(rider.phone)}
                    {rider.city ? ` · ${rider.city}` : ''}
                    {rider.vehicleNumber ? ` · ${rider.vehicleNumber}` : ''}
                  </span>
                  <div className="small">
                    {rider.distanceKm !== null ? `${rider.distanceKm.toFixed(1)} km away` : 'Location unknown'}
                    {rider.lastLocationAt && (
                      <span className={stale ? 'text-warning' : 'muted'}> · seen {timeAgo(rider.lastLocationAt)}</span>
                    )}
                  </div>
                  <div className="row-gap small">
                    {!rider.isOnline && <Badge tone="neutral">Offline</Badge>}
                    {rider.busyWith && <Badge tone="warning">Delivering #{rider.busyWith}</Badge>}
                    {rider.isCurrentRider && <Badge tone="success">Has this order</Badge>}
                    {rider.offerStatus && OFFER_LABEL[rider.offerStatus] && !rider.isCurrentRider && (
                      <Badge tone="neutral">{OFFER_LABEL[rider.offerStatus]}</Badge>
                    )}
                  </div>
                </div>
                {!rider.isCurrentRider && (
                  <button
                    className="btn btn-small btn-primary"
                    disabled={!rider.canAssign || assigning !== null}
                    title={rider.canAssign ? undefined : 'Busy with another order'}
                    onClick={() => assign(rider.id, rider.name)}
                  >
                    {assigning === rider.id ? 'Assigning…' : order.rider ? 'Reassign' : 'Assign'}
                  </button>
                )}
                <a className="btn btn-small btn-ghost" href={`tel:${rider.phone}`}>
                  Call
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
