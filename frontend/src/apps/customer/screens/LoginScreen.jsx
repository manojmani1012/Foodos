import React, { useState } from 'react'
import './LoginScreen.css'
import FoodosLogo from '../../../components/FoodosLogo'

export default function LoginScreen({ onLogin }) {
  const [phone, setPhone] = useState('')
  const [step, setStep] = useState('phone') // 'phone' | 'otp'
  const [otp, setOtp] = useState(['', '', '', ''])

  function handleContinue() {
    if (phone.length >= 10) setStep('otp')
  }

  function handleOtpChange(i, val) {
    if (!/^\d?$/.test(val)) return
    const next = [...otp]
    next[i] = val
    setOtp(next)
    if (val && i < 3) {
      document.getElementById(`otp-${i + 1}`)?.focus()
    }
    if (next.every(d => d !== '')) {
      setTimeout(onLogin, 400)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-header">
        <FoodosLogo variant="inline" size={38} />
      </div>

      <div className="login-illustration">
        <OnboardingIllustration />
      </div>

      <div className="login-card">
        {step === 'phone' ? (
          <>
            <h2 className="login-title">Welcome Back!</h2>
            <p className="login-sub">Login or signup to continue</p>

            <div className="phone-input-group">
              <div className="country-code">
                <span className="flag">🇮🇳</span>
                <span>+91</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <input
                className="phone-input"
                type="tel"
                placeholder="Enter mobile number"
                maxLength={10}
                value={phone}
                onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
              />
            </div>

            <button
              className={`btn-primary ${phone.length >= 10 ? 'active' : ''}`}
              onClick={handleContinue}
              disabled={phone.length < 10}
            >
              Continue
            </button>

            <div className="divider">
              <span className="divider-line" />
              <span className="divider-text">or</span>
              <span className="divider-line" />
            </div>

            <div className="social-buttons">
              <button className="social-btn" onClick={onLogin}>
                <GoogleIcon /> Google
              </button>
              <button className="social-btn" onClick={onLogin}>
                <AppleIcon /> Apple
              </button>
              <button className="social-btn facebook" onClick={onLogin}>
                <FacebookIcon />
              </button>
            </div>

            <p className="terms-text">
              By continuing, you agree to our{' '}
              <span className="link">Terms & Conditions</span> and{' '}
              <span className="link">Privacy Policy</span>
            </p>

            <p className="signup-text">
              Already have an account?{' '}
              <span className="link" onClick={onLogin}>Login</span>
            </p>
          </>
        ) : (
          <>
            <button className="back-btn" onClick={() => setStep('phone')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#1a5c35" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <h2 className="login-title">Enter OTP</h2>
            <p className="login-sub">Sent to +91 {phone}</p>

            <div className="otp-group">
              {otp.map((d, i) => (
                <input
                  key={i}
                  id={`otp-${i}`}
                  className="otp-box"
                  type="tel"
                  maxLength={1}
                  value={d}
                  onChange={e => handleOtpChange(i, e.target.value)}
                />
              ))}
            </div>

            <p className="resend-text">Didn't receive? <span className="link">Resend OTP</span></p>

            <button
              className={`btn-primary ${otp.every(d => d) ? 'active' : ''}`}
              onClick={onLogin}
              disabled={!otp.every(d => d)}
            >
              Verify & Continue
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function OnboardingIllustration() {
  return (
    <svg viewBox="0 0 300 160" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 'auto' }}>
      <ellipse cx="150" cy="148" rx="110" ry="10" fill="#e8f5e9"/>
      {/* Scooter */}
      <ellipse cx="80" cy="130" rx="22" ry="22" fill="none" stroke="#1a5c35" strokeWidth="6"/>
      <ellipse cx="80" cy="130" rx="7" ry="7" fill="#1a5c35" fillOpacity="0.3"/>
      <ellipse cx="190" cy="130" rx="22" ry="22" fill="none" stroke="#1a5c35" strokeWidth="6"/>
      <ellipse cx="190" cy="130" rx="7" ry="7" fill="#1a5c35" fillOpacity="0.3"/>
      <path d="M80 130 L120 88 L175 88 L190 130" stroke="#1a5c35" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M120 88 L92 130" stroke="#1a5c35" strokeWidth="4" strokeLinecap="round"/>
      <path d="M175 88 L188 74 L204 77" stroke="#1a5c35" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="126" y="80" width="44" height="10" rx="5" fill="#1a5c35" fillOpacity="0.6"/>
      {/* Delivery box */}
      <rect x="128" y="46" width="48" height="38" rx="8" fill="#1a5c35"/>
      <path d="M128 62 H176" stroke="white" strokeWidth="1.5"/>
      <path d="M152 46 V84" stroke="white" strokeWidth="1.5"/>
      {/* Rider */}
      <circle cx="168" cy="60" r="14" fill="#2d8653"/>
      <path d="M156 56 Q156 40 168 38 Q180 40 180 56 Z" fill="#1a5c35"/>
      {/* Speed lines */}
      <path d="M30 100 H58" stroke="#c8e6c9" strokeWidth="3" strokeLinecap="round"/>
      <path d="M18 116 H52" stroke="#c8e6c9" strokeWidth="3" strokeLinecap="round"/>
      <path d="M36 132 H62" stroke="#c8e6c9" strokeWidth="3" strokeLinecap="round"/>
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11"/>
    </svg>
  )
}

function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  )
}
