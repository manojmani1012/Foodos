import React, { useState } from 'react'
import '../common.css'
import { ORDERS } from '../orderData'

const TABS = [
  { key: 'new', label: 'New' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
]

export default function OrdersScreen({ onBack, onSelectOrder }) {
  const [tab, setTab] = useState('new')
  const filtered = ORDERS.filter(o => o.status === tab)

  return (
    <div className="rp-screen">
      <div className="rp-header">
        <button className="rp-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#333" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="rp-title">Orders</span>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '16px 20px 0' }}>
        {TABS.map(t => {
          const count = ORDERS.filter(o => o.status === t.key).length
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: tab === t.key ? '#1a5c35' : '#f0f0f0',
                color: tab === t.key ? '#fff' : '#555', fontWeight: 600, fontSize: 13,
              }}
            >
              {t.label} ({count})
            </button>
          )
        })}
      </div>

      <div className="rp-content">
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: '#aaa', padding: '40px 0' }}>
            <span style={{ fontSize: 40 }}>📭</span>
            <p>No {tab} orders</p>
          </div>
        )}
        {filtered.map(o => (
          <div className="rp-card" key={o.id} onClick={() => onSelectOrder(o.id)} style={{ cursor: 'pointer' }}>
            <div className="rp-row">
              <span style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>#{o.id}</span>
              <span style={{ fontSize: 12, color: '#999' }}>{o.time}</span>
            </div>
            <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{o.customer}</div>
            <div className="rp-row" style={{ marginTop: 8 }}>
              <span style={{ fontSize: 13, color: '#666' }}>{o.items.length} item{o.items.length > 1 ? 's' : ''}</span>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#1a5c35' }}>₹{o.total}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
