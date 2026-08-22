import React from 'react'
import '../common.css'
import FoodosLogo from '../../../components/FoodosLogo'
import { ORDERS } from '../orderData'

export default function DashboardScreen({ online, setOnline, onGoOrders, onGoProfile }) {
  const newCount = ORDERS.filter(o => o.status === 'new').length
  const preparingCount = ORDERS.filter(o => o.status === 'preparing').length
  const readyCount = ORDERS.filter(o => o.status === 'ready').length
  const todayRevenue = ORDERS.reduce((s, o) => s + o.total, 0)

  return (
    <div className="rp-screen">
      <div className="rp-header" style={{ background: '#1a5c35', flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
        <div className="rp-row">
          <FoodosLogo variant="inline" size={26} />
          <button onClick={onGoProfile} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer' }}>👤</button>
        </div>
        <div className="rp-row">
          <div style={{ color: '#fff' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>The Biryani House</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>⭐ 4.6</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontSize: 13, fontWeight: 600 }}>
            {online ? 'Accepting Orders' : 'Closed'}
            <ToggleSwitch checked={online} onChange={() => setOnline(v => !v)} />
          </label>
        </div>
      </div>

      <div className="rp-content">
        <div className="rp-card" style={{ background: '#e8f5e9' }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Today's Overview</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#1a5c35' }}>₹{todayRevenue.toLocaleString()}</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{ORDERS.length} Orders Today</div>
        </div>

        <div className="rp-row" style={{ gap: 10, marginBottom: 14 }}>
          <StatBox label="New" value={newCount} color="#e65100" />
          <StatBox label="Preparing" value={preparingCount} color="#1565c0" />
          <StatBox label="Ready" value={readyCount} color="#1a5c35" />
        </div>

        <button className="rp-btn-primary" onClick={onGoOrders}>View All Orders</button>
      </div>
    </div>
  )
}

function StatBox({ label, value, color }) {
  return (
    <div className="rp-card" style={{ flex: 1, textAlign: 'center', margin: 0, padding: 12 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      onClick={onChange}
      style={{
        width: 40, height: 22, borderRadius: 20, border: 'none', cursor: 'pointer',
        background: checked ? '#8bd18f' : 'rgba(255,255,255,0.3)', position: 'relative', transition: 'background 0.2s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 20 : 2, width: 18, height: 18, borderRadius: '50%',
        background: '#fff', transition: 'left 0.2s',
      }} />
    </button>
  )
}
