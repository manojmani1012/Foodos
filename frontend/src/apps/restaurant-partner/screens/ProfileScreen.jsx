import React from 'react'
import '../common.css'

const MENU = ['Restaurant Details', 'Menu Management', 'Analytics', 'Payments & Payouts', 'Help & Support', 'Settings']

export default function ProfileScreen({ onBack, onLogout, onAddMenuItem }) {
  return (
    <div className="rp-screen">
      <div className="rp-header" style={{ background: '#1a5c35' }}>
        <button className="rp-back" onClick={onBack} style={{ background: 'rgba(255,255,255,0.15)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="rp-title" style={{ color: '#fff' }}>Profile</span>
      </div>

      <div className="rp-content">
        <div className="rp-card" style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: -30 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>🍽️</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>The Biryani House</div>
            <div style={{ fontSize: 13, color: '#888' }}>Anna Nagar, Chennai · ⭐ 4.6</div>
          </div>
        </div>

        <button className="rp-btn-primary" style={{ marginBottom: 14 }} onClick={onAddMenuItem}>+ Add Menu Item</button>

        <div className="rp-card" style={{ padding: 0, overflow: 'hidden' }}>
          {MENU.map((m, i) => (
            <button key={m} style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '15px 16px', border: 'none', borderBottom: i < MENU.length - 1 ? '1px solid #f2f2f2' : 'none',
              background: '#fff', cursor: 'pointer', fontSize: 14.5, fontFamily: 'Inter, sans-serif', color: '#333',
            }}>
              {m}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="#ccc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          ))}
        </div>

        <button className="rp-btn-outline" onClick={onLogout}>Logout</button>
      </div>
    </div>
  )
}
