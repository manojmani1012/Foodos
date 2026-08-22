import React, { useEffect, useState } from 'react'
import '../common.css'

export default function NewRequestScreen({ onAccept, onReject }) {
  const [seconds, setSeconds] = useState(15)

  useEffect(() => {
    if (seconds <= 0) { onReject(); return }
    const t = setTimeout(() => setSeconds(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds, onReject])

  return (
    <div className="dp-screen">
      <div className="dp-header">
        <span className="dp-title">New Delivery Request</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#e53935' }}>⏱ {seconds}s</span>
      </div>

      <div className="dp-content">
        <div className="dp-card">
          <div className="dp-row" style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>The Biryani House</span>
            <span className="dp-pill">₹65.00</span>
          </div>
          <div style={{ fontSize: 12.5, color: '#888', marginBottom: 12 }}>Anna Nagar, Chennai</div>

          <TimelineRow label="Pickup from" value="The Biryani House" dist="1.2 km" />
          <TimelineRow label="Deliver to" value="Ramesh Kumar, 12 Lake View Road" dist="5.8 km" last />

          <div className="dp-row" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed #eee' }}>
            <span style={{ fontSize: 13, color: '#666' }}>Order Details · 2 Items · ₹548</span>
            <span style={{ fontSize: 13, color: '#666' }}>View Items</span>
          </div>
          <div className="dp-row" style={{ marginTop: 8 }}>
            <span style={{ fontSize: 13, color: '#666' }}>Total Distance</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>7.0 km</span>
          </div>
          <div className="dp-row" style={{ marginTop: 4 }}>
            <span style={{ fontSize: 13, color: '#666' }}>Expected Earnings</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1a5c35' }}>₹65.00</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button className="dp-btn-outline" onClick={onReject}>Reject</button>
          <button className="dp-btn-primary" onClick={onAccept}>Accept Order</button>
        </div>
      </div>
    </div>
  )
}

function TimelineRow({ label, value, dist, last }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: last ? 0 : 10 }}>
      <span style={{ fontSize: 16 }}>{last ? '📍' : '🏬'}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: '#999' }}>{label}</div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#111' }}>{value}</div>
      </div>
      <span style={{ fontSize: 12, color: '#888' }}>{dist}</span>
    </div>
  )
}
