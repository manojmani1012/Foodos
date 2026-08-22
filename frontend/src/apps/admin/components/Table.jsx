import React from 'react'

const BADGE_COLORS = {
  Delivered: 'green', Active: 'green', Success: 'green', Online: 'green', Resolved: 'green', Open: 'red',
  'On the Way': 'blue', 'On Delivery': 'blue', Preparing: 'orange', Pending: 'orange', 'In Progress': 'orange', Scheduled: 'orange',
  Cancelled: 'red', Suspended: 'red', High: 'red',
  Offline: 'grey', Medium: 'orange', Low: 'grey',
}

export function Badge({ value }) {
  return <span className={`admin-badge ${BADGE_COLORS[value] || 'grey'}`}>{value}</span>
}

/**
 * Generic table. columns: [{ key, label, render? }]
 */
export default function Table({ columns, rows, onRowClick }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="admin-table">
        <thead>
          <tr>{columns.map(c => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i} onClick={() => onRowClick?.(row)} style={{ cursor: onRowClick ? 'pointer' : 'default' }}>
              {columns.map(c => (
                <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>No records found</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
