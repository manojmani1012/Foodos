import React from 'react'
import Table, { Badge } from '../components/Table'
import { TRANSACTIONS } from '../mockData'

const COLUMNS = [
  { key: 'id', label: 'Transaction ID' },
  { key: 'type', label: 'Type' },
  { key: 'amount', label: 'Amount', render: r => `${r.amount < 0 ? '-' : ''}₹${Math.abs(r.amount)}` },
  { key: 'status', label: 'Status', render: r => <Badge value={r.status} /> },
  { key: 'date', label: 'Date' },
]

export default function PaymentsPage() {
  return (
    <div className="admin-card">
      <Table columns={COLUMNS} rows={TRANSACTIONS} />
    </div>
  )
}
