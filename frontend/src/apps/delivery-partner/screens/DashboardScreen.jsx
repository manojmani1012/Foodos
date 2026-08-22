import React, { useState } from 'react'
import '../common.css'
import FoodosLogo from '../../../components/FoodosLogo'

export default function DashboardScreen({ online, setOnline, todayEarnings, trips, hours, rating, onGoEarnings, onGoProfile }) {
  const targetTrips = 15
  const progressPct = Math.min(100, Math.round((trips / targetTrips) * 100))

  return (
    <div className="dp-screen">
      <div className="dp-header" style={{ background: '#1a5c35', flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
        <div className="dp-row">
          <FoodosLogo variant="inline" size={26} />
          <button onClick={onGoProfile} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer' }}>👤</button>
        </div>
        <div className="dp-row">
          <div style={{ color: '#fff' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Manoj Mani</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>⭐ 4.8</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontSize: 13, fontWeight: 600 }}>
            {online ? 'Online' : 'Offline'}
            <ToggleSwitch checked={online} onChange={() => setOnline(v => !v)} />
          </label>
        </div>
      </div>

      <div className="dp-content">
        <div className="dp-card" style={{ background: '#e8f5e9' }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Today's Earnings</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#1a5c35' }}>₹{todayEarnings}</div>
        </div>

        <div className="dp-row" style={{ gap: 10, marginBottom: 14 }}>
          <StatBox label="Trips" value={trips} />
          <StatBox label="Earnings" value={`₹${todayEarnings}`} />
          <StatBox label="Hours" value={hours} />
          <StatBox label="Rating" value={`${rating}★`} />
        </div>

        <div className="dp-card">
          <div className="dp-row" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>Today's Progress</span>
            <span style={{ fontSize: 12, color: '#888' }}>{trips} / {targetTrips} Trips</span>
          </div>
          <div style={{ height: 8, background: '#eee', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ width: `${progressPct}%`, height: '100%', background: '#1a5c35' }} />
          </div>
          <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>🎁 Incentive Zone: Complete {targetTrips} trips to earn ₹250 extra</div>
        </div>

        <button className="dp-btn-primary" style={{ background: '#fff', color: '#1a5c35', border: '1.5px solid #1a5c35' }} onClick={onGoEarnings}>
          View Earnings History
        </button>
      </div>
    </div>
  )
}

function StatBox({ label, value }) {
  return (
    <div className="dp-card" style={{ flex: 1, textAlign: 'center', margin: 0, padding: 12 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{value}</div>
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
