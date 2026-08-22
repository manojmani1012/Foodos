import React, { useState } from 'react'
import '../common.css'

const WEEK = [
  { day: 'Mon', amt: 780 }, { day: 'Tue', amt: 950 }, { day: 'Wed', amt: 640 },
  { day: 'Thu', amt: 1100 }, { day: 'Fri', amt: 1245 }, { day: 'Sat', amt: 1580 }, { day: 'Sun', amt: 890 },
]

export default function EarningsScreen({ onBack }) {
  const [tab, setTab] = useState('Weekly')
  const total = WEEK.reduce((s, d) => s + d.amt, 0)
  const max = Math.max(...WEEK.map(d => d.amt))

  return (
    <div className="dp-screen">
      <div className="dp-header">
        <button className="dp-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#333" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="dp-title">Earnings</span>
      </div>

      <div className="dp-content">
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['Daily', 'Weekly', 'Monthly'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: tab === t ? '#1a5c35' : '#f0f0f0',
                color: tab === t ? '#fff' : '#555', fontWeight: 600, fontSize: 13,
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="dp-card" style={{ background: '#e8f5e9' }}>
          <div style={{ fontSize: 12, color: '#666' }}>{tab} Earnings</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#1a5c35' }}>₹{total.toLocaleString()}</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>13 May - 19 May, 2025 · 8 Trips Completed</div>
        </div>

        <div className="dp-card">
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 14 }}>Earnings Trend</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 120 }}>
            {WEEK.map(d => (
              <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: '100%', height: `${(d.amt / max) * 90}px`, background: '#1a5c35',
                  borderRadius: 6, minHeight: 4,
                }} />
                <span style={{ fontSize: 10, color: '#999' }}>{d.day}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dp-card">
          <div className="dp-row"><span style={{ fontSize: 13, color: '#666' }}>Trip Earnings</span><span style={{ fontSize: 13, fontWeight: 700 }}>₹{Math.round(total * 0.8)}</span></div>
          <div className="dp-row" style={{ marginTop: 8 }}><span style={{ fontSize: 13, color: '#666' }}>Incentives</span><span style={{ fontSize: 13, fontWeight: 700 }}>₹{Math.round(total * 0.15)}</span></div>
          <div className="dp-row" style={{ marginTop: 8 }}><span style={{ fontSize: 13, color: '#666' }}>Tips</span><span style={{ fontSize: 13, fontWeight: 700 }}>₹{Math.round(total * 0.05)}</span></div>
        </div>
      </div>
    </div>
  )
}
