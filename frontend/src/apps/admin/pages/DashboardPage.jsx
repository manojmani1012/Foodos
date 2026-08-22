import React from 'react'
import StatCard from '../components/StatCard'
import Table, { Badge } from '../components/Table'
import { STATS, ORDERS } from '../mockData'

const ORDER_COLUMNS = [
  { key: 'id', label: 'Order ID', render: r => `#${r.id}` },
  { key: 'customer', label: 'Customer' },
  { key: 'restaurant', label: 'Restaurant' },
  { key: 'amount', label: 'Amount', render: r => `₹${r.amount}` },
  { key: 'status', label: 'Status', render: r => <Badge value={r.status} /> },
  { key: 'time', label: 'Time' },
]

export default function DashboardPage() {
  return (
    <>
      <div className="admin-grid">
        <StatCard label="Total Orders" value={STATS.totalOrders.toLocaleString()} trend="+18.0% vs yesterday" />
        <StatCard label="Total Revenue" value={`₹${STATS.totalRevenue.toLocaleString()}`} trend="+21.4% vs yesterday" />
        <StatCard label="Active Restaurants" value={STATS.activeRestaurants.toLocaleString()} trend="+12.7% vs yesterday" />
        <StatCard label="Delivery Partners" value={STATS.deliveryPartners.toLocaleString()} trend="+15.3% vs yesterday" />
      </div>

      <div className="admin-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="admin-card">
          <div className="admin-card-title">Orders Overview (This Week)</div>
          <MiniBarChart />
        </div>
        <div className="admin-card">
          <div className="admin-card-title">Order Status</div>
          <StatusBreakdown />
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card-title">Recent Orders</div>
        <Table columns={ORDER_COLUMNS} rows={ORDERS} />
      </div>
    </>
  )
}

function MiniBarChart() {
  const data = [2000, 2400, 1900, 2600, 2800, 3100, 2200]
  const max = Math.max(...data)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 140 }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ width: '100%', height: `${(v / max) * 110}px`, background: '#1a5c35', borderRadius: 6 }} />
          <span style={{ fontSize: 11, color: '#999' }}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>
        </div>
      ))}
    </div>
  )
}

function StatusBreakdown() {
  const rows = [
    { label: 'Delivered', pct: 59.7, color: '#1a5c35' },
    { label: 'Confirmed', pct: 15.1, color: '#1565c0' },
    { label: 'On the Way', pct: 13.4, color: '#e65100' },
    { label: 'Pending', pct: 8.0, color: '#fbc02d' },
    { label: 'Cancelled', pct: 2.3, color: '#e53935' },
  ]
  return (
    <div>
      {rows.map(r => (
        <div key={r.label} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
            <span style={{ color: '#555' }}>{r.label}</span>
            <span style={{ fontWeight: 700 }}>{r.pct}%</span>
          </div>
          <div style={{ height: 6, background: '#f0f0f0', borderRadius: 6 }}>
            <div style={{ width: `${r.pct}%`, height: '100%', background: r.color, borderRadius: 6 }} />
          </div>
        </div>
      ))}
    </div>
  )
}
