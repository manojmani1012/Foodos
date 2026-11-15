import * as Location from 'expo-location'
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
  // Each request is offered to one rider at a time; when this runs out it
  // moves on to the next rider.
  expiresAt: string
  secondsLeft: number
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
  customer: Place & { instructions: string | null; landmark: string | null }
  items: { name: string; quantity: number }[]
  paymentMethod: string
  collectPaise: number
  distanceKm: number | null
  pickupKm: number | null
  dropKm: number | null
  // "Delivered" needs the customer's 4-digit code.
  codeRequired: boolean
  // How close to the pin "reached" and "arrived" are allowed.
  geofenceMetres: number
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

export type StepAction = 'reached' | 'picked-up' | 'arrived' | 'delivered'

// The next step a rider takes from each status, and what the swipe says.
export const NEXT_STEP: Record<Exclude<DeliveryStatus, 'delivered'>, { action: StepAction; label: string }> = {
  accepted: { action: 'reached', label: 'Swipe: reached the restaurant' },
  reached_restaurant: { action: 'picked-up', label: 'Swipe: order picked up' },
  picked_up: { action: 'arrived', label: 'Swipe: reached the customer' },
  arrived: { action: 'delivered', label: 'Swipe: order delivered' },
}

// The steps the server checks against the map: where the phone is right now
// goes with them.
const AT_A_PLACE: StepAction[] = ['reached', 'arrived']

async function hereNow(): Promise<{ latitude: number; longitude: number; accuracy?: number } | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync()

    if (permission.status !== 'granted') return null

    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? undefined,
    }
  } catch {
    // The server falls back to the last position the app shared.
    return null
  }
}

export async function advance(
  id: string,
  action: StepAction,
  options: { cashCollected?: boolean; code?: string } = {},
): Promise<Delivery | null> {
  const here = AT_A_PLACE.includes(action) ? await hereNow() : null
  const body = {
    ...(here ?? {}),
    ...(action === 'delivered' ? { cashCollected: !!options.cashCollected, code: options.code } : {}),
  }
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
  const rupees = Math.round(paise) / 100
  // "₹146", or "₹5.50" when there are paise: never "₹5.5".
  const decimals = Number.isInteger(rupees) ? 0 : 2

  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: 2 })}`
}

export function formatKm(km: number | null): string {
  return km == null ? '—' : `${km.toFixed(1)} km`
}
