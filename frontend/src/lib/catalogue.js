import { request } from './apiClient.js'

// Turns API responses into the shape the screens already render.
//
// Prices arrive as paise and are converted once, here, so no screen has to
// remember the unit. Illustrations (emoji and card colour) are presentation, not
// data: the database stores image URLs, and until real photos are uploaded these
// keep the design intact without inventing fields on the server.

const CUISINE_ART = [
  [/biryani|rice/i, '🍛', '#fff3e0'],
  [/pizza|italian/i, '🍕', '#fce4ec'],
  [/burger|sandwich/i, '🍔', '#e8f5e9'],
  [/south indian|tiffin|dosa/i, '🥘', '#f3e5f5'],
  [/healthy|salad|continental/i, '🥗', '#e0f2f1'],
  [/dessert|cake|bakery/i, '🍰', '#fff8e1'],
  [/chinese|noodle/i, '🍜', '#e3f2fd'],
  [/chicken|grill|kebab/i, '🍗', '#fbe9e7'],
]

const ITEM_ART = [
  [/biryani/i, '🍛'],
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

function artFor(patterns, text, fallback) {
  const match = patterns.find(([pattern]) => pattern.test(text))

  return match ? match.slice(1) : fallback
}

export function rupees(paise) {
  return Math.round(paise) / 100
}

// The cards read "(1.2k+)", so a count becomes thousands to one decimal place.
function toThousands(count) {
  return Math.round(count / 100) / 10
}

export function mapRestaurant(api) {
  const text = `${api.name} ${(api.cuisines || []).join(' ')}`
  const [emoji, color] = artFor(CUISINE_ART, text, ['🍽️', '#eceff1'])
  const fee = rupees(api.deliveryFeePaise)

  return {
    id: api.id,
    name: api.name,
    cuisine: (api.cuisines || []).join(', '),
    rating: api.rating,
    reviews: toThousands(api.ratingCount),
    time: `${api.etaMinMinutes}-${api.etaMaxMinutes} min`,
    delivery: fee === 0 ? 'Free Delivery' : `₹${fee} Delivery`,
    deliveryFee: fee,
    tag: api.isVeg ? 'Pure Veg' : null,
    emoji,
    color,
    address: [api.addressLine, api.city].filter(Boolean).join(', '),
    isAcceptingOrders: api.isAcceptingOrders,
    isFavourite: api.isFavourite,
  }
}

export function mapMenuItem(api, categoryName) {
  const [emoji] = artFor(ITEM_ART, `${api.name} ${categoryName || ''}`, ['🍽️'])

  return {
    id: api.id,
    name: api.name,
    category: categoryName,
    price: rupees(api.pricePaise),
    pricePaise: api.pricePaise,
    rating: api.rating,
    reviews: api.ratingCount,
    veg: api.isVeg,
    isAvailable: api.isAvailable,
    desc: api.description,
    emoji,
    addOns: (api.addons || []).map(addon => ({
      id: addon.id,
      label: addon.name,
      price: rupees(addon.pricePaise),
      pricePaise: addon.pricePaise,
      isAvailable: addon.isAvailable,
    })),
  }
}

function query(params) {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value)
    }
  }

  const string = search.toString()

  return string ? `?${string}` : ''
}

export async function fetchRestaurants({ search, cuisine, city, vegOnly, limit, offset } = {}) {
  const body = await request(
    `/api/v1/customer/restaurants${query({ search, cuisine, city, vegOnly, limit, offset })}`,
    // Browsing works signed out; the token is sent when there is one so the
    // server can mark favourites.
    { auth: true },
  )

  return {
    restaurants: body.restaurants.map(mapRestaurant),
    total: body.total,
  }
}

export async function fetchRestaurant(id) {
  const body = await request(`/api/v1/customer/restaurants/${id}`)

  const categories = (body.categories || []).map(category => ({
    id: category.id,
    name: category.name,
    items: category.items.map(item => mapMenuItem(item, category.name)),
  }))

  return {
    restaurant: mapRestaurant(body),
    categories,
    items: categories.flatMap(category => category.items),
  }
}

export async function fetchCuisines() {
  const body = await request('/api/v1/customer/cuisines')

  return body.cuisines.map(name => {
    const [emoji] = artFor(CUISINE_ART, name, ['🍽️'])

    return { id: name, label: name, emoji }
  })
}

// Offer cards cycle through these so a row of them stays visually distinct.
const OFFER_COLORS = ['#1a5c35', '#e65100', '#6a1b9a', '#1565c0']

export async function fetchOffers() {
  const body = await request('/api/v1/customer/offers')

  return body.offers.map((offer, index) => {
    const label =
      offer.type === 'percent'
        ? `${Math.round(offer.percentOff)}% OFF`
        : offer.type === 'flat'
          ? `₹${rupees(offer.flatOffPaise)} OFF`
          : 'FREE DELIVERY'

    const conditions = []

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

export async function fetchFavourites() {
  const body = await request('/api/v1/customer/favourites')

  return body.restaurants.map(mapRestaurant)
}

export function addFavourite(restaurantId) {
  return request(`/api/v1/customer/favourites/${restaurantId}`, { method: 'PUT' })
}

export function removeFavourite(restaurantId) {
  return request(`/api/v1/customer/favourites/${restaurantId}`, { method: 'DELETE' })
}
