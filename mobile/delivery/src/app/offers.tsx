// Extra Earning Offers: bonuses for completing a number of trips, today and on
// other days, and today's standing for the shift incentive.

import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ScreenHeader } from '@/components/ScreenHeader'
import {
  fetchEarningOffers,
  fetchShiftStanding,
  formatDay,
  formatDuration,
  formatRupees,
  type EarningOffer,
  type EarningOffers,
  type ShiftStanding,
} from '@/lib/delivery'
import { colors, radius, shadow, space, type } from '@/theme'

function daysText(offer: EarningOffer): string {
  if (offer.dayType === 'weekday') return 'Weekdays, Monday to Friday'
  if (offer.dayType === 'weekend') return 'Weekends'
  if (offer.dayType === 'festival' && offer.festivalFrom) {
    return offer.festivalTo && offer.festivalTo !== offer.festivalFrom
      ? `Festival: ${formatDay(offer.festivalFrom)} to ${formatDay(offer.festivalTo)}`
      : `Festival: ${formatDay(offer.festivalFrom)}`
  }
  return 'Every day'
}

export default function OffersScreen() {
  const [offers, setOffers] = useState<EarningOffers | null>(null)
  const [standing, setStanding] = useState<ShiftStanding | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [nextOffers, nextStanding] = await Promise.all([fetchEarningOffers(), fetchShiftStanding()])
      setOffers(nextOffers)
      setStanding(nextStanding)
      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load your offers')
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title="Extra earning offers" />
      <ScrollView
        contentContainerStyle={styles.content}
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
        {!offers || !standing ? (
          error ? null : (
            <ActivityIndicator size="large" color={colors.brand} />
          )
        ) : (
          <>
            <Text style={styles.section}>Today · {offers.tripsToday} trips done</Text>
            {offers.today.length === 0 ? <Text style={styles.hint}>No trip offers today.</Text> : null}
            {offers.today.map(offer => (
              <View key={offer.id} style={styles.card}>
                <View style={styles.row}>
                  <Text style={[styles.title, styles.flex]}>{offer.name}</Text>
                  <Text style={styles.bonus}>{offer.achieved ? 'Earned' : `+${formatRupees(offer.bonusPaise)}`}</Text>
                </View>
                <View style={styles.bar}>
                  <View style={[styles.fill, { width: `${Math.min(1, offer.tripsDone / offer.targetTrips) * 100}%` }]} />
                </View>
                <Text style={styles.hint}>
                  {offer.achieved
                    ? 'Bonus added to today’s earnings'
                    : `${offer.tripsDone} of ${offer.targetTrips} trips`}
                </Text>
              </View>
            ))}

            {standing.ruleOn ? (
              <>
                <Text style={styles.section}>
                  {formatRupees(standing.incentivePerOrderPaise)} per order, if you meet today's shifts
                </Text>
              </>
            ) : (
              <Text style={styles.section}>Your hours today</Text>
            )}
            <View style={styles.card}>
              <Text style={styles.title}>{formatDuration(standing.today.onlineMinutes)} online</Text>
              {standing.today.shifts.map(shift => (
                <View key={shift.name} style={styles.row}>
                  <Text style={[styles.hint, styles.flex]}>
                    {shift.name} {shift.start}–{shift.end}
                  </Text>
                  <Text style={[styles.hint, shift.met && styles.met]}>
                    {formatDuration(shift.doneMinutes)} of {formatDuration(shift.minMinutes)}
                    {shift.met ? ' ✓' : ''}
                  </Text>
                </View>
              ))}
              {standing.ruleOn ? (
                <>
                  <Text style={styles.hint}>
                    Orders turned down: {standing.today.rejections} (up to {standing.today.maxRejections} allowed)
                  </Text>
                  <Text style={styles.hint}>Paid after the day ends. Keep the app open so your time is counted.</Text>
                </>
              ) : null}
            </View>

            {standing.results.length > 0 ? (
              <View style={styles.card}>
                {standing.results.map(result => (
                  <Text key={result.date} style={styles.hint}>
                    {formatDay(result.date)}:{' '}
                    {result.eligible ? `${formatRupees(result.amountPaise)} shift incentive` : 'shift hours not met'}
                  </Text>
                ))}
              </View>
            ) : null}

            {offers.later.length > 0 ? (
              <>
                <Text style={styles.section}>Other days</Text>
                {offers.later.map(offer => (
                  <View key={offer.id} style={styles.card}>
                    <View style={styles.row}>
                      <Text style={[styles.title, styles.flex]}>{offer.name}</Text>
                      <Text style={styles.bonus}>+{formatRupees(offer.bonusPaise)}</Text>
                    </View>
                    <Text style={styles.hint}>{daysText(offer)}</Text>
                  </View>
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxxl },
  section: { ...type.overline, color: colors.muted },
  card: { padding: space.lg, gap: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { ...type.bodyStrong, color: colors.ink },
  bonus: { ...type.bodyStrong, color: colors.brand },
  hint: { ...type.small, color: colors.muted },
  met: { color: colors.brand },
  error: { ...type.small, color: colors.danger },
  bar: { height: 6, borderRadius: radius.pill, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.brand },
})
