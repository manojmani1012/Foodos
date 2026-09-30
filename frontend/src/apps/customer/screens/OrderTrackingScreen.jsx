import React, { useEffect, useState } from 'react'
import './OrderTrackingScreen.css'
import { cancelOrder, fetchOrder } from '../../../lib/orders.js'

// The tracking timeline, in the order the app shows it. The API returns the
// statuses that have actually happened; anything further down is still ahead.
const STEPS = [
  { key: 'confirmed', label: 'Order Confirmed' },
  { key: 'preparing', label: 'Preparing Your Food' },
  { key: 'ready', label: 'Ready for Pickup' },
  { key: 'picked_up', label: 'Picked Up' },
  { key: 'on_the_way', label: 'On the Way' },
  { key: 'delivered', label: 'Delivered' },
]

// Until the restaurant and delivery apps push updates, the status only changes
// when someone else moves it, so a slow poll is enough. This becomes a WebSocket
// subscription when realtime arrives.
const POLL_INTERVAL_MS = 15000

const CANCELLABLE = new Set(['pending', 'confirmed'])

function formatTime(iso) {
  if (!iso) return ''

  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function OrderTrackingScreen({ order: initialOrder, onBack, onDone }) {
  const [order, setOrder] = useState(initialOrder)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState('')

  const finished = order?.status === 'delivered' || order?.status === 'cancelled'

  useEffect(() => {
    if (!order?.id || finished) return undefined

    let cancelled = false

    const timer = setInterval(async () => {
      try {
        const latest = await fetchOrder(order.id)

        if (!cancelled) setOrder(latest)
      } catch {
        // A failed poll is not worth interrupting the screen for; the next one
        // will try again.
      }
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [order?.id, finished])

  if (!order) return null

  const reached = new Map(order.timeline.map(step => [step.status, step.at]))
  const currentIndex = STEPS.reduce((last, step, idx) => (reached.has(step.key) ? idx : last), -1)

  async function handleCancel() {
    setCancelling(true)
    setError('')

    try {
      setOrder(await cancelOrder(order.id, 'Changed my mind'))
    } catch (cancelError) {
      setError(cancelError.message)
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="track-screen">
      <div className="track-header">
        <button className="track-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#333" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="track-title">Order Tracking</span>
        <span className="track-help">Help</span>
      </div>

      <div className="track-content">
        <div className="track-order-id">Order ID: #{order.orderNumber}</div>

        {order.status === 'cancelled' ? (
          <div className="track-cancelled">
            <span style={{ fontSize: 34 }}>🚫</span>
            <p>This order was cancelled.</p>
            {order.cancellationReason && <small>{order.cancellationReason}</small>}
          </div>
        ) : (
          <div className="track-timeline">
            {STEPS.map((step, idx) => {
              const done = idx <= currentIndex
              return (
                <div className="track-step" key={step.key}>
                  <div className="track-step-marker">
                    <span className={`track-dot ${done ? 'done' : ''}`} />
                    {idx < STEPS.length - 1 && <span className={`track-line ${idx < currentIndex ? 'done' : ''}`} />}
                  </div>
                  <div className="track-step-info">
                    <div className={`track-step-label ${done ? 'done' : ''}`}>{step.label}</div>
                    {done && <div className="track-step-time">{formatTime(reached.get(step.key))}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {order.estimatedDeliveryAt && !finished && (
          <div className="track-eta">Expected by {formatTime(order.estimatedDeliveryAt)}</div>
        )}

        <div className="track-map-placeholder">
          <span style={{ fontSize: 36 }}>🗺️</span>
          <p>Live map tracking</p>
        </div>

        <div className="track-bill">
          <div className="track-bill-title">{order.items.length} item{order.items.length === 1 ? '' : 's'}</div>
          {order.items.map(item => (
            <div className="track-bill-row" key={item.id}>
              <span>{item.quantity} × {item.name}</span>
              <span>₹{item.lineTotal}</span>
            </div>
          ))}
          <div className="track-bill-row total">
            <span>Total ({order.paymentMethod === 'cod' ? 'Cash on delivery' : order.paymentMethod.toUpperCase()})</span>
            <span>₹{order.total}</span>
          </div>
        </div>

        {order.restaurant && (
          <div className="track-restaurant-line">
            From <strong>{order.restaurant.name}</strong>
          </div>
        )}

        {error && <div className="track-error">{error}</div>}

        {CANCELLABLE.has(order.status) && (
          <button className="track-cancel-btn" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? 'Cancelling…' : 'Cancel order'}
          </button>
        )}
      </div>

      {finished && (
        <button className="track-done-btn" onClick={onDone}>
          {order.status === 'delivered' ? 'Order Delivered — Back to Home' : 'Back to Home'}
        </button>
      )}
    </div>
  )
}
