import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Line, PayoutBreakdown, SCHEDULE_NOTE, StatusPill } from '@/components/PayoutBreakdown'
import { ScreenHeader } from '@/components/ScreenHeader'
import {
  fetchPayout,
  fetchStatementUrl,
  formatDay,
  formatPeriod,
  formatRupees,
  type PayoutEntry,
  type PayoutSummary,
} from '@/lib/restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

const KIND_LABELS: Record<string, string> = {
  order: 'Order',
  refund: 'Refund',
  adjustment: 'Adjustment',
}

function entryTitle(entry: PayoutEntry): string {
  const kind = KIND_LABELS[entry.kind] ?? entry.kind

  if (entry.orderNumber) return entry.kind === 'order' ? `#${entry.orderNumber}` : `${kind} · #${entry.orderNumber}`

  return kind
}

export default function PayoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()

  const [payout, setPayout] = useState<(PayoutSummary & { entries: PayoutEntry[] }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

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

  async function downloadStatement() {
    if (downloading) return

    setDownloading(true)
    setError('')

    try {
      const url = await fetchStatementUrl(id)
      await Linking.openURL(url)
    } catch (statementError: any) {
      setError(statementError.message || 'Could not open the statement')
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <ScreenHeader title="Payout" />
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    )
  }

  const entries = payout?.entries ?? []

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScreenHeader
        title="Payout"
        subtitle={payout ? `For ${formatPeriod(payout.periodStart, payout.periodEnd)}` : undefined}
      />

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
                <Text style={styles.heroLabel}>
                  {payout.status === 'paid' ? 'Paid to you' : 'Payout amount'}
                </Text>
                <StatusPill status={payout.status} />
              </View>
              <Text style={styles.heroValue}>{formatRupees(payout.netPaise)}</Text>
              <Text style={styles.heroHint}>{statusLine(payout)}</Text>

              {payout.status === 'on_hold' && payout.holdReason ? (
                <Text style={styles.problem}>On hold: {payout.holdReason}</Text>
              ) : null}
              {payout.status === 'failed' ? (
                <Text style={styles.problem}>
                  This payout could not be sent{payout.failureReason ? `: ${payout.failureReason}` : ''}.
                  Foodos will retry it. Check your bank details are correct.
                </Text>
              ) : null}

              <View style={styles.breakdown}>
                {payout.breakdown ? (
                  <PayoutBreakdown breakdown={payout.breakdown} totalLabel="You get" totalPaise={payout.netPaise} />
                ) : (
                  <>
                    <Line label="Sales" value={formatRupees(payout.grossPaise)} />
                    <Line label="Foodos commission" value={`− ${formatRupees(Math.abs(payout.commissionPaise))}`} />
                    {payout.adjustmentsPaise ? (
                      <Line
                        label="Refunds and adjustments"
                        value={`${payout.adjustmentsPaise < 0 ? '− ' : '+ '}${formatRupees(Math.abs(payout.adjustmentsPaise))}`}
                      />
                    ) : null}
                    <View style={styles.divider} />
                    <Line label="You get" value={formatRupees(payout.netPaise)} strong />
                  </>
                )}
              </View>
            </View>

            <Pressable
              style={[styles.primaryButton, downloading && styles.disabled]}
              onPress={downloadStatement}
              disabled={downloading}
            >
              {downloading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Download statement</Text>
              )}
            </Pressable>
            <Text style={styles.note}>
              Opens a printable statement in your browser. Use Print or Share there to save it as a PDF.
            </Text>

            <Text style={styles.sectionTitle}>
              {entries.length} item{entries.length === 1 ? '' : 's'} in this payout
            </Text>

            {entries.length === 0 ? (
              <Text style={styles.emptyText}>No orders listed.</Text>
            ) : (
              <View style={styles.card}>
                {entries.map((entry, index) => (
                  <View key={String(entry.id)} style={[styles.row, index === entries.length - 1 && styles.rowLast]}>
                    <View style={styles.flex}>
                      <Text style={styles.rowTitle}>{entryTitle(entry)}</Text>
                      <Text style={styles.rowHint} numberOfLines={2}>
                        {formatDay(entry.businessDate)}
                        {entry.note ? ` · ${entry.note}` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.rowValue, entry.amountPaise < 0 && styles.negative]}>
                      {entry.amountPaise < 0 ? '− ' : ''}
                      {formatRupees(Math.abs(entry.amountPaise))}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.note}>{SCHEDULE_NOTE}</Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function statusLine(payout: PayoutSummary): string {
  switch (payout.status) {
    case 'paid':
      return [
        payout.paidAt ? `Sent on ${formatDay(payout.paidAt.slice(0, 10))}` : 'Sent',
        payout.reference ? `UTR ${payout.reference}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    case 'scheduled':
      return `Foodos plans to send this on ${formatDay(payout.scheduledFor)}`
    case 'processing':
      return 'Foodos is sending this payout'
    case 'on_hold':
      return `Was due ${formatDay(payout.scheduledFor)}`
    case 'failed':
      return `Was due ${formatDay(payout.scheduledFor)}`
    case 'cancelled':
      return 'Cancelled. Its orders move to your next payout.'
    default:
      return payout.scheduledFor ? `Due ${formatDay(payout.scheduledFor)}` : ''
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
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLabel: { ...type.overline, color: colors.muted },
  heroValue: { ...type.display, color: colors.brand, marginTop: space.xs },
  heroHint: { ...type.small, color: colors.muted, marginTop: 2 },
  problem: {
    ...type.small,
    color: colors.danger,
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  breakdown: {
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.sm },

  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginTop: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  primaryButtonText: { ...type.bodyStrong, color: '#fff' },
  disabled: { opacity: 0.5 },

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
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowTitle: { ...type.bodyStrong, color: colors.ink },
  rowHint: { ...type.caption, color: colors.muted, marginTop: 1 },
  rowValue: { ...type.bodyStrong, color: colors.ink },
  negative: { color: colors.danger },

  note: { ...type.caption, color: colors.muted, marginTop: space.md, lineHeight: 17 },

  error: {
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
