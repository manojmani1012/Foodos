import React, { useEffect, useState } from 'react'
import { AuthProvider, useAuth } from '../../lib/AuthContext.jsx'
import { addFavourite, fetchFavourites, removeFavourite } from '../../lib/catalogue.js'
import { fetchOrder } from '../../lib/orders.js'
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
  return (
    <AuthProvider role="customer">
      <CustomerApp />
    </AuthProvider>
  )
}

function CustomerApp() {
  const { status, isSignedIn, signOut } = useAuth()
  const [screen, setScreen] = useState('splash') // 'splash' | 'login' | 'home' | 'restaurant' | 'food-detail' | 'cart' | 'payment' | 'tracking' | 'profile'
  const [restaurantId, setRestaurantId] = useState(null)
  const [restaurant, setRestaurant] = useState(null)
  const [selectedItem, setSelectedItem] = useState(null)
  // Each line keeps a snapshot of the dish and the add-ons chosen, so a later
  // menu edit never changes what is already in the basket.
  const [cart, setCart] = useState([]) // [{ item, qty, addOns }]
  const [orderTotal, setOrderTotal] = useState(0)
  const [couponCode, setCouponCode] = useState(null)
  const [activeOrder, setActiveOrder] = useState(null)
  const [favourites, setFavourites] = useState([]) // [restaurantId]
  const [favouritesBusy, setFavouritesBusy] = useState(false)
  const [homeTab, setHomeTab] = useState('home')

  const cartCount = cart.reduce((sum, c) => sum + c.qty, 0)

  // After the splash, send a returning user (valid refresh token) straight to
  // Home and everyone else to Login. `status` starts as 'loading' while the
  // session is restored, so the decision waits for the answer.
  useEffect(() => {
    if (screen !== 'splash' || status === 'loading') return

    setScreen(isSignedIn ? 'home' : 'login')
  }, [screen, status, isSignedIn])

  useEffect(() => {
    if (!isSignedIn) {
      setFavourites([])
      return
    }

    let cancelled = false

    fetchFavourites()
      .then(saved => {
        if (!cancelled) setFavourites(saved.map(r => r.id))
      })
      .catch(() => {
        // A failed load just means no hearts are filled; browsing still works.
      })

    return () => {
      cancelled = true
    }
  }, [isSignedIn])

  // Saving is optimistic so the heart responds immediately, and rolls back if
  // the server refuses.
  async function toggleFavourite(id) {
    if (!isSignedIn || favouritesBusy) return

    const wasFavourite = favourites.includes(id)

    setFavouritesBusy(true)
    setFavourites(prev => (wasFavourite ? prev.filter(f => f !== id) : [...prev, id]))

    try {
      await (wasFavourite ? removeFavourite(id) : addFavourite(id))
    } catch {
      setFavourites(prev => (wasFavourite ? [...prev, id] : prev.filter(f => f !== id)))
    } finally {
      setFavouritesBusy(false)
    }
  }

  return (
    <div className="phone-frame">
      {screen === 'splash' && <SplashScreen onDone={() => {}} />}
      {screen === 'login' && <LoginScreen onLogin={() => setScreen('home')} />}
      {screen === 'home' && (
        <HomeScreen
          initialTab={homeTab}
          onSelectRestaurant={id => {
            setRestaurantId(id)
            setScreen('restaurant')
          }}
          onGoProfile={() => setScreen('profile')}
          onOpenOrder={async id => {
            try {
              setActiveOrder(await fetchOrder(id))
              setScreen('tracking')
            } catch {
              // The list will show the failure on its next refresh.
            }
          }}
          favourites={favourites}
          onToggleFavourite={toggleFavourite}
        />
      )}
      {screen === 'restaurant' && (
        <RestaurantScreen
          restaurantId={restaurantId}
          cartCount={cartCount}
          onBack={() => setScreen('home')}
          onSelectItem={item => {
            setSelectedItem(item)
            setScreen('food-detail')
          }}
          onLoaded={setRestaurant}
          onGoCart={() => setScreen('cart')}
        />
      )}
      {screen === 'food-detail' && (
        <FoodDetailScreen
          item={selectedItem}
          onBack={() => setScreen('restaurant')}
          onAddToCart={({ item, qty, addOns }) => {
            setCart(prev => [...prev, { item, qty, addOns }])
            setScreen('restaurant')
          }}
        />
      )}
      {screen === 'cart' && (
        <CartScreen
          cart={cart}
          restaurant={restaurant}
          onBack={() => setScreen('restaurant')}
          onUpdateQty={(index, qty) => {
            setCart(prev => {
              if (qty <= 0) return prev.filter((_, i) => i !== index)
              return prev.map((c, i) => i === index ? { ...c, qty } : c)
            })
          }}
          onPlaceOrder={({ total, couponCode }) => {
            setOrderTotal(total)
            setCouponCode(couponCode)
            setScreen('payment')
          }}
        />
      )}
      {screen === 'payment' && (
        <PaymentScreen
          amount={orderTotal}
          cart={cart}
          couponCode={couponCode}
          onBack={() => setScreen('cart')}
          onOrderPlaced={order => {
            // The order now lives on the server, so the local cart is done.
            setCart([])
            setCouponCode(null)
            setActiveOrder(order)
            setScreen('tracking')
          }}
        />
      )}
      {screen === 'tracking' && (
        <OrderTrackingScreen
          order={activeOrder}
          onBack={() => setScreen('home')}
          onDone={() => {
            setActiveOrder(null)
            setScreen('home')
          }}
        />
      )}
      {screen === 'profile' && (
        <ProfileScreen
          onBack={() => setScreen('home')}
          onLogout={async () => {
            // Revokes the session on the server, then clears local state.
            await signOut()
            setCart([])
            setActiveOrder(null)
            setScreen('login')
          }}
          onGoHomeTab={tab => {
            setHomeTab(tab)
            setScreen('home')
          }}
        />
      )}
    </div>
  )
}
