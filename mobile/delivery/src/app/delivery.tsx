import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { ScreenHeader } from '@/components/ScreenHeader'
import {
  advance,
  call,
  fetchActive,
  formatKm,
  formatRupees,
  navigateTo,
  NEXT_STEP,
  type Delivery,
  type Place,
} from '@/lib/delivery'
import { useLocationSharing } from '@/lib/LocationSharing'
import { colors, radius, shadow, space, type } from '@/theme'

// While waiting at the restaurant, check whether the kitchen has marked the
// food ready, so the Picked up button unlocks without a manual refresh.
const WAIT_POLL_MS = 10000

const PROGRESS: { status: Delivery['status']; label: string }[] = [
  { status: 'accepted', label: 'Going to restaurant' },
  { status: 'reached_restaurant', label: 'At restaurant' },
  { status: 'picked_up', label: 'Going to customer' },
  { status: 'arrived', label: 'At customer' },
]

export default function DeliveryScreen() {
  const router = useRouter()
  // Room for the phone's own navigation bar under the bottom buttons.
  const insets = useSafeAreaInsets()

  const [delivery, setDelivery] = useState<Delivery | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [finished, setFinished] = useState<{ earningPaise: number; orderNumber: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setDelivery(await fetchActive())
      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load this delivery')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Keep the customer's view of the rider current for the whole trip.
  useLocationSharing(!!delivery)

  const waitingForFood =
    !!delivery && !delivery.foodReady && (delivery.status === 'accepted' || delivery.status === 'reached_restaurant')

  useEffect(() => {
    if (!waitingForFood) return

    const timer = setInterval(load, WAIT_POLL_MS)

    return () => clearInterval(timer)
  }, [waitingForFood, load])

  async function step(cashCollected = false) {
    if (!delivery || busy || delivery.status === 'delivered') return

    const next = NEXT_STEP[delivery.status]

    setBusy(true)
    setError('')

    try {
      const updated = await advance(delivery.id, next.action, cashCollected)

      if (updated) {
        setDelivery(updated)
      } else {
        setFinished({ earningPaise: delivery.earningPaise, orderNumber: delivery.orderNumber })
        setDelivery(null)
      }
    } catch (stepError: any) {
      setError(stepError.message || 'Could not update the delivery')
      // The order may have moved on (the restaurant marked it ready, say).
      await load()
    } finally {
      setBusy(false)
    }
  }

  function onPrimary() {
    if (!delivery || delivery.status === 'delivered') return

    const next = NEXT_STEP[delivery.status]

    if (next.action === 'delivered' && delivery.collectPaise > 0) {
      Alert.alert(
        `Collect ${formatRupees(delivery.collectPaise)} in cash`,
        'Only confirm once you have the full amount from the customer.',
        [
          { text: 'Not yet', style: 'cancel' },
          { text: 'Cash collected', onPress: () => step(true) },
        ],
      )
      return
    }

    step()
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title="Delivery" />
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    )
  }

  if (finished) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.centre}>
          <View style={styles.doneIcon}>
            <Feather name="check" size={36} color="#fff" />
          </View>
          <Text style={styles.doneTitle}>Delivered!</Text>
          <Text style={styles.doneHint}>Order #{finished.orderNumber}</Text>
          <Text style={styles.doneEarning}>+{formatRupees(finished.earningPaise)}</Text>
          <Pressable style={styles.primary} onPress={() => router.back()}>
            <Text style={styles.primaryText}>Back to orders</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  if (!delivery) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title="Delivery" />
        <View style={styles.centre}>
          <Text style={styles.emptyText}>{error || 'You have no delivery in progress.'}</Text>
        </View>
      </SafeAreaView>
    )
  }

  const atRestaurant = delivery.status === 'accepted' || delivery.status === 'reached_restaurant'
  const next = delivery.status === 'delivered' ? null : NEXT_STEP[delivery.status]
  const blocked = next?.action === 'picked-up' && !delivery.foodReady
  const stepIndex = PROGRESS.findIndex(entry => entry.status === delivery.status)

  return (
    <SafeAreaView style={styles.screen} edges={next ? ['top'] : ['top', 'bottom']}>
      <ScreenHeader title={`Order #${delivery.orderNumber}`} subtitle={PROGRESS[stepIndex]?.label} />

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

        <View style={styles.progress}>
          {PROGRESS.map((entry, index) => (
            <View key={entry.status} style={[styles.progressBar, index <= stepIndex && styles.progressBarDone]} />
          ))}
        </View>

        {delivery.collectPaise > 0 ? (
          <View style={styles.cash}>
            <Feather name="dollar-sign" size={18} color={colors.warning} />
            <Text style={styles.cashText}>
              Cash order: collect <Text style={styles.cashAmount}>{formatRupees(delivery.collectPaise)}</Text> from the
              customer
            </Text>
          </View>
        ) : (
          <View style={styles.paid}>
            <Feather name="check-circle" size={16} color={colors.brandInk} />
            <Text style={styles.paidText}>Prepaid: do not collect any money</Text>
          </View>
        )}

        <PlaceCard
          heading="Pick up from"
          place={delivery.restaurant}
          active={atRestaurant}
          note={
            atRestaurant
              ? delivery.foodReady
                ? 'Food is ready. Collect it from the counter.'
                : 'Still being prepared. Wait at the restaurant.'
              : 'Collected'
          }
        />

        <PlaceCard
          heading="Deliver to"
          place={delivery.customer}
          active={!atRestaurant}
          note={delivery.customer.instructions ? `Note: ${delivery.customer.instructions}` : null}
        />

        <View style={styles.card}>
          <Text style={styles.cardHeading}>Items to collect</Text>
          {delivery.items.map((item, index) => (
            <View key={`${item.name}-${index}`} style={styles.itemRow}>
              <Text style={styles.itemQty}>{item.quantity} ×</Text>
              <Text style={styles.itemName}>{item.name}</Text>
            </View>
          ))}
          <Text style={styles.itemHint}>Check the bag has everything before you leave the restaurant.</Text>
        </View>

        <View style={styles.earningRow}>
          <Text style={styles.earningLabel}>You earn on this order</Text>
          <Text style={styles.earningValue}>{formatRupees(delivery.earningPaise)}</Text>
        </View>
        <Text style={styles.earningHint}>
          {formatKm(delivery.distanceKm)} trip
          {delivery.tipPaise > 0 ? ` · includes ${formatRupees(delivery.tipPaise)} tip` : ''}
        </Text>
      </ScrollView>

      {next ? (
        <View style={[styles.footer, { paddingBottom: space.lg + insets.bottom }]}>
          {blocked ? (
            <Text style={styles.blockedHint}>
              The restaurant has not marked the food ready yet. This unlocks automatically when they do.
            </Text>
          ) : null}
          <Pressable
            style={[styles.primary, (busy || blocked) && styles.dim]}
            onPress={onPrimary}
            disabled={busy || blocked}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{next.label}</Text>}
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  )
}

