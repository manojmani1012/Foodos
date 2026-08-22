import React, { useEffect, useState } from 'react'
import './OrderTrackingScreen.css'
import { getRestaurant } from '../../../data/menuData'

const STEPS = [
  { key: 'confirmed', label: 'Order Confirmed', time: '12:34 PM' },
  { key: 'preparing', label: 'Preparing Your Food', time: '12:40 PM' },
  { key: 'pickup', label: 'Picked Up', time: '01:00 PM' },
  { key: 'on-the-way', label: 'On the Way', time: '01:05 PM' },
  { key: 'delivered', label: 'Delivered', time: '—' },
]

export default function OrderTrackingScreen({ restaurantId, onBack, onDone }) {
  const restaurant = getRestaurant(restaurantId)
  const [stepIndex, setStepIndex] = useState(0)

  // Simulate order progressing through statuses over time.
  useEffect(() => {
    if (stepIndex >= STEPS.length - 1) return
    const t = setTimeout(() => setStepIndex(i => i + 1), 2500)
    return () => clearTimeout(t)
  }, [stepIndex])

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
        <div className="track-order-id">Order ID: #FD125487</div>

        <div className="track-timeline">
          {STEPS.map((step, idx) => {
            const done = idx <= stepIndex
            return (
              <div className="track-step" key={step.key}>
                <div className="track-step-marker">
                  <span className={`track-dot ${done ? 'done' : ''}`} />
                  {idx < STEPS.length - 1 && <span className={`track-line ${idx < stepIndex ? 'done' : ''}`} />}
                </div>
                <div className="track-step-info">
                  <div className={`track-step-label ${done ? 'done' : ''}`}>{step.label}</div>
                  {done && <div className="track-step-time">{step.time}</div>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="track-map-placeholder">
          <span style={{ fontSize: 36 }}>🗺️</span>
          <p>Live map tracking</p>
        </div>

        {stepIndex >= 2 && (
          <div className="track-rider-card">
            <div className="track-rider-avatar">🛵</div>
            <div className="track-rider-info">
              <div className="track-rider-name">Suresh Kumar</div>
              <div className="track-rider-rating">⭐ 4.8 · Delivery Partner</div>
            </div>
            <button className="track-rider-call" onClick={() => { window.location.href = 'tel:+919876543210' }}>📞</button>
          </div>
        )}

        {restaurant && (
          <div className="track-restaurant-line">
            From <strong>{restaurant.name}</strong>
          </div>
        )}
      </div>

      {stepIndex >= STEPS.length - 1 && (
        <button className="track-done-btn" onClick={onDone}>
          Order Delivered — Back to Home
        </button>
      )}
    </div>
  )
}
