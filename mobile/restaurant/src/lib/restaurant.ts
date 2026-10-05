import { request } from './apiClient'

// The restaurant portal's half of the API. Every route is scoped by the server
// to the restaurant the signed-in owner owns, so nothing here ever sends a
// restaurant id: there is no way to ask for another restaurant's data.

const BASE = '/api/v1/restaurant'

export type Restaurant = {
  id: string
  name: string
  description: string | null
  cuisines: string[]
  addressLine: string | null
  city: string | null
  phone: string | null
  imageUrl: string | null
  isVeg: boolean
  rating: number
  ratingCount: number
  status: string
  isAcceptingOrders: boolean
  avgPrepMinutes: number
  commissionPct: number
  opensAt: string | null
  closesAt: string | null
}

export type Dashboard = {
  ordersToday: number
  cancelledToday: number
  revenueTodayPaise: number
  inProgressPaise: number
  newOrders: number
  preparing: number
  ready: number
  menuItems: number
  unavailableItems: number
}

export type OrderSummary = {
  id: string
  orderNumber: string
  status: string
  totalPaise: number
  itemCount: number
  paymentMethod: string
  placedAt: string
  customerName: string | null
  specialInstructions: string | null
}

export type OrderItem = {
  id: string
  name: string
  isVeg: boolean
  quantity: number
  unitPricePaise: number
  lineTotalPaise: number
  addons: { name: string; pricePaise: number }[]
}

export type OrderDetail = {
  id: string
  orderNumber: string
  status: string
  customer: { name: string | null; phone: string | null }
  items: OrderItem[]
  subtotalPaise: number
  packagingFeePaise: number
  taxPaise: number
  discountPaise: number
  totalPaise: number
  paymentMethod: string
  paymentStatus: string
  placedAt: string
  specialInstructions: string | null
  cancellationReason: string | null
}

export type MenuCategory = { id: string; name: string; sortOrder: number }

export type MenuItem = {
  id: string
  categoryId: string | null
  name: string
  description: string | null
  pricePaise: number
  imageUrl: string | null
  isVeg: boolean
  isAvailable: boolean
  rating: number
  ratingCount: number
  sortOrder: number
  addons: unknown[]
}

// --- Restaurant and dashboard ---------------------------------------------

export async function fetchRestaurant(): Promise<Restaurant> {
  const { restaurant } = await request(`${BASE}/me`)

  return restaurant
}

export async function setAcceptingOrders(isAcceptingOrders: boolean): Promise<Restaurant> {
  const { restaurant } = await request(`${BASE}/settings`, {
    method: 'PATCH',
    body: { isAcceptingOrders },
  })

  return restaurant
}

export async function fetchDashboard(): Promise<Dashboard> {
  const { ok, ...counters } = await request(`${BASE}/dashboard`)

  return counters as Dashboard
}

// --- Order queue -----------------------------------------------------------

// The server's queue names. 'new' means confirmed but not yet accepted; an
// unpaid order appears in no queue, so nothing unpaid can be cooked.
export type Queue = 'new' | 'preparing' | 'ready'

export const QUEUES: { key: Queue; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
]

export async function fetchOrders(queue?: Queue): Promise<OrderSummary[]> {
  const query = queue ? `?queue=${encodeURIComponent(queue)}` : ''
  const { orders } = await request(`${BASE}/orders${query}`)

  return orders
}

export async function fetchOrder(orderId: string): Promise<OrderDetail> {
  const { order } = await request(`${BASE}/orders/${orderId}`)

  return order
}

export async function acceptOrder(orderId: string): Promise<OrderDetail> {
  const { order } = await request(`${BASE}/orders/${orderId}/accept`, { method: 'POST' })

  return order
}

export async function rejectOrder(orderId: string, reason?: string): Promise<OrderDetail> {
  const { order } = await request(`${BASE}/orders/${orderId}/reject`, {
    method: 'POST',
    body: { reason: reason || null },
  })

  return order
}

export async function markOrderReady(orderId: string): Promise<OrderDetail> {
  const { order } = await request(`${BASE}/orders/${orderId}/ready`, { method: 'POST' })

  return order
}

// --- Menu ------------------------------------------------------------------

export async function fetchMenu(): Promise<{ categories: MenuCategory[]; items: MenuItem[] }> {
  const { categories, items } = await request(`${BASE}/menu`)

  return { categories, items }
}

export function createCategory(name: string, sortOrder?: number) {
  return request(`${BASE}/menu/categories`, {
    method: 'POST',
    body: { name, ...(sortOrder === undefined ? {} : { sortOrder }) },
  })
}

export function createMenuItem(item: {
  name: string
  pricePaise: number
  categoryId?: string | null
  description?: string | null
  isVeg?: boolean
  isAvailable?: boolean
}) {
  return request(`${BASE}/menu/items`, { method: 'POST', body: item })
}

export function updateMenuItem(
  itemId: string,
  patch: Partial<{
    name: string
    pricePaise: number
    categoryId: string | null
    description: string | null
    isVeg: boolean
    isAvailable: boolean
  }>,
) {
  return request(`${BASE}/menu/items/${itemId}`, { method: 'PATCH', body: patch })
}

export function deleteMenuItem(itemId: string) {
  return request(`${BASE}/menu/items/${itemId}`, { method: 'DELETE' })
}

// --- Display helpers -------------------------------------------------------

export function formatRupees(paise: number): string {
  return `₹${(Math.round(paise) / 100).toLocaleString('en-IN')}`
}

// Prices are typed in rupees and stored in paise. Rounding stops a typed
// "249.567" from becoming a fractional paise the server would reject.
export function toPaise(rupeeText: string): number {
  const value = Number.parseFloat(rupeeText)

  return Number.isFinite(value) ? Math.round(value * 100) : NaN
}

export function formatTime(isoString: string | null): string {
  if (!isoString) return ''

  return new Date(isoString).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}
