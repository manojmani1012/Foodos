import React, { useState } from 'react'
import './HomeScreen.css'
import FoodosLogo from '../../../components/FoodosLogo'
import { fetchCuisines, fetchFavourites, fetchOffers, fetchRestaurants } from '../../../lib/catalogue.js'
import { fetchOrders } from '../../../lib/orders.js'
import { useAuth } from '../../../lib/AuthContext.jsx'
import { useAsync, useDebounced } from '../../../lib/useAsync.js'

const STATUS_LABEL = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  picked_up: 'Picked up',
  on_the_way: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

const STATUS_TONE = { delivered: 'delivered', cancelled: 'cancelled' }

export default function HomeScreen({ onSelectRestaurant, onGoProfile, onOpenOrder, favourites = [], onToggleFavourite, initialTab = 'home' }) {
  const { isSignedIn } = useAuth()
  const [activeTab, setActiveTab] = useState(initialTab)
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState(null)
  const [showAllOffers, setShowAllOffers] = useState(false)

  // Searching and filtering happen on the server, so the phone never holds the
  // whole catalogue. Typing is debounced to avoid a request per keystroke.
  const settledSearch = useDebounced(search)

  const restaurantsQuery = useAsync(
    () => fetchRestaurants({ search: settledSearch, cuisine: activeCat }),
    [settledSearch, activeCat],
  )
  const cuisinesQuery = useAsync(fetchCuisines, [])
  const offersQuery = useAsync(fetchOffers, [])

  const restaurants = restaurantsQuery.data?.restaurants ?? []
  const categories = cuisinesQuery.data ?? []
  const allOffers = offersQuery.data ?? []

  // The search tab and the home list read from the same request; the difference
  // is only which one the user is looking at.
  const filtered = restaurants
  const homeRestaurants = restaurants
  const favouritesQuery = useAsync(
    () => (isSignedIn ? fetchFavourites() : Promise.resolve([])),
    [isSignedIn, favourites.length],
  )
  const favouriteRestaurants = favouritesQuery.data ?? []

  // Reloaded whenever the tab is opened, so an order placed moments ago appears.
  const ordersQuery = useAsync(
    () => (isSignedIn ? fetchOrders() : Promise.resolve([])),
    [isSignedIn, activeTab],
  )
  const orders = ordersQuery.data ?? []
  const visibleOffers = showAllOffers ? allOffers : allOffers.slice(0, 2)

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
                {cuisinesQuery.loading && <div className="row-hint">Loading…</div>}
                {categories.map(cat => (
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
                <span className="section-title">{activeCat ? `${activeCat} Restaurants` : 'Top Restaurants'}</span>
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
                {restaurantsQuery.loading && <RestaurantSkeletons />}
                {restaurantsQuery.error && (
                  <LoadFailed message={restaurantsQuery.error.message} onRetry={restaurantsQuery.reload} />
                )}
                {!restaurantsQuery.loading && !restaurantsQuery.error && homeRestaurants.length === 0 && (
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
              {restaurantsQuery.loading && <RestaurantSkeletons />}
              {restaurantsQuery.error && (
                <LoadFailed message={restaurantsQuery.error.message} onRetry={restaurantsQuery.reload} />
              )}
              {!restaurantsQuery.loading && !restaurantsQuery.error && filtered.length === 0 && (
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
            {ordersQuery.loading ? (
              <RestaurantSkeletons count={2} />
            ) : orders.length === 0 ? (
              <div className="empty-state">
                <span style={{ fontSize: 40 }}>📦</span>
                <p>{isSignedIn ? 'No orders yet' : 'Sign in to see your orders'}</p>
              </div>
            ) : (
              <div className="orders-list">
                {orders.map(o => (
                  <div className="order-row" key={o.id} onClick={() => onOpenOrder?.(o.id)}>
                    <div className="order-row-emoji">🍽️</div>
                    <div className="order-row-info">
                      <div className="order-row-name">{o.restaurant?.name || 'Restaurant'}</div>
                      <div className="order-row-meta">
                        #{o.orderNumber} · {new Date(o.placedAt).toLocaleDateString()} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div className="order-row-right">
                      <div className="order-row-total">₹{o.total}</div>
                      <span className={`order-status-pill ${STATUS_TONE[o.status] || 'active'}`}>
                        {STATUS_LABEL[o.status] || o.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'favourites' && (
          <div className="section">
            <div className="section-header">
              <span className="section-title">Favourites</span>
            </div>
            {favouritesQuery.loading ? (
              <RestaurantSkeletons />
            ) : favouriteRestaurants.length === 0 ? (
              <div className="empty-state">
                <span style={{ fontSize: 40 }}>❤️</span>
                <p>{isSignedIn ? 'No favourites yet' : 'Sign in to save favourites'}</p>
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

    </div>
  )
}

function RestaurantSkeletons({ count = 3 }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className="restaurant-card skeleton" key={i} aria-hidden="true">
          <div className="restaurant-img skeleton-block" />
          <div className="restaurant-info">
            <div className="skeleton-line wide" />
            <div className="skeleton-line" />
            <div className="skeleton-line narrow" />
          </div>
        </div>
      ))}
    </>
  )
}

function LoadFailed({ message, onRetry }) {
  return (
    <div className="empty-state">
      <span style={{ fontSize: 40 }}>📶</span>
      <p>{message || 'Could not load restaurants'}</p>
      <button className="retry-btn" onClick={onRetry}>Try again</button>
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
