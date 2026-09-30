import React, { useEffect, useState } from 'react'
import './RestaurantScreen.css'
import { fetchRestaurant } from '../../../lib/catalogue.js'
import { useAsync } from '../../../lib/useAsync.js'

export default function RestaurantScreen({ restaurantId, cartCount, onBack, onSelectItem, onGoCart, onLoaded }) {
  // The whole menu arrives in one request: restaurant, categories, items and
  // add-ons together.
  const { data, loading, error, reload } = useAsync(() => fetchRestaurant(restaurantId), [restaurantId])
  const [activeCat, setActiveCat] = useState(null)

  const categories = data?.categories ?? []

  // Select the first category once the menu lands, and again if the restaurant
  // changes underneath us.
  useEffect(() => {
    setActiveCat(categories[0]?.name ?? null)

    if (data?.restaurant) {
      onLoaded?.(data.restaurant)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (loading) return <MenuLoading onBack={onBack} />
  if (error) return <MenuFailed message={error.message} onBack={onBack} onRetry={reload} />
  if (!data) return null

  const restaurant = data.restaurant
  const items = categories.find(c => c.name === activeCat)?.items ?? []

  return (
    <div className="restaurant-screen">
      <div className="rest-hero" style={{ background: restaurant.color }}>
        <button className="rest-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#333" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="rest-hero-emoji">{restaurant.emoji}</span>
      </div>

      <div className="rest-info-card">
        <div className="rest-info-top">
          <div>
            <h1 className="rest-name">{restaurant.name}</h1>
            <p className="rest-address">{restaurant.address}</p>
          </div>
          {restaurant.tag && <span className="rest-tag">{restaurant.tag}</span>}
        </div>
        <div className="rest-meta-row">
          <span className="rest-meta-item">⭐ {restaurant.rating} ({restaurant.reviews}k+)</span>
          <span className="rest-meta-dot">·</span>
          <span className="rest-meta-item">🕒 {restaurant.time}</span>
          <span className="rest-meta-dot">·</span>
          <span className="rest-meta-item">{restaurant.delivery}</span>
        </div>
      </div>

      <div className="rest-tabs">
        {categories.map(cat => (
          <button
            key={cat.id}
            className={`rest-tab ${activeCat === cat.name ? 'active' : ''}`}
            onClick={() => setActiveCat(cat.name)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      <div className="rest-menu-list">
        {items.map(item => (
          <MenuItemRow key={item.id} item={item} onClick={() => onSelectItem(item)} />
        ))}
        {items.length === 0 && (
          <div className="rest-empty">Nothing on this part of the menu yet.</div>
        )}
        <div style={{ height: cartCount > 0 ? 90 : 24 }} />
      </div>

      {cartCount > 0 && (
        <button className="rest-cart-bar" onClick={onGoCart}>
          <span>{cartCount} {cartCount === 1 ? 'item' : 'items'} added</span>
          <span className="rest-cart-cta">View Cart →</span>
        </button>
      )}
    </div>
  )
}

function MenuItemRow({ item, onClick }) {
  return (
    <div className="menu-row" onClick={onClick}>
      <div className="menu-row-info">
        <span className={`veg-dot ${item.veg ? 'veg' : 'nonveg'}`} />
        <div>
          <div className="menu-row-name">{item.name}</div>
          <div className="menu-row-rating">⭐ {item.rating} ({item.reviews})</div>
          <div className="menu-row-price">₹{item.price}</div>
          <div className="menu-row-desc">{item.desc}</div>
        </div>
      </div>
      <div className="menu-row-img">
        <span style={{ fontSize: 32 }}>{item.emoji}</span>
        <button className="menu-row-add">ADD</button>
      </div>
    </div>
  )
}

function MenuLoading({ onBack }) {
  return (
    <div className="restaurant-screen">
      <div className="rest-hero skeleton-block">
        <button className="rest-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#333" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>
      <div className="rest-menu-list">
        {[0, 1, 2, 3].map(i => (
          <div className="menu-row" key={i} aria-hidden="true">
            <div style={{ flex: 1 }}>
              <div className="skeleton-line wide" />
              <div className="skeleton-line" />
              <div className="skeleton-line narrow" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MenuFailed({ message, onBack, onRetry }) {
  return (
    <div className="restaurant-screen">
      <div className="rest-empty" style={{ paddingTop: 60 }}>
        <p>{message || 'Could not load this menu'}</p>
        <button className="retry-btn" onClick={onRetry}>Try again</button>
        <button className="retry-btn" onClick={onBack} style={{ marginLeft: 8 }}>Go back</button>
      </div>
    </div>
  )
}
