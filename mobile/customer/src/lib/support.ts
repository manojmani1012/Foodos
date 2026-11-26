import { API_BASE_URL, request } from './apiClient'

// Help & support: tickets the customer raises and Foodos's replies, plus the
// policy pages and how to reach Foodos.

const BASE = '/api/v1/support'

export type SupportInfo = {
  // Null until Foodos sets them.
  supportPhone: string | null
  supportEmail: string | null
  supportHours: string | null
  policies: { key: string; title: string; path: string }[]
}

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

export type TicketSummary = {
  id: string
  ticketNumber: string
  subject: string
  status: TicketStatus
  order: { id: string; orderNumber: string } | null
  createdAt: string
  updatedAt: string
  lastMessage: string | null
  // Foodos wrote last: there is an answer to read.
  awaitingYou: boolean
}

export type Ticket = TicketSummary & {
  messages: { id: string; fromSupport: boolean; body: string; createdAt: string }[]
}

// What a customer can ask about. The labels match the server's.
export const TOPICS: { key: string; label: string; needsOrder?: boolean }[] = [
  { key: 'order_late', label: 'Order is late or not delivered', needsOrder: true },
  { key: 'order_wrong', label: 'Wrong or missing items', needsOrder: true },
  { key: 'food_quality', label: 'Food quality', needsOrder: true },
  { key: 'payment_refund', label: 'Payment or refund' },
  { key: 'delivery_partner', label: 'Delivery partner', needsOrder: true },
  { key: 'account', label: 'My account' },
  { key: 'app_problem', label: 'Problem with the app' },
  { key: 'other', label: 'Something else' },
]

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Waiting for Foodos',
  in_progress: 'Foodos is on it',
  resolved: 'Resolved',
  closed: 'Closed',
}

export async function fetchSupportInfo(): Promise<SupportInfo> {
  const { ok, ...info } = await request(`${BASE}/info`)

  return info as SupportInfo
}

export async function fetchTickets(): Promise<TicketSummary[]> {
  const { tickets } = await request(`${BASE}/tickets`)

  return tickets
}

export async function fetchTicket(id: string): Promise<Ticket> {
  const { ticket } = await request(`${BASE}/tickets/${id}`)

  return ticket
}

export async function createTicket(topic: string, message: string, orderId?: string | null): Promise<Ticket> {
  const { ticket } = await request(`${BASE}/tickets`, {
    method: 'POST',
    body: { topic, message, ...(orderId ? { orderId } : {}) },
  })

  return ticket
}

export async function replyToTicket(id: string, message: string): Promise<Ticket> {
  const { ticket } = await request(`${BASE}/tickets/${id}/messages`, { method: 'POST', body: { message } })

  return ticket
}

// The policy pages are plain web pages served by the API.
export function policyUrl(key: 'terms' | 'privacy' | 'refund' | 'delivery' | 'contact' | string): string {
  return `${API_BASE_URL}/legal/${key}`
}
