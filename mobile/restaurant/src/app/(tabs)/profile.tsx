import { Feather } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useFocusEffect, useRouter, type Href } from 'expo-router'
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
import {
  fetchRestaurant,
  pickDishPhoto,
  removeCoverPhoto,
  resolveImageUrl,
  setAcceptingOrders,
  shortTime,
  uploadCoverPhoto,
  type PhotoSource,
  type Restaurant,
} from '@/lib/restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

export default function ProfileScreen() {
  const { signOut } = useAuth()
  const router = useRouter()

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [coverBusy, setCoverBusy] = useState(false)

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

  // Reloads when coming back from the outlet settings screen.
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

  function chooseCover() {
    const options: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: 'Take photo', onPress: () => replaceCover('camera') },
      { text: 'Choose from gallery', onPress: () => replaceCover('library') },
    ]

    if (restaurant?.imageUrl) {
      options.push({ text: 'Remove photo', style: 'destructive', onPress: removeCover })
    }

    options.push({ text: 'Cancel', style: 'cancel' })

    Alert.alert(
      'Cover photo',
      'Shown at the top of your page. Your best dish or your storefront works well.',
      options,
    )
  }

  async function replaceCover(source: PhotoSource) {
    setError('')
    setCoverBusy(true)

    try {
      // Wider than a dish photo: it spans the top of the restaurant page.
      const uri = await pickDishPhoto(source, [16, 9])

      if (uri) setRestaurant(await uploadCoverPhoto(uri))
    } catch (coverError: any) {
      setError(coverError.message || 'Could not update the cover photo')
    } finally {
      setCoverBusy(false)
    }
  }

  async function removeCover() {
    setCoverBusy(true)

    try {
      setRestaurant(await removeCoverPhoto())
    } catch (coverError: any) {
      setError(coverError.message || 'Could not remove the cover photo')
    } finally {
      setCoverBusy(false)
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

  const cover = resolveImageUrl(restaurant?.imageUrl)
  const hours =
    restaurant?.opensAt && restaurant?.closesAt
      ? `${shortTime(restaurant.opensAt)} - ${shortTime(restaurant.closesAt)}`
      : 'Not set'

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
          <Pressable style={styles.cover} onPress={chooseCover} disabled={coverBusy}>
            {cover ? (
              <Image source={{ uri: cover }} style={styles.coverImage} contentFit="cover" />
            ) : (
              <View style={styles.coverEmpty}>
                <Feather name="camera" size={20} color={colors.brand} />
                <Text style={styles.coverEmptyText}>Add a cover photo</Text>
              </View>
            )}

            {coverBusy ? (
              <View style={styles.coverBusy}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : cover ? (
              <View style={styles.coverEdit}>
                <Feather name="edit-2" size={13} color="#fff" />
              </View>
            ) : null}
          </Pressable>

          <View style={styles.identityBody}>
            <Text style={styles.name}>{restaurant?.name ?? 'Your restaurant'}</Text>
            <Text style={styles.address}>
              {restaurant?.addressLine ?? ''}
              {restaurant?.city ? `, ${restaurant.city}` : ''}
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

        <Text style={styles.sectionTitle}>Your business</Text>

        <View style={styles.card}>
          <NavRow
            icon="trending-up"
            label="Earnings"
            hint="Takings, commission and what you keep"
            onPress={() => router.push('/earnings' as Href)}
          />
          <NavRow
            icon="star"
            label="Ratings and reviews"
            hint={
              restaurant?.ratingCount
                ? `★ ${restaurant.rating.toFixed(1)} from ${restaurant.ratingCount} ratings`
                : 'No ratings yet'
            }
            onPress={() => router.push('/reviews' as Href)}
          />
          <NavRow
            icon="clock"
            label="Outlet settings"
            hint={`Hours ${hours} · ${restaurant?.avgPrepMinutes ?? 0} min prep`}
            onPress={() => router.push('/outlet' as Href)}
            last
          />
        </View>

        <Text style={styles.sectionTitle}>Details</Text>

        <View style={styles.card}>
          <Detail label="Cuisines" value={restaurant?.cuisines.join(', ') || '—'} />
          <Detail
            label="Kitchen type"
            value={restaurant?.isVeg ? 'Pure vegetarian' : 'Veg and non-veg'}
          />
          <Detail label="Commission" value={`${restaurant?.commissionPct ?? 0}%`} />
          <Detail label="Connected to" value={API_BASE_URL} last />
        </View>

        <Text style={styles.note}>
          Your name, address and cuisines decide what customers search for and where riders go, so
          Foodos support changes those for you.
        </Text>

        <Pressable style={styles.signOut} onPress={confirmSignOut}>
          <Feather name="log-out" size={16} color={colors.danger} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

function NavRow({
  icon,
  label,
  hint,
  onPress,
  last,
}: {
  icon: keyof typeof Feather.glyphMap
  label: string
  hint: string
  onPress: () => void
  last?: boolean
}) {
  return (
    <Pressable style={[styles.navRow, last && styles.rowLast]} onPress={onPress}>
      <View style={styles.navIcon}>
        <Feather name={icon} size={16} color={colors.brand} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.navLabel}>{label}</Text>
        <Text style={styles.navHint} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.faint} />
    </Pressable>
  )
}

function Detail({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.detailRow, last && styles.rowLast]}>
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
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  // 16:9, the crop the picker uses for covers.
  cover: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.brandSoft },
  coverImage: { width: '100%', height: '100%' },
  coverEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  coverEmptyText: { ...type.smallStrong, color: colors.brand },
  coverBusy: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
  coverEdit: {
    position: 'absolute',
    right: space.md,
    bottom: space.md,
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  identityBody: { padding: space.lg },
  name: { ...type.heading, color: colors.ink },
  address: { ...type.small, color: colors.muted, marginTop: 2 },

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
  rowLast: { borderBottomWidth: 0 },

  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  navIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  navLabel: { ...type.bodyStrong, color: colors.ink },
  navHint: { ...type.caption, color: colors.muted, marginTop: 1 },

  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  detailLabel: { ...type.small, color: colors.muted, width: 110 },
  detailValue: { ...type.small, color: colors.ink, flex: 1, textAlign: 'right' },

  note: { ...type.caption, color: colors.muted, marginTop: space.lg, lineHeight: 17 },

  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.xl,
    paddingVertical: space.lg,
    borderRadius: radius.md,
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
