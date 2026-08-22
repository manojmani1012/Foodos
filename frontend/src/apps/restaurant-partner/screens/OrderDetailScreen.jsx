import React from 'react'
import '../common.css'
import { getOrder } from '../orderData'

export default function OrderDetailScreen({ orderId, onBack, onAccept, onReject }) {
  const order = getOrder(orderId)
  if (!order) return null

  return (
    <div className="rp-screen">
      <div className="rp-header">
        <button className="rp-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#333" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="rp-title">Order #{order.id}</span>
      </div>

      <div className="rp-content">
        <div className="rp-card">
          <div style={{ fontSize: 12, color: '#999' }}>Order Time</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 12 }}>{order.time}</div>

          <div style={{ fontSize: 12, color: '#999' }}>Customer</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{order.customer}</div>
        </div>

        <div className="rp-card">
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 10 }}>Order Items</div>
          {order.items.map((item, i) => (
            <div className="rp-row" key={i} style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 13.5, color: '#333' }}>{item.name} × {item.qty}</span>
            </div>
          ))}
          <div className="rp-row" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #eee' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>Total Amount</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1a5c35' }}>₹{order.total}</span>
          </div>
        </div>

        {order.status === 'new' && (
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="rp-btn-outline" onClick={() => onReject(order.id)}>Reject Order</button>
            <button className="rp-btn-primary" onClick={() => onAccept(order.id)}>Accept Order</button>
          </div>
        )}
        {order.status !== 'new' && (
          <div className="rp-pill" style={{ display: 'inline-block' }}>
            Status: {order.status === 'preparing' ? 'Preparing' : 'Ready for Pickup'}
          </div>
        )}
      </div>
    </div>
  )
}
