import React, { useState } from 'react'
import SplashScreen from './screens/SplashScreen'
import LoginScreen from './screens/LoginScreen'
import HomeScreen from './screens/HomeScreen'
import RestaurantScreen from './screens/RestaurantScreen'
import FoodDetailScreen from './screens/FoodDetailScreen'
import CartScreen from './screens/CartScreen'
import PaymentScreen from './screens/PaymentScreen'
import OrderTrackingScreen from './screens/OrderTrackingScreen'
import ProfileScreen from './screens/ProfileScreen'

export default function App() {
  const [screen, setScreen] = useState('splash') // 'splash' | 'login' | 'home' | 'restaurant' | 'food-detail' | 'cart' | 'payment' | 'tracking' | 'profile'
  const [restaurantId, setRestaurantId] = useState(null)
  const [selectedItemId, setSelectedItemId] = useState(null)
  const [cart, setCart] = useState([]) // [{ itemId, qty, addOns }]
  const [orderTotal, setOrderTotal] = useState(0)
  const [orders, setOrders] = useState([]) // [{ id, restaurantId, total, status, date }]
  const [favourites, setFavourites] = useState([]) // [restaurantId]
  const [homeTab, setHomeTab] = useState('home')

  const cartCount = cart.reduce((sum, c) => sum + c.qty, 0)

  return (
    <div className="phone-frame">
      {screen === 'splash' && <SplashScreen onDone={() => setScreen('login')} />}
      {screen === 'login' && <LoginScreen onLogin={() => setScreen('home')} />}
      {screen === 'home' && (
        <HomeScreen
          initialTab={homeTab}
          onSelectRestaurant={id => {
            setRestaurantId(id)
            setScreen('restaurant')
          }}
          onGoProfile={() => setScreen('profile')}
          orders={orders}
          favourites={favourites}
          onToggleFavourite={id => {
            setFavourites(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id])
          }}
        />
      )}
      {screen === 'restaurant' && (
        <RestaurantScreen
          restaurantId={restaurantId}
          cartCount={cartCount}
          onBack={() => setScreen('home')}
          onSelectItem={itemId => {
            setSelectedItemId(itemId)
            setScreen('food-detail')
          }}
          onGoCart={() => setScreen('cart')}
        />
      )}
      {screen === 'food-detail' && (
        <FoodDetailScreen
          itemId={selectedItemId}
          onBack={() => setScreen('restaurant')}
          onAddToCart={({ itemId, qty, addOns }) => {
            setCart(prev => [...prev, { itemId, qty, addOns }])
            setScreen('restaurant')
          }}
        />
      )}
      {screen === 'cart' && (
        <CartScreen
          cart={cart}
          restaurantId={restaurantId}
          onBack={() => setScreen('restaurant')}
          onUpdateQty={(index, qty) => {
            setCart(prev => {
              if (qty <= 0) return prev.filter((_, i) => i !== index)
              return prev.map((c, i) => i === index ? { ...c, qty } : c)
            })
          }}
          onPlaceOrder={total => {
            setOrderTotal(total)
            setScreen('payment')
          }}
        />
      )}
      {screen === 'payment' && (
        <PaymentScreen
          amount={orderTotal}
          onBack={() => setScreen('cart')}
          onPaymentSuccess={() => {
            setCart([])
            setOrders(prev => [
              { id: `FD${100000 + prev.length}`, restaurantId, total: orderTotal, status: 'On the Way', date: new Date().toLocaleDateString() },
              ...prev,
            ])
            setScreen('tracking')
          }}
        />
      )}
      {screen === 'tracking' && (
        <OrderTrackingScreen
          restaurantId={restaurantId}
          onBack={() => setScreen('home')}
          onDone={() => {
            setOrders(prev => prev.map((o, i) => i === 0 ? { ...o, status: 'Delivered' } : o))
            setScreen('home')
          }}
        />
      )}
      {screen === 'profile' && (
        <ProfileScreen
          onBack={() => setScreen('home')}
          onLogout={() => setScreen('login')}
          onGoHomeTab={tab => {
            setHomeTab(tab)
            setScreen('home')
          }}
        />
      )}
    </div>
  )
}
