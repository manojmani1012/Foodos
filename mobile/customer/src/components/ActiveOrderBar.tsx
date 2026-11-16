// The live order strip at the bottom of the main screens, like Swiggy and
// Zomato: what is happening to the order now and when it arrives. Tapping it
// opens the tracking screen. Checked every 20 seconds while the screen is open.

import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useAuth } from '@/lib/AuthContext'
import { fetchActiveOrder, type Order } from '@/lib/orders'
import { colors, radius, shadow, space, type } from '@/theme'

const REFRESH_MS = 20_000

function headline(order: Order): { title: string; icon: keyof typeof Feather.glyphMap } {
  // Short, so the line fits beside "Track" on a small phone.
  if (order.delivery?.status === 'arrived') return { title: 'Delivery partner has arrived', icon: 'map-pin' }

  switch (order.status) {
    case 'confirmed':
      return { title: 'Order placed', icon: 'clock' }
    case 'preparing':
      return { title: 'Preparing your food', icon: 'coffee' }
    case 'ready':
      return { title: 'Food is ready for pickup', icon: 'package' }
    default:
      return { title: 'On the way', icon: 'navigation' }
  }
}

export function ActiveOrderBar({ style }: { style?: object }) {
  const router = useRouter()
  const { isSignedIn } = useAuth()
  const [order, setOrder] = useState<Order | null>(null)

  useFocusEffect(
    useCallback(() => {
      if (!isSignedIn) return

      let alive = true
      const check = () =>
        fetchActiveOrder()
          .then(next => alive && setOrder(next))
          // A dropped connection keeps the last known state rather than flickering.
          .catch(() => {})

      check()
      const timer = setInterval(check, REFRESH_MS)

      return () => {
        alive = false
        clearInterval(timer)
      }
    }, [isSignedIn]),
  )

  if (!order) return null

  const { title, icon } = headline(order)
  const arriving =
    order.etaMinutes === null ? null : order.etaMinutes === 0 ? 'Arriving now' : `Arriving in ${order.etaMinutes} mins`

  return (
    <Pressable
      style={[styles.bar, style]}
      onPress={() => router.push({ pathname: '/order/[id]', params: { id: order.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${arriving ?? ''}. Track order`}
    >
      <View style={styles.icon}>
        <Feather name={icon} size={18} color={colors.brand} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {[order.restaurant.name, arriving].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text style={styles.track}>Track</Text>
      <Feather name="chevron-right" size={18} color={colors.surface} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
    ...shadow.bar,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  title: { ...type.bodyStrong, color: colors.surface },
  sub: { ...type.caption, color: '#ffffffb3', marginTop: 1 },
  track: { ...type.smallStrong, color: colors.surface },
})
