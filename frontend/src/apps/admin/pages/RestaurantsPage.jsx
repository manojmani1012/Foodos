import React from 'react'
import Table, { Badge } from '../components/Table'
import { RESTAURANTS } from '../mockData'

const COLUMNS = [
  { key: 'name', label: 'Restaurant' },
  { key: 'owner', label: 'Owner' },
  { key: 'joined', label: 'Joined On' },
  { key: 'status', label: 'Status', render: r => <Badge value={r.status} /> },
]

export default function RestaurantsPage() {
  return (
    <div className="admin-card">
      <div className="admin-row" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="admin-btn">+ Add Restaurant</button>
      </div>
      <Table columns={COLUMNS} rows={RESTAURANTS} />
    </div>
  )
}
