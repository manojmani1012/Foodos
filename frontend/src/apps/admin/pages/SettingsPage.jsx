import React from 'react'
import Table from '../components/Table'
import { SYSTEM_LOGS } from '../mockData'

const SETTINGS_SECTIONS = [
  { label: 'General Settings', desc: 'App name, currency, timezone' },
  { label: 'Commission & Fees', desc: 'Restaurant commission, delivery fees' },
  { label: 'Payment Settings', desc: 'Razorpay, wallet configuration' },
  { label: 'SMS & Email Settings', desc: 'OTP gateway, notification templates' },
  { label: 'App Configuration', desc: 'Onboarding flow, feature flags' },
  { label: 'Zones & Areas', desc: 'Serviceable delivery zones' },
]

const LOG_COLUMNS = [
  { key: 'time', label: 'Time' },
  { key: 'action', label: 'Action' },
  { key: 'module', label: 'Module' },
  { key: 'ip', label: 'IP Address' },
]

export default function SettingsPage() {
  return (
    <>
      <div className="admin-grid">
        {SETTINGS_SECTIONS.map(s => (
          <div className="admin-card" key={s.label} style={{ cursor: 'pointer' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 12.5, color: '#888' }}>{s.desc}</div>
          </div>
        ))}
      </div>

      <div className="admin-card">
        <div className="admin-card-title">System Activity Logs</div>
        <Table columns={LOG_COLUMNS} rows={SYSTEM_LOGS} />
      </div>
    </>
  )
}
