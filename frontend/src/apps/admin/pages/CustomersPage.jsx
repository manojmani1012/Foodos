import React from 'react'
import Table from '../components/Table'
import { CUSTOMERS } from '../mockData'

const COLUMNS = [
  { key: 'name', label: 'Customer' },
  { key: 'phone', label: 'Phone' },
  { key: 'orders', label: 'Total Orders' },
  { key: 'joined', label: 'Joined On' },
]

export default function CustomersPage() {
  return (
    <div className="admin-card">
      <Table columns={COLUMNS} rows={CUSTOMERS} />
    </div>
  )
}
