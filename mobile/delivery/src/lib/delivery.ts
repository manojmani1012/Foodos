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
  // A fake GPS app is on: Foodos refuses its positions until it is off.
  fakeGps: boolean
  // "Complete 15 trips, earn ₹250 extra", with today's progress.
  targets: Target[]
  cash: CashInHand
}

export type Target = {
  id: string
  name: string
  targetTrips: number
  bonusPaise: number
  tripsDone: number
  achieved: boolean
}

// Cash from cash orders not yet handed over to Foodos. At the limit, only
// prepaid orders are offered until it is deposited.
export type CashInHand = {
  inHandPaise: number
  limitPaise: number
  limitReached: boolean
  // What stops at the limit. Absent on older servers, which block cash orders.
  blocks?: 'cash_orders' | 'all_orders'
}

export type CashDeposit = {
  id: string
  amountPaise: number
  reference: string | null
  recordedBy: string | null
  online: boolean
  createdAt: string
}

// What Razorpay's checkout is opened with.
export type PaymentIntent = {
  razorpayOrderId: string
  keyId: string
  amountPaise: number
  currency: string
  orderNumber: string
  customer: { name: string | null; phone: string | null; email: string | null }
}

export function cashBlockText(cash: CashInHand): string {
  return cash.blocks === 'all_orders' ? 'no new orders' : 'only prepaid orders'
}

export async function fetchCash(): Promise<{ cash: CashInHand; deposits: CashDeposit[] }> {
  const body = await request('/api/v1/delivery/cash')

  return { cash: body.cash, deposits: body.deposits }
}

export async function startCashDeposit(amountPaise: number): Promise<PaymentIntent> {
  const { payment } = await request('/api/v1/delivery/cash/deposit', { method: 'POST', body: { amountPaise } })

  return payment
}

export function confirmCashDeposit(result: {
  razorpayOrderId: string
  razorpayPaymentId: string
  razorpaySignature: string
}) {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = result

  return request('/api/v1/delivery/cash/deposit/confirm', {
    method: 'POST',
    body: { razorpayOrderId, razorpayPaymentId, razorpaySignature },
  })
}

export type TargetReached = { name: string; bonusPaise: number }

export type Offer = {
  id: string
  orderNumber: string
  // From a test account: no location check, for testing from anywhere.
  isTest: boolean
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
  // From a test account: "reached" and "arrived" work from anywhere.
  isTest: boolean
  earningPaise: number
  tipPaise: number
  acceptedAt: string | null
  deliveredAt: string | null
}

// The pay rule, when the server sends it (it is admin-editable, so the app
// never hard-codes the numbers).
export type PayRule = {
  basePaise: number
  baseKm: number
  perKmPaise: number
  orderIncentivePaise: number
}

export type Earnings = {
  days: number
  totals: {
    deliveries: number
    // Older servers: basePaise is base + distance and distancePaise is absent.
    basePaise: number
    distancePaise?: number
    incentivePaise: number
    tipsPaise: number
    earningsPaise: number
    distanceKm: number
    // TDS deducted on these earnings (not on tips). Absent on older servers.
    tdsPaise?: number
  }
  daily: {
    date: string
    deliveries: number
    basePaise?: number
    distancePaise?: number
    incentivePaise?: number
    earningsPaise: number
    tipsPaise: number
    distanceKm: number
    tdsPaise?: number
  }[]
  cashCollectedTodayPaise: number
  cash: CashInHand
  payRule?: PayRule | null
}

// --- Payouts ---------------------------------------------------------------

export type PayoutStatus = 'scheduled' | 'on_hold' | 'processing' | 'paid' | 'failed' | 'cancelled' | 'pending'

// Every amount is the effect on what Foodos owes the rider: cash collected is
// negative, cash handed over positive.
export type PayoutBreakdown = {
  basePaise?: number
  distancePaise?: number
  incentivePaise?: number
  tipsPaise?: number
  // TDS deducted from base, distance and incentives (positive = deducted).
  tdsPaise?: number
  cashCollectedPaise?: number
  cashDepositedPaise?: number
  adjustmentsPaise?: number
  refundsPaise?: number
}

export type PayoutSummary = {
  id: string
  status: PayoutStatus
  scheduledFor: string | null
  periodStart: string | null
  periodEnd: string | null
  grossPaise: number
  commissionPaise: number
  adjustmentsPaise: number
  netPaise: number
  reference: string | null
  paidAt: string | null
  holdReason: string | null
  failureReason?: string | null
  breakdown?: PayoutBreakdown
}

export type EntryKind = 'delivery' | 'cash_collected' | 'cash_deposit' | 'refund' | 'adjustment' | string

export type PayoutEntry = {
  id: number | string
  kind: EntryKind
  orderId: string | null
  orderNumber: string | null
  businessDate: string
  amountPaise: number
  breakdown: Record<string, unknown>
  note: string | null
  createdAt: string
}

export type Payouts = {
  unpaid: {
    duePaise: number
    entryCount: number
    nextPayDate: string | null
    belowMinimum: boolean
    minPayoutPaise: number
    cashInHandPaise?: number
    breakdown?: PayoutBreakdown
  }
  upcoming: PayoutSummary[]
  history: PayoutSummary[]
}

export async function fetchPayouts(): Promise<Payouts> {
  const { ok, ...payouts } = await request(`${BASE}/payouts`)

  return {
    unpaid: payouts.unpaid,
    upcoming: payouts.upcoming ?? [],
    history: payouts.history ?? [],
  }
}

