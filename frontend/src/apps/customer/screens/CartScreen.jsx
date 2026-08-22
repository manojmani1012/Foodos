import React, { useState } from 'react'
import './CartScreen.css'
import { getItem, ADD_ONS, getRestaurant } from '../../../data/menuData'

const DELIVERY_FEE = 20
const PACKAGING_FEE = 10

export default function CartScreen({ cart, restaurantId, onBack, onUpdateQty, onPlaceOrder }) {
  const [coupon, setCoupon] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState(null)
  const restaurant = getRestaurant(restaurantId)

  const lines = cart.map((c, idx) => {
    const item = getItem(c.itemId)
    const addOnTotal = (c.addOns || []).reduce((sum, id) => {
      const a = ADD_ONS.find(x => x.id === id)
      return sum + (a ? a.price : 0)
    }, 0)
    return { ...c, index: idx, item, addOnTotal, lineTotal: (item.price + addOnTotal) * c.qty }
  })

  const itemTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0)
  const discount = appliedCoupon === 'FOODNEW' ? Math.min(100, Math.round(itemTotal * 0.5)) : 0
  const toPay = Math.max(0, itemTotal + DELIVERY_FEE + PACKAGING_FEE - discount)

  function applyCoupon() {
    if (coupon.trim().toUpperCase() === 'FOODNEW') {
      setAppliedCoupon('FOODNEW')
    }
  }

  return (
    <div className="cart-screen">
      <div className="cart-header">
        <button className="cart-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#333" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="cart-title">My Cart</span>
        <span className="cart-edit">Edit</span>
      </div>

      <div className="cart-content">
        {restaurant && <div className="cart-restaurant-name">{restaurant.name}</div>}

        {lines.length === 0 && (
          <div className="cart-empty">
            <span style={{ fontSize: 40 }}>🛒</span>
            <p>Your cart is empty</p>
          </div>
        )}

        {lines.map(line => (
          <div className="cart-line" key={line.index}>
            <div className="cart-line-info">
              <span className={`veg-dot ${line.item.veg ? 'veg' : 'nonveg'}`} />
              <div>
                <div className="cart-line-name">{line.item.name}</div>
                {line.addOns?.length > 0 && (
                  <div className="cart-line-addons">
                    {line.addOns.map(id => ADD_ONS.find(a => a.id === id)?.label).join(', ')}
                  </div>
                )}
                <div className="cart-line-price">₹{line.lineTotal}</div>
              </div>
            </div>
            <div className="cart-qty-control">
              <button className="cart-qty-btn" onClick={() => onUpdateQty(line.index, line.qty - 1)}>−</button>
              <span className="cart-qty-value">{line.qty}</span>
              <button className="cart-qty-btn" onClick={() => onUpdateQty(line.index, line.qty + 1)}>+</button>
            </div>
          </div>
        ))}

        {lines.length > 0 && (
          <>
            <div className="cart-coupon-row">
              <input
                className="cart-coupon-input"
                placeholder="Apply Coupon"
                value={coupon}
                onChange={e => setCoupon(e.target.value)}
              />
              <button className="cart-coupon-btn" onClick={applyCoupon}>Apply</button>
            </div>
            {appliedCoupon && (
              <div className="cart-coupon-applied">✓ {appliedCoupon} applied — you saved ₹{discount}</div>
            )}

            <div className="cart-bill">
              <div className="cart-bill-row">
                <span>Item Total</span>
                <span>₹{itemTotal}</span>
              </div>
              <div className="cart-bill-row">
                <span>Delivery Fee</span>
                <span>₹{DELIVERY_FEE}</span>
              </div>
              <div className="cart-bill-row">
                <span>Packaging Fee</span>
                <span>₹{PACKAGING_FEE}</span>
              </div>
              {discount > 0 && (
                <div className="cart-bill-row discount">
                  <span>Coupon Discount</span>
                  <span>−₹{discount}</span>
                </div>
              )}
              <div className="cart-bill-row total">
                <span>To Pay</span>
                <span>₹{toPay}</span>
              </div>
            </div>
          </>
        )}
        <div style={{ height: lines.length > 0 ? 90 : 0 }} />
      </div>

      {lines.length > 0 && (
        <button className="cart-place-order" onClick={() => onPlaceOrder(toPay)}>
          Place Order · ₹{toPay}
        </button>
      )}
    </div>
  )
}
