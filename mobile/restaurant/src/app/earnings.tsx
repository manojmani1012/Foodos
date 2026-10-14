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

import { ScreenHeader } from '@/components/ScreenHeader'
import { fetchEarnings, formatRupees, type Earnings } from '@/lib/restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
]

export default function EarningsScreen() {
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
                from {totals.orders} delivered order{totals.orders === 1 ? '' : 's'}
              </Text>

              <View style={styles.breakdown}>
                <Line label="Food sales" value={formatRupees(totals.foodPaise)} />
                <Line label="Packaging charges" value={formatRupees(totals.packagingPaise)} />
                <Line
                  label={`Foodos commission (${earnings?.commissionPct ?? 0}% of food)`}
                  value={`− ${formatRupees(totals.commissionPaise)}`}
                />
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
            pay for delivery, so neither is part of your earnings. Payout dates are set in your
            agreement with Foodos.
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

  error: {
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
