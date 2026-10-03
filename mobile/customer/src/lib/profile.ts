import { request } from './apiClient'

export type Profile = {
  id: string
  phone: string | null
  email: string | null
  fullName: string | null
  memberSince: string
  stats: { deliveredOrders: number; favourites: number; addresses: number }
}

export async function fetchProfile(): Promise<Profile> {
  const body = await request('/api/v1/customer/profile')

  return body.profile
}

export async function updateProfile(changes: {
  fullName?: string | null
  email?: string | null
}): Promise<Profile> {
  const body = await request('/api/v1/customer/profile', { method: 'PATCH', body: changes })

  return body.profile
}

export function deleteAccount() {
  return request('/api/v1/customer/account', { method: 'DELETE' })
}

export async function reviewOrder(orderId: string, rating: number, comment?: string) {
  const body = await request(`/api/v1/customer/orders/${orderId}/review`, {
    method: 'POST',
    body: { rating, comment: comment || null },
  })

  return body.review
}

export async function fetchOrderReview(
  orderId: string,
): Promise<{ rating: number; comment: string | null } | null> {
  const body = await request(`/api/v1/customer/orders/${orderId}/review`)

  return body.review
}
