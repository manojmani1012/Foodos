import { API_BASE_URL, request } from './apiClient'
import { rupees } from './catalogue'
import type { CartLine } from './CartContext'

// Cart pricing, checkout and order history.
//
// The server prices everything. These calls send only what was chosen — item
// ids, add-on ids and quantities — so nothing about money travels from the app
// to the server.

function toCartItems(lines: CartLine[]) {
  return lines.map(line => ({
    menuItemId: line.item.id,
    quantity: line.quantity,
    addonIds: line.addOns.map(addon => addon.id),
  }))
}

export type Serviceable = {
  ok: boolean
  distanceKm: number | null
  radiusKm: number
  code: 'restaurant_unavailable' | 'address_needs_pin' | 'address_too_far' | null
  reason: string | null
}

export type Quote = {
  restaurantName: string
  subtotal: number
  deliveryFee: number
  packagingFee: number
  tax: number
  discount: number
  // For the delivery partner, all of it.
  tip: number
  // The bill rounds to whole rupees; this is the difference, shown as its own line.
  roundOff: number
  total: number
  coupon: { code: string | null; applied: boolean; reason: string | null; discountPaise: number }
  // Whether the restaurant delivers to the chosen address. Absent without one.
  serviceable: Serviceable | null
  // Cash on delivery can be switched off by Foodos.
  codAvailable: boolean
}

export async function quoteCart(
  lines: CartLine[],
  couponCode?: string | null,
  addressId?: string | null,
  tipPaise = 0,
): Promise<Quote> {
  const body = await request('/api/v1/customer/cart/quote', {
    method: 'POST',
    body: { items: toCartItems(lines), couponCode: couponCode || null, addressId: addressId || null, tipPaise },
  })

  return {
    restaurantName: body.restaurantName,
    subtotal: rupees(body.subtotalPaise),
    deliveryFee: rupees(body.deliveryFeePaise),
    packagingFee: rupees(body.packagingFeePaise),
    tax: rupees(body.taxPaise),
    discount: rupees(body.discountPaise),
    tip: rupees(body.tipPaise ?? 0),
    roundOff: rupees(body.roundOffPaise ?? 0),
    total: rupees(body.totalPaise),
    coupon: body.coupon,
    serviceable: body.serviceable ?? null,
    codAvailable: body.codAvailable !== false,
  }
}

export type Address = {
  id: string
  label: string
  line1: string
  line2: string | null
  landmark?: string | null
  city: string
  pincode: string | null
  // The map pin: where the rider navigates to, and what decides which
  // restaurants deliver here. Addresses saved before pins were required have
  // none and must be pinned before ordering.
  latitude?: number | null
  longitude?: number | null
  isDefault: boolean
}

export function hasPin(address: Pick<Address, 'latitude' | 'longitude'> | null | undefined): boolean {
  return address?.latitude != null && address?.longitude != null
}

export function formatAddress(address: Address): string {
  return [address.line1, address.line2, address.landmark ? `near ${address.landmark}` : null, address.city, address.pincode]
    .filter(Boolean)
    .join(', ')
}

export async function fetchAddresses(): Promise<Address[]> {
  const body = await request('/api/v1/customer/addresses')

  return body.addresses
}

export async function addAddress(address: Partial<Address>): Promise<Address> {
  const body = await request('/api/v1/customer/addresses', { method: 'POST', body: address })

  return body.address
}

// Replaces a saved address, pin included.
export async function updateAddress(id: string, address: Partial<Address>): Promise<Address> {
  const body = await request(`/api/v1/customer/addresses/${id}`, { method: 'PUT', body: address })

  return body.address
}

