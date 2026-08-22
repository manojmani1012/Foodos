import React from 'react'

export default function StatCard({ label, value, trend }) {
  return (
    <div className="admin-card">
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value">{value}</div>
      {trend && <div className="admin-stat-trend">{trend}</div>}
    </div>
  )
}
