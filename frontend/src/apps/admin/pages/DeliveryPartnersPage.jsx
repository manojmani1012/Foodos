import React from 'react'
import Table, { Badge } from '../components/Table'
import { DELIVERY_PARTNERS } from '../mockData'

const COLUMNS = [
  { key: 'name', label: 'Partner' },
  { key: 'phone', label: 'Phone' },
  { key: 'rating', label: 'Rating', render: r => `⭐ ${r.rating}` },
  { key: 'joined', label: 'Joined On' },
  { key: 'status', label: 'Status', render: r => <Badge value={r.status} /> },
]

export default function DeliveryPartnersPage() {
  return (
    <div className="admin-card">
      <Table columns={COLUMNS} rows={DELIVERY_PARTNERS} />
    </div>
  )
}
