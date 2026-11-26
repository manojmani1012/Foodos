import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { PayoutBreakdown, SCHEDULE_NOTE, StatusPill } from '@/components/PayoutBreakdown'
import { ScreenHeader } from '@/components/ScreenHeader'
import {
  fetchEarnings,
  fetchPayoutAccount,
  fetchPayouts,
  formatDay,
  formatPeriod,
  formatRupees,
  type Earnings,
  type PayoutAccount,
  type PayoutsOverview,
  type PayoutSummary,
} from '@/lib/restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
]

function planLine(plan: PayoutsOverview['plan']): string {
  const name =
    plan.commissionPlan === 'subscription'
      ? 'Subscription plan'
      : plan.commissionPlan === 'custom'
        ? 'Your agreed plan'
        : 'Standard plan'

  const fee = plan.gatewayFeePct ? ` + ${plan.gatewayFeePct}% payment fee` : ''

  return `${name} · ${plan.commissionPct}% commission${fee}, charged on food + packaging`
}

export default function EarningsScreen() {
  const router = useRouter()
  const [days, setDays] = useState(7)
  const [earnings, setEarnings] = useState<Earnings | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (range: number) => {
    try {
      setEarnings(await fetchEarnings(range))
      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load your earnings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    load(days)
  }, [days, load])

  // Payouts and the bank account do not depend on the range, and reload when
  // coming back from the bank details screen.
  const [payouts, setPayouts] = useState<PayoutsOverview | null>(null)
  const [account, setAccount] = useState<PayoutAccount | null | undefined>(undefined)
  const [payoutError, setPayoutError] = useState('')

  const loadPayouts = useCallback(async () => {
    const [overview, bank] = await Promise.allSettled([fetchPayouts(), fetchPayoutAccount()])

    if (overview.status === 'fulfilled') {
      setPayouts(overview.value)
      setPayoutError('')
    } else {
      setPayoutError(overview.reason?.message || 'Could not load your payouts')
    }

    if (bank.status === 'fulfilled') setAccount(bank.value)
  }, [])

  useFocusEffect(
    useCallback(() => {
      loadPayouts()
    }, [loadPayouts]),
  )

  const nextPayout: PayoutSummary | undefined = [...(payouts?.upcoming ?? [])].sort((a, b) =>
    (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''),
  )[0]
  const unpaid = payouts?.unpaid

  const totals = earnings?.totals
  // Newest first, and only days that had orders: a month of zero rows says nothing.
  const activeDays = (earnings?.daily ?? []).filter(day => day.orders > 0).reverse()

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScreenHeader title="Earnings" />

      <View style={styles.ranges}>
        {RANGES.map(range => {
          const active = range.days === days

          return (
            <Pressable
              key={range.days}
              style={[styles.range, active && styles.rangeActive]}
              onPress={() => setDays(range.days)}
            >
              <Text style={[styles.rangeText, active && styles.rangeTextActive]}>{range.label}</Text>
            </Pressable>
          )
        })}
      </View>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true)
                await Promise.all([load(days), loadPayouts()])
                setRefreshing(false)
              }}
              tintColor={colors.brand}
            />
          }
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {totals ? (
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>You earned</Text>
              <Text style={styles.heroValue}>{formatRupees(totals.earningsPaise)}</Text>
              <Text style={styles.heroHint}>
                from {totals.orders} delivered order{totals.orders === 1 ? '' : 's'}
              </Text>

              <View style={styles.breakdown}>
                <Line label="Food sales" value={formatRupees(totals.foodPaise)} />
                <Line label="Packaging charges" value={formatRupees(totals.packagingPaise)} />
                {totals.discountPaise ? (
                  <Line label="Coupons paid by you" value={`− ${formatRupees(totals.discountPaise)}`} />
                ) : null}
                <Line
                  label={`Foodos commission (${earnings?.commissionPct ?? 0}% on food + packaging)`}
                  value={`− ${formatRupees(totals.commissionPaise)}`}
                />
                <Line
                  label={
                    earnings?.gatewayFeePct ? `Payment gateway fee (${earnings.gatewayFeePct}%)` : 'Payment gateway fee'
                  }
                  value={`− ${formatRupees(totals.gatewayFeePaise ?? 0)}`}
                />
                {totals.gstOnCommissionPaise ? (
                  <Line label="GST on these fees" value={`− ${formatRupees(totals.gstOnCommissionPaise)}`} />
                ) : null}
                {totals.tdsPaise ? <Line label="TDS" value={`− ${formatRupees(totals.tdsPaise)}`} /> : null}
                <View style={styles.divider} />
                <Line label="You keep" value={formatRupees(totals.earningsPaise)} strong />
              </View>
            </View>
          ) : null}

          {earnings && earnings.inProgress.orders > 0 ? (
            <View style={styles.pending}>
              <Text style={styles.pendingText}>
                {earnings.inProgress.orders} more order
                {earnings.inProgress.orders === 1 ? ' is' : 's are'} still on the way (
                {formatRupees(earnings.inProgress.foodPaise)} in food). They count once delivered.
              </Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Payouts</Text>

          {payoutError ? <Text style={styles.error}>{payoutError}</Text> : null}

          {account !== undefined && account?.status !== 'verified' ? (
            <Pressable style={styles.bankBanner} onPress={() => router.push('/bank')}>
              <Feather name="credit-card" size={18} color={colors.warning} />
              <View style={styles.flex}>
                <Text style={styles.bankBannerTitle}>
                  {!account
                    ? 'Add your bank account for payouts'
                    : account.status === 'rejected'
                      ? 'Your bank details were rejected'
                      : 'Your bank details are being checked'}
                </Text>
                <Text style={styles.bankBannerText}>
                  {!account
                    ? 'Foodos needs a bank account to send your money.'
                    : account.status === 'rejected'
                      ? account.rejectReason || 'Please check and update them.'
                      : 'Foodos checks new details before the first payout to them.'}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.warning} />
            </Pressable>
          ) : null}

          {payouts ? (
            <>
              <Text style={styles.planLine}>{planLine(payouts.plan)}</Text>

              {unpaid ? (
                <View style={[styles.hero, styles.gapTop]}>
                  <Text style={styles.heroLabel}>Not paid yet</Text>
                  <Text style={styles.heroValue}>{formatRupees(unpaid.duePaise)}</Text>
                  <Text style={styles.heroHint}>
                    {unpaid.entryCount === 0
                      ? 'Nothing waiting: every delivered order is in a payout.'
                      : unpaid.belowMinimum
                        ? `Carried to the next payout, because payouts start at ${formatRupees(unpaid.minPayoutPaise)}.`
                        : unpaid.nextPayDate
                          ? `Expected in the payout on ${formatDay(unpaid.nextPayDate)}.`
                          : 'Goes into your next scheduled payout.'}
                  </Text>

                  {unpaid.entryCount > 0 ? (
                    <View style={styles.breakdown}>
                      <PayoutBreakdown
                        breakdown={unpaid.breakdown}
                        totalLabel="Due to you"
                        totalPaise={unpaid.duePaise}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}

              {nextPayout ? (
                <Pressable
                  style={[styles.card, styles.nextCard]}
                  onPress={() => router.push({ pathname: '/payout/[id]', params: { id: nextPayout.id } })}
                >
                  <View style={styles.flex}>
                    <Text style={styles.heroLabel}>Next payout</Text>
                    <Text style={styles.nextDate}>{formatDay(nextPayout.scheduledFor)}</Text>
                    <Text style={styles.dayOrders}>
                      For {formatPeriod(nextPayout.periodStart, nextPayout.periodEnd)}
                    </Text>
                    {nextPayout.status === 'on_hold' ? (
                      <Text style={styles.holdText}>
                        On hold{nextPayout.holdReason ? `: ${nextPayout.holdReason}` : ''}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.nextRight}>
                    <Text style={styles.dayValue}>{formatRupees(nextPayout.netPaise)}</Text>
                    <StatusPill status={nextPayout.status} />
                  </View>
                </Pressable>
              ) : null}

              <Text style={styles.subTitle}>Payout history</Text>
              {payouts.history.length === 0 ? (
                <Text style={styles.emptyText}>No payouts sent yet.</Text>
              ) : (
                <View style={styles.card}>
                  {payouts.history.map((payout, index) => (
                    <Pressable
                      key={payout.id}
                      style={[styles.dayRow, index === payouts.history.length - 1 && styles.dayRowLast]}
                      onPress={() => router.push({ pathname: '/payout/[id]', params: { id: payout.id } })}
                    >
                      <View style={styles.flex}>
                        <Text style={styles.dayDate}>
                          {formatDay(payout.paidAt ? payout.paidAt.slice(0, 10) : payout.scheduledFor)}
                        </Text>
                        <Text style={styles.dayOrders}>
                          For {formatPeriod(payout.periodStart, payout.periodEnd)}
                          {payout.status === 'paid' && payout.reference ? ` · Ref ${payout.reference}` : ''}
                        </Text>
                      </View>
                      <View style={styles.nextRight}>
                        <Text style={styles.dayValue}>{formatRupees(payout.netPaise)}</Text>
                        <StatusPill status={payout.status} />
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}

              <Text style={styles.note}>
                {SCHEDULE_NOTE} Foodos sends each payout to your bank account and marks it paid with
                the bank reference (UTR).
              </Text>
            </>
          ) : !payoutError ? (
            <ActivityIndicator color={colors.brand} style={styles.gapTop} />
          ) : null}

          <Text style={styles.sectionTitle}>By day</Text>

          {activeDays.length === 0 ? (
            <Text style={styles.emptyText}>No delivered orders in this period yet.</Text>
          ) : (
            <View style={styles.card}>
              {activeDays.map((day, index) => (
                <View
                  key={day.date}
                  style={[styles.dayRow, index === activeDays.length - 1 && styles.dayRowLast]}
                >
                  <View style={styles.flex}>
                    <Text style={styles.dayDate}>
                      {new Date(day.date).toLocaleDateString('en-IN', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </Text>
                    <Text style={styles.dayOrders}>
                      {day.orders} order{day.orders === 1 ? '' : 's'} · food{' '}
                      {formatRupees(day.foodPaise)}
                    </Text>
                  </View>
                  <Text style={styles.dayValue}>{formatRupees(day.earningsPaise)}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.note}>
            Counts delivered orders only. Taxes go to the government, and the delivery fee and tips
            pay for delivery, so neither is part of your earnings.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, strong && styles.lineStrong]}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.lineStrong]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  ranges: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  range: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.ground,
  },
  rangeActive: { backgroundColor: colors.brand },
  rangeText: { ...type.smallStrong, color: colors.body },
  rangeTextActive: { color: '#fff' },

  content: { padding: space.lg, paddingBottom: space.xxxl },

  hero: {
    padding: space.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  heroLabel: { ...type.overline, color: colors.muted },
  heroValue: { ...type.display, color: colors.brand, marginTop: space.xs },
  heroHint: { ...type.small, color: colors.muted, marginTop: 2 },

  breakdown: {
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: 4 },
  lineLabel: { ...type.small, color: colors.body, flex: 1 },
  lineValue: { ...type.small, color: colors.ink },
  lineStrong: { ...type.bodyStrong, color: colors.ink },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.sm },

  pending: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  pendingText: { ...type.small, color: colors.warning, lineHeight: 19 },

  sectionTitle: { ...type.overline, color: colors.muted, marginTop: space.xl, marginBottom: space.sm },
  emptyText: { ...type.small, color: colors.muted },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    ...shadow.card,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  dayRowLast: { borderBottomWidth: 0 },
  dayDate: { ...type.bodyStrong, color: colors.ink },
  dayOrders: { ...type.caption, color: colors.muted, marginTop: 1 },
  dayValue: { ...type.bodyStrong, color: colors.ink },

  note: { ...type.caption, color: colors.muted, marginTop: space.lg, lineHeight: 17 },

  gapTop: { marginTop: space.md },
  planLine: { ...type.smallStrong, color: colors.body },
  subTitle: { ...type.smallStrong, color: colors.ink, marginTop: space.lg, marginBottom: space.sm },

  bankBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    marginBottom: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  bankBannerTitle: { ...type.smallStrong, color: colors.warning },
  bankBannerText: { ...type.caption, color: colors.warning, marginTop: 2, lineHeight: 16 },

  nextCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg, marginTop: space.md },
  nextDate: { ...type.heading, color: colors.ink, marginTop: space.xs },
  nextRight: { alignItems: 'flex-end', gap: space.xs },
  holdText: { ...type.caption, color: colors.danger, marginTop: space.xs },


  error: {
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
