import { StyleSheet, Text, View } from 'react-native'

import { formatRupees, type PayoutBreakdown as Breakdown, type PayoutStatus, PAYOUT_STATUS } from '@/lib/delivery'
import { colors, radius, space, type } from '@/theme'

// What makes up an amount Foodos owes the rider. Cash collected from
// customers and refunds come off; cash handed over to Foodos goes back on.
export function PayoutBreakdown({ breakdown }: { breakdown: Breakdown }) {
  const lines: { label: string; paise: number; sign: '+' | '-' | '±' }[] = [
    { label: 'Base pay', paise: breakdown.basePaise ?? 0, sign: '+' },
    { label: 'Distance pay', paise: breakdown.distancePaise ?? 0, sign: '+' },
    { label: 'Incentives', paise: breakdown.incentivePaise ?? 0, sign: '+' },
    { label: 'TDS deducted', paise: breakdown.tdsPaise ?? 0, sign: '-' },
    { label: 'Tips from customers', paise: breakdown.tipsPaise ?? 0, sign: '+' },
    { label: 'Cash collected from customers', paise: breakdown.cashCollectedPaise ?? 0, sign: '-' },
    { label: 'Cash handed over to Foodos', paise: breakdown.cashDepositedPaise ?? 0, sign: '+' },
    { label: 'Adjustments', paise: breakdown.adjustmentsPaise ?? 0, sign: '±' },
    { label: 'Refunds', paise: breakdown.refundsPaise ?? 0, sign: '-' },
  ].filter(line => line.paise !== 0) as { label: string; paise: number; sign: '+' | '-' | '±' }[]

  if (lines.length === 0) return null

  return (
    <View>
      {lines.map(line => {
        const minus = line.sign === '-' || (line.sign === '±' && line.paise < 0)

        return (
          <View key={line.label} style={styles.line}>
            <Text style={styles.label}>{line.label}</Text>
            <Text style={[styles.value, minus && styles.minus]}>
              {minus ? '− ' : ''}
              {formatRupees(Math.abs(line.paise))}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

export function PayoutStatusPill({ status }: { status: PayoutStatus }) {
  const info = PAYOUT_STATUS[status] ?? { label: status, tone: 'plain' as const }
  const tone =
    info.tone === 'good'
      ? { bg: colors.brandSoft, fg: colors.brand }
      : info.tone === 'warn'
        ? { bg: colors.warningSoft, fg: colors.warning }
        : info.tone === 'bad'
          ? { bg: colors.dangerSoft, fg: colors.danger }
          : { bg: colors.ground, fg: colors.body }

  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.pillText, { color: tone.fg }]}>{info.label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: space.md },
  label: { ...type.small, color: colors.body, flex: 1 },
  value: { ...type.small, color: colors.ink },
  minus: { color: colors.danger },
  pill: { alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
  pillText: { ...type.caption, fontWeight: '700' },
})
