import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '@/lib/AuthContext'
import { fetchOrders } from '@/lib/orders'
import { colors, radius, shadow, space, type } from '@/theme'

// How each status reads, and whether it is still moving.
const STATUS: Record<string, { label: string; tone: 'live' | 'done' | 'cancelled' }> = {
  pending: { label: 'Pending', tone: 'live' },
  confirmed: { label: 'Confirmed', tone: 'live' },
  preparing: { label: 'Preparing', tone: 'live' },
  ready: { label: 'Ready for pickup', tone: 'live' },
  picked_up: { label: 'Picked up', tone: 'live' },
  on_the_way: { label: 'On the way', tone: 'live' },
  delivered: { label: 'Delivered', tone: 'done' },
  cancelled: { label: 'Cancelled', tone: 'cancelled' },
}

export default function OrdersScreen() {
  const router = useRouter()
  const { isSignedIn } = useAuth()

  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!isSignedIn) {
      setLoading(false)
      return
    }

    setError('')

    try {
      setOrders(await fetchOrders())
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load your orders')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [isSignedIn])

  // Reloads every time the tab is opened, so an order placed moments ago is
  // already there, and a status moved by the restaurant shows up on return.
  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Your orders</Text>
      </View>

      <FlatList
        data={orders}
        keyExtractor={item => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              load()
            }}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
        renderItem={({ item }) => {
          const status = STATUS[item.status] ?? { label: item.status, tone: 'live' as const }

          return (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => router.push({ pathname: '/order/[id]', params: { id: item.id } })}
            >
              <View style={styles.cardHead}>
                <View style={styles.flex}>
                  <Text style={styles.restaurant} numberOfLines={1}>
                    {item.restaurant?.name}
                  </Text>
                  <Text style={styles.meta}>
                    #{item.orderNumber} · {new Date(item.placedAt).toLocaleDateString()}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusPill,
                    status.tone === 'done' && styles.statusDone,
                    status.tone === 'cancelled' && styles.statusCancelled,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      status.tone === 'cancelled' && styles.statusTextCancelled,
                    ]}
                  >
                    {status.label}
                  </Text>
                </View>
              </View>

              <View style={styles.cardFoot}>
                <Text style={styles.items}>
                  {item.itemCount} item{item.itemCount === 1 ? '' : 's'}
                </Text>
                <Text style={styles.total}>₹{item.total.toFixed(0)}</Text>
                <Feather name="chevron-right" size={18} color={colors.faint} />
              </View>
            </Pressable>
          )
        }}
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : error ? (
            <View style={styles.empty}>
              <Feather name="wifi-off" size={40} color={colors.faint} />
              <Text style={styles.emptyText}>{error}</Text>
              <Pressable style={styles.ghost} onPress={load}>
                <Text style={styles.ghostText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.empty}>
              <Feather name="file-text" size={40} color={colors.faint} />
              <Text style={styles.emptyTitle}>No orders yet</Text>
              <Text style={styles.emptyText}>Your orders will appear here once you place one.</Text>
              <Pressable style={styles.ghost} onPress={() => router.push('/')}>
                <Text style={styles.ghostText}>Browse restaurants</Text>
              </Pressable>
            </View>
          )
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  header: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  headerTitle: { ...type.display, fontSize: 24, color: colors.ink },
  list: { padding: space.lg, gap: space.md, flexGrow: 1 },

  card: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  cardPressed: { opacity: 0.9 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  restaurant: { ...type.heading, color: colors.ink },
  meta: { ...type.caption, color: colors.muted, marginTop: 2 },

  statusPill: {
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  statusDone: { backgroundColor: colors.veg },
  statusCancelled: { backgroundColor: colors.dangerSoft },
  statusText: { ...type.caption, color: colors.surface, fontWeight: '700' },
  statusTextCancelled: { color: colors.danger },

  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  items: { flex: 1, ...type.small, color: colors.body },
  total: { ...type.bodyStrong, color: colors.ink, fontVariant: ['tabular-nums'] },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  emptyTitle: { ...type.heading, color: colors.ink, marginTop: space.sm },
  emptyText: { ...type.body, color: colors.muted, textAlign: 'center' },
  ghost: {
    marginTop: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  ghostText: { ...type.smallStrong, color: colors.brand },
})
