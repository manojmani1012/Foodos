import * as SecureStore from 'expo-secure-store'
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useColorScheme } from 'react-native'

// Light, dark, or follow the phone.
//
// The choice is a preference, not a secret, but SecureStore is already a
// dependency and works the same way, so it keeps the app to one storage API.

export type ThemeChoice = 'light' | 'dark' | 'system'

const KEY = 'foodos.theme'

type ThemeValue = {
  choice: ThemeChoice
  resolved: 'light' | 'dark'
  setChoice: (choice: ThemeChoice) => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemePreferenceProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme()
  const [choice, setChoiceState] = useState<ThemeChoice>('system')

  useEffect(() => {
    // Wrapped rather than chained: on a platform where the store is missing
    // this throws synchronously, which a .catch() would not catch, and the
    // whole app would fail to render over a theme preference.
    async function restore() {
      try {
        const stored = await SecureStore.getItemAsync(KEY)

        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setChoiceState(stored)
        }
      } catch {
        // No stored preference, or no store: follow the phone.
      }
    }

    restore()
  }, [])

  const value = useMemo<ThemeValue>(
    () => ({
      choice,
      resolved: choice === 'system' ? (system === 'dark' ? 'dark' : 'light') : choice,
      setChoice: (next: ThemeChoice) => {
        // The choice applies immediately; saving it is best effort.
        setChoiceState(next)

        try {
          SecureStore.setItemAsync(KEY, next).catch(() => {})
        } catch {
          // The preference lasts for this session only.
        }
      },
    }),
    [choice, system],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useThemePreference(): ThemeValue {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error('useThemePreference must be used inside a ThemePreferenceProvider')
  }

  return context
}