export type Order = {
  id: string
  orderNumber: string
  status: string
  restaurant: {
    id: string
    name: string
    address: string
    phone: string | null
    latitude: number | null
    longitude: number | null
  }
  address: {
    line1: string
    line2?: string | null
    landmark?: string | null
    city: string
    pincode?: string | null
    latitude?: number | null
    longitude?: number | null
  }
  items: {
    id: string
    name: string
    isVeg: boolean
    quantity: number
    lineTotal: number
    addons: { name: string; price: number }[]
  }[]
  subtotal: number
  deliveryFee: number
  packagingFee: number
  tax: number
  discount: number
  tip: number
  roundOff: number
  total: number
  paymentMethod: string
  placedAt: string
  estimatedDeliveryAt: string | null
  // "Arriving in X mins", worked out by the server on every read; 0 means the
  // rider is at the door. Null once the order is over.
  etaMinutes: number | null
  // What the customer tells the rider at the door, while it is needed.
  deliveryCode: string | null
  // Between 11 pm and 5 am: riders may call ahead.
  lateNight: boolean
  cancellationReason: string | null
  // Set when a paid order was cancelled: the money going back to the customer.
  // Also set when Foodos refunds part of a delivered order.
  // `destination`: back to the card/UPI paid with, or into the Foodos wallet.
  refund: { status: 'pending' | 'processed' | 'failed'; amount: number; destination: 'original' | 'wallet' } | null
  // The rider, once one is assigned. Phone and position only while the order is
  // on its way.
  delivery: Tracking | null
  timeline: { status: string; note: string | null; at: string }[]
  cookingInstructions: string | null
  noCutlery: boolean
  deliveryPreferences: DeliveryPreference[]
  // The customer's rating of the delivery, once given.
  riderReview: { rating: number; comment: string | null } | null
  // The rider said thanks for the tip.
  tipThanked: boolean
}

export type DeliveryPreference = 'leave_at_door' | 'no_bell' | 'no_call' | 'pet_at_home'

export const DELIVERY_PREFERENCES: { id: DeliveryPreference; label: string; icon: string }[] = [
  { id: 'leave_at_door', label: 'Leave at the door', icon: 'home' },
  { id: 'no_bell', label: "Don't ring the bell", icon: 'bell-off' },
  { id: 'no_call', label: 'Avoid calling', icon: 'phone-off' },
  { id: 'pet_at_home', label: 'Pet at home', icon: 'alert-circle' },
]

export type Tracking = {
  status: 'searching' | 'accepted' | 'reached_restaurant' | 'picked_up' | 'arrived' | 'delivered' | 'cancelled'
  partner: {
    name: string
    phone: string | null
    vehicleType: string | null
    vehicleNumber: string | null
  } | null
  location: { latitude: number; longitude: number; updatedAt: string | null } | null
}

export function mapOrder(api: any): Order {
  return {
    id: api.id,
    orderNumber: api.orderNumber,
    status: api.status,
    restaurant: api.restaurant,
    address: api.deliveryAddress,
    items: (api.items || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      isVeg: item.isVeg,
      quantity: item.quantity,
      lineTotal: rupees(item.lineTotalPaise),
      addons: (item.addons || []).map((a: any) => ({ name: a.name, price: rupees(a.pricePaise) })),
    })),
    subtotal: rupees(api.subtotalPaise),
    deliveryFee: rupees(api.deliveryFeePaise),
    packagingFee: rupees(api.packagingFeePaise),
    tax: rupees(api.taxPaise),
    discount: rupees(api.discountPaise),
    tip: rupees(api.tipPaise ?? 0),
    roundOff: rupees(api.roundOffPaise ?? 0),
    total: rupees(api.totalPaise),
    paymentMethod: api.paymentMethod,
    placedAt: api.placedAt,
    estimatedDeliveryAt: api.estimatedDeliveryAt,
    etaMinutes: api.etaMinutes ?? null,
    deliveryCode: api.deliveryCode ?? null,
    lateNight: !!api.lateNight,
    cancellationReason: api.cancellationReason,
    refund: api.refund
      ? {
          status: api.refund.status,
          amount: rupees(api.refund.amountPaise),
          destination: api.refund.destination === 'wallet' || api.paymentMethod === 'wallet' ? 'wallet' : 'original',
        }
      : null,
    delivery: api.delivery ?? null,
    timeline: api.timeline || [],
    cookingInstructions: api.cookingInstructions ?? null,
    noCutlery: !!api.noCutlery,
    deliveryPreferences: api.deliveryPreferences ?? [],
    riderReview: api.riderReview ?? null,
    tipThanked: !!api.tipThanked,
  }
}

