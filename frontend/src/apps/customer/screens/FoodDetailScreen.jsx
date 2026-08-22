import React, { useState } from 'react'
import './FoodDetailScreen.css'
import { getItem, ADD_ONS } from '../../../data/menuData'

export default function FoodDetailScreen({ itemId, onBack, onAddToCart }) {
  const item = getItem(itemId)
  const [qty, setQty] = useState(1)
  const [selectedAddOns, setSelectedAddOns] = useState([])

  if (!item) return null

  function toggleAddOn(id) {
    setSelectedAddOns(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    )
  }

  const addOnTotal = selectedAddOns.reduce((sum, id) => {
    const a = ADD_ONS.find(x => x.id === id)
    return sum + (a ? a.price : 0)
  }, 0)
  const total = (item.price + addOnTotal) * qty

  return (
    <div className="food-detail-screen">
      <div className="fd-hero">
        <button className="fd-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#333" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="fd-hero-emoji">{item.emoji}</span>
      </div>

      <div className="fd-content">
        <div className="fd-title-row">
          <span className={`veg-dot ${item.veg ? 'veg' : 'nonveg'}`} />
          <h1 className="fd-name">{item.name}</h1>
        </div>
        <div className="fd-rating">⭐ {item.rating} ({item.reviews})</div>
        <div className="fd-price">₹{item.price}</div>
        <p className="fd-desc">{item.desc}</p>

        <div className="fd-section">
          <div className="fd-section-title">Add-ons</div>
          <div className="fd-addon-list">
            {ADD_ONS.map(a => (
              <label key={a.id} className="fd-addon-row">
                <span className="fd-addon-label">
                  <input
                    type="checkbox"
                    checked={selectedAddOns.includes(a.id)}
                    onChange={() => toggleAddOn(a.id)}
                  />
                  {a.label}
                </span>
                <span className="fd-addon-price">+₹{a.price}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="fd-section">
          <div className="fd-section-title">Quantity</div>
          <div className="fd-qty-control">
            <button className="fd-qty-btn" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
            <span className="fd-qty-value">{qty}</span>
            <button className="fd-qty-btn" onClick={() => setQty(q => q + 1)}>+</button>
          </div>
        </div>
      </div>

      <button
        className="fd-add-btn"
        onClick={() => onAddToCart({ itemId: item.id, qty, addOns: selectedAddOns })}
      >
        Add to Cart · ₹{total}
      </button>
    </div>
  )
}
