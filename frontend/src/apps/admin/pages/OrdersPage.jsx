import React, { useState } from 'react'
import Table, { Badge } from '../components/Table'
import { ORDERS } from '../mockData'

const COLUMNS = [
  { key: 'id', label: 'Order ID', render: r => `#${r.id}` },
  { key: 'customer', label: 'Customer' },
  { key: 'restaurant', label: 'Restaurant' },
  { key: 'amount', label: 'Amount', render: r => `₹${r.amount}` },
  { key: 'status', label: 'Status', render: r => <Badge value={r.status} /> },
  { key: 'time', label: 'Time' },
]

const TABS = ['All', 'Pending', 'Preparing', 'On the Way', 'Delivered', 'Cancelled']

export default function OrdersPage() {
  const [tab, setTab] = useState('All')
  const rows = tab === 'All' ? ORDERS : ORDERS.filter(o => o.status === tab)

  return (
    <div className="admin-card">
      <div className="admin-tabs">
        {TABS.map(t => (
          <button key={t} className={`admin-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <Table columns={COLUMNS} rows={rows} />
    </div>
  )
}
