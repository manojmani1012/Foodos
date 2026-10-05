import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  fetchOrders,
  formatRupees,
  formatTime,
  QUEUES,
  type OrderSummary,
  type Queue,
} from '@/lib/restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

// A new order should appear without anyone pulling to refresh.
const POLL_MS = 12000

const EMPTY: Record<Queue, { icon: keyof typeof Feather.glyphMap; title: string; hint: string }> = {
  new: {
    icon: 'bell',
    title: 'No new orders',
    hint: 'Orders appear here the moment a customer pays.',
  },
  preparing: {
    icon: 'clock',
    title: 'Nothing cooking',
    hint: 'Accepted orders move here while the kitchen works.',
  },
  ready: {
    icon: 'check-circle',
    title: 'Nothing waiting',
    hint: 'Orders marked ready wait here for the rider.',
  },
}

export default function OrdersScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ queue?: string }>()

  const [queue, setQueue] = useState<Queue>('new')
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  // The dashboard tiles deep-link into a specific queue.
  useEffect(() => {
    if (params.queue === 'new' || params.queue === 'preparing' || params.queue === 'ready') {
      setQueue(params.queue)
    }
  }, [params.queue])

  const load = useCallback(async (which: Queue, showSpinner = false) => {
    if (showSpinner) setLoading(true)

    try {
      setOrders(await fetchOrders(which))
      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load your orders')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(queue, true)
  }, [queue, load])

  const focused = useRef(false)

  useFocusEffect(
    useCallback(() => {
      focused.current = true
      load(queue)

      const timer = setInterval(() => {
        if (focused.current) load(queue)
      }, POLL_MS)

      return () => {
        focused.current = false
        clearInterval(timer)
      }
    }, [queue, load]),
  )

  const empty = EMPTY[queue]

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>Orders</Text>
      </View>

      <View style={styles.tabs}>
        {QUEUES.map(entry => {
          const active = entry.key === queue

          return (
            <Pressable
              key={entry.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setQueue(entry.key)}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{entry.label}</Text>
            </Pressable>
          )
        })}
      </View>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={item => item.id}
          contentContainerStyle={
            orders.length === 0 ? styles.emptyContent : styles.listContent
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true)
                await load(queue)
                setRefreshing(false)
              }}
              tintColor={colors.brand}
            />
          }
          ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Feather name={empty.icon} size={26} color={colors.faint} />
              </View>
              <Text style={styles.emptyTitle}>{empty.title}</Text>
              <Text style={styles.emptyHint}>{empty.hint}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push({ pathname: '/order/[id]', params: { id: item.id } })}
            >
              <View style={styles.cardTop}>
                <Text style={styles.orderNumber}>#{item.orderNumber}</Text>
                <Text style={styles.time}>{formatTime(item.placedAt)}</Text>
              </View>

              <Text style={styles.customer}>{item.customerName || 'Customer'}</Text>

              {item.specialInstructions ? (
                <View style={styles.noteRow}>
                  <Feather name="message-square" size={12} color={colors.warning} />
                  <Text style={styles.note} numberOfLines={2}>
                    {item.specialInstructions}
                  </Text>
                </View>
              ) : null}

              <View style={styles.cardBottom}>
                <Text style={styles.itemCount}>
                  {item.itemCount} item{item.itemCount === 1 ? '' : 's'} ·{' '}
                  {item.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online'}
                </Text>
                <Text style={styles.total}>{formatRupees(item.totalPaise)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    backgroundColor: colors.surface,
  },
  heading: { ...type.title, color: colors.ink },

  tabs: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.ground,
  },
  tabActive: { backgroundColor: colors.brand },
  tabText: { ...type.smallStrong, color: colors.body },
  tabTextActive: { color: '#fff' },

  listContent: { padding: space.lg, gap: space.md, paddingBottom: space.xxxl },
  emptyContent: { flexGrow: 1, padding: space.lg },

  card: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderNumber: { ...type.bodyStrong, color: colors.ink },
  time: { ...type.caption, color: colors.muted },
  customer: { ...type.small, color: colors.body, marginTop: space.xs },

  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs + 2,
    marginTop: space.sm,
    padding: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.warningSoft,
  },
  note: { ...type.caption, color: colors.warning, flex: 1, lineHeight: 16 },

  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  itemCount: { ...type.caption, color: colors.muted, flex: 1 },
  total: { ...type.bodyStrong, color: colors.brand },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  emptyTitle: { ...type.heading, color: colors.body, marginTop: space.sm },
  emptyHint: {
    ...type.small,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: space.xl,
    lineHeight: 19,
  },

  error: {
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
