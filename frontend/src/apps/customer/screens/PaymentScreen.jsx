import React, { useState } from 'react'
import './PaymentScreen.css'
import { addAddress, fetchAddresses, newIdempotencyKey, placeOrder } from '../../../lib/orders.js'
import { useAsync } from '../../../lib/useAsync.js'

// Only cash on delivery works today. The others are shown so the flow reads
// correctly, but stay disabled until the payment provider is connected —
// selecting one would fail at the server anyway.
const METHODS = [
  {
    group: 'UPI',
    options: [
      { id: 'gpay', label: 'Google Pay', emoji: '🟢' },
      { id: 'phonepe', label: 'PhonePe', emoji: '🟣' },
      { id: 'paytm', label: 'Paytm', emoji: '🔵' },
    ],
  },
  { group: 'Cards', options: [{ id: 'card', label: 'Credit / Debit Card', emoji: '💳' }] },
  { group: 'Wallet', options: [{ id: 'wallet', label: 'Foodos Wallet', emoji: '👛' }] },
  { group: 'Other', options: [{ id: 'cod', label: 'Cash on Delivery', emoji: '💵', enabled: true }] },
]

const BLANK_ADDRESS = { label: 'Home', line1: '', line2: '', city: 'Chennai', pincode: '' }

export default function PaymentScreen({ amount, cart, couponCode, onBack, onOrderPlaced }) {
  const [selected, setSelected] = useState('cod')
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')
  const [addingAddress, setAddingAddress] = useState(false)
  const [draft, setDraft] = useState(BLANK_ADDRESS)
  const [chosenAddressId, setChosenAddressId] = useState(null)

  // One key for this checkout attempt. Kept in state so a retry after a failure
  // reuses it and cannot place a second order.
  const [idempotencyKey] = useState(newIdempotencyKey)

  const addressQuery = useAsync(fetchAddresses, [])
  const addresses = addressQuery.data ?? []
  const activeAddressId =
    chosenAddressId ?? addresses.find(a => a.isDefault)?.id ?? addresses[0]?.id ?? null

  async function saveAddress() {
    if (!draft.line1.trim() || !draft.city.trim()) {
      setError('Enter the street and city')
      return
    }

    setError('')

    try {
      const saved = await addAddress({ ...draft, isDefault: addresses.length === 0 })
      setChosenAddressId(saved.id)
      setAddingAddress(false)
      setDraft(BLANK_ADDRESS)
      addressQuery.reload()
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  async function handlePay() {
    if (!activeAddressId) {
      setAddingAddress(true)
      setError('Add a delivery address first')
      return
    }

    setPaying(true)
    setError('')

    try {
      const order = await placeOrder({
        cart,
        couponCode,
        addressId: activeAddressId,
        paymentMethod: 'cod',
        idempotencyKey,
      })

      onOrderPlaced(order)
    } catch (payError) {
      setError(payError.message)
      setPaying(false)
    }
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
        <div className="pay-group">
          <div className="pay-group-title">Deliver to</div>

          {addressQuery.loading && <div className="pay-address-hint">Loading addresses…</div>}

          {!addressQuery.loading && addresses.map(address => (
            <label className="pay-option" key={address.id}>
              <span className="pay-option-left">
                <span className="pay-option-emoji">📍</span>
                <span className="pay-option-label">
                  <strong>{address.label}</strong>
                  <span className="pay-address-line">
                    {[address.line1, address.line2, address.city, address.pincode].filter(Boolean).join(', ')}
                  </span>
                </span>
              </span>
              <input
                type="radio"
                name="address"
                checked={activeAddressId === address.id}
                onChange={() => setChosenAddressId(address.id)}
              />
            </label>
          ))}

          {addingAddress ? (
            <div className="pay-address-form">
              <input
                id="address-label"
                className="pay-input"
                placeholder="Label (Home, Work)"
                value={draft.label}
                onChange={e => setDraft({ ...draft, label: e.target.value })}
              />
              <input
                id="address-line1"
                className="pay-input"
                placeholder="House / street"
                value={draft.line1}
                onChange={e => setDraft({ ...draft, line1: e.target.value })}
              />
              <input
                id="address-city"
                className="pay-input"
                placeholder="City"
                value={draft.city}
                onChange={e => setDraft({ ...draft, city: e.target.value })}
              />
              <input
                id="address-pincode"
                className="pay-input"
                placeholder="Pincode"
                value={draft.pincode}
                onChange={e => setDraft({ ...draft, pincode: e.target.value })}
              />
              <div className="pay-address-actions">
                <button className="pay-address-save" onClick={saveAddress}>Save address</button>
                <button className="pay-address-cancel" onClick={() => setAddingAddress(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="pay-add-address" onClick={() => setAddingAddress(true)}>
              + Add a new address
            </button>
          )}
        </div>

        {METHODS.map(group => (
          <div className="pay-group" key={group.group}>
            <div className="pay-group-title">{group.group}</div>
            {group.options.map(opt => (
              <label
                className={`pay-option ${opt.enabled ? '' : 'disabled'}`}
                key={opt.id}
                title={opt.enabled ? undefined : 'Coming soon'}
              >
                <span className="pay-option-left">
                  <span className="pay-option-emoji">{opt.emoji}</span>
                  <span className="pay-option-label">{opt.label}</span>
                  {!opt.enabled && <span className="pay-soon">Coming soon</span>}
                </span>
                <input
                  type="radio"
                  name="payment"
                  disabled={!opt.enabled}
                  checked={selected === opt.id}
                  onChange={() => setSelected(opt.id)}
                />
              </label>
            ))}
          </div>
        ))}

        {error && <div className="pay-error">{error}</div>}

        <div className="pay-secure-note">🔒 100% Secure Payments</div>
      </div>

      <button className="pay-btn" onClick={handlePay} disabled={paying}>
        {paying ? 'Placing order…' : `Place Order · ₹${amount}`}
      </button>
    </div>
  )
}
