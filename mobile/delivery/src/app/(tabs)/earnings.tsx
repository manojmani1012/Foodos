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
import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import { PayoutBreakdown, PayoutStatusPill } from '@/components/PayoutBreakdown'
import {
  cashBlockText,
  fetchEarnings,
  fetchHistory,
  fetchPayoutAccount,
  fetchPayouts,
  fetchTds,
  formatDay,
  formatPeriod,
  formatRupees,
  PAYOUT_SCHEDULE_TEXT,
  type Delivery,
  type Earnings,
  type PayoutSummary,
  type PayoutAccount,
  type Payouts,
  type TdsSummary,
} from '@/lib/delivery'
import { colors, radius, shadow, space, type } from '@/theme'

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
]

export default function EarningsScreen() {
  const router = useRouter()
  const [days, setDays] = useState(7)
  const [earnings, setEarnings] = useState<Earnings | null>(null)
  const [payouts, setPayouts] = useState<Payouts | null>(null)
  const [account, setAccount] = useState<PayoutAccount | null>(null)
  const [accountLoaded, setAccountLoaded] = useState(false)
  const [recent, setRecent] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (range: number) => {
    // Payouts load on their own: if they fail, earnings still show.
    fetchPayouts()
      .then(setPayouts)
      .catch(() => setPayouts(null))

    fetchPayoutAccount()
      .then(loaded => {
        setAccount(loaded)
        setAccountLoaded(true)
      })
      .catch(() => setAccountLoaded(false))

    try {
      const [summary, history] = await Promise.all([fetchEarnings(range), fetchHistory()])

      setEarnings(summary)
      setRecent(history.slice(0, 10))
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

  // Back from the bank screen: show the account's new status.
  useFocusEffect(
    useCallback(() => {
      fetchPayoutAccount()
        .then(loaded => {
          setAccount(loaded)
          setAccountLoaded(true)
        })
        .catch(() => {})
    }, []),
  )

  const totals = earnings?.totals
  const rule = earnings?.payRule
  const openPayout = (payout: PayoutSummary) =>
    router.push({ pathname: '/payout/[id]', params: { id: payout.id } })
  const busyDays = (earnings?.daily ?? []).filter(day => day.deliveries > 0).reverse()

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>Earnings</Text>
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
                await load(days)
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
                {totals.deliveries} deliver{totals.deliveries === 1 ? 'y' : 'ies'} · {totals.distanceKm} km
              </Text>

              <View style={styles.breakdown}>
                {totals.distancePaise != null ? (
                  <>
                    <Line label="Base pay" value={formatRupees(totals.basePaise)} />
                    <Line label="Distance pay" value={formatRupees(totals.distancePaise)} />
                  </>
                ) : (
                  <Line label="Delivery pay" value={formatRupees(totals.basePaise)} />
                )}
                <Line label="Incentives" value={formatRupees(totals.incentivePaise)} />
                {totals.tdsPaise ? <Line label="TDS deducted" value={`− ${formatRupees(totals.tdsPaise)}`} /> : null}
                <Line label="Tips from customers" value={formatRupees(totals.tipsPaise)} />
              </View>
              <Text style={styles.rule}>
                {rule
                  ? `How you are paid: ${formatRupees(rule.basePaise)} for the first ${rule.baseKm} km, ${formatRupees(rule.perKmPaise)} per km after that${rule.orderIncentivePaise > 0 ? `, ${formatRupees(rule.orderIncentivePaise)} bonus on every delivered order` : ''}, and every rupee of tips.`
                  : 'How you are paid: base pay per delivery, distance pay per km, incentives, and every rupee of a customer tip.'}
              </Text>
            </View>
          ) : null}

          {accountLoaded && (!account || account.status !== 'verified') ? (
            <Pressable style={styles.bankBanner} onPress={() => router.push('/bank')}>
              <Feather name="alert-circle" size={18} color={colors.warning} />
              <View style={styles.flex}>
                <Text style={styles.bankTitle}>
                  {!account
                    ? 'Add your bank account or UPI'
                    : account.status === 'rejected'
                      ? 'Your payout account was rejected'
                      : 'Your payout account is being checked'}
                </Text>
                <Text style={styles.bankText}>
                  {!account
                    ? 'Foodos can only send a payout to a verified account.'
                    : account.status === 'rejected'
                      ? account.rejectReason || 'Please check your details and save them again.'
                      : 'Foodos checks new details before sending money to them.'}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.faint} />
            </Pressable>
          ) : null}

          {earnings && earnings.cash.inHandPaise > 0 ? (
            <View style={styles.cash}>
              <Text style={styles.cashTitle}>Cash in hand</Text>
              <Text style={styles.cashValue}>{formatRupees(earnings.cash.inHandPaise)}</Text>
              <Text style={styles.cashHint}>
                Collected from customers on cash orders and not yet handed over. This belongs to Foodos:
                deposit it now or hand it over, or it is taken off your next payout.
                {earnings.cash.limitPaise
                  ? earnings.cash.limitReached
                    ? ` You have reached the ${formatRupees(earnings.cash.limitPaise)} limit, so you get ${cashBlockText(earnings.cash)} until it is paid in.`
                    : ` At ${formatRupees(earnings.cash.limitPaise)} you get ${cashBlockText(earnings.cash)} until it is paid in.`
                  : ''}
              </Text>
              <Pressable style={styles.deposit} onPress={() => router.push('/cash')} accessibilityRole="button">
                <Text style={styles.depositText}>Deposit now</Text>
              </Pressable>
            </View>
          ) : null}

          {payouts ? <PayoutsSection payouts={payouts} onOpen={openPayout} /> : null}

          {days > 1 ? (
            <>
              <Text style={styles.sectionTitle}>By day</Text>
              {busyDays.length === 0 ? (
                <Text style={styles.emptyText}>No deliveries in this period yet.</Text>
              ) : (
                <View style={styles.card}>
                  {busyDays.map((day, index) => (
                    <View key={day.date} style={[styles.row, index === busyDays.length - 1 && styles.rowLast]}>
                      <View style={styles.flex}>
                        <Text style={styles.rowTitle}>
                          {new Date(day.date).toLocaleDateString('en-IN', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}
                        </Text>
                        <Text style={styles.rowHint}>
                          {day.deliveries} deliver{day.deliveries === 1 ? 'y' : 'ies'} · {day.distanceKm} km
                        </Text>
                      </View>
                      <View style={styles.rowEnd}>
                        <Text style={styles.rowValue}>{formatRupees(day.earningsPaise)}</Text>
                        {day.tdsPaise ? <Text style={styles.rowHint}>TDS {formatRupees(day.tdsPaise)}</Text> : null}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : null}

          <TdsCard />

          <Text style={styles.sectionTitle}>Recent deliveries</Text>
          {recent.length === 0 ? (
            <Text style={styles.emptyText}>Your completed deliveries will appear here.</Text>
          ) : (
            <View style={styles.card}>
              {recent.map((delivery, index) => (
                <View key={delivery.id} style={[styles.row, index === recent.length - 1 && styles.rowLast]}>
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle}>{delivery.restaurant.name}</Text>
                    <Text style={styles.rowHint}>
                      #{delivery.orderNumber}
                      {delivery.deliveredAt
                        ? ` · ${new Date(delivery.deliveredAt).toLocaleString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}`
                        : ''}
                    </Text>
                  </View>
                  <Text style={styles.rowValue}>{formatRupees(delivery.earningPaise)}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.note}>
            {PAYOUT_SCHEDULE_TEXT} Foodos sends each payout and marks it paid here with the bank
            reference (UTR).
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function PayoutsSection({ payouts, onOpen }: { payouts: Payouts; onOpen: (payout: PayoutSummary) => void }) {
  const { unpaid, upcoming, history } = payouts
  const owes = unpaid.duePaise < 0

  return (
    <>
      <Text style={styles.sectionTitle}>Not paid yet</Text>
      <View style={[styles.hero, owes && styles.owes]}>
        {owes ? (
          <>
            <Text style={[styles.heroLabel, styles.owesText]}>You owe Foodos</Text>
            <Text style={[styles.dueValue, styles.owesText]}>{formatRupees(-unpaid.duePaise)}</Text>
            <Text style={[styles.heroHint, styles.owesText]}>
              For cash collected from customers. Hand it over to Foodos; your next earnings are set
              against it first.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.heroLabel}>Due to you</Text>
            <Text style={styles.dueValue}>{formatRupees(unpaid.duePaise)}</Text>
            <Text style={styles.heroHint}>
              {unpaid.entryCount === 0
                ? 'Nothing waiting. New earnings show here until they go into a payout.'
                : unpaid.belowMinimum
                  ? `Below the ${formatRupees(unpaid.minPayoutPaise)} minimum, so it is carried forward and added to your next payout.`
                  : unpaid.nextPayDate
                    ? `Goes into the payout on ${formatDay(unpaid.nextPayDate)}.`
                    : 'Goes into your next payout.'}
            </Text>
          </>
        )}
        {unpaid.breakdown ? (
          <View style={styles.breakdown}>
            <PayoutBreakdown breakdown={unpaid.breakdown} />
          </View>
        ) : null}
      </View>

      {upcoming.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Next payout</Text>
          <View style={styles.card}>
            {upcoming.map((payout, index) => (
              <Pressable
                key={payout.id}
                style={[styles.row, index === upcoming.length - 1 && styles.rowLast]}
                onPress={() => onOpen(payout)}
              >
                <View style={styles.flex}>
                  <Text style={styles.rowTitle}>{formatDay(payout.scheduledFor)}</Text>
                  <Text style={styles.rowHint}>For {formatPeriod(payout.periodStart, payout.periodEnd)}</Text>
                  {payout.status === 'on_hold' && payout.holdReason ? (
                    <Text style={styles.holdText}>On hold: {payout.holdReason}</Text>
                  ) : null}
                </View>
                <View style={styles.rowEnd}>
                  <Text style={styles.rowValue}>{formatRupees(payout.netPaise)}</Text>
                  <PayoutStatusPill status={payout.status} />
                </View>
                <Feather name="chevron-right" size={18} color={colors.faint} />
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.sectionTitle}>Payout history</Text>
      {history.length === 0 ? (
        <Text style={styles.emptyText}>Your paid payouts will appear here.</Text>
      ) : (
        <View style={styles.card}>
          {history.map((payout, index) => (
            <Pressable
              key={payout.id}
              style={[styles.row, index === history.length - 1 && styles.rowLast]}
              onPress={() => onOpen(payout)}
            >
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>
                  {formatDay(payout.status === 'paid' && payout.paidAt ? payout.paidAt : payout.scheduledFor)}
                </Text>
                <Text style={styles.rowHint}>
                  {payout.status === 'paid'
                    ? `Paid${payout.reference ? ` · UTR ${payout.reference}` : ''}`
                    : payout.status === 'failed'
                      ? 'Failed: Foodos will retry'
                      : formatPeriod(payout.periodStart, payout.periodEnd)}
                </Text>
              </View>
              <View style={styles.rowEnd}>
                <Text style={styles.rowValue}>{formatRupees(payout.netPaise)}</Text>
                <PayoutStatusPill status={payout.status} />
              </View>
              <Feather name="chevron-right" size={18} color={colors.faint} />
            </Pressable>
          ))}
        </View>
      )}
    </>
  )
}

function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number)

  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

// Tax deducted at source on the rider's pay (tips are not taxed by Foodos),
// for one financial year, 1 April to 31 March.
function TdsCard() {
  const [fy, setFy] = useState<number | undefined>(undefined)
  const [tds, setTds] = useState<TdsSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let current = true

    setFailed(false)
    fetchTds(fy)
      .then(result => current && setTds(result))
      .catch(() => current && setFailed(true))

    return () => {
      current = false
    }
  }, [fy])

  // "2026-27" -> the year it starts, to step back to the year before.
  const startYear = tds ? Number(tds.financialYear.slice(0, 4)) : fy
  const viewingPrevious = fy !== undefined && tds != null && Number(tds.financialYear.slice(0, 4)) === fy

  if (failed && !tds) return null
  if (!tds) return null

  return (
    <>
      <Text style={styles.sectionTitle}>TDS this financial year</Text>
      <View style={styles.card}>
        <View style={styles.tdsBody}>
          <Text style={styles.tdsYear}>Financial year {tds.financialYear}</Text>
          <Line label="Earnings (excluding tips)" value={formatRupees(tds.earningsPaise)} />
          <Line label="TDS deducted" value={formatRupees(tds.tdsPaise)} />
          <Text style={styles.rule}>
            Tips are not taxed by Foodos. TDS is deducted from your base pay, distance pay and incentives.
          </Text>

          <View style={styles.tdsActions}>
            <Pressable onPress={() => setOpen(value => !value)} style={styles.tdsLink}>
              <Text style={styles.tdsLinkText}>{open ? 'Hide months' : 'Show months'}</Text>
              <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.brand} />
            </Pressable>
            {startYear ? (
              <Pressable onPress={() => setFy(viewingPrevious ? undefined : startYear - 1)} style={styles.tdsLink}>
                <Text style={styles.tdsLinkText}>
                  {viewingPrevious ? 'Back to this year' : `View ${startYear - 1}-${String(startYear).slice(2)}`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {open
          ? tds.months.map((month, index) => (
              <View key={month.month} style={[styles.row, index === tds.months.length - 1 && styles.rowLast]}>
                <View style={styles.flex}>
                  <Text style={styles.rowTitle}>{monthName(month.month)}</Text>
                  <Text style={styles.rowHint}>Earned {formatRupees(month.earningsPaise)}</Text>
                </View>
                <Text style={styles.rowValue}>TDS {formatRupees(month.tdsPaise)}</Text>
              </View>
            ))
          : null}
      </View>
    </>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
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
    gap: space.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  heading: { ...type.title, color: colors.ink },
  ranges: { flexDirection: 'row', gap: space.sm },
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
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  lineLabel: { ...type.small, color: colors.body },
  lineValue: { ...type.small, color: colors.ink },
  rule: { ...type.caption, color: colors.muted, marginTop: space.md, lineHeight: 17 },

  dueValue: { ...type.title, color: colors.ink, marginTop: space.xs },
  owes: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft },
  owesText: { color: colors.danger },
  holdText: { ...type.caption, color: colors.warning, marginTop: 2 },
  rowEnd: { alignItems: 'flex-end', gap: 4, marginRight: space.sm },

  cash: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.warningSoft },
  cashTitle: { ...type.overline, color: colors.warning },
  cashValue: { ...type.title, color: colors.warning, marginTop: space.xs },
  cashHint: { ...type.caption, color: colors.warning, marginTop: space.xs, lineHeight: 16 },
  deposit: {
    alignSelf: 'flex-start',
    marginTop: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.warning,
  },
  depositText: { ...type.smallStrong, color: colors.surface },

  bankBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.warningSoft,
  },
  bankTitle: { ...type.smallStrong, color: colors.warning },
  bankText: { ...type.caption, color: colors.body, marginTop: 2, lineHeight: 16 },
  tdsBody: { padding: space.lg },
  tdsYear: { ...type.smallStrong, color: colors.ink, marginBottom: space.xs },
  tdsActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.md },
  tdsLink: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: space.xs },
  tdsLinkText: { ...type.smallStrong, color: colors.brand },
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowTitle: { ...type.bodyStrong, color: colors.ink },
  rowHint: { ...type.caption, color: colors.muted, marginTop: 1 },
  rowValue: { ...type.bodyStrong, color: colors.ink },

  note: { ...type.caption, color: colors.muted, marginTop: space.lg, lineHeight: 17 },
  error: {
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
