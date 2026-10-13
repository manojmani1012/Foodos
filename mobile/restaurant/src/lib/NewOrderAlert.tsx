import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AppState, Pressable, StyleSheet, Text, Vibration, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { fetchDashboard } from './restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

// A kitchen is loud and the phone is often on a shelf, so a new order has to
// announce itself rather than wait to be noticed on screen.
//
// This works while the app is open. Alerting a phone that is locked or has the
// app closed needs push notifications (Firebase), which come later.

const POLL_MS = 15000
// Long-short-long, repeated: distinct from an ordinary notification buzz.
const PATTERN = [0, 600, 250, 600, 250, 600]

type Value = { newOrders: number; refresh: () => void }

const NewOrderContext = createContext<Value>({ newOrders: 0, refresh: () => {} })

export function NewOrderAlertProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [newOrders, setNewOrders] = useState(0)
  const [banner, setBanner] = useState<number | null>(null)

  // null until the first check, so orders already waiting when the app opens
  // are counted on the badge but do not set the phone buzzing.
  const lastCount = useRef<number | null>(null)

  const check = useCallback(async () => {
    try {
      const { newOrders: count } = await fetchDashboard()

      if (lastCount.current !== null && count > lastCount.current) {
        Vibration.vibrate(PATTERN)
        setBanner(count - lastCount.current)
      }

      lastCount.current = count
      setNewOrders(count)
    } catch {
      // A missed check is retried on the next tick; the badge simply waits.
    }
  }, [])

  useEffect(() => {
    check()

    let timer: ReturnType<typeof setInterval> | null = setInterval(check, POLL_MS)

    // Stop polling in the background and catch up the moment the app returns.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        check()
        timer ??= setInterval(check, POLL_MS)
      } else if (timer) {
        clearInterval(timer)
        timer = null
      }
    })

    return () => {
      if (timer) clearInterval(timer)
      subscription.remove()
    }
  }, [check])

  // The banner clears itself, so a missed one does not cover the screen.
  useEffect(() => {
    if (banner === null) return

    const timeout = setTimeout(() => setBanner(null), 8000)

    return () => clearTimeout(timeout)
  }, [banner])

  return (
    <NewOrderContext.Provider value={{ newOrders, refresh: check }}>
      {children}

      {banner !== null ? (
        <Pressable
          style={[styles.banner, { top: insets.top + space.sm }]}
          onPress={() => {
            setBanner(null)
            Vibration.cancel()
            router.push({ pathname: '/(tabs)/orders', params: { queue: 'new' } })
          }}
        >
          <View style={styles.bannerIcon}>
            <Feather name="bell" size={18} color={colors.brand} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.bannerTitle}>
              {banner === 1 ? 'New order!' : `${banner} new orders!`}
            </Text>
            <Text style={styles.bannerHint}>Tap to accept</Text>
          </View>
          <Feather name="chevron-right" size={18} color="#fff" />
        </Pressable>
      ) : null}
    </NewOrderContext.Provider>
  )
}

export function useNewOrders(): Value {
  return useContext(NewOrderContext)
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  banner: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.brand,
    ...shadow.raised,
  },
  bannerIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  bannerTitle: { ...type.bodyStrong, color: '#fff' },
  bannerHint: { ...type.caption, color: '#cfe8d6' },
})
