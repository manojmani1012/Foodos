import React, { createContext, useContext, useMemo, useState } from 'react'

import type { MenuItem, Restaurant } from './catalogue'

// Hands the selected dish to the detail screen.
//
// The menu screen has already loaded the dish, its add-ons and its restaurant,
// so passing the objects across avoids a second request and guarantees the
// detail screen shows exactly the price the menu showed.

type DishValue = {
  dish: MenuItem | null
  restaurant: Restaurant | null
  open: (restaurant: Restaurant, dish: MenuItem) => void
}

const DishContext = createContext<DishValue | null>(null)

export function DishProvider({ children }: { children: React.ReactNode }) {
  const [dish, setDish] = useState<MenuItem | null>(null)
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)

  const value = useMemo<DishValue>(
    () => ({
      dish,
      restaurant,
      open: (nextRestaurant, nextDish) => {
        setRestaurant(nextRestaurant)
        setDish(nextDish)
      },
    }),
    [dish, restaurant],
  )

  return <DishContext.Provider value={value}>{children}</DishContext.Provider>
}

export function useDish(): DishValue {
  const context = useContext(DishContext)

  if (!context) {
    throw new Error('useDish must be used inside a DishProvider')
  }

  return context
}