export async function fetchPayout(id: string): Promise<PayoutSummary & { entries: PayoutEntry[] }> {
  const { payout } = await request(`${BASE}/payouts/${id}`)

  return { ...payout, entries: payout.entries ?? [] }
}

// A short-lived link to a printable statement, opened in the phone's browser.
export async function openPayoutStatement(id: string) {
  const { url } = await request(`${BASE}/payouts/${id}/statement`, { method: 'POST' })

  return Linking.openURL(url)
}

export const PAYOUT_STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'plain' }> = {
  scheduled: { label: 'Scheduled', tone: 'plain' },
  pending: { label: 'Pending', tone: 'plain' },
  processing: { label: 'Being sent', tone: 'plain' },
  on_hold: { label: 'On hold', tone: 'warn' },
  paid: { label: 'Paid', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'plain' },
}

export const ENTRY_KIND: Record<string, string> = {
  delivery: 'Delivery',
  cash_collected: 'Cash collected',
  cash_deposit: 'Cash handed over',
  refund: 'Refund',
  adjustment: 'Adjustment',
}

export const PAYOUT_SCHEDULE_TEXT =
  'Mon–Tue earnings are paid on Thursday, Wed–Thu on Monday, Fri–Sun on Tuesday. A holiday moves it to the next working day.'

// "Thu 21 Nov" from "2026-11-21" (a date with no time, so no timezone shift).
export function formatDay(date: string | null | undefined, withYear = false): string {
  if (!date) return '—'
  // A full timestamp (paidAt) is shown in the phone's own time zone.
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  const when = date.length > 10 ? new Date(date) : new Date(y, m - 1, d)

  return when.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  })
}

export function formatPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return ''
  if (!start || start === end) return formatDay(end ?? start)

  return `${formatDay(start)} – ${formatDay(end)}`
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

// `mocked`: Android says the position comes from a fake GPS app.
export function sendLocation(latitude: number, longitude: number, mocked = false) {
  return request(`${BASE}/location`, { method: 'POST', body: { latitude, longitude, mocked } })
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

async function hereNow(): Promise<{ latitude: number; longitude: number; accuracy?: number; mocked: boolean } | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync()

    if (permission.status !== 'granted') return null

    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? undefined,
      mocked: position.mocked === true,
    }
  } catch {
    // The server falls back to the last position the app shared.
    return null
  }
}

export type StepResult = {
  delivery: Delivery
  // True once handed over: `delivery` is then the finished trip, with any
  // target bonus it earned already in its pay.
  delivered: boolean
  targetsReached: TargetReached[]
}

export async function advance(
  id: string,
  action: StepAction,
  options: { cashCollected?: boolean; code?: string } = {},
): Promise<StepResult> {
  const here = AT_A_PLACE.includes(action) ? await hereNow() : null
  const body = {
    ...(here ?? {}),
    ...(action === 'delivered' ? { cashCollected: !!options.cashCollected, code: options.code } : {}),
  }
  const result = await request(`${BASE}/deliveries/${id}/${action}`, { method: 'POST', body })

  // "delivered" returns the finished delivery; every other step returns the
  // one still in progress.
  return { delivery: result.delivery, delivered: !!result.delivered, targetsReached: result.targetsReached ?? [] }
}

export async function fetchEarnings(days: number): Promise<Earnings> {
  const { ok, ...earnings } = await request(`${BASE}/earnings?days=${days}`)

  return earnings as Earnings
}

export type TdsMonth = { month: string; earningsPaise: number; tdsPaise: number }

export type TdsSummary = {
  financialYear: string
  // Pay excluding tips.
  earningsPaise: number
  tdsPaise: number
  months: TdsMonth[]
}

// `fy` is the year the financial year starts (2026 = 2026-27); default is the current one.
export async function fetchTds(fy?: number): Promise<TdsSummary> {
  const { ok, ...tds } = await request(`${BASE}/tds${fy ? `?fy=${fy}` : ''}`)

  return { ...tds, months: tds.months ?? [] } as TdsSummary
}

// --- Payout account --------------------------------------------------------

export type PayoutAccountStatus = 'pending' | 'verified' | 'rejected'

export type PayoutAccount = {
  holder: string | null
  accountNumberMasked: string | null
  ifsc: string | null
  bankName: string | null
  upiId: string | null
  status: PayoutAccountStatus
  rejectReason: string | null
  updatedAt: string | null
}

// Partial body: a key left out is kept, null removes it.
export type PayoutAccountChanges = Partial<{
  holder: string | null
  accountNumber: string | null
  ifsc: string | null
  bankName: string | null
  upiId: string | null
}>

export async function fetchPayoutAccount(): Promise<PayoutAccount | null> {
  const { account } = await request(`${BASE}/payout-account`)

  return account ?? null
}

export async function savePayoutAccount(changes: PayoutAccountChanges): Promise<PayoutAccount> {
  const { account } = await request(`${BASE}/payout-account`, { method: 'PUT', body: changes })

  return account
}

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/
export const ACCOUNT_NUMBER_PATTERN = /^\d{9,18}$/
export const UPI_PATTERN = /^[\w.\-]{2,}@[a-zA-Z]{2,}$/

export function payoutAccountStatusLabel(account: PayoutAccount | null): string {
  if (!account) return 'Not added yet'
  if (account.status === 'verified') return 'Verified'
  if (account.status === 'rejected') return 'Rejected, please check and update'

  return 'Pending check by Foodos'
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
