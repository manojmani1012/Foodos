import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { useCart } from '@/lib/CartContext'
import { useLocation } from '@/lib/LocationContext'
import { formatAddress, newIdempotencyKey, placeOrder, quoteCart, type Quote } from '@/lib/orders'
import { colors, radius, shadow, space, type } from '@/theme'

import { Header } from './cart'

// UPI and card go through Razorpay; cash skips it entirely. The wallet stays
// disabled until top-ups exist, since a balance nobody can add to is useless.
const METHODS = [
  {
    id: 'upi',
    label: 'UPI',
    hint: 'Google Pay, PhonePe, Paytm and others',
    icon: 'smartphone',
    enabled: true,
  },
  {
    id: 'card',
    label: 'Credit / debit card',
    hint: 'Visa, Mastercard, RuPay',
    icon: 'credit-card',
    enabled: true,
  },
  {
    id: 'cod',
    label: 'Cash on delivery',
    hint: 'Pay the rider when it arrives',
    icon: 'dollar-sign',
    enabled: true,
  },
  { id: 'wallet', label: 'Foodos wallet', hint: 'Coming soon', icon: 'briefcase', enabled: false },
] as const

export default function CheckoutScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const cart = useCart()
  const location = useLocation()
  const { coupon } = useLocalSearchParams<{ coupon?: string }>()

  const [method, setMethod] = useState<'upi' | 'card' | 'cod'>('upi')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState('')

  // Held for the whole attempt, so retrying after a failure cannot place a
  // second order.
  const [idempotencyKey] = useState(newIdempotencyKey)

  const couponCode = coupon || null

  const price = useCallback(async () => {
    if (cart.lines.length === 0) return

    try {
      setQuote(await quoteCart(cart.lines, couponCode))
    } catch (priceError: any) {
      setError(priceError.message || 'Could not price your order')
    }
  }, [cart.lines, couponCode])

  useEffect(() => {
    price()
  }, [price])

  if (cart.lines.length === 0) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.replace('/')} title="Checkout" />
        <View style={styles.empty}>
          <Feather name="shopping-bag" size={44} color={colors.faint} />
          <Text style={styles.emptyText}>Your cart is empty.</Text>
        </View>
      </SafeAreaView>
    )
  }

  async function confirm() {
    if (!location.selected) {
      router.push('/location')
      return
    }

    setPlacing(true)
    setError('')

    try {
      const order = await placeOrder({
        lines: cart.lines,
        couponCode,
        addressId: location.selected.id,
        idempotencyKey,
        paymentMethod: method,
      })

      // The order lives on the server now, so the local basket is done.
      cart.clear()

      if (method === 'cod') {
        router.replace({ pathname: '/order/[id]', params: { id: order.id } })
        return
      }

      // A prepaid order is saved but still pending: the restaurant only sees it
      // once the money lands.
      router.replace({
        pathname: '/payment',
        params: { orderId: order.id, orderNumber: order.orderNumber },
      })
    } catch (placeError: any) {
      setError(placeError.message || 'Could not place your order')
      setPlacing(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} title="Checkout" subtitle={cart.restaurant?.name} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Deliver to</Text>
              <Pressable onPress={() => router.push('/location')} hitSlop={8}>
                <Text style={styles.link}>{location.selected ? 'Change' : 'Add'}</Text>
              </Pressable>
            </View>

            {location.selected ? (
              <View style={styles.addressRow}>
                <Feather name="map-pin" size={18} color={colors.brand} />
                <View style={styles.flex}>
                  <Text style={styles.addressLabel}>{location.selected.label}</Text>
                  <Text style={styles.addressText}>{formatAddress(location.selected)}</Text>
                </View>
              </View>
            ) : (
              <Pressable style={styles.addAddress} onPress={() => router.push('/location')}>
                <Feather name="plus" size={16} color={colors.brand} />
                <Text style={styles.addAddressText}>Add a delivery address</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Payment</Text>

            {METHODS.map(option => {
              const selected = option.id === method

              return (
                <Pressable
                  key={option.id}
                  style={[
                    styles.method,
                    !option.enabled && styles.methodDisabled,
                    selected && styles.methodSelected,
                  ]}
                  disabled={!option.enabled}
                  onPress={() => setMethod(option.id as 'upi' | 'card' | 'cod')}
                >
                  <View style={styles.methodIcon}>
                    <Feather
                      name={option.icon as any}
                      size={17}
                      color={option.enabled ? colors.brand : colors.faint}
                    />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.methodLabel}>{option.label}</Text>
                    <Text style={styles.methodHint}>{option.hint}</Text>
                  </View>
                  <Feather
                    name={selected ? 'check-circle' : 'circle'}
                    size={19}
                    color={selected ? colors.brand : colors.lineStrong}
                  />
                </Pressable>
              )
            })}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Order summary</Text>

            {cart.lines.map(line => (
              <View key={line.key} style={styles.summaryRow}>
                <Text style={styles.summaryQty}>{line.quantity}×</Text>
                <Text style={styles.summaryName} numberOfLines={1}>
                  {line.item.name}
                </Text>
                <Text style={styles.summaryValue}>
                  ₹{((line.item.price + line.addOns.reduce((s, a) => s + a.price, 0)) * line.quantity).toFixed(0)}
                </Text>
              </View>
            ))}

            <View style={styles.divider} />

            <BillRow label="Item total" value={quote?.subtotal} />
            <BillRow label="Delivery fee" value={quote?.deliveryFee} />
            <BillRow label="Packaging fee" value={quote?.packagingFee} />
            <BillRow label="GST" value={quote?.tax} />
            {quote && quote.discount > 0 && (
              <BillRow label="Coupon discount" value={-quote.discount} tone="good" />
            )}

            <View style={styles.billTotal}>
              <Text style={styles.billTotalLabel}>To pay</Text>
              <Text style={styles.billTotalValue}>
                {quote ? `₹${quote.total.toFixed(0)}` : '—'}
              </Text>
            </View>
          </View>

          {error ? (
            <View style={styles.error}>
              <Feather name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.bar, { paddingBottom: space.md + insets.bottom }]}>
        <View style={styles.flex}>
          <Text style={styles.barLabel}>
            {method === 'cod' ? 'Pay on delivery' : 'Pay now'}
          </Text>
          <Text style={styles.barValue}>{quote ? `₹${quote.total.toFixed(0)}` : '—'}</Text>
        </View>
        <Pressable
          style={[styles.barButton, (placing || !quote) && styles.disabled]}
          disabled={placing || !quote}
          onPress={confirm}
        >
          {placing ? (
            <ActivityIndicator color={colors.surface} size="small" />
          ) : (
            <Text style={styles.barButtonText}>
              {method === 'cod' ? 'Place order' : 'Pay & place order'}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

function BillRow({ label, value, tone }: { label: string; value?: number; tone?: 'good' }) {
  return (
    <View style={styles.billRow}>
      <Text style={styles.billLabel}>{label}</Text>
      <Text style={[styles.billValue, tone === 'good' && styles.billValueGood]}>
        {value === undefined ? '—' : `${value < 0 ? '−' : ''}₹${Math.abs(value).toFixed(0)}`}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },

  card: {
    marginHorizontal: space.lg,
    marginTop: space.lg,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { ...type.overline, color: colors.muted, marginBottom: space.md },
  link: { ...type.smallStrong, color: colors.brand, marginBottom: space.md },

  addressRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  addressLabel: { ...type.bodyStrong, color: colors.ink },
  addressText: { ...type.small, color: colors.muted, marginTop: 2 },
  addAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.brand,
  },
  addAddressText: { ...type.smallStrong, color: colors.brand },

  method: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  methodDisabled: { opacity: 0.45 },
  methodSelected: {},
  methodIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodLabel: { ...type.bodyStrong, color: colors.ink },
  methodHint: { ...type.caption, color: colors.muted, marginTop: 1 },

  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  summaryQty: { ...type.smallStrong, color: colors.brand, minWidth: 26 },
  summaryName: { flex: 1, ...type.small, color: colors.body },
  summaryValue: { ...type.small, color: colors.ink, fontVariant: ['tabular-nums'] },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
    marginVertical: space.md,
  },

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

  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  errorText: { flex: 1, ...type.small, color: colors.danger },

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    ...shadow.bar,
  },
  barLabel: { ...type.caption, color: colors.muted },
  barValue: { ...type.title, color: colors.ink, fontVariant: ['tabular-nums'] },
  barButton: {
    minWidth: 150,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  barButtonText: { ...type.bodyStrong, color: colors.surface },
  disabled: { opacity: 0.5 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  emptyText: { ...type.body, color: colors.muted },
})
