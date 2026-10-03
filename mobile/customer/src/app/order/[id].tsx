import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { cancelOrder, fetchOrder, formatAddress, type Order } from '@/lib/orders'
import { fetchOrderReview, reviewOrder } from '@/lib/profile'
import { colors, radius, shadow, space, type } from '@/theme'

import { Header, VegMark } from '../cart'

// The stages an order moves through, in the order the app shows them. The API
// reports which have actually happened; anything below is still ahead.
const STEPS = [
  { key: 'confirmed', label: 'Order confirmed', hint: 'The restaurant has your order' },
  { key: 'preparing', label: 'Preparing your food', hint: 'The kitchen is on it' },
  { key: 'ready', label: 'Ready for pickup', hint: 'Waiting for a delivery partner' },
  { key: 'picked_up', label: 'Picked up', hint: 'On its way to you' },
  { key: 'on_the_way', label: 'Out for delivery', hint: 'Almost there' },
  { key: 'delivered', label: 'Delivered', hint: 'Enjoy your meal' },
]

// Until the delivery app pushes updates, the status only changes when someone
// else moves it, so a slow poll is enough. This becomes a WebSocket when
// realtime arrives.
const POLL_INTERVAL_MS = 15000

const CANCELLABLE = new Set(['pending', 'confirmed'])

