import { Linking, Platform } from 'react-native'

import { request } from './apiClient'

// The delivery partner's half of the API. Every route acts on the signed-in
// rider only; there is no rider id anywhere in these calls.

const BASE = '/api/v1/delivery'

export type PartnerStatus = 'pending' | 'active' | 'suspended' | 'rejected'
export type VehicleType = 'bike' | 'scooter' | 'bicycle' | 'ev'

export type Partner = {
  name: string | null
  phone: string
  status: PartnerStatus
  isOnline: boolean
  vehicleType: VehicleType
  vehicleNumber: string | null
  city: string | null
  rating: number
  ratingCount: number
  today: { deliveries: number; earningsPaise: number }
}

export type Offer = {
  id: string
  orderNumber: string
  foodReady: boolean
  restaurant: { name: string; area: string | null }
  dropArea: string
  itemCount: number
  pickupKm: number | null
  dropKm: number | null
  earningPaise: number
  // Cash orders: what has to be collected at the door. 0 when prepaid.
  collectPaise: number
  openedAt: string
}

export type DeliveryStatus = 'accepted' | 'reached_restaurant' | 'picked_up' | 'arrived' | 'delivered'

export type Place = {
  name: string
  address: string
  phone: string | null
  latitude: number | null
  longitude: number | null
}

export type Delivery = {
  id: string
  status: DeliveryStatus
  orderNumber: string
  orderStatus: string
  foodReady: boolean
  restaurant: Place
  customer: Place & { instructions: string | null }
  items: { name: string; quantity: number }[]
  paymentMethod: string
  collectPaise: number
  distanceKm: number | null
  earningPaise: number
  tipPaise: number
  acceptedAt: string | null
  deliveredAt: string | null
}

export type Earnings = {
  days: number
  totals: {
    deliveries: number
    basePaise: number
    incentivePaise: number
    tipsPaise: number
    earningsPaise: number
    distanceKm: number
  }
  daily: {
    date: string
    deliveries: number
    earningsPaise: number
    tipsPaise: number
    distanceKm: number
  }[]
  cashCollectedTodayPaise: number
}

// --- The rider -------------------------------------------------------------

export async function fetchPartner(): Promise<Partner> {
  const { partner } = await request(`${BASE}/me`)

  return partner
}

export async function updatePartner(
  changes: Partial<{ fullName: string; vehicleType: VehicleType; vehicleNumber: string; city: string }>,
): Promise<Partner> {
  const { partner } = await request(`${BASE}/me`, { method: 'PATCH', body: changes })

  return partner
}

export async function setOnline(isOnline: boolean): Promise<Partner> {
  const { partner } = await request(`${BASE}/online`, { method: 'POST', body: { isOnline } })

  return partner
}

export function sendLocation(latitude: number, longitude: number) {
  return request(`${BASE}/location`, { method: 'POST', body: { latitude, longitude } })
}

// --- Work ------------------------------------------------------------------

export async function fetchOffers(): Promise<Offer[]> {
  const { requests } = await request(`${BASE}/requests`)

  return requests
}

export async function fetchActive(): Promise<Delivery | null> {
  const { delivery } = await request(`${BASE}/active`)

  return delivery
}

export async function acceptOffer(id: string): Promise<Delivery> {
  const { delivery } = await request(`${BASE}/deliveries/${id}/accept`, { method: 'POST' })

  return delivery
}

export function skipOffer(id: string) {
  return request(`${BASE}/deliveries/${id}/reject`, { method: 'POST' })
}

// The next step a rider takes from each status, and what the button says.
export const NEXT_STEP: Record<
  Exclude<DeliveryStatus, 'delivered'>,
  { action: 'reached' | 'picked-up' | 'arrived' | 'delivered'; label: string }
> = {
  accepted: { action: 'reached', label: "I've reached the restaurant" },
  reached_restaurant: { action: 'picked-up', label: 'Order picked up' },
  picked_up: { action: 'arrived', label: "I've arrived at the customer" },
  arrived: { action: 'delivered', label: 'Order delivered' },
}

export async function advance(
  id: string,
  action: 'reached' | 'picked-up' | 'arrived' | 'delivered',
  cashCollected = false,
): Promise<Delivery | null> {
  const body = action === 'delivered' ? { cashCollected } : undefined
  const result = await request(`${BASE}/deliveries/${id}/${action}`, { method: 'POST', body })

  // "delivered" returns the finished delivery; every other step returns the
  // one still in progress.
  return result.delivered ? null : result.delivery
}

export async function fetchEarnings(days: number): Promise<Earnings> {
  const { ok, ...earnings } = await request(`${BASE}/earnings?days=${days}`)

  return earnings as Earnings
}

export async function fetchHistory(): Promise<Delivery[]> {
  const { deliveries } = await request(`${BASE}/history`)

  return deliveries
}

// --- Leaving the app -------------------------------------------------------

// Turn-by-turn directions in the rider's own Google Maps app: free, no key,
// and better navigation than anything built in.
export function navigateTo(place: Place) {
  const destination =
    place.latitude != null && place.longitude != null
      ? `${place.latitude},${place.longitude}`
      : encodeURIComponent(place.address)

  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${destination}`
      : `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`

  return Linking.openURL(url)
}

export function call(phone: string | null) {
  if (phone) return Linking.openURL(`tel:${phone}`)
}

// --- Display ---------------------------------------------------------------

export function formatRupees(paise: number): string {
  return `₹${(Math.round(paise) / 100).toLocaleString('en-IN')}`
}

export function formatKm(km: number | null): string {
  return km == null ? '—' : `${km.toFixed(1)} km`
}
