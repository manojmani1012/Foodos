// Display helpers. Every time is shown in India time, whatever the clock on
// the computer viewing the panel says, so it matches the apps and the database.

const TIME_ZONE = 'Asia/Kolkata'

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const wholeRupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

export function formatMoney(paise: number | null | undefined, options: { whole?: boolean } = {}) {
  const value = (paise ?? 0) / 100
  const formatter = options.whole || Number.isInteger(value) ? wholeRupees : rupees
  return formatter.format(value)
}

const dateTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})
const dateOnly = new Intl.DateTimeFormat('en-IN', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' })
const timeOnly = new Intl.DateTimeFormat('en-IN', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' })
const shortDay = new Intl.DateTimeFormat('en-IN', { timeZone: TIME_ZONE, day: 'numeric', month: 'short' })

export function formatDateTime(iso: string | null | undefined) {
  return iso ? dateTime.format(new Date(iso)) : '—'
}

export function formatDate(iso: string | null | undefined) {
  return iso ? dateOnly.format(new Date(iso)) : '—'
}

export function formatTime(iso: string | null | undefined) {
  return iso ? timeOnly.format(new Date(iso)) : '—'
}

// "2026-10-14" (a calendar day from the API) -> "14 Oct", without a time zone shift.
export function formatDay(day: string) {
  const [year, month, date] = day.split('-').map(Number)
  return shortDay.format(new Date(Date.UTC(year, month - 1, date, 6)))
}

// 7 -> "7 min", 135 -> "2 h 15 min", 3000 -> "2 days".
export function formatWait(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest ? `${hours} h ${rest} min` : `${hours} h`
  }
  const days = Math.floor(minutes / (24 * 60))
  return days === 1 ? '1 day' : `${days} days`
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

export function paymentStatusLabel(method: string, status: string) {
  if (status === 'pending') return method === 'cod' ? 'To collect at the door' : 'Not paid yet'
  return ({ paid: 'Paid', failed: 'Failed', refunded: 'Refunded' } as Record<string, string>)[status] || status
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return 'never'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

// Today's date in India as YYYY-MM-DD, for date filters sent to the API.
export function indiaToday(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(now)
}

export function addDays(day: string, days: number) {
  const [year, month, date] = day.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, date + days))
  return next.toISOString().slice(0, 10)
}

export function formatPhone(phone: string | null | undefined) {
  if (!phone) return '—'
  const match = phone.match(/^\+91(\d{5})(\d{5})$/)
  return match ? `+91 ${match[1]} ${match[2]}` : phone
}

export function titleCase(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

type Tone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger'

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Awaiting payment', tone: 'neutral' },
  confirmed: { label: 'New', tone: 'info' },
  preparing: { label: 'Preparing', tone: 'progress' },
  ready: { label: 'Ready', tone: 'progress' },
  picked_up: { label: 'Picked up', tone: 'progress' },
  on_the_way: { label: 'Arriving', tone: 'progress' },
  delivered: { label: 'Delivered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
}

export const PARTNER_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  active: { label: 'Active', tone: 'success' },
  suspended: { label: 'Suspended', tone: 'danger' },
  rejected: { label: 'Rejected', tone: 'neutral' },
}

export const RESTAURANT_STATUS: Record<string, { label: string; tone: Tone }> = {
  ...PARTNER_STATUS,
  active: { label: 'Live', tone: 'success' },
}

export const REFUND_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Refund on its way', tone: 'info' },
  processed: { label: 'Refunded', tone: 'success' },
  failed: { label: 'Refund failed', tone: 'danger' },
}

export const DELIVERY_STATUS: Record<string, string> = {
  searching: 'Finding a rider',
  accepted: 'Rider going to restaurant',
  reached_restaurant: 'Rider at restaurant',
  picked_up: 'Rider has the food',
  arrived: 'Rider at customer',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export const PAYMENT_METHOD: Record<string, string> = {
  upi: 'UPI',
  card: 'Card',
  wallet: 'Wallet',
  cod: 'Cash',
  netbanking: 'Net banking',
}

export const VEHICLE: Record<string, string> = {
  bike: 'Bike',
  scooter: 'Scooter',
  bicycle: 'Bicycle',
  ev: 'Electric',
}
