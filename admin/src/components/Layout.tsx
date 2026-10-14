import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Dashboard } from '../lib/types'
import { useLoad } from '../lib/useLoad'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/orders', label: 'Orders' },
  { to: '/restaurants', label: 'Restaurants' },
  { to: '/riders', label: 'Riders' },
  { to: '/customers', label: 'Customers' },
  { to: '/offers', label: 'Offers' },
  { to: '/payouts', label: 'Payouts' },
  { to: '/activity', label: 'Activity log' },
]

export default function Layout() {
  const { admin, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  // Counts of what is waiting on someone, shown beside the menu items.
  const summary = useLoad(() => api<Dashboard>('/api/v1/admin/dashboard'), 'nav', 60_000)
  const waiting = summary.data
  const badges: Record<string, number> = waiting
    ? {
        '/orders':
          waiting.attention.failedRefunds.length +
          waiting.attention.waitingForRestaurant.length +
          waiting.attention.waitingForRider.length,
        '/restaurants': waiting.restaurants.pending,
        '/riders': waiting.riders.pending,
      }
    : {}

  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <div className="shell">
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>
            Foodos <small>Admin</small>
          </span>
        </div>
        <nav aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
              <span>{item.label}</span>
              {badges[item.to] ? <span className="nav-badge">{badges[item.to]}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="me">
            <span className="me-name">{admin?.fullName || admin?.email}</span>
            <span className="me-role">{admin?.role === 'super_admin' ? 'Super admin' : 'Admin'}</span>
          </div>
          <button className="btn btn-small btn-ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="btn btn-small" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            Menu
          </button>
          <span className="topbar-title">Foodos Admin</span>
        </div>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
