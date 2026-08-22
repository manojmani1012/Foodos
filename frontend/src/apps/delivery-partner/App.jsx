import React, { useState } from 'react'
import SplashScreen from './screens/SplashScreen'
import LoginScreen from './screens/LoginScreen'
import DashboardScreen from './screens/DashboardScreen'
import NewRequestScreen from './screens/NewRequestScreen'
import DeliveryFlowScreen from './screens/DeliveryFlowScreen'
import EarningsScreen from './screens/EarningsScreen'
import ProfileScreen from './screens/ProfileScreen'

export default function App() {
  const [screen, setScreen] = useState('splash')
  const [online, setOnline] = useState(false)
  const [todayEarnings, setTodayEarnings] = useState(1245)
  const [trips, setTrips] = useState(8)

  return (
    <div className="phone-frame">
      {screen === 'splash' && <SplashScreen onDone={() => setScreen('login')} />}
      {screen === 'login' && <LoginScreen onLogin={() => setScreen('dashboard')} />}
      {screen === 'dashboard' && (
        <DashboardScreen
          online={online}
          setOnline={updater => {
            setOnline(prev => {
              const next = typeof updater === 'function' ? updater(prev) : updater
              if (next && !prev) setTimeout(() => setScreen('request'), 1500)
              return next
            })
          }}
          todayEarnings={todayEarnings}
          trips={trips}
          hours={5.2}
          rating={4.8}
          onGoEarnings={() => setScreen('earnings')}
          onGoProfile={() => setScreen('profile')}
        />
      )}
      {screen === 'request' && (
        <NewRequestScreen
          onAccept={() => setScreen('flow')}
          onReject={() => setScreen('dashboard')}
        />
      )}
      {screen === 'flow' && (
        <DeliveryFlowScreen
          onComplete={() => {
            setTodayEarnings(e => e + 65)
            setTrips(t => t + 1)
            setScreen('dashboard')
          }}
        />
      )}
      {screen === 'earnings' && <EarningsScreen onBack={() => setScreen('dashboard')} />}
      {screen === 'profile' && (
        <ProfileScreen onBack={() => setScreen('dashboard')} onLogout={() => setScreen('login')} />
      )}
    </div>
  )
}
