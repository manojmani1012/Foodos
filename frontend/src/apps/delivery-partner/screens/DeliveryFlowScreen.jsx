import React, { useState } from 'react'
import '../common.css'

const STEPS = ['accepted', 'pickup', 'navigate', 'arrived']

export default function DeliveryFlowScreen({ onComplete }) {
  const [step, setStep] = useState('accepted')

  const config = {
    accepted: {
      title: 'Order Accepted',
      emoji: '🏬',
      heading: 'The Biryani House',
      sub: 'Anna Nagar, Chennai',
      note: 'Go to Restaurant',
      noteSub: 'Reach the restaurant to pick up the order',
      btn: "I've Reached Restaurant",
      next: 'pickup',
    },
    pickup: {
      title: 'Pickup Order',
      emoji: '📦',
      heading: 'The Biryani House',
      sub: 'Order ID: #FD125487',
      note: '2 Items · ₹548',
      noteSub: 'Confirm you have picked up the order',
      btn: 'Order Picked ✓',
      next: 'navigate',
    },
    navigate: {
      title: 'On the Way',
      emoji: '🗺️',
      heading: 'Ramesh Kumar',
      sub: '12, Lake View Road, Nungambakkam',
      note: '5.8 km · 18 min',
      noteSub: 'Navigate to the customer\u2019s location',
      btn: 'Navigate',
      next: 'arrived',
    },
    arrived: {
      title: 'Arrived at Customer',
      emoji: '🏠',
      heading: 'You have arrived',
      sub: 'Ramesh Kumar · 12, Lake View Road',
      note: null,
      noteSub: null,
      btn: 'Order Delivered ✓',
      next: null,
    },
  }[step]

  function handleAction() {
    if (config.next) setStep(config.next)
    else onComplete()
  }

  return (
    <div className="dp-screen">
      <div className="dp-header">
        <span className="dp-title">{config.title}</span>
      </div>

      <div className="dp-content" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 10, textAlign: 'center',
        }}>
          <span style={{ fontSize: 64 }}>{config.emoji}</span>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>{config.heading}</div>
          <div style={{ fontSize: 13, color: '#888' }}>{config.sub}</div>
          {config.note && (
            <div className="dp-pill" style={{ marginTop: 8 }}>{config.note}</div>
          )}
          {config.noteSub && <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{config.noteSub}</div>}
        </div>

        <div className="dp-row" style={{ marginBottom: 16, gap: 8 }}>
          {STEPS.map(s => (
            <span key={s} style={{
              flex: 1, height: 4, borderRadius: 4,
              background: STEPS.indexOf(s) <= STEPS.indexOf(step) ? '#1a5c35' : '#eee',
            }} />
          ))}
        </div>

        <button className="dp-btn-primary" onClick={handleAction}>{config.btn}</button>
      </div>
    </div>
  )
}
