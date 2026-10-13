import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  acceptOffer,
  fetchActive,
  fetchOffers,
  fetchPartner,
  formatKm,
  formatRupees,
  setOnline,
  skipOffer,
  type Delivery,
  type Offer,
  type Partner,
} from '@/lib/delivery'
import { useLocationSharing } from '@/lib/LocationSharing'
import { colors, radius, shadow, space, type } from '@/theme'

// Offers are checked this often while online and free. A delivery is first come,
// first served, so a slow check means losing orders to other riders.
const POLL_MS = 8000
// An offer left unanswered is skipped, so it goes to someone who is looking.
const OFFER_SECONDS = 60
const BUZZ = [0, 500, 200, 500]

export default function HomeScreen() {
  const router = useRouter()

  const [partner, setPartner] = useState<Partner | null>(null)
  const [active, setActive] = useState<Delivery | null>(null)
  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Which offers the rider has already been buzzed for.
  const seen = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const [me, current] = await Promise.all([fetchPartner(), fetchActive()])

      setPartner(me)
      setActive(current)

      if (me.status === 'active' && me.isOnline && !current) {
        const open = await fetchOffers()
        const fresh = open.filter(offer => !seen.current.has(offer.id))

        if (fresh.length > 0) {
          Vibration.vibrate(BUZZ)
          fresh.forEach(offer => seen.current.add(offer.id))
        }

        setOffers(open)
      } else {
        setOffers([])
      }

      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not reach Foodos. Check your connection')
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll only while this screen is in front and the app is open.
  useFocusEffect(
    useCallback(() => {
      load()

      let timer: ReturnType<typeof setInterval> | null = setInterval(load, POLL_MS)
      const subscription = AppState.addEventListener('change', state => {
        if (state === 'active') {
          load()
          timer ??= setInterval(load, POLL_MS)
        } else if (timer) {
          clearInterval(timer)
          timer = null
        }
      })

      return () => {
        if (timer) clearInterval(timer)
        subscription.remove()
      }
    }, [load]),
  )

  const sharing = !!partner && partner.status === 'active' && (partner.isOnline || !!active)

  useLocationSharing(sharing, () =>
    Alert.alert(
      'Location needed',
      'Foodos uses your location to show how far each pickup is and to let customers follow their order. Allow location in your phone settings.',
    ),
  )

  async function toggleOnline() {
    if (!partner || switching) return

    if (partner.isOnline && active) {
      Alert.alert('Finish your delivery first', 'You can go offline once this order is delivered.')
      return
    }

    setSwitching(true)

    try {
      setPartner(await setOnline(!partner.isOnline))
      await load()
    } catch (switchError: any) {
      setError(switchError.message || 'Could not change your status')
    } finally {
      setSwitching(false)
    }
  }

  async function accept(offer: Offer) {
    if (acceptingId) return

    setAcceptingId(offer.id)
    Vibration.cancel()

    try {
      await acceptOffer(offer.id)
      router.push('/delivery')
    } catch (acceptError: any) {
      // Usually another rider was quicker. Say so and move on.
      setError(acceptError.message || 'Could not accept this order')
      await load()
    } finally {
      setAcceptingId(null)
    }
  }

  async function skip(offer: Offer) {
    setOffers(current => current.filter(o => o.id !== offer.id))
    skipOffer(offer.id).catch(() => {})
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

  const approved = partner?.status === 'active'
  const online = !!partner?.isOnline

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={[styles.header, online && approved && styles.headerOnline]}>
        <View style={styles.flex}>
          <Text style={styles.hello}>Hi {partner?.name?.split(' ')[0] || 'there'}</Text>
          <Text style={styles.headerHint}>
            {!approved
              ? 'Account under review'
              : online
                ? 'You are online and receiving orders'
                : 'You are offline'}
          </Text>
        </View>

        {approved ? (
          <Pressable
            style={[styles.switch, online && styles.switchOn, switching && styles.dim]}
            onPress={toggleOnline}
            disabled={switching}
          >
            <Text style={[styles.switchText, online && styles.switchTextOn]}>
              {online ? 'Online' : 'Offline'}
            </Text>
            <View style={[styles.track, online && styles.trackOn]}>
              <View style={[styles.thumb, online && styles.thumbOn]} />
            </View>
          </Pressable>
        ) : null}
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

        <View style={styles.statsRow}>
          <Stat label="Today's earnings" value={formatRupees(partner?.today.earningsPaise ?? 0)} />
          <Stat label="Deliveries today" value={String(partner?.today.deliveries ?? 0)} />
        </View>

        {!approved ? (
          <Notice
            icon="shield"
            title={partner?.status === 'pending' ? 'Waiting for approval' : 'Account not active'}
            body={
              partner?.status === 'pending'
                ? 'Foodos is verifying your details. You can go online and take orders as soon as your account is approved. Meanwhile, add your vehicle details under Profile.'
                : 'Your account cannot take orders right now. Contact Foodos support.'
            }
          />
        ) : active ? (
          <Pressable style={styles.activeCard} onPress={() => router.push('/delivery')}>
            <View style={styles.activeIcon}>
              <Feather name="package" size={20} color="#fff" />
            </View>
            <View style={styles.flex}>
              <Text style={styles.activeTitle}>Delivery in progress</Text>
              <Text style={styles.activeHint}>
                #{active.orderNumber} · {active.restaurant.name}
              </Text>
            </View>
            <Text style={styles.activeAction}>Continue</Text>
            <Feather name="chevron-right" size={18} color="#fff" />
          </Pressable>
        ) : !online ? (
          <Notice
            icon="moon"
            title="You are offline"
            body="Go online to start receiving delivery requests near you."
          />
        ) : offers.length === 0 ? (
          <Notice
            icon="radio"
            title="Looking for orders"
            body="New requests appear here and your phone vibrates. Keep the app open while you wait."
          />
        ) : (
          <>
            <Text style={styles.sectionTitle}>New requests</Text>
            {offers.map(offer => (
              <OfferCard
                key={offer.id}
                offer={offer}
                busy={acceptingId === offer.id}
                onAccept={() => accept(offer)}
                onSkip={() => skip(offer)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function OfferCard({
  offer,
  busy,
  onAccept,
  onSkip,
}: {
  offer: Offer
  busy: boolean
  onAccept: () => void
  onSkip: () => void
}) {
  // Counts down from when this card first appeared on this phone.
  const [left, setLeft] = useState(OFFER_SECONDS)

  useEffect(() => {
    const timer = setInterval(() => setLeft(seconds => seconds - 1), 1000)

    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (left <= 0 && !busy) onSkip()
    // onSkip changes identity every render; only the countdown should trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, busy])

  return (
    <View style={styles.offer}>
      <View style={styles.offerTop}>
        <Text style={styles.offerEarning}>{formatRupees(offer.earningPaise)}</Text>
        <View style={styles.timer}>
          <Feather name="clock" size={12} color={colors.warning} />
          <Text style={styles.timerText}>{Math.max(left, 0)}s</Text>
        </View>
      </View>

      <Leg
        icon="shopping-bag"
        title={offer.restaurant.name}
        detail={[offer.restaurant.area, `${formatKm(offer.pickupKm)} away`].filter(Boolean).join(' · ')}
      />
      <View style={styles.legLine} />
      <Leg icon="map-pin" title={offer.dropArea || 'Customer'} detail={`${formatKm(offer.dropKm)} from the restaurant`} />

      <View style={styles.offerMeta}>
        <Text style={styles.offerMetaText}>
          {offer.itemCount} item{offer.itemCount === 1 ? '' : 's'} · {offer.foodReady ? 'Food is ready' : 'Being prepared'}
        </Text>
        {offer.collectPaise > 0 ? (
          <View style={styles.cashPill}>
            <Text style={styles.cashPillText}>Collect {formatRupees(offer.collectPaise)} cash</Text>
          </View>
        ) : (
          <Text style={styles.prepaid}>Prepaid</Text>
        )}
      </View>

      <View style={styles.offerActions}>
        <Pressable style={styles.skipButton} onPress={onSkip} disabled={busy}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
        <Pressable style={[styles.acceptButton, busy && styles.dim]} onPress={onAccept} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptText}>Accept order</Text>}
        </Pressable>
      </View>
    </View>
  )
}

function Leg({ icon, title, detail }: { icon: keyof typeof Feather.glyphMap; title: string; detail: string }) {
  return (
    <View style={styles.leg}>
      <View style={styles.legIcon}>
        <Feather name={icon} size={14} color={colors.brand} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.legTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.legDetail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
    </View>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

function Notice({ icon, title, body }: { icon: keyof typeof Feather.glyphMap; title: string; body: string }) {
  return (
    <View style={styles.notice}>
      <View style={styles.noticeIcon}>
        <Feather name={icon} size={24} color={colors.brand} />
      </View>
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeBody}>{body}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.6 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
    backgroundColor: '#3a4148',
  },
  headerOnline: { backgroundColor: colors.brand },
  hello: { ...type.title, color: '#fff' },
  headerHint: { ...type.small, color: 'rgba(255,255,255,0.75)', marginTop: 2 },

  switch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  switchOn: { backgroundColor: 'rgba(255,255,255,0.2)' },
  switchText: { ...type.smallStrong, color: '#fff' },
  switchTextOn: { color: '#fff' },
  track: {
    width: 42,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.3)',
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: '#8bd18f' },
  thumb: { width: 18, height: 18, borderRadius: radius.pill, backgroundColor: '#fff' },
  thumbOn: { alignSelf: 'flex-end' },

  content: { padding: space.lg, paddingBottom: space.xxxl },

  statsRow: { flexDirection: 'row', gap: space.md, marginBottom: space.lg },
  stat: {
    flex: 1,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  statValue: { ...type.title, color: colors.ink },
  statLabel: { ...type.caption, color: colors.muted, marginTop: 2 },

  sectionTitle: { ...type.overline, color: colors.muted, marginBottom: space.sm },

  notice: {
    alignItems: 'center',
    gap: space.sm,
    padding: space.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  noticeIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
    marginBottom: space.xs,
  },
  noticeTitle: { ...type.heading, color: colors.ink },
  noticeBody: { ...type.small, color: colors.muted, textAlign: 'center', lineHeight: 19 },

  activeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.brand,
    ...shadow.raised,
  },
  activeIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  activeTitle: { ...type.bodyStrong, color: '#fff' },
  activeHint: { ...type.caption, color: '#cfe8d6', marginTop: 2 },
  activeAction: { ...type.smallStrong, color: '#fff' },

  offer: {
    marginBottom: space.md,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.brand,
    ...shadow.raised,
  },
  offerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  offerEarning: { ...type.display, color: colors.brand },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.warningSoft,
  },
  timerText: { ...type.smallStrong, color: colors.warning },

  leg: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  legIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  legTitle: { ...type.bodyStrong, color: colors.ink },
  legDetail: { ...type.caption, color: colors.muted, marginTop: 1 },
  legLine: { width: 2, height: 14, backgroundColor: colors.line, marginLeft: 14, marginVertical: 3 },

  offerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  offerMetaText: { ...type.caption, color: colors.body, flex: 1 },
  cashPill: {
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.warningSoft,
  },
  cashPillText: { ...type.caption, fontWeight: '700', color: colors.warning },
  prepaid: { ...type.caption, fontWeight: '700', color: colors.brandInk },

  offerActions: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  skipButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  skipText: { ...type.bodyStrong, color: colors.body },
  acceptButton: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  acceptText: { ...type.bodyStrong, color: '#fff' },

  error: {
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
