import React, { useState } from 'react'
import './HomeScreen.css'
import FoodosLogo from '../../../components/FoodosLogo'
import { RESTAURANTS } from '../../../data/menuData'

const CATEGORIES = [
  { id: 1, label: 'Biryani', emoji: '🍛' },
  { id: 2, label: 'Pizza', emoji: '🍕' },
  { id: 3, label: 'Burger', emoji: '🍔' },
  { id: 4, label: 'Chicken', emoji: '🍗' },
  { id: 5, label: 'Healthy', emoji: '🥗' },
  { id: 6, label: 'Desserts', emoji: '🍰' },
]

const TOP_OFFERS = [
  { id: 1, label: '50% OFF', sub: 'Up to ₹100 on first order', code: 'FOODNEW', color: '#1a5c35' },
  { id: 2, label: 'FREE DELIVERY', sub: 'On orders above ₹299', code: 'FREEDEL', color: '#e65100' },
  { id: 3, label: '20% OFF', sub: 'On orders above ₹499', code: 'SAVE20', color: '#6a1b9a' },
  { id: 4, label: '₹75 OFF', sub: 'Weekend special', code: 'WEEKEND75', color: '#1565c0' },
]

export default function HomeScreen({ onSelectRestaurant, onGoProfile, orders = [], favourites = [], onToggleFavourite, initialTab = 'home' }) {
  const [activeTab, setActiveTab] = useState(initialTab)
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState(null)
  const [showAllOffers, setShowAllOffers] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState(null)

  const filtered = RESTAURANTS.filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    return r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q)
  })
  const favouriteRestaurants = RESTAURANTS.filter(r => favourites.includes(r.id))
  const visibleOffers = showAllOffers ? TOP_OFFERS : TOP_OFFERS.slice(0, 2)
  const activeCatLabel = CATEGORIES.find(c => c.id === activeCat)?.label
  const homeRestaurants = activeCatLabel
    ? RESTAURANTS.filter(r => r.cuisine.toLowerCase().includes(activeCatLabel.toLowerCase()))
    : RESTAURANTS

  return (
    <div className="home-screen">
      {/* Header */}
      <div className="home-header">
        <div className="location-row">
          <FoodosLogo size={30} dark />
          <div className="location-info" style={{ flex: 1, marginLeft: 10 }}>
            <div className="location-label">Deliver now</div>
            <div className="location-value">
              Velachery, Chennai
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="#1a5c35" strokeWidth="2.4" strokeLinecap="round"/></svg>
            </div>
          </div>
          <div className="header-icons">
            <button className="icon-btn notif">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span className="notif-badge">2</span>
            </button>
          </div>
        </div>

        {(activeTab === 'home' || activeTab === 'search') && (
          <div className="search-bar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="#aaa" strokeWidth="2"/><path d="m21 21-4.35-4.35" stroke="#aaa" strokeWidth="2" strokeLinecap="round"/></svg>
            <input
              className="search-input"
              placeholder="Search for restaurant or cuisine..."
              autoFocus={activeTab === 'search'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="clear-btn" onClick={() => setSearch('')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="#999" strokeWidth="2" strokeLinecap="round"/></svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="home-content">
        {activeTab === 'home' && (
          <>
            {/* Banner */}
            <div className="banner-section">
              <div className="banner-card">
                <div className="banner-text">
                  <span className="banner-offer">50% OFF</span>
                  <span className="banner-line">on First Order</span>
                  <span className="banner-code">Use Code: <strong>FOOD060</strong></span>
                </div>
                <div className="banner-img">🍕</div>
              </div>
            </div>

            {/* Categories */}
            <div className="section">
              <div className="section-header">
                <span className="section-title">Categories</span>
                <button className="see-all" onClick={() => setActiveTab('search')}>See all</button>
              </div>
              <div className="categories-row">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    className={`cat-chip ${activeCat === cat.id ? 'active' : ''}`}
                    onClick={() => setActiveCat(activeCat === cat.id ? null : cat.id)}
                  >
                    <span className="cat-emoji">{cat.emoji}</span>
                    <span className="cat-label">{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Top Offers */}
            <div className="section">
              <div className="section-header">
                <span className="section-title">Top Offers</span>
                <button className="see-all" onClick={() => setShowAllOffers(v => !v)}>
                  {showAllOffers ? 'Show less' : 'See all'}
                </button>
              </div>
              <div className="offers-row">
                {visibleOffers.map(offer => (
                  <div key={offer.id} className="offer-card" style={{ background: offer.color }}>
                    <div className="offer-label">{offer.label}</div>
                    <div className="offer-sub">{offer.sub}</div>
                    <div className="offer-code">{offer.code}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Restaurants */}
            <div className="section">
              <div className="section-header">
                <span className="section-title">{activeCatLabel ? `${activeCatLabel} Restaurants` : 'Top Restaurants'}</span>
                <button className="see-all" onClick={() => setActiveTab('search')}>See all</button>
              </div>
              <div className="restaurant-list">
                {homeRestaurants.map(r => (
                  <RestaurantCard
                    key={r.id}
                    restaurant={r}
                    onClick={() => onSelectRestaurant?.(r.id)}
                    isFav={favourites.includes(r.id)}
                    onToggleFav={() => onToggleFavourite?.(r.id)}
                  />
                ))}
                {homeRestaurants.length === 0 && (
                  <div className="empty-state">
                    <span style={{ fontSize: 40 }}>🍽️</span>
                    <p>No restaurants in this category</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === 'search' && (
          <div className="section">
            <div className="section-header">
              <span className="section-title">{search ? `Results for "${search}"` : 'Search restaurants'}</span>
            </div>
            <div className="restaurant-list">
              {filtered.map(r => (
                <RestaurantCard
                  key={r.id}
                  restaurant={r}
                  onClick={() => onSelectRestaurant?.(r.id)}
                  isFav={favourites.includes(r.id)}
                  onToggleFav={() => onToggleFavourite?.(r.id)}
                />
              ))}
              {filtered.length === 0 && (
                <div className="empty-state">
                  <span style={{ fontSize: 40 }}>🔍</span>
                  <p>No restaurants found</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="section">
            <div className="section-header">
              <span className="section-title">My Orders</span>
            </div>
            {orders.length === 0 ? (
              <div className="empty-state">
                <span style={{ fontSize: 40 }}>📦</span>
                <p>No orders yet</p>
              </div>
            ) : (
              <div className="orders-list">
                {orders.map(o => {
                  const restaurant = RESTAURANTS.find(r => r.id === o.restaurantId)
                  return (
                    <div className="order-row" key={o.id} onClick={() => setSelectedOrder(o)}>
                      <div className="order-row-emoji">{restaurant?.emoji || '🍽️'}</div>
                      <div className="order-row-info">
                        <div className="order-row-name">{restaurant?.name || 'Restaurant'}</div>
                        <div className="order-row-meta">Order #{o.id} · {o.date}</div>
                      </div>
                      <div className="order-row-right">
                        <div className="order-row-total">₹{o.total}</div>
                        <span className={`order-status-pill ${o.status === 'Delivered' ? 'delivered' : 'active'}`}>{o.status}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'favourites' && (
          <div className="section">
            <div className="section-header">
              <span className="section-title">Favourites</span>
            </div>
            {favouriteRestaurants.length === 0 ? (
              <div className="empty-state">
                <span style={{ fontSize: 40 }}>❤️</span>
                <p>No favourites yet</p>
              </div>
            ) : (
              <div className="restaurant-list">
                {favouriteRestaurants.map(r => (
                  <RestaurantCard
                    key={r.id}
                    restaurant={r}
                    onClick={() => onSelectRestaurant?.(r.id)}
                    isFav={true}
                    onToggleFav={() => onToggleFavourite?.(r.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ height: 80 }} />
      </div>

      {/* Bottom Nav */}
      <nav className="bottom-nav">
        {[
          { id: 'home', label: 'Home', icon: HomeIcon },
          { id: 'search', label: 'Search', icon: SearchIcon },
          { id: 'orders', label: 'Orders', icon: OrderIcon },
          { id: 'favourites', label: 'Favourites', icon: HeartIcon },
          { id: 'profile', label: 'Profile', icon: ProfileIcon },
        ].map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => {
                if (tab.id === 'profile') {
                  onGoProfile?.()
                  return
                }
                setActiveTab(tab.id)
              }}
            >
              <Icon active={activeTab === tab.id} />
              <span className="nav-label">{tab.label}</span>
            </button>
          )
        })}
      </nav>

      {selectedOrder && (
        <OrderDetailOverlay order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}
    </div>
  )
}

function OrderDetailOverlay({ order, onClose }) {
  const restaurant = RESTAURANTS.find(r => r.id === order.restaurantId)
  const steps = ['Confirmed', 'Preparing', 'Picked Up', 'On the Way', 'Delivered']
  const currentStepIndex = order.status === 'Delivered' ? steps.length - 1 : 3

  return (
    <div className="order-detail-overlay">
      <div className="order-detail-header">
        <button className="order-detail-back" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#333" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="order-detail-title">Order Details</span>
      </div>

      <div className="order-detail-content">
        <div className="order-detail-restaurant">
          <span className="order-detail-emoji">{restaurant?.emoji || '🍽️'}</span>
          <div>
            <div className="order-detail-name">{restaurant?.name || 'Restaurant'}</div>
            <div className="order-detail-address">{restaurant?.address}</div>
          </div>
        </div>

        <div className="order-detail-meta-card">
          <div className="order-detail-meta-row">
            <span>Order ID</span>
            <span>#{order.id}</span>
          </div>
          <div className="order-detail-meta-row">
            <span>Date</span>
            <span>{order.date}</span>
          </div>
          <div className="order-detail-meta-row">
            <span>Amount Paid</span>
            <span>₹{order.total}</span>
          </div>
          <div className="order-detail-meta-row">
            <span>Status</span>
            <span className={`order-status-pill ${order.status === 'Delivered' ? 'delivered' : 'active'}`}>{order.status}</span>
          </div>
        </div>

        <div className="order-detail-section-title">Order Status</div>
        <div className="order-detail-timeline">
          {steps.map((step, idx) => (
            <div className="order-detail-step" key={step}>
              <span className={`order-detail-dot ${idx <= currentStepIndex ? 'done' : ''}`} />
              <span className={`order-detail-step-label ${idx <= currentStepIndex ? 'done' : ''}`}>{step}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function RestaurantCard({ restaurant: r, onClick, isFav, onToggleFav }) {
  return (
    <div className="restaurant-card" onClick={onClick}>
      <div className="restaurant-img" style={{ background: r.color }}>
        <span style={{ fontSize: 48 }}>{r.emoji}</span>
        <button className="fav-btn" onClick={e => { e.stopPropagation(); onToggleFav?.() }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill={isFav ? '#e53935' : 'none'}>
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke={isFav ? '#e53935' : '#ccc'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
      <div className="restaurant-info">
        <div className="restaurant-name">{r.name}</div>
        <div className="restaurant-cuisine">{r.cuisine}</div>
        <div className="restaurant-meta">
          <span className="rating-badge">⭐ {r.rating} ({r.reviews}k+)</span>
          <span className="dot-sep">·</span>
          <span className="time-badge">🕒 {r.time}</span>
          <span className="dot-sep">·</span>
          <span className="delivery-badge">{r.delivery}</span>
        </div>
        {r.tag && <span className="tag-pill">{r.tag}</span>}
      </div>
    </div>
  )
}

function HomeIcon({ active }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke={active ? '#1a5c35' : '#aaa'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill={active ? '#e8f5e9' : 'none'}/><polyline points="9,22 9,12 15,12 15,22" stroke={active ? '#1a5c35' : '#aaa'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function SearchIcon({ active }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={active ? '#1a5c35' : '#aaa'} strokeWidth="2"/><path d="m21 21-4.35-4.35" stroke={active ? '#1a5c35' : '#aaa'} strokeWidth="2" strokeLinecap="round"/></svg>
}
function OrderIcon({ active }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" stroke={active ? '#1a5c35' : '#aaa'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><rect x="9" y="3" width="6" height="4" rx="1" ry="1" stroke={active ? '#1a5c35' : '#aaa'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function HeartIcon({ active }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? '#e53935' : 'none'}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke={active ? '#e53935' : '#aaa'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function ProfileIcon({ active }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke={active ? '#1a5c35' : '#aaa'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="7" r="4" stroke={active ? '#1a5c35' : '#aaa'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
