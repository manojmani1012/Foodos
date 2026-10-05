import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  acceptOrder,
  fetchOrder,
  formatRupees,
  formatTime,
  markOrderReady,
  rejectOrder,
  type OrderDetail,
} from '@/lib/restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting payment',
  confirmed: 'New order',
  preparing: 'Preparing',
  ready: 'Ready for pickup',
  picked_up: 'With the rider',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()

  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    if (!id) return

    try {
      setOrder(await fetchOrder(String(id)))
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

  // Every action goes through here so a failure never leaves the screen
  // showing a state the server did not agree to.
  async function run(action: () => Promise<OrderDetail>, failure: string) {
    if (busy) return

    setBusy(true)
    setError('')

    try {
      setOrder(await action())
    } catch (actionError: any) {
      setError(actionError.message || failure)
      // The order may have moved on underneath us, so re-read the truth.
      await load()
    } finally {
      setBusy(false)
    }
  }

  function confirmReject() {
    run(() => rejectOrder(String(id), reason.trim()), 'Could not reject this order').then(() => {
      setRejecting(false)
      setReason('')
    })
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

  if (!order) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} title="Order" />
        <View style={styles.centre}>
          <Text style={styles.error}>{error || 'This order could not be found'}</Text>
        </View>
      </SafeAreaView>
    )
  }

  const isNew = order.status === 'confirmed'
  const isPreparing = order.status === 'preparing'

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} title={`#${order.orderNumber}`} />

      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.statusCard}>
          <Text style={styles.statusText}>{STATUS_LABEL[order.status] ?? order.status}</Text>
          <Text style={styles.statusMeta}>Placed at {formatTime(order.placedAt)}</Text>
          {order.cancellationReason ? (
            <Text style={styles.cancelReason}>Reason: {order.cancellationReason}</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Customer</Text>
          <Text style={styles.customerName}>{order.customer.name || 'Customer'}</Text>
          {order.customer.phone ? (
            <Text style={styles.customerPhone}>{order.customer.phone}</Text>
          ) : null}
        </View>

        {order.specialInstructions ? (
          <View style={styles.noteCard}>
            <Feather name="message-square" size={14} color={colors.warning} />
            <Text style={styles.noteText}>{order.specialInstructions}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Items</Text>

          {order.items.map(item => (
            <View key={item.id} style={styles.itemRow}>
              <View style={[styles.vegDot, { borderColor: item.isVeg ? colors.veg : colors.nonVeg }]}>
                <View
                  style={[
                    styles.vegDotInner,
                    { backgroundColor: item.isVeg ? colors.veg : colors.nonVeg },
                  ]}
                />
              </View>

              <View style={styles.flex}>
                <Text style={styles.itemName}>{item.name}</Text>
                {item.addons.length > 0 ? (
                  <Text style={styles.itemAddons}>
                    {item.addons.map(addon => addon.name).join(', ')}
                  </Text>
                ) : null}
              </View>

              <Text style={styles.itemQty}>× {item.quantity}</Text>
              <Text style={styles.itemPrice}>{formatRupees(item.lineTotalPaise)}</Text>
            </View>
          ))}

          <View style={styles.divider} />

          <Row label="Subtotal" value={formatRupees(order.subtotalPaise)} />
          <Row label="Packaging" value={formatRupees(order.packagingFeePaise)} />
          <Row label="Tax" value={formatRupees(order.taxPaise)} />
          {order.discountPaise > 0 ? (
            <Row label="Discount" value={`− ${formatRupees(order.discountPaise)}`} />
          ) : null}

          <View style={styles.divider} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Order total</Text>
            <Text style={styles.totalValue}>{formatRupees(order.totalPaise)}</Text>
          </View>

          <Text style={styles.payment}>
            {order.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online'} ·{' '}
            {order.paymentStatus}
          </Text>
        </View>

        {rejecting ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Why are you rejecting this?</Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Out of stock, kitchen closing, …"
              placeholderTextColor={colors.muted}
              value={reason}
              onChangeText={setReason}
              multiline
            />
            <Text style={styles.reasonHint}>
              The customer sees this, and is refunded automatically if they have paid.
            </Text>

            <View style={styles.actionRow}>
              <Pressable
                style={[styles.ghostButton, styles.flex]}
                onPress={() => setRejecting(false)}
              >
                <Text style={styles.ghostButtonText}>Keep order</Text>
              </Pressable>
              <Pressable
                style={[styles.dangerButton, styles.flex, busy && styles.disabled]}
                onPress={confirmReject}
                disabled={busy}
              >
                <Text style={styles.dangerButtonText}>Confirm reject</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {!rejecting && (isNew || isPreparing) ? (
        <View style={styles.footer}>
          {isNew ? (
            <View style={styles.actionRow}>
              <Pressable
                style={[styles.ghostButton, styles.flex]}
                onPress={() =>
                  Alert.alert('Reject this order?', 'The customer will be told and refunded.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Reject', style: 'destructive', onPress: () => setRejecting(true) },
                  ])
                }
              >
                <Text style={styles.ghostButtonText}>Reject</Text>
              </Pressable>

              <Pressable
                style={[styles.primaryButton, styles.flexTwo, busy && styles.disabled]}
                onPress={() => run(() => acceptOrder(String(id)), 'Could not accept this order')}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Accept and start cooking</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[styles.primaryButton, busy && styles.disabled]}
              onPress={() => run(() => markOrderReady(String(id)), 'Could not update this order')}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Mark ready for pickup</Text>
              )}
            </Pressable>
          )}
        </View>
      ) : null}
    </SafeAreaView>
  )
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.header}>
      <Pressable style={styles.back} onPress={onBack} hitSlop={8}>
        <Feather name="chevron-left" size={22} color={colors.ink} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  flexTwo: { flex: 2 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  back: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ground,
  },
  headerTitle: { ...type.heading, color: colors.ink },

  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxxl },

  statusCard: {
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
  },
  statusText: { ...type.heading, color: colors.brandInk },
  statusMeta: { ...type.caption, color: colors.body, marginTop: 2 },
  cancelReason: { ...type.small, color: colors.danger, marginTop: space.sm },

  card: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  cardTitle: { ...type.overline, color: colors.muted, marginBottom: space.sm },
  customerName: { ...type.bodyStrong, color: colors.ink },
  customerPhone: { ...type.small, color: colors.body, marginTop: 2 },

  noteCard: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  noteText: { ...type.small, color: colors.warning, flex: 1, lineHeight: 19 },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  vegDot: {
    width: 14,
    height: 14,
    borderWidth: 1.5,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vegDotInner: { width: 6, height: 6, borderRadius: radius.pill },
  itemName: { ...type.body, color: colors.ink },
  itemAddons: { ...type.caption, color: colors.muted, marginTop: 1 },
  itemQty: { ...type.small, color: colors.muted, minWidth: 30, textAlign: 'right' },
  itemPrice: { ...type.smallStrong, color: colors.ink, minWidth: 64, textAlign: 'right' },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
    marginVertical: space.md,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  rowLabel: { ...type.small, color: colors.body },
  rowValue: { ...type.small, color: colors.ink },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...type.bodyStrong, color: colors.ink },
  totalValue: { ...type.title, color: colors.brand },
  payment: { ...type.caption, color: colors.muted, marginTop: space.sm },

  reasonInput: {
    minHeight: 72,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.ground,
    ...type.body,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  reasonHint: { ...type.caption, color: colors.muted, marginTop: space.sm, lineHeight: 16 },

  footer: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    ...shadow.bar,
  },
  actionRow: { flexDirection: 'row', gap: space.md, marginTop: space.md },

  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  primaryButtonText: { ...type.bodyStrong, color: '#fff' },

  ghostButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  ghostButtonText: { ...type.bodyStrong, color: colors.body },

  dangerButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.danger,
  },
  dangerButtonText: { ...type.bodyStrong, color: '#fff' },

  disabled: { opacity: 0.6 },

  error: {
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
