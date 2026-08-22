// Shared mock data for restaurants and their menu items across screens.
export const RESTAURANTS = [
  {
    id: 1,
    name: 'The Biryani House',
    cuisine: 'Biryani, North Indian, Chinese',
    rating: 4.4,
    reviews: 1.2,
    time: '30-40 min',
    delivery: '₹20 Delivery',
    tag: 'Free Veg',
    emoji: '🍛',
    color: '#fff3e0',
    address: 'Anna Nagar, Chennai',
  },
  {
    id: 2,
    name: 'Pizza Corner',
    cuisine: 'Pizza, Fast Food, Italian',
    rating: 4.1,
    reviews: 0.8,
    time: '25-35 min',
    delivery: 'Free Delivery',
    tag: null,
    emoji: '🍕',
    color: '#fce4ec',
    address: 'Velachery, Chennai',
  },
  {
    id: 3,
    name: 'Burger Hub',
    cuisine: 'Burgers, Sandwiches, Snacks',
    rating: 4.3,
    reviews: 0.6,
    time: '20-30 min',
    delivery: '₹15 Delivery',
    tag: null,
    emoji: '🍔',
    color: '#e8f5e9',
    address: 'T Nagar, Chennai',
  },
  {
    id: 4,
    name: 'Dosa Express',
    cuisine: 'South Indian, Tiffins',
    rating: 4.5,
    reviews: 2.1,
    time: '15-25 min',
    delivery: 'Free Delivery',
    tag: null,
    emoji: '🥘',
    color: '#f3e5f5',
    address: 'Adyar, Chennai',
  },
]

export const MENU_CATEGORIES = ['Biryani', 'Starters', 'Main Course', 'Combos', 'Breads', 'Beverages', 'Desserts']

export const MENU_ITEMS = [
  { id: 101, restaurantId: 1, name: 'Chicken Biryani', category: 'Biryani', price: 249, rating: 4.5, reviews: 910, veg: false, emoji: '🍛', desc: 'Aromatic basmati rice cooked with tender chicken, spices & herbs.' },
  { id: 102, restaurantId: 1, name: 'Mutton Biryani', category: 'Biryani', price: 299, rating: 4.6, reviews: 540, veg: false, emoji: '🍛', desc: 'Slow-cooked mutton layered with fragrant basmati rice.' },
  { id: 103, restaurantId: 1, name: 'Veg Biryani', category: 'Biryani', price: 199, rating: 4.2, reviews: 320, veg: true, emoji: '🍛', desc: 'Mixed vegetables and basmati rice with traditional spices.' },
  { id: 104, restaurantId: 1, name: 'Prawn Biryani', category: 'Biryani', price: 319, rating: 4.4, reviews: 210, veg: false, emoji: '🍤', desc: 'Juicy prawns simmered in a spiced biryani masala with rice.' },
  { id: 105, restaurantId: 1, name: 'Chicken 65', category: 'Starters', price: 179, rating: 4.3, reviews: 402, veg: false, emoji: '🍗', desc: 'Spicy deep-fried chicken bites tossed with curry leaves.' },
  { id: 106, restaurantId: 1, name: 'Gobi Manchurian', category: 'Starters', price: 159, rating: 4.0, reviews: 180, veg: true, emoji: '🥦', desc: 'Crispy cauliflower florets tossed in a tangy manchurian sauce.' },
]

export const ADD_ONS = [
  { id: 'a1', label: 'Extra Chicken (2 pcs)', price: 50 },
  { id: 'a2', label: 'Raita', price: 30 },
  { id: 'a3', label: 'Boiled Egg', price: 20 },
]

export function getRestaurant(id) {
  return RESTAURANTS.find(r => r.id === id)
}

export function getMenuForRestaurant(id) {
  return MENU_ITEMS.filter(m => m.restaurantId === id)
}

export function getItem(id) {
  return MENU_ITEMS.find(m => m.id === id)
}
