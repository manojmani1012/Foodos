import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams } from 'expo-router'
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

import { PayoutBreakdown, PayoutStatusPill } from '@/components/PayoutBreakdown'
import { ScreenHeader } from '@/components/ScreenHeader'
import {
  ENTRY_KIND,
  fetchPayout,
  formatDay,
  formatPeriod,
  formatRupees,
  openPayoutStatement,
  PAYOUT_SCHEDULE_TEXT,
  type PayoutEntry,
  type PayoutSummary,
} from '@/lib/delivery'
import { colors, radius, shadow, space, type } from '@/theme'

type Detail = PayoutSummary & { entries: PayoutEntry[] }

// One payout: what it is for, when Foodos sends it, and every order, cash
// hand-over and adjustment in it.
export default function PayoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [payout, setPayout] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [statementBusy, setStatementBusy] = useState(false)
  const [statementError, setStatementError] = useState('')

  const load = useCallback(async () => {
    try {
      setPayout(await fetchPayout(id))
      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load this payout')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const downloadStatement = async () => {
    setStatementBusy(true)
    setStatementError('')
    try {
      await openPayoutStatement(id)
    } catch (openError: any) {
      setStatementError(openError.message || 'Could not open the statement')
    } finally {
      setStatementBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader
        title="Payout"
        subtitle={payout ? `For ${formatPeriod(payout.periodStart, payout.periodEnd)}` : undefined}
      />

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
                await load()
                setRefreshing(false)
              }}
              tintColor={colors.brand}
            />
          }
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {payout ? (
            <>
              <View style={styles.hero}>
                <View style={styles.heroTop}>
                  <Text style={styles.heroLabel}>{payout.status === 'paid' ? 'Paid to you' : 'Payout'}</Text>
                  <PayoutStatusPill status={payout.status} />
                </View>
                <Text style={styles.heroValue}>{formatRupees(payout.netPaise)}</Text>
                <Text style={styles.heroHint}>{statusLine(payout)}</Text>

                {payout.status === 'on_hold' && payout.holdReason ? (
                  <Text style={[styles.notice, styles.warn]}>On hold: {payout.holdReason}</Text>
                ) : null}
                {payout.status === 'failed' ? (
                  <Text style={[styles.notice, styles.bad]}>
                    This payout could not be sent{payout.failureReason ? `: ${payout.failureReason}` : ''}. Foodos
                    will retry.
                  </Text>
                ) : null}

                {payout.breakdown ? (
                  <View style={styles.breakdown}>
                    <PayoutBreakdown breakdown={payout.breakdown} />
                    <View style={[styles.line, styles.totalLine]}>
                      <Text style={styles.totalLabel}>Net payout</Text>
                      <Text style={styles.totalLabel}>{formatRupees(payout.netPaise)}</Text>
                    </View>
                  </View>
                ) : null}
              </View>

              <Pressable
                style={[styles.button, statementBusy && styles.buttonBusy]}
                onPress={downloadStatement}
                disabled={statementBusy}
              >
                {statementBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Feather name="download" size={16} color="#fff" />
                    <Text style={styles.buttonText}>Download statement</Text>
                  </>
                )}
              </Pressable>
              {statementError ? <Text style={styles.errorText}>{statementError}</Text> : null}

              <Text style={styles.sectionTitle}>What is in it</Text>
              {payout.entries.length === 0 ? (
                <Text style={styles.emptyText}>No entries.</Text>
              ) : (
                <View style={styles.card}>
                  {payout.entries.map((entry, index) => (
                    <View
                      key={String(entry.id)}
                      style={[styles.row, index === payout.entries.length - 1 && styles.rowLast]}
                    >
                      <View style={styles.flex}>
                        <Text style={styles.rowTitle}>
                          {ENTRY_KIND[entry.kind] ?? entry.kind}
                          {entry.orderNumber ? ` · #${entry.orderNumber}` : ''}
                        </Text>
                        <Text style={styles.rowHint}>
                          {formatDay(entry.businessDate)}
                          {entry.note ? ` · ${entry.note}` : ''}
                        </Text>
                      </View>
                      <Text style={[styles.rowValue, entry.amountPaise < 0 && styles.minus]}>
                        {entry.amountPaise < 0 ? '− ' : ''}
                        {formatRupees(Math.abs(entry.amountPaise))}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.note}>
                {PAYOUT_SCHEDULE_TEXT} Foodos sends the money and marks the payout paid here with the bank
                reference (UTR).
              </Text>
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function statusLine(payout: PayoutSummary): string {
  switch (payout.status) {
    case 'paid':
      return [
        payout.paidAt ? `Paid on ${formatDay(payout.paidAt, true)}` : 'Paid',
        payout.reference ? `UTR ${payout.reference}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    case 'failed':
      return `Was due on ${formatDay(payout.scheduledFor)}`
    case 'cancelled':
      return 'Cancelled. Its earnings go into your next payout.'
    case 'on_hold':
      return payout.scheduledFor ? `Was due on ${formatDay(payout.scheduledFor)}` : 'On hold'
    default:
      return payout.scheduledFor ? `Due on ${formatDay(payout.scheduledFor, true)}` : 'Date to be set'
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space.lg, paddingBottom: space.xxxl },

  hero: {
    padding: space.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroLabel: { ...type.overline, color: colors.muted },
  heroValue: { ...type.display, color: colors.brand, marginTop: space.xs },
  heroHint: { ...type.small, color: colors.muted, marginTop: 2 },
  notice: { ...type.small, marginTop: space.md, padding: space.md, borderRadius: radius.md },
  warn: { backgroundColor: colors.warningSoft, color: colors.warning },
  bad: { backgroundColor: colors.dangerSoft, color: colors.danger },
  breakdown: {
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLine: { marginTop: space.xs, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  totalLabel: { ...type.bodyStrong, color: colors.ink },

  button: {
    marginTop: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  buttonBusy: { opacity: 0.7 },
  buttonText: { ...type.bodyStrong, color: '#fff' },
  errorText: { ...type.small, color: colors.danger, marginTop: space.sm },

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
  minus: { color: colors.danger },

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
