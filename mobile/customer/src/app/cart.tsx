import { Feather } from '@expo/vector-icons'
import { Redirect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { useCart } from '@/lib/CartContext'
import { fetchOffers, formatMoney, type OfferCard } from '@/lib/catalogue'
import { useLocation } from '@/lib/LocationContext'
import { quoteCart, type Quote } from '@/lib/orders'
import { colors, radius, shadow, space, type } from '@/theme'

export default function CartScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const cart = useCart()
  const location = useLocation()
  const addressId = location.selected?.id ?? null

  const [coupon, setCoupon] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [pricing, setPricing] = useState(true)
  const [error, setError] = useState('')
  const [offers, setOffers] = useState<OfferCard[] | null>(null)
  const [browsingOffers, setBrowsingOffers] = useState(false)

  // Totals come from the server, so the figure shown is the figure charged.
  const price = useCallback(async () => {
    if (cart.lines.length === 0) {
      setQuote(null)
      setPricing(false)
      return
    }

    setPricing(true)
    setError('')

    try {
      setQuote(await quoteCart(cart.lines, appliedCoupon, addressId))
    } catch (priceError: any) {
      setError(priceError.message || 'Could not price your cart')
      setQuote(null)
    } finally {
      setPricing(false)
    }
  }, [cart.lines, appliedCoupon, addressId])

  useEffect(() => {
    price()
  }, [price])

  // The platform's coupons plus this restaurant's own, for "View all coupons".
  useEffect(() => {
    fetchOffers(cart.restaurant?.id)
      .then(setOffers)
      .catch(() => setOffers([]))
  }, [cart.restaurant?.id])

  function applyCode(code: string) {
    setCoupon(code)
    setAppliedCoupon(code)
    setBrowsingOffers(false)
  }

  if (cart.lines.length === 0) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} title="Your cart" />
        <View style={styles.empty}>
          <Feather name="shopping-bag" size={44} color={colors.faint} />
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptyText}>Add dishes from a restaurant to get started.</Text>
          <Pressable style={styles.primaryGhost} onPress={() => router.replace('/')}>
            <Text style={styles.primaryGhostText}>Browse restaurants</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  const couponState = quote?.coupon

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} title="Your cart" subtitle={cart.restaurant?.name} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          {cart.lines.map((line, index) => (
            <View key={line.key} style={[styles.line, index > 0 && styles.lineDivider]}>
              <VegMark isVeg={line.item.isVeg} />

              <View style={styles.lineBody}>
                <Text style={styles.lineName}>{line.item.name}</Text>
                {line.addOns.length > 0 && (
                  <Text style={styles.lineAddons}>
                    {line.addOns.map(a => a.label).join(', ')}
                  </Text>
                )}
                <Text style={styles.linePrice}>₹{line.item.price}</Text>
              </View>

              <View style={styles.lineRight}>
                <View style={styles.stepper}>
                  <Pressable
                    style={styles.stepperButton}
                    onPress={() => cart.decrement(line.key)}
                    hitSlop={6}
                  >
                    <Feather name="minus" size={14} color={colors.surface} />
                  </Pressable>
                  <Text style={styles.stepperCount}>{line.quantity}</Text>
                  <Pressable
                    style={styles.stepperButton}
                    onPress={() => cart.increment(line.key)}
                    hitSlop={6}
                  >
                    <Feather name="plus" size={14} color={colors.surface} />
                  </Pressable>
                </View>
                <Text style={styles.lineTotal}>
                  ₹{((line.item.price + line.addOns.reduce((s, a) => s + a.price, 0)) * line.quantity).toFixed(0)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Have a coupon?</Text>
          <View style={styles.couponRow}>
            <TextInput
              style={styles.couponInput}
              placeholder="Enter code"
              placeholderTextColor={colors.faint}
              autoCapitalize="characters"
              autoCorrect={false}
              value={coupon}
              onChangeText={setCoupon}
            />
            <Pressable
              style={[styles.couponButton, !coupon.trim() && styles.disabled]}
              disabled={!coupon.trim()}
              onPress={() => setAppliedCoupon(coupon.trim().toUpperCase())}
            >
              <Text style={styles.couponButtonText}>Apply</Text>
            </Pressable>
          </View>

          {couponState?.applied && (
            <View style={styles.couponApplied}>
              <Feather name="check-circle" size={15} color={colors.brand} />
              <Text style={styles.couponAppliedText}>
                {couponState.code} applied — you saved ₹{quote?.discount}
              </Text>
              <Pressable
                onPress={() => {
                  setAppliedCoupon(null)
                  setCoupon('')
                }}
              >
                <Text style={styles.couponRemove}>Remove</Text>
              </Pressable>
            </View>
          )}

          {couponState && !couponState.applied && couponState.reason && (
            <View style={styles.couponFailed}>
              <Feather name="alert-circle" size={15} color={colors.warning} />
              <Text style={styles.couponFailedText}>{couponState.reason}</Text>
            </View>
          )}

          {offers && offers.length > 0 && (
            <Pressable style={styles.viewOffers} onPress={() => setBrowsingOffers(true)}>
              <Feather name="tag" size={15} color={colors.brand} />
              <Text style={styles.viewOffersText}>View all coupons ({offers.length})</Text>
              <Feather name="chevron-right" size={16} color={colors.brand} />
            </Pressable>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>For the restaurant</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="Cooking instructions, e.g. less spicy"
            placeholderTextColor={colors.faint}
            value={cart.notes.cooking}
            onChangeText={cooking => cart.setNotes({ cooking })}
            maxLength={200}
            multiline
          />
          <Pressable
            style={styles.cutlery}
            onPress={() => cart.setNotes({ noCutlery: !cart.notes.noCutlery })}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: cart.notes.noCutlery }}
          >
            <Feather
              name={cart.notes.noCutlery ? 'check-square' : 'square'}
              size={19}
              color={cart.notes.noCutlery ? colors.brand : colors.muted}
            />
            <View style={styles.flex}>
              <Text style={styles.cutleryTitle}>Don't send cutlery</Text>
              <Text style={styles.cutleryHint}>Less plastic, if you have your own.</Text>
            </View>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Bill details</Text>

          {error ? (
            <View style={styles.billError}>
              <Text style={styles.billErrorText}>{error}</Text>
              <Pressable style={styles.primaryGhost} onPress={price}>
                <Text style={styles.primaryGhostText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={pricing ? styles.billUpdating : undefined}>
              <BillRow label="Item total" value={quote?.subtotal} />
              <BillRow label="Delivery fee" value={quote?.deliveryFee} />
              <BillRow label="Packaging fee" value={quote?.packagingFee} />
              <BillRow label="GST" value={quote?.tax} />
              {quote && quote.discount > 0 && (
                <BillRow label="Coupon discount" value={-quote.discount} tone="good" />
              )}
              {quote && quote.roundOff !== 0 && <BillRow label="Round off" value={quote.roundOff} />}
              <View style={styles.billTotal}>
                <Text style={styles.billTotalLabel}>To pay</Text>
                <Text style={styles.billTotalValue}>{quote ? formatMoney(quote.total) : '—'}</Text>
              </View>
              {quote && quote.discount > 0 && (
                <View style={styles.savings}>
                  <Text style={styles.savingsText}>You save {formatMoney(quote.discount)} on this order</Text>
                </View>
              )}
            </View>
          )}

          {quote?.serviceable && !quote.serviceable.ok ? (
            <View style={styles.billError}>
              <Text style={styles.billErrorText}>{quote.serviceable.reason}</Text>
              <Pressable style={styles.primaryGhost} onPress={() => router.push('/location')}>
                <Text style={styles.primaryGhostText}>Change address</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <Modal visible={browsingOffers} transparent animationType="slide" onRequestClose={() => setBrowsingOffers(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setBrowsingOffers(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: space.xl + insets.bottom }]} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Coupons</Text>
            <ScrollView style={styles.sheetList}>
              {(offers ?? []).map(offer => {
                const short = Math.max(0, offer.minOrder - cart.subtotal)
                const applied = couponState?.applied && couponState.code === offer.code

                return (
                  <View key={offer.id} style={styles.offer}>
                    <View style={styles.flex}>
                      <Text style={styles.offerLabel}>{offer.label}</Text>
                      <Text style={styles.offerSub}>{offer.sub}</Text>
                      <View style={styles.offerCode}>
                        <Text style={styles.offerCodeText}>{offer.code}</Text>
                      </View>
                      {short > 0 && (
                        <Text style={styles.offerShort}>Add {formatMoney(short)} more to use this</Text>
                      )}
                    </View>
                    <Pressable
                      style={[styles.offerApply, (short > 0 || applied) && styles.disabled]}
                      disabled={short > 0 || !!applied}
                      onPress={() => applyCode(offer.code)}
                    >
                      <Text style={styles.offerApplyText}>{applied ? 'Applied' : 'Apply'}</Text>
                    </Pressable>
                  </View>
                )
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={[styles.bar, { paddingBottom: space.md + insets.bottom }]}>
        <View style={styles.flex}>
          <Text style={styles.barLabel}>Total</Text>
          <Text style={styles.barValue}>{quote ? formatMoney(quote.total) : '—'}</Text>
        </View>
        <Pressable
          style={[styles.barButton, (!quote || pricing) && styles.disabled]}
          disabled={!quote || pricing}
          onPress={() =>
            router.push({
              pathname: '/checkout',
              params: { coupon: couponState?.applied ? couponState.code ?? '' : '' },
            })
          }
        >
          {pricing ? (
            <ActivityIndicator color={colors.surface} size="small" />
          ) : (
            <>
              <Text style={styles.barButtonText}>Checkout</Text>
              <Feather name="arrow-right" size={17} color={colors.surface} />
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

export function Header({
  onBack,
  title,
  subtitle,
}: {
  onBack: () => void
  title: string
  subtitle?: string | null
}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={14} style={styles.backButton}>
        <Feather name="chevron-left" size={24} color={colors.ink} />
      </Pressable>
      <View style={styles.flex}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.headerSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function BillRow({
  label,
  value,
  tone,
}: {
  label: string
  value: number | undefined
  tone?: 'good'
}) {
  return (
    <View style={styles.billRow}>
      <Text style={styles.billLabel}>{label}</Text>
      <Text style={[styles.billValue, tone === 'good' && styles.billValueGood]}>
        {value === undefined ? '—' : formatMoney(value)}
      </Text>
    </View>
  )
}

export function VegMark({ isVeg }: { isVeg: boolean }) {
  const tint = isVeg ? colors.veg : colors.nonVeg

  return (
    <View style={[styles.vegMark, { borderColor: tint }]}>
      <View style={[styles.vegMarkInner, { backgroundColor: tint }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },

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
  backButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...type.heading, color: colors.ink },
  headerSub: { ...type.caption, color: colors.muted, marginTop: 1 },

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
  cardTitle: { ...type.overline, color: colors.muted, marginBottom: space.md },

  line: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  lineDivider: {
    marginTop: space.lg,
    paddingTop: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  lineBody: { flex: 1 },
  lineName: { ...type.bodyStrong, color: colors.ink },
  lineAddons: { ...type.caption, color: colors.muted, marginTop: 2 },
  linePrice: { ...type.small, color: colors.muted, marginTop: space.xs },
  lineRight: { alignItems: 'flex-end', gap: space.sm },
  lineTotal: { ...type.bodyStrong, color: colors.ink },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  stepperButton: { width: 30, height: 32, alignItems: 'center', justifyContent: 'center' },
  stepperCount: { minWidth: 20, textAlign: 'center', color: colors.surface, ...type.smallStrong },

  couponRow: { flexDirection: 'row', gap: space.sm },
  couponInput: {
    flex: 1,
    height: 46,
    paddingHorizontal: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    ...type.body,
    color: colors.ink,
  },
  couponButton: {
    paddingHorizontal: space.xl,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  couponButtonText: { ...type.smallStrong, color: colors.surface },
  couponApplied: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  couponAppliedText: { flex: 1, ...type.caption, color: colors.brandInk },
  couponRemove: { ...type.caption, color: colors.brand, fontWeight: '700' },
  couponFailed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  couponFailedText: { flex: 1, ...type.caption, color: colors.warning },
  viewOffers: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  viewOffersText: { flex: 1, ...type.smallStrong, color: colors.brand },

  notesInput: {
    minHeight: 44,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    ...type.small,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  cutlery: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  cutleryTitle: { ...type.bodyStrong, color: colors.ink },
  cutleryHint: { ...type.caption, color: colors.muted, marginTop: 1 },

  savings: {
    marginTop: space.md,
    padding: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
  },
  savingsText: { ...type.smallStrong, color: colors.brandInk },

  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: {
    maxHeight: '75%',
    padding: space.lg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  sheetTitle: { ...type.heading, color: colors.ink, marginBottom: space.sm },
  sheetList: { flexGrow: 0 },
  offer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  offerLabel: { ...type.bodyStrong, color: colors.ink },
  offerSub: { ...type.caption, color: colors.muted, marginTop: 2 },
  offerCode: {
    alignSelf: 'flex-start',
    marginTop: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.brand,
  },
  offerCodeText: { ...type.caption, color: colors.brand, fontWeight: '700', letterSpacing: 1 },
  offerShort: { ...type.caption, color: colors.warning, marginTop: space.xs },
  offerApply: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  offerApplyText: { ...type.smallStrong, color: colors.surface },

  billUpdating: { opacity: 0.5 },
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
  billError: { alignItems: 'center', gap: space.md, paddingVertical: space.md },
  billErrorText: { ...type.small, color: colors.danger, textAlign: 'center' },

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
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minWidth: 150,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  barButtonText: { ...type.bodyStrong, color: colors.surface },
  disabled: { opacity: 0.5 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  emptyTitle: { ...type.heading, color: colors.ink, marginTop: space.sm },
  emptyText: { ...type.body, color: colors.muted, textAlign: 'center' },
  primaryGhost: {
    marginTop: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  primaryGhostText: { ...type.smallStrong, color: colors.brand },

  vegMark: {
    width: 16,
    height: 16,
    borderWidth: 1.5,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  vegMarkInner: { width: 8, height: 8, borderRadius: 4 },
})
