import React from 'react'
import FoodosLogo from '../../../components/FoodosLogo'

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: '📊' },
  { key: 'orders', label: 'Orders', icon: '🧾' },
  { key: 'restaurants', label: 'Restaurants', icon: '🍽️' },
  { key: 'delivery-partners', label: 'Delivery Partners', icon: '🛵' },
  { key: 'customers', label: 'Customers', icon: '👥' },
  { key: 'analytics', label: 'Analytics', icon: '📈' },
  { key: 'payments', label: 'Payments', icon: '💳' },
  { key: 'offers', label: 'Offers & Promotions', icon: '🎁' },
  { key: 'support', label: 'Support & Tickets', icon: '🛟' },
  { key: 'settings', label: 'Settings & Logs', icon: '⚙️' },
]

export default function Sidebar({ active, onSelect }) {
  return (
    <aside className="admin-sidebar">
      <div className="admin-logo-row">
        <FoodosLogo variant="inline" size={30} />
      </div>
      {NAV.map(item => (
        <button
          key={item.key}
          className={`admin-nav-item ${active === item.key ? 'active' : ''}`}
          onClick={() => onSelect(item.key)}
        >
          <span>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </aside>
  )
}
