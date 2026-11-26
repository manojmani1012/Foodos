import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { AuthProvider, useAuth } from './lib/auth'
import { ToastProvider } from './lib/toast'
import Activity from './pages/Activity'
import CustomerDetail from './pages/CustomerDetail'
import Customers from './pages/Customers'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Offers from './pages/Offers'
import OrderDetail from './pages/OrderDetail'
import Orders from './pages/Orders'
import PayoutDetail from './pages/PayoutDetail'
import Payouts from './pages/Payouts'
import RestaurantDetail from './pages/RestaurantDetail'
import RestaurantForm from './pages/RestaurantForm'
import Restaurants from './pages/Restaurants'
import RiderDetail from './pages/RiderDetail'
import Riders from './pages/Riders'
import Settings from './pages/Settings'
import Support from './pages/Support'
import SupportTicket from './pages/SupportTicket'
import './styles.css'

function App() {
  const { admin, restoring } = useAuth()

  if (restoring) {
    return (
      <div className="login">
        <div className="spinner-row" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>Opening Foodos Admin…</span>
        </div>
      </div>
    )
  }

  if (!admin) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="restaurants" element={<Restaurants />} />
        <Route path="restaurants/new" element={<RestaurantForm />} />
        <Route path="restaurants/:id" element={<RestaurantDetail />} />
        <Route path="restaurants/:id/edit" element={<RestaurantForm />} />
        <Route path="riders" element={<Riders />} />
        <Route path="riders/:id" element={<RiderDetail />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="offers" element={<Offers />} />
        <Route path="payouts" element={<Payouts />} />
        <Route path="payouts/:id" element={<PayoutDetail />} />
        <Route path="settings" element={<Settings />} />
        <Route path="support" element={<Support />} />
        <Route path="support/:id" element={<SupportTicket />} />
        <Route path="activity" element={<Activity />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
