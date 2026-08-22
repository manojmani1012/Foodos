import React, { useEffect } from 'react'
import './SplashScreen.css'
import FoodosLogo from '../../../components/FoodosLogo'

export default function SplashScreen({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2400)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className="splash">
      <div className="splash-center">
        <FoodosLogo variant="icon" size={92} />
        <span className="splash-brand-text">Foodos</span>
        <p className="splash-tagline">Good Food. Fast Delivery.</p>
      </div>
      <div className="splash-rider">
        <RiderIllustration />
      </div>
      <div className="splash-bottom">
        <div className="splash-dot active" />
        <div className="splash-dot" />
        <div className="splash-dot" />
      </div>
    </div>
  )
}

function RiderIllustration() {
  return (
    <svg viewBox="0 0 320 220" fill="none" xmlns="http://www.w3.org/2000/svg" className="rider-svg">
      {/* Ground */}
      <ellipse cx="160" cy="200" rx="130" ry="14" fill="rgba(255,255,255,0.12)" />
      {/* Bike body */}
      <ellipse cx="100" cy="175" rx="26" ry="26" fill="none" stroke="white" strokeWidth="8" strokeOpacity="0.9"/>
      <ellipse cx="220" cy="175" rx="26" ry="26" fill="none" stroke="white" strokeWidth="8" strokeOpacity="0.9"/>
      <ellipse cx="100" cy="175" rx="8" ry="8" fill="white" fillOpacity="0.7"/>
      <ellipse cx="220" cy="175" rx="8" ry="8" fill="white" fillOpacity="0.7"/>
      {/* Frame */}
      <path d="M100 175 L145 120 L200 120 L220 175" stroke="white" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.95"/>
      <path d="M145 120 L110 175" stroke="white" strokeWidth="5" strokeLinecap="round" strokeOpacity="0.8"/>
      {/* Handlebar */}
      <path d="M200 120 L215 105 L230 108" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.9"/>
      {/* Seat */}
      <rect x="148" y="112" width="40" height="10" rx="5" fill="white" fillOpacity="0.85"/>
      {/* Delivery box */}
      <rect x="152" y="80" width="52" height="40" rx="8" fill="white" fillOpacity="0.92"/>
      <path d="M152 96 H204" stroke="#1a5c35" strokeWidth="2"/>
      <path d="M178 80 V120" stroke="#1a5c35" strokeWidth="2"/>
      {/* Rider body */}
      <ellipse cx="185" cy="100" rx="16" ry="16" fill="white" fillOpacity="0.9"/>
      {/* Helmet */}
      <path d="M172 100 Q172 82 185 80 Q198 82 198 100 Z" fill="white"/>
      <path d="M172 100 Q180 104 185 104 Q190 104 198 100" stroke="white" strokeWidth="3"/>
    </svg>
  )
}
