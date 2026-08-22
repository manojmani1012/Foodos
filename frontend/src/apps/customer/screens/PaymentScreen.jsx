import React, { useState } from 'react'
import './PaymentScreen.css'

const METHODS = [
  {
    group: 'UPI',
    options: [
      { id: 'gpay', label: 'Google Pay', emoji: '🟢' },
      { id: 'phonepe', label: 'PhonePe', emoji: '🟣' },
      { id: 'paytm', label: 'Paytm', emoji: '🔵' },
    ],
  },
  {
    group: 'Cards',
    options: [
      { id: 'card', label: 'Credit / Debit Card', emoji: '💳' },
    ],
  },
  {
    group: 'Wallet',
    options: [
      { id: 'wallet', label: 'Foodos Wallet · ₹250 available', emoji: '👛' },
    ],
  },
  {
    group: 'Other',
    options: [
      { id: 'cod', label: 'Cash on Delivery', emoji: '💵' },
    ],
  },
]

export default function PaymentScreen({ amount, onBack, onPaymentSuccess }) {
  const [selected, setSelected] = useState('gpay')
  const [paying, setPaying] = useState(false)

  function handlePay() {
    setPaying(true)
    setTimeout(() => {
      onPaymentSuccess()
    }, 1200)
  }

  return (
    <div className="payment-screen">
      <div className="pay-header">
        <button className="pay-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#333" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="pay-title">Choose Payment Method</span>
      </div>

      <div className="pay-content">
        {METHODS.map(group => (
          <div className="pay-group" key={group.group}>
            <div className="pay-group-title">{group.group}</div>
            {group.options.map(opt => (
              <label className="pay-option" key={opt.id}>
                <span className="pay-option-left">
                  <span className="pay-option-emoji">{opt.emoji}</span>
                  <span className="pay-option-label">{opt.label}</span>
                </span>
                <input
                  type="radio"
                  name="payment"
                  checked={selected === opt.id}
                  onChange={() => setSelected(opt.id)}
                />
              </label>
            ))}
          </div>
        ))}

        <div className="pay-secure-note">🔒 100% Secure Payments</div>
      </div>

      <button className="pay-btn" onClick={handlePay} disabled={paying}>
        {paying ? 'Processing…' : `Pay · ₹${amount}`}
      </button>
    </div>
  )
}