// One key per checkout attempt. If the connection drops after the order was
// written but before the response arrived, retrying with the same key returns
// the original order rather than placing a second one.
export function newIdempotencyKey(): string {
  const random = (globalThis as any).crypto?.randomUUID?.()

  return random || `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function placeOrder(options: {
  lines: CartLine[]
  couponCode?: string | null
  addressId: string
  idempotencyKey: string
  paymentMethod?: string
  tipPaise?: number
  cookingInstructions?: string
  noCutlery?: boolean
  deliveryPreferences?: DeliveryPreference[]
}): Promise<Order> {
  const body = await request('/api/v1/customer/orders', {
    method: 'POST',
    body: {
      items: toCartItems(options.lines),
      paymentMethod: options.paymentMethod ?? 'cod',
      couponCode: options.couponCode || null,
      addressId: options.addressId,
      idempotencyKey: options.idempotencyKey,
      tipPaise: options.tipPaise ?? 0,
      cookingInstructions: options.cookingInstructions?.trim() || null,
      noCutlery: !!options.noCutlery,
      deliveryPreferences: options.deliveryPreferences ?? [],
    },
  })

  return mapOrder(body.order)
}

// The order's GST invoice: a page for the browser, behind a link that works
// for 15 minutes. Only for delivered orders.
export async function invoiceUrl(orderId: string): Promise<string> {
  const body = await request(`/api/v1/customer/orders/${orderId}/invoice`, { method: 'POST' })

  return `${API_BASE_URL}${body.url}`
}

// The order still on its way, for the bar at the bottom of the app.
export async function fetchActiveOrder(): Promise<Order | null> {
  const body = await request('/api/v1/customer/orders/active')

  return body.order ? mapOrder(body.order) : null
}

export async function reviewRider(orderId: string, rating: number, comment?: string) {
  const body = await request(`/api/v1/customer/orders/${orderId}/rider-review`, {
    method: 'POST',
    body: { rating, comment: comment?.trim() || null },
  })

  return body.riderReview as { rating: number; comment: string | null }
}

export async function fetchOrder(id: string): Promise<Order> {
  const body = await request(`/api/v1/customer/orders/${id}`)

  return mapOrder(body.order)
}

export async function fetchOrders() {
  const body = await request('/api/v1/customer/orders')

  return body.orders.map((order: any) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    total: rupees(order.totalPaise),
    itemCount: order.itemCount,
    placedAt: order.placedAt,
    restaurant: order.restaurant,
  }))
}

export async function cancelOrder(id: string, reason?: string): Promise<Order> {
  const body = await request(`/api/v1/customer/orders/${id}/cancel`, {
    method: 'POST',
    body: { reason: reason || null },
  })

  return mapOrder(body.order)
}


// --- Razorpay --------------------------------------------------------------

export type PaymentIntent = {
  razorpayOrderId: string
  // Public by design. The secret stays on the server and never ships in the app.
  keyId: string
  amountPaise: number
  currency: string
  orderNumber: string
  customer: { name: string | null; phone: string | null; email: string | null }
}

export async function startPayment(orderId: string): Promise<PaymentIntent> {
  const body = await request(`/api/v1/customer/orders/${orderId}/pay`, { method: 'POST' })

  return body.payment
}

export async function confirmPayment(
  orderId: string,
  result: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
) {
  return request(`/api/v1/customer/orders/${orderId}/pay/confirm`, {
    method: 'POST',
    body: result,
  })
}

// Asked when checkout closed before the app could confirm: the webhook may have
// settled it already.
export async function fetchPaymentStatus(
  orderId: string,
): Promise<{ paymentStatus: string; orderStatus: string }> {
  return request(`/api/v1/customer/orders/${orderId}/pay/status`)
}
