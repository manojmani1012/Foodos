import React, { useState } from 'react'
import './admin.css'
import Sidebar from './components/Sidebar'
import DashboardPage from './pages/DashboardPage'
import OrdersPage from './pages/OrdersPage'
import RestaurantsPage from './pages/RestaurantsPage'
import DeliveryPartnersPage from './pages/DeliveryPartnersPage'
import CustomersPage from './pages/CustomersPage'
import AnalyticsPage from './pages/AnalyticsPage'
import PaymentsPage from './pages/PaymentsPage'
import OffersPage from './pages/OffersPage'
import SupportPage from './pages/SupportPage'
import SettingsPage from './pages/SettingsPage'

const PAGES = {
  dashboard: { title: 'Dashboard Overview', Component: DashboardPage },
  orders: { title: 'Orders Management', Component: OrdersPage },
  restaurants: { title: 'Restaurant Management', Component: RestaurantsPage },
  'delivery-partners': { title: 'Delivery Partners', Component: DeliveryPartnersPage },
  customers: { title: 'Customers', Component: CustomersPage },
  analytics: { title: 'Analytics & Reports', Component: AnalyticsPage },
  payments: { title: 'Payments & Settlements', Component: PaymentsPage },
  offers: { title: 'Offers & Promotions', Component: OffersPage },
  support: { title: 'Support & Tickets', Component: SupportPage },
  settings: { title: 'Settings & System Logs', Component: SettingsPage },
}

export default function App() {
  const [active, setActive] = useState('dashboard')
  const { title, Component } = PAGES[active]

  return (
    <div className="admin-shell">
      <Sidebar active={active} onSelect={setActive} />
      <main className="admin-main">
        <div className="admin-topbar">
          <span className="admin-page-title">{title}</span>
          <span style={{ fontSize: 13, color: '#888' }}>17 May, 2025</span>
        </div>
        <Component />
      </main>
    </div>
  )
}
