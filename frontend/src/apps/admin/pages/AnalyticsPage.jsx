import React from 'react'
import StatCard from '../components/StatCard'
import { RESTAURANTS, STATS } from '../mockData'

export default function AnalyticsPage() {
  const topRestaurants = [
    { name: 'The Biryani House', revenue: 245600 },
    { name: 'Pizza Corner', revenue: 172400 },
    { name: 'Burger Hub', revenue: 105480 },
    { name: 'Dosa Express', revenue: 89230 },
  ]
  const max = Math.max(...topRestaurants.map(r => r.revenue))

  return (
    <>
      <div className="admin-grid">
        <StatCard label="Avg Order Value" value="₹146.05" trend="+2.6%" />
        <StatCard label="Completion Rate" value="94.6%" trend="+3.2%" />
        <StatCard label="Total Restaurants" value={STATS.activeRestaurants} />
        <StatCard label="Total Customers" value="45,892" trend="+16.9%" />
      </div>

      <div className="admin-card">
        <div className="admin-card-title">Top Performing Restaurants</div>
        {topRestaurants.map(r => (
          <div key={r.name} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: '#333', fontWeight: 600 }}>{r.name}</span>
              <span style={{ color: '#1a5c35', fontWeight: 700 }}>₹{r.revenue.toLocaleString()}</span>
            </div>
            <div style={{ height: 8, background: '#f0f0f0', borderRadius: 6 }}>
              <div style={{ width: `${(r.revenue / max) * 100}%`, height: '100%', background: '#1a5c35', borderRadius: 6 }} />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
