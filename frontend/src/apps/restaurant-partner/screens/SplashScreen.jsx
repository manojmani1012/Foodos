import React, { useEffect } from 'react'
import FoodosLogo from '../../../components/FoodosLogo'

export default function SplashScreen({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2000)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'linear-gradient(165deg, #0f3d23 0%, #1a5c35 45%, #2d8653 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
    }}>
      <div style={{ boxShadow: '0 12px 32px rgba(0,0,0,0.25)' }}>
        <FoodosLogo variant="icon" size={92} />
      </div>
      <span style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>Foodos</span>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', letterSpacing: 1, textTransform: 'uppercase' }}>Restaurant Partner</p>
    </div>
  )
}
