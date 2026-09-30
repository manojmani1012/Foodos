import React, { useState } from 'react'
import './CartScreen.css'
import { quoteCart } from '../../../lib/orders.js'
import { useAsync } from '../../../lib/useAsync.js'

// Totals come from the server. The cart sends what was chosen and the API
// returns the bill, so the figure shown here is the figure that gets charged.
export default function CartScreen({ cart, restaurant, onBack, onUpdateQty, onPlaceOrder }) {
  const [coupon, setCoupon] = useState('')
  const [submittedCoupon, setSubmittedCoupon] = useState('')

  const quoteQuery = useAsync(
    () => (cart.length ? quoteCart(cart, submittedCoupon) : Promise.resolve(null)),
    [cart, submittedCoupon],
  )

  const quote = quoteQuery.data
  const couponState = quote?.coupon

  // Each line still shows its own subtotal from the snapshot taken when it was
  // added; only the bill below is authoritative.
  const lines = cart.map((c, idx) => {
    const addOnTotal = (c.addOns || []).reduce((sum, a) => sum + a.price, 0)

    return { ...c, index: idx, addOnTotal, lineTotal: (c.item.price + addOnTotal) * c.qty }
  })

  function applyCoupon() {
    setSubmittedCoupon(coupon.trim().toUpperCase())
  }

  function clearCoupon() {
    setCoupon('')
    setSubmittedCoupon('')
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
                    {line.addOns.map(a => a.label).join(', ')}
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
            {couponState?.applied && (
              <div className="cart-coupon-applied">
                ✓ {couponState.code} applied — you saved ₹{quote.discount}
                <button className="cart-coupon-remove" onClick={clearCoupon}>Remove</button>
              </div>
            )}
            {couponState && !couponState.applied && couponState.reason && (
              <div className="cart-coupon-error">{couponState.reason}</div>
            )}

            {quoteQuery.error ? (
              <div className="cart-bill-error">
                {quoteQuery.error.message}
                <button className="retry-btn" onClick={quoteQuery.reload}>Try again</button>
              </div>
            ) : (
              <div className={`cart-bill ${quoteQuery.loading ? 'updating' : ''}`}>
                <div className="cart-bill-row">
                  <span>Item Total</span>
                  <span>{quote ? `₹${quote.subtotal}` : '…'}</span>
                </div>
                <div className="cart-bill-row">
                  <span>Delivery Fee</span>
                  <span>₹{quote ? quote.deliveryFee : '—'}</span>
                </div>
                <div className="cart-bill-row">
                  <span>Packaging Fee</span>
                  <span>₹{quote ? quote.packagingFee : '—'}</span>
                </div>
                {quote?.tax > 0 && (
                  <div className="cart-bill-row">
                    <span>GST</span>
                    <span>₹{quote.tax}</span>
                  </div>
                )}
                {quote?.discount > 0 && (
                  <div className="cart-bill-row discount">
                    <span>Coupon Discount</span>
                    <span>−₹{quote.discount}</span>
                  </div>
                )}
                <div className="cart-bill-row total">
                  <span>To Pay</span>
                  <span>{quote ? `₹${quote.total}` : '…'}</span>
                </div>
              </div>
            )}
          </>
        )}
        <div style={{ height: lines.length > 0 ? 90 : 0 }} />
      </div>

      {lines.length > 0 && (
        <button
          className="cart-place-order"
          onClick={() => onPlaceOrder({ total: quote.total, couponCode: couponState?.applied ? couponState.code : null })}
          disabled={!quote || quoteQuery.loading}
        >
          {quoteQuery.loading ? 'Updating…' : `Place Order · ₹${quote ? quote.total : ''}`}
        </button>
      )}
    </div>
  )
}
