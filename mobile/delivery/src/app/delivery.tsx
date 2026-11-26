import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { ScreenHeader } from '@/components/ScreenHeader'
import { SwipeButton } from '@/components/SwipeButton'
import { ApiError } from '@/lib/apiClient'
import {
  advance,
  call,
  fetchActive,
  formatKm,
  formatRupees,
  navigateTo,
  thankForTip,
  NEXT_STEP,
  type Delivery,
  type TargetReached,
  type Place,
} from '@/lib/delivery'
import { useLocationSharing } from '@/lib/LocationSharing'
import { colors, radius, shadow, space, type } from '@/theme'

// While waiting at the restaurant, check whether the kitchen has marked the
// food ready, so the Picked up swipe unlocks without a manual refresh.
const WAIT_POLL_MS = 10000

// Pickup and delivery are two separate screens, as on Swiggy and Zomato, so a
// rider always knows which half of the trip they are on, and each step is a
// deliberate swipe. Testers tapping one button two or three times had marked
// orders delivered that were still in the bag.
const PICKUP = new Set<Delivery['status']>(['accepted', 'reached_restaurant'])

type Blocked = { title: string; body: string }

export default function DeliveryScreen() {
  const router = useRouter()
  // Room for the phone's own navigation bar under the bottom buttons.
  const insets = useSafeAreaInsets()

  const [delivery, setDelivery] = useState<Delivery | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState<Blocked | null>(null)
  const [code, setCode] = useState('')
  const [finished, setFinished] = useState<{
    earningPaise: number
    orderNumber: string
    targetsReached: TargetReached[]
  } | null>(null)

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

  const waitingForFood = !!delivery && !delivery.foodReady && PICKUP.has(delivery.status)

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
      const result = await advance(delivery.id, next.action, { cashCollected, code })

      if (!result.delivered) {
        setDelivery(result.delivery)
      } else {
        // The finished trip's pay includes any target bonus it earned.
        setFinished({
          earningPaise: result.delivery?.earningPaise ?? delivery.earningPaise,
          orderNumber: delivery.orderNumber,
          targetsReached: result.targetsReached,
        })
        setDelivery(null)
      }
    } catch (stepError: any) {
      const codeOf = stepError instanceof ApiError ? stepError.code : ''

      if (codeOf === 'too_far') {
        setBlocked({
          title:
            next.action === 'reached'
              ? 'You seem to be far away from the pickup location'
              : "You seem to be far away from the customer's location",
          body: stepError.message.split('. ').slice(1).join('. ') || 'Try moving closer to update the status.',
        })
      } else if (codeOf === 'location_needed') {
        setBlocked({ title: 'Location is off', body: stepError.message })
      } else if (codeOf === 'mock_location') {
        setBlocked({ title: 'Fake GPS detected', body: stepError.message })
      } else {
        setError(stepError.message || 'Could not update the delivery')
      }

      if (codeOf === 'code_wrong' || codeOf === 'code_locked') setCode('')

      // The order may have moved on (the restaurant marked it ready, say).
      await load()
    } finally {
      setBusy(false)
    }
  }

  function onSwipe() {
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
          {finished.targetsReached.map(target => (
            <View key={target.name} style={styles.bonus}>
              <Feather name="award" size={18} color={colors.brandInk} />
              <Text style={styles.bonusText}>
                Target reached: {formatRupees(target.bonusPaise)} bonus included
              </Text>
            </View>
          ))}
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

  const pickup = PICKUP.has(delivery.status)
  const next = delivery.status === 'delivered' ? null : NEXT_STEP[delivery.status]
  const foodNotReady = next?.action === 'picked-up' && !delivery.foodReady
  const needsCode = next?.action === 'delivered' && delivery.codeRequired && code.length !== 4
  const swipeLocked = foodNotReady || needsCode

  return (
    <SafeAreaView style={styles.screen} edges={next ? ['top'] : ['top', 'bottom']}>
      <ScreenHeader title={pickup ? 'Pick up the order' : 'Deliver the order'} subtitle={`Order #${delivery.orderNumber}${delivery.isTest ? ' · Test order' : ''}`} />

      <View style={[styles.stage, pickup ? styles.stagePickup : styles.stageDrop]}>
        <Feather name={pickup ? 'shopping-bag' : 'home'} size={16} color="#fff" />
        <Text style={styles.stageText}>
          {pickup ? 'Step 1 of 2 · Pick up' : 'Step 2 of 2 · Deliver'}
          {'  ·  '}
          {delivery.status === 'accepted'
            ? 'Go to the restaurant'
            : delivery.status === 'reached_restaurant'
              ? 'At the restaurant'
              : delivery.status === 'picked_up'
                ? 'Go to the customer'
                : 'At the customer'}
        </Text>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
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

          {pickup ? (
            <>
              <PlaceCard
                heading="Pick up from"
                place={delivery.restaurant}
                note={delivery.foodReady ? 'Food is ready. Collect it from the counter.' : 'Still being prepared. Wait at the restaurant.'}
                distance={delivery.status === 'accepted' ? delivery.pickupKm : null}
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

              <View style={styles.nextUp}>
                <Feather name="info" size={14} color={colors.muted} />
                <Text style={styles.nextUpText}>
                  Next: deliver to {delivery.customer.name}, {formatKm(delivery.dropKm)} away.{' '}
                  {delivery.collectPaise > 0
                    ? `Collect ${formatRupees(delivery.collectPaise)} in cash.`
                    : 'Prepaid: no cash to collect.'}
                </Text>
              </View>
            </>
          ) : (
            <>
              {delivery.collectPaise > 0 ? (
                <View style={styles.cash}>
                  <Feather name="dollar-sign" size={18} color={colors.warning} />
                  <Text style={styles.cashText}>
                    Cash order: collect <Text style={styles.cashAmount}>{formatRupees(delivery.collectPaise)}</Text>{' '}
                    from the customer
                  </Text>
                </View>
              ) : (
                <View style={styles.paid}>
                  <Feather name="check-circle" size={16} color={colors.brandInk} />
                  <Text style={styles.paidText}>Prepaid: do not collect any money</Text>
                </View>
              )}

              <PlaceCard
                heading="Deliver to"
                place={delivery.customer}
                note={[
                  delivery.customer.landmark ? `Landmark: ${delivery.customer.landmark}` : null,
                  delivery.customer.instructions ? `Note: ${delivery.customer.instructions}` : null,
                ]
                  .filter(Boolean)
                  .join('\n') || null}
                distance={null}
              />

              {delivery.status === 'arrived' && delivery.codeRequired ? (
                <View style={styles.card}>
                  <Text style={styles.cardHeading}>Customer's delivery code</Text>
                  <Text style={styles.codeHint}>
                    Ask the customer for the 4-digit code in their Foodos app, then swipe to finish.
                  </Text>
                  <TextInput
                    style={styles.codeInput}
                    value={code}
                    onChangeText={text => setCode(text.replace(/\D/g, '').slice(0, 4))}
                    keyboardType="number-pad"
                    maxLength={4}
                    placeholder="••••"
                    placeholderTextColor={colors.faint}
                    accessibilityLabel="Delivery code"
                  />
                </View>
              ) : null}
            </>
          )}

          {delivery.tipPaise > 0 ? <ActiveTip key={delivery.id} delivery={delivery} /> : null}

          <View style={styles.earningRow}>
            <Text style={styles.earningLabel}>You earn on this order</Text>
            <Text style={styles.earningValue}>{formatRupees(delivery.earningPaise)}</Text>
          </View>
          <Text style={styles.earningHint}>
            {formatKm(delivery.distanceKm)} trip
            {delivery.tipPaise > 0 ? ` · includes ${formatRupees(delivery.tipPaise)} tip` : ''}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {next ? (
        <View style={[styles.footer, { paddingBottom: space.lg + insets.bottom }]}>
          {foodNotReady ? (
            <Text style={styles.blockedHint}>
              The restaurant has not marked the food ready yet. This unlocks automatically when they do.
            </Text>
          ) : needsCode ? (
            <Text style={styles.blockedHint}>Enter the customer's 4-digit code to finish.</Text>
          ) : next.action === 'reached' || next.action === 'arrived' ? (
            <Text style={styles.footerHint}>
              {delivery.isTest
                ? 'Test order: works from anywhere.'
                : `Works within ${delivery.geofenceMetres} m of the ${next.action === 'reached' ? 'restaurant' : 'customer'}.`}
            </Text>
          ) : null}
          <SwipeButton label={next.label} onComplete={onSwipe} disabled={swipeLocked} busy={busy} />
        </View>
      ) : null}

      <Modal visible={!!blocked} transparent animationType="slide" onRequestClose={() => setBlocked(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: space.xl + insets.bottom }]}>
            <View style={styles.sheetIcon}>
              <Feather name="map-pin" size={30} color={colors.brand} />
            </View>
            <Text style={styles.sheetTitle}>{blocked?.title}</Text>
            <Text style={styles.sheetBody}>{blocked?.body}</Text>
            <Pressable style={styles.primary} onPress={() => setBlocked(null)}>
              <Text style={styles.primaryText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function PlaceCard({
  heading,
  place,
  note,
  distance,
}: {
  heading: string
  place: Place
  note: string | null
  distance: number | null
}) {
  return (
    <View style={[styles.card, styles.cardActive]}>
      <Text style={styles.cardHeading}>{heading}</Text>
      <Text style={styles.placeName}>{place.name}</Text>
      <Text style={styles.placeAddress}>{place.address}</Text>
      {distance != null ? <Text style={styles.placeDistance}>{formatKm(distance)} from you</Text> : null}
      {note ? <Text style={styles.placeNote}>{note}</Text> : null}

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
    </View>
  )
}

// "The customer tipped": shown while the order is on the way, with a thank-you.
function ActiveTip({ delivery }: { delivery: Delivery }) {
  const [state, setState] = useState<'ask' | 'sending' | 'sent' | 'failed'>(delivery.tipThanked ? 'sent' : 'ask')

  async function thank() {
    setState('sending')

    try {
      await thankForTip(delivery.id)
      setState('sent')
    } catch {
      setState('failed')
    }
  }

  return (
    <View style={styles.tipBanner}>
      <View style={styles.tipBannerText}>
        <Text style={styles.tipBannerTitle}>Customer tipped {formatRupees(delivery.tipPaise)}</Text>
        <Text style={styles.tipBannerHint}>
          {state === 'failed' ? 'Could not send your thanks. Try again.' : 'Added to your earnings after delivery.'}
        </Text>
      </View>
      {state === 'sent' ? (
        <Text style={styles.tipBannerTitle}>Thanks sent</Text>
      ) : (
        <Pressable style={styles.tipBannerButton} onPress={thank} disabled={state === 'sending'} accessibilityRole="button">
          <Text style={styles.tipBannerButtonText}>{state === 'sending' ? 'Sending…' : 'Say thanks'}</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  tipBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
  },
  tipBannerText: { flex: 1 },
  tipBannerTitle: { ...type.smallStrong, color: colors.brandInk },
  tipBannerHint: { ...type.caption, color: colors.brandInk },
  tipBannerButton: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  tipBannerButtonText: { ...type.smallStrong, color: colors.surface },
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
  dim: { opacity: 0.5 },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxxl },

  stage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  stagePickup: { backgroundColor: '#8a5a00' },
  stageDrop: { backgroundColor: colors.brand },
  stageText: { ...type.smallStrong, color: '#fff', flex: 1 },

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
  placeDistance: { ...type.caption, color: colors.muted, marginTop: space.xs },
  placeNote: { ...type.caption, color: colors.warning, marginTop: space.sm, lineHeight: 17 },
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

  nextUp: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', paddingHorizontal: space.xs },
  nextUpText: { ...type.caption, color: colors.muted, flex: 1, lineHeight: 17 },

  codeHint: { ...type.small, color: colors.body, marginBottom: space.md },
  codeInput: {
    height: 60,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.brand,
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 12,
    color: colors.ink,
  },

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
  footerHint: { ...type.caption, color: colors.muted, textAlign: 'center' },
  primary: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  primaryText: { ...type.bodyStrong, fontSize: 16, color: '#fff' },

  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    alignItems: 'center',
    gap: space.md,
    padding: space.xl,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  sheetIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  sheetTitle: { ...type.title, color: colors.ink, textAlign: 'center' },
  sheetBody: { ...type.body, color: colors.body, textAlign: 'center', marginBottom: space.sm },

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
  bonus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  bonusText: { ...type.smallStrong, color: colors.brandInk },
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
