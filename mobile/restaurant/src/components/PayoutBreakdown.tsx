import { StyleSheet, Text, View } from 'react-native'

import {
  PAYOUT_STATUS_LABELS,
  formatRupees,
  type PayoutBreakdown as Breakdown,
  type PayoutStatus,
} from '@/lib/restaurant'
import { colors, radius, space, type } from '@/theme'

export const SCHEDULE_NOTE =
  'Mon–Tue earnings are paid on Thursday, Wed–Thu on Monday, Fri–Sun on Tuesday. A holiday moves it to the next working day.'

export function StatusPill({ status }: { status: PayoutStatus }) {
  const good = status === 'paid'
  const bad = status === 'failed' || status === 'on_hold' || status === 'cancelled'

  return (
    <View style={[styles.pill, good ? styles.pillGood : bad ? styles.pillBad : styles.pillNeutral]}>
      <Text style={[styles.pillText, good ? styles.pillGoodText : bad ? styles.pillBadText : styles.pillNeutralText]}>
        {PAYOUT_STATUS_LABELS[status] ?? status}
      </Text>
    </View>
  )
}

// What a payout (or the money not yet paid) is made of: sales in, Foodos's
// share and taxes out, then refunds and adjustments. Lines that are zero are
// left out so a simple week reads simply.
export function PayoutBreakdown({
  breakdown,
  totalLabel,
  totalPaise,
}: {
  breakdown: Breakdown | undefined
  totalLabel: string
  totalPaise: number
}) {
  const b = breakdown ?? {}
  const adjustments = b.adjustmentsPaise ?? 0
  // Refunds always reduce what you are paid, whichever sign the server uses.
  const refunds = Math.abs(b.refundsPaise ?? 0)

  return (
    <View>
      <Line label="Food sales" value={formatRupees(b.foodPaise ?? 0)} />
      <Line label="Packaging charges" value={formatRupees(b.packagingPaise ?? 0)} />
      {b.discountPaise ? (
        <Line label="Coupons paid by you" value={`− ${formatRupees(Math.abs(b.discountPaise))}`} />
      ) : null}
      <Line
        label="Foodos commission (on food + packaging)"
        value={`− ${formatRupees(Math.abs(b.commissionPaise ?? 0))}`}
      />
      <Line label="Payment gateway fee" value={`− ${formatRupees(Math.abs(b.gatewayFeePaise ?? 0))}`} />
      {b.gstOnCommissionPaise ? (
        <Line label="GST on these fees" value={`− ${formatRupees(Math.abs(b.gstOnCommissionPaise))}`} />
      ) : null}
      {b.tdsPaise ? <Line label="TDS (income tax)" value={`− ${formatRupees(Math.abs(b.tdsPaise))}`} /> : null}
      {refunds ? <Line label="Refunds charged to you" value={`− ${formatRupees(refunds)}`} /> : null}
      {adjustments ? (
        <Line
          label="Adjustments by Foodos"
          value={`${adjustments < 0 ? '− ' : '+ '}${formatRupees(Math.abs(adjustments))}`}
        />
      ) : null}
      <View style={styles.divider} />
      <Line label={totalLabel} value={formatRupees(totalPaise)} strong />
      {b.bankOfferPaise ? (
        <Text style={styles.note}>
          Bank or card offers ({formatRupees(Math.abs(b.bankOfferPaise))}) are paid by the bank, not by you.
        </Text>
      ) : null}
    </View>
  )
}

export function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, strong && styles.lineStrong]}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.lineStrong]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: 4 },
  lineLabel: { ...type.small, color: colors.body, flex: 1 },
  lineValue: { ...type.small, color: colors.ink },
  lineStrong: { ...type.bodyStrong, color: colors.ink },
  pill: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
  pillText: { ...type.caption },
  pillGood: { backgroundColor: colors.brandSoft },
  pillGoodText: { color: colors.brand },
  pillBad: { backgroundColor: colors.dangerSoft },
  pillBadText: { color: colors.danger },
  pillNeutral: { backgroundColor: colors.warningSoft },
  pillNeutralText: { color: colors.warning },
  note: { ...type.caption, color: colors.muted, marginTop: space.sm, lineHeight: 16 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.sm },
})
