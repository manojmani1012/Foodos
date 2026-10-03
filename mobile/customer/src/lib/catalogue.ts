import { request } from './apiClient'

// Turns API responses into what the screens render.
//
// Prices arrive as paise and are converted once, here, so no screen has to
// remember the unit. Illustrations are presentation, not data: the database
// stores image URLs, and until real photos are uploaded these keep the design
// intact without inventing fields on the server.

const CUISINE_ART: [RegExp, string, string][] = [
  [/biryani|rice/i, '🍛', '#fff3e0'],
  [/pizza|italian/i, '🍕', '#fce4ec'],
  [/burger|sandwich/i, '🍔', '#e8f5e9'],
  [/south indian|tiffin|dosa/i, '🥘', '#f3e5f5'],
  [/healthy|salad|continental/i, '🥗', '#e0f2f1'],
  [/dessert|cake|bakery/i, '🍰', '#fff8e1'],
  [/chinese|noodle/i, '🍜', '#e3f2fd'],
  [/chicken|grill|kebab/i, '🍗', '#fbe9e7'],
]

export function rupees(paise: number): number {
  return Math.round(paise) / 100
}

function artFor(text: string): [string, string] {
  const match = CUISINE_ART.find(([pattern]) => pattern.test(text))

  return match ? [match[1], match[2]] : ['🍽️', '#eceff1']
}

export type Restaurant = {
  id: string
  name: string
  cuisine: string
  rating: number
  ratingCount: number
  eta: string
  delivery: string
  isVeg: boolean
  emoji: string
  color: string
  address: string
  isAcceptingOrders: boolean
  isFavourite: boolean
}

export function mapRestaurant(api: any): Restaurant {
  const [emoji, color] = artFor(`${api.name} ${(api.cuisines || []).join(' ')}`)
  const fee = rupees(api.deliveryFeePaise)

  return {
    id: api.id,
    name: api.name,
    cuisine: (api.cuisines || []).join(', '),
    rating: api.rating,
    ratingCount: api.ratingCount,
    eta: `${api.etaMinMinutes}-${api.etaMaxMinutes} min`,
    delivery: fee === 0 ? 'Free Delivery' : `₹${fee} Delivery`,
    isVeg: api.isVeg,
    emoji,
    color,
    address: [api.addressLine, api.city].filter(Boolean).join(', '),
    isAcceptingOrders: api.isAcceptingOrders,
    isFavourite: api.isFavourite,
  }
}

function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value))
    }
  }

  const string = search.toString()

  return string ? `?${string}` : ''
}

export async function fetchRestaurants(
  options: { search?: string; cuisine?: string; city?: string } = {},
): Promise<{ restaurants: Restaurant[]; total: number }> {
  const body = await request(`/api/v1/customer/restaurants${query(options)}`)

  return {
    restaurants: body.restaurants.map(mapRestaurant),
    total: body.total,
  }
}

export async function fetchCuisines(): Promise<{ id: string; label: string; emoji: string }[]> {
  const body = await request('/api/v1/customer/cuisines')

  return body.cuisines.map((name: string) => {
    const [emoji] = artFor(name)

    return { id: name, label: name, emoji }
  })
}

const OFFER_COLORS = ['#1a5c35', '#e65100', '#6a1b9a', '#1565c0']

export async function fetchOffers() {
  const body = await request('/api/v1/customer/offers')

  return body.offers.map((offer: any, index: number) => {
    const label =
      offer.type === 'percent'
        ? `${Math.round(offer.percentOff)}% OFF`
        : offer.type === 'flat'
          ? `₹${rupees(offer.flatOffPaise)} OFF`
          : 'FREE DELIVERY'

    const conditions: string[] = []

    if (offer.maxDiscountPaise) conditions.push(`Up to ₹${rupees(offer.maxDiscountPaise)}`)
    if (offer.firstOrderOnly) conditions.push('on your first order')
    else if (offer.minOrderPaise > 0) conditions.push(`on orders above ₹${rupees(offer.minOrderPaise)}`)

    return {
      id: offer.id,
      code: offer.code,
      label,
      sub: conditions.join(' ') || 'On all orders',
      color: OFFER_COLORS[index % OFFER_COLORS.length],
    }
  })
}

export function addFavourite(restaurantId: string) {
  return request(`/api/v1/customer/favourites/${restaurantId}`, { method: 'PUT' })
}

export function removeFavourite(restaurantId: string) {
  return request(`/api/v1/customer/favourites/${restaurantId}`, { method: 'DELETE' })
}


export type MenuItem = {
  id: string
  name: string
  description: string | null
  price: number
  isVeg: boolean
  isAvailable: boolean
  rating: number | null
  ratingCount: number
  emoji: string
  addOns: { id: string; label: string; price: number; isAvailable: boolean }[]
}

export type MenuCategory = { id: string; name: string; items: MenuItem[] }

const ITEM_ART: [RegExp, string][] = [
  [/biryani|briyani/i, '🍛'],
  [/pizza/i, '🍕'],
  [/burger/i, '🍔'],
  [/dosa|idli|vada/i, '🥘'],
  [/naan|roti|bread/i, '🫓'],
  [/prawn|fish/i, '🍤'],
  [/chicken|tikka|65/i, '🍗'],
  [/juice|chaas|lassi|beverage/i, '🥤'],
  [/bowl|salad|quinoa/i, '🥗'],
  [/fries|snack/i, '🍟'],
  [/cake|dessert|sweet/i, '🍰'],
  [/gobi|paneer|veg/i, '🥦'],
]

function itemArt(text: string): string {
  return ITEM_ART.find(([pattern]) => pattern.test(text))?.[1] ?? '🍽️'
}

export function mapMenuItem(api: any, categoryName?: string): MenuItem {
  return {
    id: api.id,
    name: api.name,
    description: api.description,
    price: rupees(api.pricePaise),
    isVeg: api.isVeg,
    isAvailable: api.isAvailable,
    rating: api.rating,
    ratingCount: api.ratingCount,
    emoji: itemArt(`${api.name} ${categoryName ?? ''}`),
    addOns: (api.addons || []).map((addon: any) => ({
      id: addon.id,
      label: addon.name,
      price: rupees(addon.pricePaise),
      isAvailable: addon.isAvailable,
    })),
  }
}

export async function fetchRestaurant(
  id: string,
): Promise<{ restaurant: Restaurant; categories: MenuCategory[] }> {
  const body = await request(`/api/v1/customer/restaurants/${id}`)

  return {
    restaurant: mapRestaurant(body),
    categories: (body.categories || []).map((category: any) => ({
      id: category.id,
      name: category.name,
      items: category.items.map((item: any) => mapMenuItem(item, category.name)),
    })),
  }
}
