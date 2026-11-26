// Earnings week by week (Monday to Sunday): pick a week to see it day by day,
// with tips shown apart from pay and whether the money has reached the bank.

import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ScreenHeader } from '@/components/ScreenHeader'
import {
  fetchWeeklyEarnings,
  formatDay,
  formatPeriod,
  formatRupees,
  PAYOUT_STATUS,
  type WeekEarnings,
} from '@/lib/delivery'
import { colors, radius, shadow, space, type } from '@/theme'

export default function WeeklyScreen() {
  const [weeks, setWeeks] = useState<WeekEarnings[] | null>(null)
  const [error, setError] = useState('')
  // 0 is this week, 1 the one before.
  const [index, setIndex] = useState(0)

  useFocusEffect(
    useCallback(() => {
      fetchWeeklyEarnings()
        .then(loaded => {
          setWeeks(loaded)
          setError('')
        })
        .catch((loadError: any) => setError(loadError.message || 'Could not load your weeks'))
    }, []),
  )

  const week = weeks?.[index]

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title="Weekly earnings" subtitle="Monday to Sunday, last 8 weeks" />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!weeks || !week ? (
          error ? null : (
            <ActivityIndicator size="large" color={colors.brand} />
          )
        ) : (
          <>
            <View style={styles.picker}>
              <Arrow
                label="Earlier week"
                symbol="‹"
                disabled={index >= weeks.length - 1}
                onPress={() => setIndex(index + 1)}
              />
              <Text style={[styles.title, styles.pickerText]}>
                {index === 0 ? 'This week' : formatPeriod(week.weekStart, week.weekEnd)}
              </Text>
              <Arrow label="Later week" symbol="›" disabled={index === 0} onPress={() => setIndex(index - 1)} />
            </View>

            <View style={styles.tips}>
              <Text style={styles.tipsValue}>{formatRupees(week.earningsPaise)}</Text>
              <Text style={styles.tipsText}>
                {week.tipsPaise > 0 ? `Includes customer tips ${formatRupees(week.tipsPaise)}. ` : ''}
                {week.deliveries} deliver{week.deliveries === 1 ? 'y' : 'ies'}.
              </Text>
              {week.payouts.map((payout, position) => (
                <Text key={position} style={styles.tipsText}>
                  {payout.status === 'paid'
                    ? `Bank transfer successful: ${formatRupees(payout.netPaise)}${payout.reference ? ` (UTR ${payout.reference})` : ''}`
                    : `Payout of ${formatRupees(payout.netPaise)}: ${PAYOUT_STATUS[payout.status]?.label ?? payout.status}${payout.scheduledFor ? `, ${formatDay(payout.scheduledFor)}` : ''}`}
                </Text>
              ))}
            </View>

            <Bars days={week.days} />

            <View style={styles.card}>
              <Line label="Delivery pay" value={formatRupees(week.payPaise)} />
              <Line label="Incentives" value={formatRupees(week.incentivePaise)} />
              <Line
                label={`Tips (${week.tippedDeliveries} order${week.tippedDeliveries === 1 ? '' : 's'})`}
                value={formatRupees(week.tipsPaise)}
              />
              {week.tdsPaise ? <Line label="TDS deducted" value={`− ${formatRupees(week.tdsPaise)}`} /> : null}
              <Text style={styles.hint}>All of every tip is yours.</Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Arrow({ label, symbol, disabled, onPress }: { label: string; symbol: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.arrow, disabled && styles.faded]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.arrowText}>{symbol}</Text>
    </Pressable>
  )
}

// One bar per day, as tall as that day's share of the best day.
function Bars({ days }: { days: WeekEarnings['days'] }) {
  const best = Math.max(1, ...days.map(day => day.earningsPaise))

  return (
    <View style={[styles.card, styles.chart]}>
      {days.map((day, position) => (
        <View
          key={day.date}
          style={styles.column}
          accessible
          accessibilityLabel={`${formatDay(day.date)}: ${formatRupees(day.earningsPaise)}`}
        >
          <Text style={styles.barValue}>{day.earningsPaise ? Math.round(day.earningsPaise / 100) : ''}</Text>
          <View style={styles.track}>
            <View style={[styles.bar, { height: `${(day.earningsPaise / best) * 100}%` }]} />
          </View>
          <Text style={styles.barLabel}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][position]}</Text>
        </View>
      ))}
    </View>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.hint, styles.flex]}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxxl },
  tips: { padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.brandSoft },
  tipsValue: { ...type.title, color: colors.brandInk },
  tipsText: { ...type.small, color: colors.brandInk },
  card: { padding: space.lg, gap: space.xs, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { ...type.bodyStrong, color: colors.ink },
  hint: { ...type.small, color: colors.muted },
  value: { ...type.small, color: colors.ink },
  error: { ...type.small, color: colors.danger },
  picker: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pickerText: { flex: 1, textAlign: 'center' },
  arrow: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  arrowText: { ...type.title, color: colors.ink },
  faded: { opacity: 0.35 },
  chart: { flexDirection: 'row', gap: space.sm, alignItems: 'stretch' },
  column: { flex: 1, alignItems: 'center', gap: space.xs },
  track: { height: 110, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: colors.brand },
  barValue: { ...type.caption, color: colors.ink, minHeight: 16 },
  barLabel: { ...type.caption, color: colors.muted },
})
