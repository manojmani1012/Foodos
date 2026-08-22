import React, { useState } from 'react'
import './RestaurantScreen.css'
import { getRestaurant, getMenuForRestaurant, MENU_CATEGORIES } from '../../../data/menuData'

export default function RestaurantScreen({ restaurantId, cartCount, onBack, onSelectItem, onGoCart }) {
  const restaurant = getRestaurant(restaurantId)
  const menu = getMenuForRestaurant(restaurantId)
  const categories = MENU_CATEGORIES.filter(c => menu.some(m => m.category === c))
  const [activeCat, setActiveCat] = useState(categories[0])

  if (!restaurant) return null

  const items = menu.filter(m => m.category === activeCat)

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
            key={cat}
            className={`rest-tab ${activeCat === cat ? 'active' : ''}`}
            onClick={() => setActiveCat(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="rest-menu-list">
        {items.map(item => (
          <MenuItemRow key={item.id} item={item} onClick={() => onSelectItem(item.id)} />
        ))}
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
