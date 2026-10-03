import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { useAuth } from './AuthContext'
import { fetchAddresses, type Address } from './orders'

// The delivery address shown in the header and used at checkout.
//
// One source of truth: the header, the location picker and checkout all read
// this, so what someone sees at the top is what the order is actually sent to.

type LocationValue = {
  addresses: Address[]
  selected: Address | null
  loading: boolean
  select: (address: Address) => void
  reload: () => Promise<void>
  label: string
}

const LocationContext = createContext<LocationValue | null>(null)

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth()
  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!isSignedIn) {
      setAddresses([])
      return
    }

    setLoading(true)

    try {
      const list = await fetchAddresses()
      setAddresses(list)

      // Fall back to the default address, then to whatever exists, so the
      // header is never blank for someone who has saved one.
      setSelectedId(previous => {
        if (previous && list.some(a => a.id === previous)) return previous

        return list.find(a => a.isDefault)?.id ?? list[0]?.id ?? null
      })
    } catch {
      // A failed load leaves the picker empty; browsing still works.
    } finally {
      setLoading(false)
    }
  }, [isSignedIn])

  useEffect(() => {
    reload()
  }, [reload])

  const value = useMemo<LocationValue>(() => {
    const selected = addresses.find(a => a.id === selectedId) ?? null

    return {
      addresses,
      selected,
      loading,
      select: (address: Address) => setSelectedId(address.id),
      reload,
      // What the header shows: the area and city, or a prompt to set one.
      label: selected ? `${selected.line1.split(',')[0]}, ${selected.city}` : 'Set delivery address',
    }
  }, [addresses, selectedId, loading, reload])

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>
}

export function useLocation(): LocationValue {
  const context = useContext(LocationContext)

  if (!context) {
    throw new Error('useLocation must be used inside a LocationProvider')
  }

  return context
}
