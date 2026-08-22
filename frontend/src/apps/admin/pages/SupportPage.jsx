import React from 'react'
import Table, { Badge } from '../components/Table'
import { TICKETS } from '../mockData'

const COLUMNS = [
  { key: 'id', label: 'Ticket ID' },
  { key: 'subject', label: 'Subject' },
  { key: 'priority', label: 'Priority', render: r => <Badge value={r.priority} /> },
  { key: 'status', label: 'Status', render: r => <Badge value={r.status} /> },
  { key: 'createdOn', label: 'Created On' },
]

export default function SupportPage() {
  return (
    <div className="admin-card">
      <Table columns={COLUMNS} rows={TICKETS} />
    </div>
  )
}
