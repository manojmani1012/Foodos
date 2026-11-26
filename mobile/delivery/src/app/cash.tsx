// Cash from cash orders: how much is held, paying it in online ("Deposit now"),
// and what has been paid in before.

import { useFocusEffect } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { RazorpayCheckout } from '@/components/RazorpayCheckout'
import type { CheckoutMessage } from '@/components/RazorpayCheckout.types'
import { ScreenHeader } from '@/components/ScreenHeader'
import {
  cashBlockText,
  confirmCashDeposit,
  fetchCash,
  formatRupees,
  startCashDeposit,
  type CashDeposit,
  type CashInHand,
  type PaymentIntent,
} from '@/lib/delivery'
import { colors, radius, shadow, space, type } from '@/theme'

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export default function CashScreen() {
  const [cash, setCash] = useState<CashInHand | null>(null)
  const [deposits, setDeposits] = useState<CashDeposit[]>([])
  const [amount, setAmount] = useState('')
  const [intent, setIntent] = useState<PaymentIntent | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Razorpay can call back more than once; the deposit is confirmed once.
  const settled = useRef(false)

  const load = useCallback(async () => {
    try {
      const body = await fetchCash()
      setCash(body.cash)
      setDeposits(body.deposits)
      return body.cash
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load your cash')
      return null
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  // Empty means all of it.
  const paise = amount.trim() ? Math.round(Number(amount.replace(/,/g, '')) * 100) : (cash?.inHandPaise ?? 0)
  const valid = !!cash && Number.isFinite(paise) && paise >= 100 && paise <= cash.inHandPaise

  async function begin() {
    setBusy(true)
    setError('')
    setNotice('')

    try {
      settled.current = false
      setIntent(await startCashDeposit(paise))
    } catch (startError: any) {
      setError(startError.message || 'Could not start the payment')
    } finally {
      setBusy(false)
    }
  }

  // The money may have left even when the app did not hear back, so the cash
  // held is read from the server rather than assumed.
  async function reconcile(before: number) {
    const now = await load()

    if (now && now.inHandPaise < before) {
      setNotice('Your deposit was received.')
      setAmount('')
    } else {
      setError('The payment was not completed. If money left your account, it shows here shortly.')
    }
  }

  async function onMessage(message: CheckoutMessage) {
    if (settled.current) return

    settled.current = true
    const before = cash?.inHandPaise ?? 0
    setIntent(null)

    if (message.type === 'success') {
      setBusy(true)

      try {
        await confirmCashDeposit(message)
        setNotice('Your deposit was received.')
        setAmount('')
        await load()
      } catch {
        await reconcile(before)
      } finally {
        setBusy(false)
      }
    } else if (message.type === 'dismissed') {
      await reconcile(before)
    } else {
      setError(message.reason || 'Payment failed')
    }
  }

  if (intent) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Pressable style={styles.close} onPress={() => onMessage({ type: 'dismissed' })} accessibilityRole="button">
          <Text style={styles.closeText}>Close payment</Text>
        </Pressable>
        <RazorpayCheckout intent={intent} onMessage={onMessage} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title="Cash in hand" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!cash ? (
          error ? null : (
            <ActivityIndicator size="large" color={colors.brand} />
          )
        ) : (
          <View style={styles.card}>
            <Text style={styles.value}>{formatRupees(cash.inHandPaise)}</Text>
            <Text style={styles.hint}>
              Collected from customers on cash orders. It belongs to Foodos.
              {cash.limitPaise
                ? ` At ${formatRupees(cash.limitPaise)} you get ${cashBlockText(cash)} until it is paid in.`
                : ''}
            </Text>
            {cash.limitReached ? <Text style={styles.warning}>You have reached the limit.</Text> : null}

            {cash.inHandPaise >= 100 ? (
              <>
                <TextInput
                  style={styles.input}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholder={`All of it: ${formatRupees(cash.inHandPaise)}`}
                  placeholderTextColor={colors.faint}
                  accessibilityLabel="Amount to deposit in rupees"
                />
                {amount.trim() && !valid ? (
                  <Text style={styles.warning}>Enter between ₹1 and the cash you hold.</Text>
                ) : null}
                <Pressable
                  style={[styles.button, (!valid || busy) && styles.disabled]}
                  disabled={!valid || busy}
                  onPress={begin}
                  accessibilityRole="button"
                >
                  {busy ? (
                    <ActivityIndicator color={colors.surface} size="small" />
                  ) : (
                    <Text style={styles.buttonText}>Deposit now{valid ? ` · ${formatRupees(paise)}` : ''}</Text>
                  )}
                </Pressable>
                <Text style={styles.hint}>
                  Pay by UPI or card. You can also hand the cash to Foodos staff.
                </Text>
              </>
            ) : (
              <Text style={styles.hint}>There is nothing to deposit.</Text>
            )}
          </View>
        )}

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.warning}>{error}</Text> : null}

        {deposits.length > 0 ? (
          <>
            <Text style={styles.section}>Paid in</Text>
            <View style={styles.card}>
              {deposits.map(deposit => (
                <View key={deposit.id} style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle}>{deposit.online ? 'Paid online' : 'Handed to Foodos'}</Text>
                    <Text style={styles.hint}>
                      {when(deposit.createdAt)}
                      {deposit.reference ? ` · ${deposit.reference}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.rowTitle}>{formatRupees(deposit.amountPaise)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxxl },
  card: { padding: space.lg, gap: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.card },
  value: { ...type.title, color: colors.ink },
  hint: { ...type.caption, color: colors.muted, lineHeight: 17 },
  warning: { ...type.small, color: colors.danger },
  notice: { ...type.small, color: colors.brand },
  input: {
    ...type.body,
    color: colors.ink,
    marginTop: space.sm,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
  },
  button: { alignItems: 'center', paddingVertical: space.md, borderRadius: radius.md, backgroundColor: colors.brand },
  buttonText: { ...type.bodyStrong, color: colors.surface },
  disabled: { opacity: 0.5 },
  close: { alignSelf: 'flex-end', padding: space.md },
  closeText: { ...type.smallStrong, color: colors.brand },
  section: { ...type.overline, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  rowTitle: { ...type.bodyStrong, color: colors.ink },
})