function formatTime(iso?: string | null): string {
  if (!iso) return ''

  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState('')
  const [review, setReview] = useState<{ rating: number; comment: string | null } | null>(null)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    if (!id) return

    try {
      setOrder(await fetchOrder(id))
      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load this order')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // Only delivered orders can be rated, so the review is fetched once the
  // order reaches that state.
  useEffect(() => {
    if (order?.status !== 'delivered') return

    fetchOrderReview(order.id)
      .then(setReview)
      .catch(() => {
        // No review yet, or it could not be read; the form simply shows.
      })
  }, [order?.id, order?.status])

  const finished = order?.status === 'delivered' || order?.status === 'cancelled'

  useEffect(() => {
    if (!order || finished) return

    const timer = setInterval(load, POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [order, finished, load])

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={colors.brand} />
      </SafeAreaView>
    )
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.centered}>
        <Feather name="wifi-off" size={40} color={colors.faint} />
        <Text style={styles.emptyText}>{error || 'That order could not be found'}</Text>
        <Pressable style={styles.ghost} onPress={() => router.replace('/')}>
          <Text style={styles.ghostText}>Back to home</Text>
        </Pressable>
      </SafeAreaView>
    )
  }

  const reached = new Map(order.timeline.map(step => [step.status, step.at]))
  const currentIndex = STEPS.reduce((last, step, index) => (reached.has(step.key) ? index : last), -1)
  const cancelled = order.status === 'cancelled'

  async function cancel() {
    setCancelling(true)

    try {
      setOrder(await cancelOrder(order!.id, 'Changed my mind'))
    } catch (cancelError: any) {
      setError(cancelError.message || 'Could not cancel this order')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        onBack={() => router.replace('/')}
        title={`Order #${order.orderNumber}`}
        subtitle={order.restaurant.name}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {cancelled ? (
          <View style={styles.cancelledBanner}>
            <Feather name="x-circle" size={26} color={colors.danger} />
            <Text style={styles.cancelledTitle}>Order cancelled</Text>
            {order.cancellationReason ? (
              <Text style={styles.cancelledReason}>{order.cancellationReason}</Text>
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.statusCard}>
              <View style={styles.statusHead}>
                <View>
                  <Text style={styles.statusLabel}>
                    {STEPS[Math.max(currentIndex, 0)]?.label ?? 'Order placed'}
                  </Text>
                  {order.estimatedDeliveryAt && (
                    <Text style={styles.statusEta}>
                      Expected by {formatTime(order.estimatedDeliveryAt)}
                    </Text>
                  )}
                </View>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>
                    {order.paymentMethod === 'cod' ? 'COD' : order.paymentMethod.toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.card}>
              {STEPS.map((step, index) => {
                const done = index <= currentIndex
                const current = index === currentIndex

                return (
                  <View key={step.key} style={styles.step}>
                    <View style={styles.stepRail}>
                      <View style={[styles.stepDot, done && styles.stepDotDone]}>
                        {done && <Feather name="check" size={11} color={colors.surface} />}
                      </View>
                      {index < STEPS.length - 1 && (
                        <View style={[styles.stepLine, index < currentIndex && styles.stepLineDone]} />
                      )}
                    </View>

                    <View style={styles.stepBody}>
                      <Text style={[styles.stepLabel, done && styles.stepLabelDone]}>
                        {step.label}
                      </Text>
                      <Text style={styles.stepHint}>
                        {done ? formatTime(reached.get(step.key)) || step.hint : step.hint}
                      </Text>
                    </View>

                    {current && <View style={styles.stepPulse} />}
                  </View>
                )
              })}
            </View>
          </>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {order.items.reduce((sum, item) => sum + item.quantity, 0)} items
          </Text>

          {order.items.map(item => (
            <View key={item.id} style={styles.itemRow}>
              <VegMark isVeg={item.isVeg} />
              <View style={styles.flex}>
                <Text style={styles.itemName}>
                  {item.quantity}× {item.name}
                </Text>
                {item.addons.length > 0 && (
                  <Text style={styles.itemAddons}>{item.addons.map(a => a.name).join(', ')}</Text>
                )}
              </View>
              <Text style={styles.itemPrice}>₹{item.lineTotal.toFixed(0)}</Text>
            </View>
          ))}

          <View style={styles.divider} />

          <BillRow label="Item total" value={order.subtotal} />
          <BillRow label="Delivery fee" value={order.deliveryFee} />
          <BillRow label="Packaging fee" value={order.packagingFee} />
          <BillRow label="GST" value={order.tax} />
          {order.discount > 0 && <BillRow label="Discount" value={-order.discount} tone="good" />}

          <View style={styles.billTotal}>
            <Text style={styles.billTotalLabel}>
              {order.paymentMethod === 'cod' ? 'Pay on delivery' : 'Paid'}
            </Text>
            <Text style={styles.billTotalValue}>₹{order.total.toFixed(0)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Delivering to</Text>
          <View style={styles.addressRow}>
            <Feather name="map-pin" size={17} color={colors.brand} />
            <Text style={styles.addressText}>{formatAddress(order.address as any)}</Text>
          </View>
        </View>

        {order.status === 'delivered' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {review ? 'Your rating' : `How was ${order.restaurant.name}?`}
            </Text>

            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map(value => {
                const filled = value <= (review?.rating ?? rating)

                return (
                  <Pressable
                    key={value}
                    onPress={() => !review && setRating(value)}
                    disabled={!!review}
                    hitSlop={6}
                  >
                    <Feather
                      name="star"
                      size={30}
                      color={filled ? colors.star : colors.lineStrong}
                    />
                  </Pressable>
                )
              })}
            </View>

            {review ? (
              review.comment ? <Text style={styles.reviewComment}>&ldquo;{review.comment}&rdquo;</Text> : null
            ) : (
              <>
                <TextInput
                  style={styles.reviewInput}
                  placeholder="Tell them what you thought (optional)"
                  placeholderTextColor={colors.faint}
                  value={comment}
                  onChangeText={setComment}
                  multiline
                />
                <Pressable
                  style={[styles.rateButton, (rating === 0 || submitting) && styles.disabled]}
                  disabled={rating === 0 || submitting}
                  onPress={async () => {
                    setSubmitting(true)

                    try {
                      await reviewOrder(order.id, rating, comment)
                      setReview({ rating, comment: comment || null })
                    } catch (rateError: any) {
                      setError(rateError.message || 'Could not save your rating')
                    } finally {
                      setSubmitting(false)
                    }
                  }}
                >
                  {submitting ? (
                    <ActivityIndicator color={colors.surface} size="small" />
                  ) : (
                    <Text style={styles.rateButtonText}>Submit rating</Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {finished && (
          <Pressable
            style={styles.reorderButton}
            onPress={() =>
              router.push({
                pathname: '/restaurant/[id]',
                params: { id: order.restaurant.id },
              })
            }
          >
            <Feather name="repeat" size={17} color={colors.brand} />
            <Text style={styles.reorderText}>Order from {order.restaurant.name} again</Text>
          </Pressable>
        )}

        {CANCELLABLE.has(order.status) && (
          <Pressable style={styles.cancelButton} onPress={cancel} disabled={cancelling}>
            {cancelling ? (
              <ActivityIndicator color={colors.danger} size="small" />
            ) : (
              <Text style={styles.cancelButtonText}>Cancel order</Text>
            )}
          </Pressable>
        )}

        <Pressable style={styles.homeButton} onPress={() => router.replace('/')}>
          <Text style={styles.homeButtonText}>Back to home</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

function BillRow({ label, value, tone }: { label: string; value: number; tone?: 'good' }) {
  return (
    <View style={styles.billRow}>
      <Text style={styles.billLabel}>{label}</Text>
      <Text style={[styles.billValue, tone === 'good' && styles.billValueGood]}>
        {value < 0 ? '−' : ''}₹{Math.abs(value).toFixed(0)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ground,
    gap: space.md,
  },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxxl },

  statusCard: {
    padding: space.lg,
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    ...shadow.raised,
  },
  statusHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusLabel: { ...type.title, color: colors.surface },
  statusEta: { ...type.small, color: '#ffffffcc', marginTop: space.xs },
  statusBadge: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
    backgroundColor: '#ffffff26',
  },
  statusBadgeText: { ...type.caption, color: colors.surface, fontWeight: '700' },

  card: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  cardTitle: { ...type.overline, color: colors.muted, marginBottom: space.md },

  step: { flexDirection: 'row', gap: space.md },
  stepRail: { alignItems: 'center', width: 22 },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: colors.brand, borderColor: colors.brand },
  stepLine: { flex: 1, width: 2, backgroundColor: colors.line, minHeight: 26 },
  stepLineDone: { backgroundColor: colors.brand },
  stepBody: { flex: 1, paddingBottom: space.lg },
  stepLabel: { ...type.bodyStrong, color: colors.faint },
  stepLabelDone: { color: colors.ink },
  stepHint: { ...type.caption, color: colors.muted, marginTop: 2 },
  stepPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand,
    alignSelf: 'center',
  },

  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.sm },
  itemName: { ...type.small, color: colors.ink },
  itemAddons: { ...type.caption, color: colors.muted, marginTop: 1 },
  itemPrice: { ...type.small, color: colors.ink, fontVariant: ['tabular-nums'] },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.md },

  billRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.xs },
  billLabel: { ...type.small, color: colors.body },
  billValue: { ...type.small, color: colors.ink, fontVariant: ['tabular-nums'] },
  billValueGood: { color: colors.brand, fontWeight: '600' },
  billTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.sm,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  billTotalLabel: { ...type.bodyStrong, color: colors.ink },
  billTotalValue: { ...type.heading, color: colors.ink, fontVariant: ['tabular-nums'] },

  addressRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  addressText: { flex: 1, ...type.small, color: colors.body },

  cancelledBanner: {
    alignItems: 'center',
    gap: space.sm,
    padding: space.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.dangerSoft,
  },
  cancelledTitle: { ...type.heading, color: colors.danger },
  cancelledReason: { ...type.small, color: colors.danger, textAlign: 'center' },

  errorText: { ...type.small, color: colors.danger, textAlign: 'center' },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  cancelButtonText: { ...type.bodyStrong, color: colors.danger },
  homeButton: {
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  homeButtonText: { ...type.bodyStrong, color: colors.surface },

  emptyText: { ...type.body, color: colors.muted, textAlign: 'center', paddingHorizontal: space.xl },

  stars: { flexDirection: 'row', gap: space.sm, justifyContent: 'center', paddingVertical: space.sm },
  reviewComment: {
    ...type.small,
    color: colors.body,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: space.sm,
  },
  reviewInput: {
    marginTop: space.md,
    minHeight: 72,
    padding: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    ...type.small,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  rateButton: {
    marginTop: space.md,
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  rateButtonText: { ...type.bodyStrong, color: colors.surface },
  disabled: { opacity: 0.5 },
  reorderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.surface,
  },
  reorderText: { ...type.bodyStrong, color: colors.brand },
  ghost: {
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  ghostText: { ...type.smallStrong, color: colors.brand },
})
