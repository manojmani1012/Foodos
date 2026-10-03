import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

import type { MenuItem, Restaurant } from './catalogue'

// The cart lives here so the menu screen, the cart bar and checkout all read the
// same thing.
//
// Each line keeps a snapshot of the dish as it was when added. If the restaurant
// changes a price while someone is shopping, their basket does not silently
// change underneath them — the server re-prices at checkout and that figure is
// what gets charged.

export type CartLine = {
  key: string
  item: MenuItem
  quantity: number
  addOns: { id: string; label: string; price: number }[]
}

type CartValue = {
  lines: CartLine[]
  restaurant: Restaurant | null
  count: number
  subtotal: number
  quantityOf: (itemId: string) => number
  add: (restaurant: Restaurant, item: MenuItem, addOns?: CartLine['addOns']) => void
  increment: (key: string) => void
  decrement: (key: string) => void
  clear: () => void
}

const CartContext = createContext<CartValue | null>(null)

// A line is identified by the dish plus the exact add-ons chosen, so the same
// dish ordered twice with different add-ons stays as two separate lines.
function lineKey(itemId: string, addOns: CartLine['addOns']): string {
  const ids = addOns.map(a => a.id).sort().join(',')

  return ids ? `${itemId}::${ids}` : itemId
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)

  const add = useCallback((nextRestaurant: Restaurant, item: MenuItem, addOns: CartLine['addOns'] = []) => {
    setLines(previous => {
      // An order can only contain dishes from one restaurant, which the API
      // enforces too. Switching restaurants starts a fresh basket.
      const switching = restaurant !== null && restaurant.id !== nextRestaurant.id
      const base = switching ? [] : previous
      const key = lineKey(item.id, addOns)
      const existing = base.find(line => line.key === key)

      if (existing) {
        return base.map(line =>
          line.key === key ? { ...line, quantity: line.quantity + 1 } : line,
        )
      }

      return [...base, { key, item, quantity: 1, addOns }]
    })

    setRestaurant(nextRestaurant)
  }, [restaurant])

  const increment = useCallback((key: string) => {
    setLines(previous =>
      previous.map(line => (line.key === key ? { ...line, quantity: line.quantity + 1 } : line)),
    )
  }, [])

  const decrement = useCallback((key: string) => {
    setLines(previous =>
      previous
        .map(line => (line.key === key ? { ...line, quantity: line.quantity - 1 } : line))
        .filter(line => line.quantity > 0),
    )
  }, [])

  const clear = useCallback(() => {
    setLines([])
    setRestaurant(null)
  }, [])

  const value = useMemo<CartValue>(() => {
    const count = lines.reduce((sum, line) => sum + line.quantity, 0)
    const subtotal = lines.reduce(
      (sum, line) =>
        sum + (line.item.price + line.addOns.reduce((a, b) => a + b.price, 0)) * line.quantity,
      0,
    )

    return {
      lines,
      restaurant,
      count,
      subtotal,
      // Totals across every line of this dish, so the stepper on the menu shows
      // the full count however it was added.
      quantityOf: (itemId: string) =>
        lines.filter(line => line.item.id === itemId).reduce((sum, line) => sum + line.quantity, 0),
      add,
      increment,
      decrement,
      clear,
    }
  }, [lines, restaurant, add, increment, decrement, clear])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartValue {
  const context = useContext(CartContext)

  if (!context) {
    throw new Error('useCart must be used inside a CartProvider')
  }

  return context
}
