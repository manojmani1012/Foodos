import { Feather } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '@/lib/AuthContext'
import { API_BASE_URL } from '@/lib/apiClient'
import { fetchRestaurant, setAcceptingOrders, type Restaurant } from '@/lib/restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

export default function ProfileScreen() {
  const { signOut } = useAuth()

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setRestaurant(await fetchRestaurant())
      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load your details')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  async function toggleAccepting() {
    if (!restaurant || busy) return

    const next = !restaurant.isAcceptingOrders

    setBusy(true)
    setRestaurant({ ...restaurant, isAcceptingOrders: next })

    try {
      setRestaurant(await setAcceptingOrders(next))
    } catch (toggleError: any) {
      setRestaurant({ ...restaurant, isAcceptingOrders: !next })
      setError(toggleError.message || 'Could not change your status')
    } finally {
      setBusy(false)
    }
  }

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You will need your OTP to sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ])
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
        <Text style={styles.heading}>Profile</Text>
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

        <View style={styles.identityCard}>
          <View style={styles.avatar}>
            <Feather name="home" size={22} color={colors.brand} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.name}>{restaurant?.name ?? 'Your restaurant'}</Text>
            <Text style={styles.address}>
              {restaurant?.addressLine ?? ''}
              {restaurant?.city ? `, ${restaurant.city}` : ''}
            </Text>
            <Text style={styles.rating}>
              ★ {restaurant?.rating.toFixed(1)} ({restaurant?.ratingCount} ratings)
            </Text>
          </View>
        </View>

        <Pressable style={styles.toggleCard} onPress={toggleAccepting} disabled={busy}>
          <View style={styles.flex}>
            <Text style={styles.toggleLabel}>
              {restaurant?.isAcceptingOrders ? 'Accepting orders' : 'Closed'}
            </Text>
            <Text style={styles.toggleHint}>
              {restaurant?.isAcceptingOrders
                ? 'Customers can order from you now'
                : 'You are hidden from customers'}
            </Text>
          </View>
          <View style={[styles.track, restaurant?.isAcceptingOrders && styles.trackOn]}>
            <View style={[styles.thumb, restaurant?.isAcceptingOrders && styles.thumbOn]} />
          </View>
        </Pressable>

        <Text style={styles.sectionTitle}>Details</Text>

        <View style={styles.card}>
          <Detail label="Cuisines" value={restaurant?.cuisines.join(', ') || '—'} />
          <Detail
            label="Kitchen type"
            value={restaurant?.isVeg ? 'Pure vegetarian' : 'Veg and non-veg'}
          />
          <Detail label="Average prep time" value={`${restaurant?.avgPrepMinutes ?? 0} minutes`} />
          <Detail label="Commission" value={`${restaurant?.commissionPct ?? 0}%`} />
          <Detail label="Status" value={restaurant?.status ?? '—'} last />
        </View>

        <Text style={styles.sectionTitle}>App</Text>

        <View style={styles.card}>
          <Detail label="Connected to" value={API_BASE_URL} last />
        </View>

        <Text style={styles.note}>
          To change your name, address or opening hours, contact Foodos support. Those details
          affect what customers see, so they are not editable here.
        </Text>

        <Pressable style={styles.signOut} onPress={confirmSignOut}>
          <Feather name="log-out" size={16} color={colors.danger} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

function Detail({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  heading: { ...type.title, color: colors.ink },

  content: { padding: space.lg, paddingBottom: space.xxxl },

  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...type.heading, color: colors.ink },
  address: { ...type.small, color: colors.muted, marginTop: 2 },
  rating: { ...type.caption, color: colors.star, marginTop: space.xs },

  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  toggleLabel: { ...type.bodyStrong, color: colors.ink },
  toggleHint: { ...type.caption, color: colors.muted, marginTop: 2 },

  track: {
    width: 46,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.lineStrong,
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: colors.brand },
  thumb: { width: 20, height: 20, borderRadius: radius.pill, backgroundColor: '#fff' },
  thumbOn: { alignSelf: 'flex-end' },

  sectionTitle: { ...type.overline, color: colors.muted, marginTop: space.xl, marginBottom: space.sm },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    ...shadow.card,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailLabel: { ...type.small, color: colors.muted, width: 130 },
  detailValue: { ...type.small, color: colors.ink, flex: 1, textAlign: 'right' },

  note: {
    ...type.caption,
    color: colors.muted,
    marginTop: space.lg,
    lineHeight: 17,
  },

  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.xl,
    paddingVertical: space.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.dangerSoft,
    backgroundColor: colors.dangerSoft,
  },
  signOutText: { ...type.bodyStrong, color: colors.danger },

  error: {
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
