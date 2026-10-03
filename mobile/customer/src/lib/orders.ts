import { request } from './apiClient'
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

export type Quote = {
  restaurantName: string
  subtotal: number
  deliveryFee: number
  packagingFee: number
  tax: number
  discount: number
  total: number
  coupon: { code: string | null; applied: boolean; reason: string | null; discountPaise: number }
}

export async function quoteCart(lines: CartLine[], couponCode?: string | null): Promise<Quote> {
  const body = await request('/api/v1/customer/cart/quote', {
    method: 'POST',
    body: { items: toCartItems(lines), couponCode: couponCode || null },
  })

  return {
    restaurantName: body.restaurantName,
    subtotal: rupees(body.subtotalPaise),
    deliveryFee: rupees(body.deliveryFeePaise),
    packagingFee: rupees(body.packagingFeePaise),
    tax: rupees(body.taxPaise),
    discount: rupees(body.discountPaise),
    total: rupees(body.totalPaise),
    coupon: body.coupon,
  }
}

export type Address = {
  id: string
  label: string
  line1: string
  line2: string | null
  city: string
  pincode: string | null
  isDefault: boolean
}

export function formatAddress(address: Address): string {
  return [address.line1, address.line2, address.city, address.pincode].filter(Boolean).join(', ')
}

export async function fetchAddresses(): Promise<Address[]> {
  const body = await request('/api/v1/customer/addresses')

  return body.addresses
}

export async function addAddress(address: Partial<Address>): Promise<Address> {
  const body = await request('/api/v1/customer/addresses', { method: 'POST', body: address })

  return body.address
}

export type Order = {
  id: string
  orderNumber: string
  status: string
  restaurant: { id: string; name: string; address: string; phone: string | null }
  address: { line1: string; line2?: string | null; city: string; pincode?: string | null }
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
  total: number
  paymentMethod: string
  placedAt: string
  estimatedDeliveryAt: string | null
  cancellationReason: string | null
  timeline: { status: string; note: string | null; at: string }[]
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
    total: rupees(api.totalPaise),
    paymentMethod: api.paymentMethod,
    placedAt: api.placedAt,
    estimatedDeliveryAt: api.estimatedDeliveryAt,
    cancellationReason: api.cancellationReason,
    timeline: api.timeline || [],
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
}): Promise<Order> {
  const body = await request('/api/v1/customer/orders', {
    method: 'POST',
    body: {
      items: toCartItems(options.lines),
      paymentMethod: options.paymentMethod ?? 'cod',
      couponCode: options.couponCode || null,
      addressId: options.addressId,
      idempotencyKey: options.idempotencyKey,
    },
  })

  return mapOrder(body.order)
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