function PlaceCard({
  heading,
  place,
  active,
  note,
}: {
  heading: string
  place: Place
  active: boolean
  note: string | null
}) {
  return (
    <View style={[styles.card, active && styles.cardActive]}>
      <Text style={styles.cardHeading}>{heading}</Text>
      <Text style={styles.placeName}>{place.name}</Text>
      <Text style={styles.placeAddress}>{place.address}</Text>
      {note ? <Text style={styles.placeNote}>{note}</Text> : null}

      {active ? (
        <View style={styles.placeActions}>
          <Pressable
            style={[styles.placeButton, !place.phone && styles.dim]}
            onPress={() => call(place.phone)}
            disabled={!place.phone}
          >
            <Feather name="phone" size={15} color={colors.brand} />
            <Text style={styles.placeButtonText}>Call</Text>
          </Pressable>
          <Pressable style={[styles.placeButton, styles.placeButtonMain]} onPress={() => navigateTo(place)}>
            <Feather name="navigation" size={15} color="#fff" />
            <Text style={[styles.placeButtonText, styles.placeButtonTextMain]}>Navigate</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
  dim: { opacity: 0.5 },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxxl },

  progress: { flexDirection: 'row', gap: 6 },
  progressBar: { flex: 1, height: 5, borderRadius: radius.pill, backgroundColor: colors.line },
  progressBarDone: { backgroundColor: colors.brand },

  cash: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  cashText: { ...type.small, color: colors.warning, flex: 1 },
  cashAmount: { fontWeight: '800' },
  paid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  paidText: { ...type.smallStrong, color: colors.brandInk },

  card: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  cardActive: { borderWidth: 1.5, borderColor: colors.brand },
  cardHeading: { ...type.overline, color: colors.muted, marginBottom: space.xs },
  placeName: { ...type.heading, color: colors.ink },
  placeAddress: { ...type.small, color: colors.body, marginTop: 2, lineHeight: 19 },
  placeNote: { ...type.caption, color: colors.warning, marginTop: space.sm },
  placeActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  placeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs + 2,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.brand,
  },
  placeButtonMain: { backgroundColor: colors.brand },
  placeButtonText: { ...type.smallStrong, color: colors.brand },
  placeButtonTextMain: { color: '#fff' },

  itemRow: { flexDirection: 'row', gap: space.sm, paddingVertical: 3 },
  itemQty: { ...type.bodyStrong, color: colors.brand, minWidth: 34 },
  itemName: { ...type.body, color: colors.ink, flex: 1 },
  itemHint: { ...type.caption, color: colors.muted, marginTop: space.sm },

  earningRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.xs },
  earningLabel: { ...type.body, color: colors.body },
  earningValue: { ...type.title, color: colors.brand },
  earningHint: { ...type.caption, color: colors.muted, paddingHorizontal: space.xs },

  footer: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    gap: space.sm,
    ...shadow.bar,
  },
  blockedHint: { ...type.caption, color: colors.warning, textAlign: 'center' },
  primary: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  primaryText: { ...type.bodyStrong, fontSize: 16, color: '#fff' },

  doneIcon: {
    width: 76,
    height: 76,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    marginBottom: space.md,
  },
  doneTitle: { ...type.display, color: colors.ink },
  doneHint: { ...type.small, color: colors.muted },
  doneEarning: { ...type.display, color: colors.brand, marginVertical: space.lg },

  emptyText: { ...type.body, color: colors.muted, textAlign: 'center' },
  error: {
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
