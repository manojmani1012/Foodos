import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  fetchDashboard,
  fetchRestaurant,
  formatRupees,
  setAcceptingOrders,
  type Dashboard,
  type Restaurant,
} from '@/lib/restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

// How often the counters refresh while this screen is open. A kitchen needs to
// notice a new order quickly, and the payload is a handful of integers.
const POLL_MS = 15000

export default function TodayScreen() {
  const router = useRouter()
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [counters, setCounters] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [togglePending, setTogglePending] = useState(false)

  const load = useCallback(async () => {
    try {
      const [place, numbers] = await Promise.all([fetchRestaurant(), fetchDashboard()])

      setRestaurant(place)
      setCounters(numbers)
      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load your dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Poll only while this tab is actually in front, so a backgrounded app is
  // not quietly making requests every fifteen seconds.
  const focused = useRef(false)

  useFocusEffect(
    useCallback(() => {
      focused.current = true
      load()

      const timer = setInterval(() => {
        if (focused.current) load()
      }, POLL_MS)

      return () => {
        focused.current = false
        clearInterval(timer)
      }
    }, [load]),
  )

  async function toggleAccepting() {
    if (!restaurant || togglePending) return

    const next = !restaurant.isAcceptingOrders

    setTogglePending(true)
    // Optimistic: the switch should move under the thumb, not after a round trip.
    setRestaurant({ ...restaurant, isAcceptingOrders: next })

    try {
      setRestaurant(await setAcceptingOrders(next))
    } catch (toggleError: any) {
      setRestaurant({ ...restaurant, isAcceptingOrders: !next })
      setError(toggleError.message || 'Could not change your status')
    } finally {
      setTogglePending(false)
    }
  }

  function openQueue(queue: 'new' | 'preparing' | 'ready') {
    router.push({ pathname: '/(tabs)/orders', params: { queue } })
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.flex}>
            <Text style={styles.restaurantName} numberOfLines={1}>
              {restaurant?.name ?? 'Your restaurant'}
            </Text>
            <Text style={styles.headerMeta}>
              {restaurant ? `★ ${restaurant.rating.toFixed(1)} · ` : ''}
              {restaurant?.addressLine ?? ''}
              {restaurant?.city ? `, ${restaurant.city}` : ''}
            </Text>
          </View>
        </View>

        <Pressable
          style={[styles.statusRow, togglePending && styles.statusRowBusy]}
          onPress={toggleAccepting}
          disabled={togglePending}
        >
          <View style={styles.flex}>
            <Text style={styles.statusLabel}>
              {restaurant?.isAcceptingOrders ? 'Accepting orders' : 'Closed'}
            </Text>
            <Text style={styles.statusHint}>
              {restaurant?.isAcceptingOrders
                ? 'Customers can order from you now'
                : 'You are hidden from customers'}
            </Text>
          </View>
          <Switch on={!!restaurant?.isAcceptingOrders} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true)
              await load()
              setRefreshing(false)
            }}
            tintColor={colors.brand}
          />
        }
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.revenueCard}>
          <Text style={styles.revenueLabel}>Earned today</Text>
          <Text style={styles.revenueValue}>{formatRupees(counters?.revenueTodayPaise ?? 0)}</Text>
          <Text style={styles.revenueHint}>
            {counters?.ordersToday ?? 0} order{counters?.ordersToday === 1 ? '' : 's'} today
            {counters?.inProgressPaise
              ? ` · ${formatRupees(counters.inProgressPaise)} still cooking`
              : ''}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Order queue</Text>

        <View style={styles.queueRow}>
          <QueueTile
            label="New"
            value={counters?.newOrders ?? 0}
            icon="bell"
            tone={colors.warning}
            toneSoft={colors.warningSoft}
            onPress={() => openQueue('new')}
          />
          <QueueTile
            label="Preparing"
            value={counters?.preparing ?? 0}
            icon="clock"
            tone="#1565c0"
            toneSoft="#e7f0fb"
            onPress={() => openQueue('preparing')}
          />
          <QueueTile
            label="Ready"
            value={counters?.ready ?? 0}
            icon="check-circle"
            tone={colors.brand}
            toneSoft={colors.brandSoft}
            onPress={() => openQueue('ready')}
          />
        </View>

        <Text style={styles.sectionTitle}>Menu</Text>

        <Pressable style={styles.menuCard} onPress={() => router.push('/(tabs)/menu')}>
          <View style={styles.flex}>
            <Text style={styles.menuValue}>{counters?.menuItems ?? 0} items on your menu</Text>
            <Text style={styles.menuHint}>
              {counters?.unavailableItems
                ? `${counters.unavailableItems} marked unavailable`
                : 'All items available'}
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.faint} />
        </Pressable>

        {counters?.cancelledToday ? (
          <Text style={styles.footnote}>
            {counters.cancelledToday} order{counters.cancelledToday === 1 ? '' : 's'} cancelled today
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function QueueTile({
  label,
  value,
  icon,
  tone,
  toneSoft,
  onPress,
}: {
  label: string
  value: number
  icon: keyof typeof Feather.glyphMap
  tone: string
  toneSoft: string
  onPress: () => void
}) {
  return (
    <Pressable style={styles.queueTile} onPress={onPress}>
      <View style={[styles.queueIcon, { backgroundColor: toneSoft }]}>
        <Feather name={icon} size={16} color={tone} />
      </View>
      <Text style={[styles.queueValue, { color: tone }]}>{value}</Text>
      <Text style={styles.queueLabel}>{label}</Text>
    </Pressable>
  )
}

// A plain view, not the platform Switch: the whole row is the touch target, so
// this only has to show state.
function Switch({ on }: { on: boolean }) {
  return (
    <View style={[styles.track, on && styles.trackOn]}>
      <View style={[styles.thumb, on && styles.thumbOn]} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
    gap: space.md,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center' },
  restaurantName: { ...type.title, color: '#fff' },
  headerMeta: { ...type.small, color: '#bcd8c6', marginTop: 2 },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  statusRowBusy: { opacity: 0.6 },
  statusLabel: { ...type.bodyStrong, color: '#fff' },
  statusHint: { ...type.caption, color: '#bcd8c6', marginTop: 1 },

  track: {
    width: 46,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.25)',
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: '#8bd18f' },
  thumb: { width: 20, height: 20, borderRadius: radius.pill, backgroundColor: '#fff' },
  thumbOn: { alignSelf: 'flex-end' },

  content: { padding: space.lg, paddingBottom: space.xxxl },

  revenueCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  revenueLabel: { ...type.overline, color: colors.muted },
  revenueValue: { ...type.display, color: colors.brand, marginTop: space.xs },
  revenueHint: { ...type.small, color: colors.muted, marginTop: space.xs },

  sectionTitle: { ...type.heading, color: colors.ink, marginTop: space.xl, marginBottom: space.md },

  queueRow: { flexDirection: 'row', gap: space.md },
  queueTile: {
    flex: 1,
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  queueIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueValue: { ...type.title },
  queueLabel: { ...type.caption, color: colors.muted },

  menuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  menuValue: { ...type.bodyStrong, color: colors.ink },
  menuHint: { ...type.caption, color: colors.muted, marginTop: 2 },

  error: {
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
  footnote: { ...type.caption, color: colors.muted, marginTop: space.xl, textAlign: 'center' },
})
