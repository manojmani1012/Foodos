import React, { useState } from 'react'
import SplashScreen from './screens/SplashScreen'
import LoginScreen from './screens/LoginScreen'
import DashboardScreen from './screens/DashboardScreen'
import OrdersScreen from './screens/OrdersScreen'
import OrderDetailScreen from './screens/OrderDetailScreen'
import AddMenuItemScreen from './screens/AddMenuItemScreen'
import ProfileScreen from './screens/ProfileScreen'
import { getOrder } from './orderData'

export default function App() {
  const [screen, setScreen] = useState('splash')
  const [online, setOnline] = useState(true)
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [, forceRender] = useState(0)

  function updateOrderStatus(id, status) {
    const order = getOrder(id)
    if (order) order.status = status
    forceRender(n => n + 1)
    setScreen('orders')
  }

  return (
    <div className="phone-frame">
      {screen === 'splash' && <SplashScreen onDone={() => setScreen('login')} />}
      {screen === 'login' && <LoginScreen onLogin={() => setScreen('dashboard')} />}
      {screen === 'dashboard' && (
        <DashboardScreen
          online={online}
          setOnline={setOnline}
          onGoOrders={() => setScreen('orders')}
          onGoProfile={() => setScreen('profile')}
        />
      )}
      {screen === 'orders' && (
        <OrdersScreen
          onBack={() => setScreen('dashboard')}
          onSelectOrder={id => {
            setSelectedOrderId(id)
            setScreen('order-detail')
          }}
        />
      )}
      {screen === 'order-detail' && (
        <OrderDetailScreen
          orderId={selectedOrderId}
          onBack={() => setScreen('orders')}
          onAccept={id => updateOrderStatus(id, 'preparing')}
          onReject={id => updateOrderStatus(id, 'rejected')}
        />
      )}
      {screen === 'add-menu-item' && (
        <AddMenuItemScreen
          onBack={() => setScreen('profile')}
          onSave={() => setScreen('profile')}
        />
      )}
      {screen === 'profile' && (
        <ProfileScreen
          onBack={() => setScreen('dashboard')}
          onLogout={() => setScreen('login')}
          onAddMenuItem={() => setScreen('add-menu-item')}
        />
      )}
    </div>
  )
}
