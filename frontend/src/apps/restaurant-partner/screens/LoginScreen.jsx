import React, { useState } from 'react'
import '../common.css'
import FoodosLogo from '../../../components/FoodosLogo'

export default function LoginScreen({ onLogin }) {
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')

  return (
    <div className="rp-screen" style={{ background: '#fff', alignItems: 'center' }}>
      <div style={{ padding: '52px 28px 0' }}>
        <FoodosLogo variant="inline" size={38} />
      </div>
      <div style={{ flex: 1, width: '100%', padding: '40px 28px', display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4 }}>Welcome back!</h2>
        <p style={{ fontSize: 14, color: '#888', marginBottom: 28 }}>Login to manage your restaurant</p>

        <input
          placeholder="Enter mobile number"
          value={phone}
          onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
          maxLength={10}
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={inputStyle}
        />

        <button
          className="rp-btn-primary"
          disabled={phone.length < 10}
          onClick={onLogin}
          style={{ opacity: phone.length < 10 ? 0.5 : 1, marginTop: 8 }}
        >
          Login
        </button>

        <button className="rp-btn-outline" style={{ marginTop: 12, border: '1.5px solid #ddd', color: '#333' }} onClick={onLogin}>
          Continue with Google
        </button>

        <p style={{ textAlign: 'center', fontSize: 13, color: '#777', marginTop: 24 }}>
          Don't have an account? <span style={{ color: '#1a5c35', fontWeight: 600, cursor: 'pointer' }} onClick={onLogin}>Register Now</span>
        </p>
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  padding: '14px',
  marginBottom: 14,
  border: '1.5px solid #e0e0e0',
  borderRadius: 12,
  fontSize: 15,
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
}
