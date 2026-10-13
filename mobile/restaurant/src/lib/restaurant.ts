import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'

import { API_BASE_URL, request } from './apiClient'

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
  // Present once a paid order is cancelled: 'pending' while Razorpay sends it
  // back, 'processed' once done, 'failed' if it could not be started.
  refund: Refund | null
  // The rider once the order is accepted: searching first, then whoever took it.
  delivery: Collection | null
}

export type Collection = {
  status: 'searching' | 'accepted' | 'reached_restaurant' | 'picked_up' | 'arrived' | 'delivered' | 'cancelled'
  partner: {
    name: string
    phone: string | null
    vehicleType: string | null
    vehicleNumber: string | null
  } | null
}

export type Refund = {
  status: 'pending' | 'processed' | 'failed'
  amountPaise: number
  requestedAt: string | null
  processedAt: string | null
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
  addons: Addon[]
}

export type Addon = { id?: string; name: string; pricePaise: number; isAvailable?: boolean }

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
export type Queue = 'new' | 'preparing' | 'ready' | 'past'

export const QUEUES: { key: Queue; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'past', label: 'Past' },
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

export async function createMenuItem(item: {
  name: string
  pricePaise: number
  categoryId?: string | null
  description?: string | null
  isVeg?: boolean
  isAvailable?: boolean
}): Promise<MenuItem> {
  const { item: created } = await request(`${BASE}/menu/items`, { method: 'POST', body: item })

  return created
}

export async function updateMenuItem(
  itemId: string,
  patch: Partial<{
    name: string
    pricePaise: number
    categoryId: string | null
    description: string | null
    isVeg: boolean
    isAvailable: boolean
  }>,
): Promise<MenuItem> {
  const { item } = await request(`${BASE}/menu/items/${itemId}`, { method: 'PATCH', body: patch })

  return item
}

export function deleteMenuItem(itemId: string) {
  return request(`${BASE}/menu/items/${itemId}`, { method: 'DELETE' })
}

export function replaceAddons(
  itemId: string,
  addons: { name: string; pricePaise: number }[],
): Promise<MenuItem> {
  return request(`${BASE}/menu/items/${itemId}/addons`, {
    method: 'PUT',
    body: { addons },
  }).then(body => body.item)
}

// --- Outlet ----------------------------------------------------------------

export type OutletChanges = Partial<{
  description: string | null
  phone: string | null
  opensAt: string | null
  closesAt: string | null
  avgPrepMinutes: number
}>

export async function updateOutlet(changes: OutletChanges): Promise<Restaurant> {
  const { restaurant } = await request(`${BASE}/profile`, { method: 'PATCH', body: changes })

  return restaurant
}

export async function uploadCoverPhoto(fileUri: string): Promise<Restaurant> {
  const form = new FormData()
  form.append('file', { uri: fileUri, name: 'cover.jpg', type: 'image/jpeg' } as any)

  const { restaurant } = await request(`${BASE}/image`, { method: 'PUT', body: form })

  return restaurant
}

export async function removeCoverPhoto(): Promise<Restaurant> {
  const { restaurant } = await request(`${BASE}/image`, { method: 'DELETE' })

  return restaurant
}

// --- Reviews and earnings --------------------------------------------------

export type Review = {
  rating: number
  comment: string | null
  createdAt: string
  orderNumber: string
  customerName: string
}

export type ReviewSummary = { total: number; average: number; distribution: number[] }

export async function fetchReviews(): Promise<{ summary: ReviewSummary; reviews: Review[] }> {
  const { summary, reviews } = await request(`${BASE}/reviews`)

  return { summary, reviews }
}

export type EarningsShare = {
  foodPaise: number
  packagingPaise: number
  commissionPaise: number
  earningsPaise: number
}

export type Earnings = {
  days: number
  commissionPct: number
  totals: EarningsShare & { orders: number }
  daily: (EarningsShare & { date: string; orders: number })[]
  inProgress: { orders: number; foodPaise: number }
}

export async function fetchEarnings(days: number): Promise<Earnings> {
  const { ok, ...earnings } = await request(`${BASE}/earnings?days=${days}`)

  return earnings as Earnings
}

// "09:30:00" from the server becomes "09:30" for display and editing.
export function shortTime(value: string | null): string {
  return value ? value.slice(0, 5) : ''
}

// --- Dish photos -----------------------------------------------------------

// Wide enough to look sharp full-width on any phone, small enough that a
// photo is ~150-300 KB instead of the 3-8 MB a camera produces. Uploading the
// original over a kitchen's mobile data would take minutes and often fail.
const PHOTO_MAX_WIDTH = 1200
const PHOTO_QUALITY = 0.72

export type PhotoSource = 'camera' | 'library'

// Returns a local file ready to upload, or null if the owner backed out.
export async function pickDishPhoto(
  source: PhotoSource,
  aspect: [number, number] = [4, 3],
): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    // Every dish card is the same shape, so the crop is fixed to match it.
    allowsEditing: true,
    aspect,
    quality: 1,
  }

  let result: ImagePicker.ImagePickerResult

  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync()

    if (!permission.granted) {
      throw new Error('Allow camera access in your phone settings to take dish photos')
    }

    result = await ImagePicker.launchCameraAsync(options)
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options)
  }

  if (result.canceled || !result.assets?.[0]) return null

  const asset = result.assets[0]
  const context = ImageManipulator.manipulate(asset.uri)

  // Never scale a small photo up; that only makes it blurrier and bigger.
  if (asset.width > PHOTO_MAX_WIDTH) {
    context.resize({ width: PHOTO_MAX_WIDTH })
  }

  const rendered = await context.renderAsync()
  const saved = await rendered.saveAsync({ compress: PHOTO_QUALITY, format: SaveFormat.JPEG })

  return saved.uri
}

export async function uploadDishPhoto(itemId: string, fileUri: string): Promise<MenuItem> {
  const form = new FormData()

  // React Native's FormData takes a file as { uri, name, type } rather than a Blob.
  form.append('file', { uri: fileUri, name: 'dish.jpg', type: 'image/jpeg' } as any)

  const { item } = await request(`${BASE}/menu/items/${itemId}/image`, {
    method: 'PUT',
    body: form,
  })

  return item
}

export async function removeDishPhoto(itemId: string): Promise<MenuItem> {
  const { item } = await request(`${BASE}/menu/items/${itemId}/image`, { method: 'DELETE' })

  return item
}

// Uploaded photos come back as /media/<id>, relative to the API, because the
// server cannot reliably know its own public address behind a proxy.
export function resolveImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null
  if (/^https?:\/\//.test(imageUrl)) return imageUrl

  return `${API_BASE_URL}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`
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
