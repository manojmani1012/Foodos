import React from 'react'
import logoImg from '../assets/LOGO.jpg'

/**
 * variant='icon'   — tight square crop showing only the white icon
 * variant='inline' — icon crop + 'Foodos' wordmark in green (header)
 */
export default function FoodosLogo({ variant = 'inline', size = 40 }) {
  const iconBox = (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <img
        src={logoImg}
        alt="Foodos"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          /* icon sits in the top-centre of the image */
          objectPosition: 'center 18%',
          display: 'block',
        }}
      />
    </div>
  )

  if (variant === 'icon') return iconBox

  // 'inline' — icon + wordmark
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.3 }}>
      {iconBox}
      <span
        style={{
          fontSize: size * 0.7,
          fontWeight: 800,
          color: '#1a5c35',
          letterSpacing: '-0.4px',
          fontFamily: 'Inter, sans-serif',
          lineHeight: 1,
        }}
      >
        Foodos
      </span>
    </div>
  )
}
