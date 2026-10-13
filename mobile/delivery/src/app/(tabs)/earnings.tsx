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

import { fetchEarnings, fetchHistory, formatRupees, type Delivery, type Earnings } from '@/lib/delivery'
import { colors, radius, shadow, space, type } from '@/theme'

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
]

export default function EarningsScreen() {
  const [days, setDays] = useState(7)
  const [earnings, setEarnings] = useState<Earnings | null>(null)
  const [recent, setRecent] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (range: number) => {
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

  const totals = earnings?.totals
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
                <Line label="Delivery pay" value={formatRupees(totals.basePaise)} />
                <Line label="Tips from customers" value={formatRupees(totals.tipsPaise)} />
                {totals.incentivePaise > 0 ? (
                  <Line label="Incentives" value={formatRupees(totals.incentivePaise)} />
                ) : null}
              </View>
            </View>
          ) : null}

          {earnings && earnings.cashCollectedTodayPaise > 0 ? (
            <View style={styles.cash}>
              <Text style={styles.cashTitle}>Cash in hand today</Text>
              <Text style={styles.cashValue}>{formatRupees(earnings.cashCollectedTodayPaise)}</Text>
              <Text style={styles.cashHint}>
                Collected from customers on cash orders. This belongs to Foodos and is settled with
                you separately.
              </Text>
            </View>
          ) : null}

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
                      <Text style={styles.rowValue}>{formatRupees(day.earningsPaise)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : null}

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
            Pay is a base amount per delivery plus a rate per km, and every rupee of a customer tip is
            yours. Payout dates are set in your agreement with Foodos.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
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

  cash: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.warningSoft },
  cashTitle: { ...type.overline, color: colors.warning },
  cashValue: { ...type.title, color: colors.warning, marginTop: space.xs },
  cashHint: { ...type.caption, color: colors.warning, marginTop: space.xs, lineHeight: 16 },

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
