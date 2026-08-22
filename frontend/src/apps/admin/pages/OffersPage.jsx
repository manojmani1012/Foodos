import React from 'react'
import { Badge } from '../components/Table'
import { OFFERS } from '../mockData'

export default function OffersPage() {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="admin-btn">+ Create Offer</button>
      </div>
      <div className="admin-grid">
        {OFFERS.map(o => (
          <div className="admin-card" key={o.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#1a5c35' }}>{o.name}</span>
              <Badge value={o.status} />
            </div>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>{o.type}</div>
            <div style={{ fontSize: 13, color: '#333', fontWeight: 600, marginBottom: 8 }}>{o.discount}</div>
            <div style={{ fontSize: 12, color: '#999' }}>{o.usage.toLocaleString()} uses</div>
          </div>
        ))}
      </div>
    </>
  )
}
