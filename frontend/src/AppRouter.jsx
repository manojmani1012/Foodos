import React from 'react'
import CustomerApp from './apps/customer/App.jsx'
import DeliveryPartnerApp from './apps/delivery-partner/App.jsx'
import RestaurantPartnerApp from './apps/restaurant-partner/App.jsx'
import AdminApp from './apps/admin/App.jsx'

const ROUTES = {
  '/delivery': DeliveryPartnerApp,
  '/restaurant': RestaurantPartnerApp,
  '/admin': AdminApp,
}

export default function AppRouter() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  const Component = ROUTES[path] || CustomerApp

  return <Component />
}
