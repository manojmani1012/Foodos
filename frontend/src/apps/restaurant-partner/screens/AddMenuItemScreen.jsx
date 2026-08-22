import React, { useState } from 'react'
import '../common.css'

const CATEGORIES = ['Biryani', 'Starters', 'Main Course', 'Beverages', 'Desserts']

export default function AddMenuItemScreen({ onBack, onSave }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [price, setPrice] = useState('')
  const [desc, setDesc] = useState('')
  const [available, setAvailable] = useState(true)

  const canSave = name.trim() && price.trim()

  return (
    <div className="rp-screen">
      <div className="rp-header">
        <button className="rp-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#333" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="rp-title">Add Menu Item</span>
      </div>

      <div className="rp-content">
        <div style={{
          height: 120, borderRadius: 14, border: '2px dashed #ccc', background: '#fafafa',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 6, marginBottom: 16, color: '#999', fontSize: 13, cursor: 'pointer',
        }}>
          <span style={{ fontSize: 28 }}>📷</span>
          Upload Photo
        </div>

        <Field label="Item Name">
          <input style={inputStyle} placeholder="e.g. Chicken Biryani" value={name} onChange={e => setName(e.target.value)} />
        </Field>

        <Field label="Category">
          <select style={inputStyle} value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>

        <Field label="Price (₹)">
          <input style={inputStyle} type="number" placeholder="249" value={price} onChange={e => setPrice(e.target.value)} />
        </Field>

        <Field label="Description">
          <textarea style={{ ...inputStyle, height: 70, resize: 'none' }} placeholder="Short description..." value={desc} onChange={e => setDesc(e.target.value)} />
        </Field>

        <div className="rp-row" style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>Available</span>
          <button
            onClick={() => setAvailable(v => !v)}
            style={{
              width: 40, height: 22, borderRadius: 20, border: 'none', cursor: 'pointer',
              background: available ? '#1a5c35' : '#ddd', position: 'relative',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: available ? 20 : 2, width: 18, height: 18,
              borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
            }} />
          </button>
        </div>

        <button
          className="rp-btn-primary"
          disabled={!canSave}
          style={{ opacity: canSave ? 1 : 0.5 }}
          onClick={() => canSave && onSave({ name, category, price, desc, available })}
        >
          Save Item
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#666', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  border: '1.5px solid #e0e0e0',
  borderRadius: 10,
  fontSize: 14,
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
  background: '#fff',
}
