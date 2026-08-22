import React, { useState } from 'react'
import './ProfileScreen.css'
import FoodosLogo from '../../../components/FoodosLogo'

const MENU_ITEMS = [
  { icon: '📦', label: 'My Orders', tab: 'orders' },
  { icon: '📍', label: 'Saved Addresses' },
  { icon: '💳', label: 'Payments & Wallet' },
  { icon: '❤️', label: 'Favourites', tab: 'favourites' },
  { icon: '🎁', label: 'Refer & Earn' },
  { icon: '🛟', label: 'Help & Support' },
]

export default function ProfileScreen({ onBack, onLogout, onGoHomeTab }) {
  const [toast, setToast] = useState('')

  function handleMenuClick(item) {
    if (item.tab) {
      onGoHomeTab?.(item.tab)
      return
    }
    setToast(`${item.label} — coming soon`)
    setTimeout(() => setToast(''), 1600)
  }

  return (
    <div className="profile-screen">
      <div className="profile-header">
        <button className="profile-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="profile-header-title">Profile</span>
      </div>

      <div className="profile-content">
        <div className="profile-card">
          <div className="profile-avatar">👤</div>
          <div className="profile-info">
            <div className="profile-name">Manoj Mani</div>
            <div className="profile-phone">+91 98765 43210</div>
          </div>
        </div>

        <div className="profile-menu">
          {MENU_ITEMS.map(item => (
            <button className="profile-menu-item" key={item.label} onClick={() => handleMenuClick(item)}>
              <span className="profile-menu-icon">{item.icon}</span>
              <span className="profile-menu-label">{item.label}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="#ccc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          ))}
        </div>

        <button className="profile-logout" onClick={onLogout}>Logout</button>

        <div className="profile-brand">
          <FoodosLogo variant="inline" size={22} />
        </div>
      </div>

      {toast && <div className="profile-toast">{toast}</div>}
    </div>
  )
}
