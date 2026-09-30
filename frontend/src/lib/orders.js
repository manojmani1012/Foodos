import { request } from './apiClient.js'
import { rupees } from './catalogue.js'

// Cart, checkout and order history.
//
// The server prices everything. These calls send only what was chosen — item
// ids, add-on ids and quantities — so nothing about money travels from the app
// to the server.

function toCartItems(cart) {
  return cart.map(line => ({
    menuItemId: line.item.id,
    quantity: line.qty,
    addonIds: (line.addOns || []).map(addon => addon.id),
  }))
}

function mapQuote(api) {
  return {
    restaurantId: api.restaurantId,
    restaurantName: api.restaurantName,
    subtotal: rupees(api.subtotalPaise),
    deliveryFee: rupees(api.deliveryFeePaise),
    packagingFee: rupees(api.packagingFeePaise),
    tax: rupees(api.taxPaise),
    discount: rupees(api.discountPaise),
    total: rupees(api.totalPaise),
    coupon: api.coupon,
  }
}

export async function quoteCart(cart, couponCode) {
  const body = await request('/api/v1/customer/cart/quote', {
    method: 'POST',
    body: { items: toCartItems(cart), couponCode: couponCode || null },
  })

  return mapQuote(body)
}

export function mapOrder(api) {
  return {
    id: api.id,
    orderNumber: api.orderNumber,
    status: api.status,
    restaurant: api.restaurant,
    address: api.deliveryAddress,
    items: (api.items || []).map(item => ({
      id: item.id,
      name: item.name,
      isVeg: item.isVeg,
      quantity: item.quantity,
      unitPrice: rupees(item.unitPricePaise),
      lineTotal: rupees(item.lineTotalPaise),
      addons: (item.addons || []).map(a => ({ name: a.name, price: rupees(a.pricePaise) })),
    })),
    subtotal: rupees(api.subtotalPaise),
    deliveryFee: rupees(api.deliveryFeePaise),
    packagingFee: rupees(api.packagingFeePaise),
    tax: rupees(api.taxPaise),
    discount: rupees(api.discountPaise),
    total: rupees(api.totalPaise),
    paymentMethod: api.paymentMethod,
    paymentStatus: api.paymentStatus,
    placedAt: api.placedAt,
    estimatedDeliveryAt: api.estimatedDeliveryAt,
    cancellationReason: api.cancellationReason,
    timeline: api.timeline || [],
  }
}

// One key per checkout attempt. If the connection drops after the order was
// written but before the response arrived, retrying with the same key returns
// the original order instead of placing a second one.
export function newIdempotencyKey() {
  const random = globalThis.crypto?.randomUUID?.()

  return random || `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function placeOrder({ cart, couponCode, addressId, address, paymentMethod, idempotencyKey, specialInstructions }) {
  const body = await request('/api/v1/customer/orders', {
    method: 'POST',
    body: {
      items: toCartItems(cart),
      paymentMethod,
      couponCode: couponCode || null,
      addressId: addressId || null,
      address: address || null,
      specialInstructions: specialInstructions || null,
      idempotencyKey,
    },
  })

  return mapOrder(body.order)
}

export async function fetchOrders() {
  const body = await request('/api/v1/customer/orders')

  return body.orders.map(order => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    total: rupees(order.totalPaise),
    itemCount: order.itemCount,
    placedAt: order.placedAt,
    restaurant: order.restaurant,
  }))
}

export async function fetchOrder(id) {
  const body = await request(`/api/v1/customer/orders/${id}`)

  return mapOrder(body.order)
}

export async function cancelOrder(id, reason) {
  const body = await request(`/api/v1/customer/orders/${id}/cancel`, {
    method: 'POST',
    body: { reason: reason || null },
  })

  return mapOrder(body.order)
}

export async function fetchAddresses() {
  const body = await request('/api/v1/customer/addresses')

  return body.addresses
}

export async function addAddress(address) {
  const body = await request('/api/v1/customer/addresses', { method: 'POST', body: address })

  return body.address
}

export function deleteAddress(id) {
  return request(`/api/v1/customer/addresses/${id}`, { method: 'DELETE' })
}
