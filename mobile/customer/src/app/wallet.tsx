import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { RazorpayCheckout } from '@/components/RazorpayCheckout'
import type { CheckoutMessage } from '@/components/RazorpayCheckout.types'
import { formatMoney, rupees } from '@/lib/catalogue'
import type { PaymentIntent } from '@/lib/orders'
import { confirmTopUp, fetchWallet, fetchWalletBalance, startTopUp, type Wallet } from '@/lib/wallet'
import { colors, radius, shadow, space, type } from '@/theme'

import { Header } from './cart'

const QUICK_AMOUNTS = [100, 200, 500, 1000]

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export default function WalletScreen() {
  const router = useRouter()

  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [amount, setAmount] = useState('')
  const [intent, setIntent] = useState<PaymentIntent | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Razorpay can call back more than once; the credit must be confirmed once.
  const settled = useRef(false)

  const load = useCallback(async () => {
    try {
      setWallet(await fetchWallet())
      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load your wallet')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const rupeesToAdd = Number(amount.replace(/[^0-9]/g, '')) || 0
  const limits = wallet?.limits
  const tooLow = !!limits && rupeesToAdd * 100 < limits.minTopUpPaise
  const tooHigh = !!limits && rupeesToAdd * 100 > limits.maxTopUpPaise
  const room = limits && wallet ? limits.maxBalancePaise - wallet.balancePaise : 0

  async function begin() {
    setBusy(true)
    setError('')
    setNotice('')

    try {
      settled.current = false
      setIntent(await startTopUp(rupeesToAdd * 100))
    } catch (startError: any) {
      setError(startError.message || 'Could not start the payment')
    } finally {
      setBusy(false)
    }
  }

  // The money may have left even when the app did not hear back, so the
  // balance is read from the server rather than assumed.
  async function reconcile(before: number) {
    try {
      const now = await fetchWalletBalance()

      if (now > before) {
        setNotice(`${formatMoney(rupees(now - before))} added to your wallet.`)
        setAmount('')
      } else {
        setError('The payment was not completed. You have not been charged.')
      }
    } catch {
      setError('We could not check the payment. Pull down to refresh your wallet.')
    }

    await load()
  }

  async function onMessage(message: CheckoutMessage) {
    if (settled.current) return

    settled.current = true
    const before = wallet?.balancePaise ?? 0
    setIntent(null)

    if (message.type === 'success') {
      setBusy(true)

      try {
        await confirmTopUp(message)
        setNotice(`${formatMoney(rupeesToAdd)} added to your wallet.`)
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

  // Leaving mid-payment asks the server what happened.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (intent) {
          onMessage({ type: 'dismissed' })
          return true
        }

        return false
      })

      return () => subscription.remove()
    }, [intent]),
  )

  if (intent) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <RazorpayCheckout intent={intent} onMessage={onMessage} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header onBack={() => router.back()} title="Foodos wallet" />

      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: space.xxl }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
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
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Available balance</Text>
            <Text style={styles.balance}>{formatMoney(rupees(wallet?.balancePaise ?? 0))}</Text>
            <Text style={styles.balanceHint}>
              Use it to pay for any order on Foodos. It cannot be withdrawn to a bank account.
            </Text>
          </View>

          {notice ? (
            <View style={styles.notice}>
              <Feather name="check-circle" size={16} color={colors.brandInk} />
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add money</Text>

            <View style={styles.amountRow}>
              <Text style={styles.rupee}>₹</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={text => setAmount(text.replace(/[^0-9]/g, '').slice(0, 5))}
                placeholder="Enter amount"
                placeholderTextColor={colors.faint}
                keyboardType="number-pad"
                accessibilityLabel="Amount to add in rupees"
              />
            </View>

            <View style={styles.chips}>
              {QUICK_AMOUNTS.map(value => (
                <Pressable
                  key={value}
                  style={[styles.chip, rupeesToAdd === value && styles.chipChosen]}
                  onPress={() => setAmount(String(value))}
                >
                  <Text style={[styles.chipText, rupeesToAdd === value && styles.chipTextChosen]}>
                    {formatMoney(value)}
                  </Text>
                </Pressable>
              ))}
            </View>

            {limits ? (
              <Text style={styles.limit}>
                {tooLow && rupeesToAdd > 0
                  ? `The least you can add is ${formatMoney(rupees(limits.minTopUpPaise))}.`
                  : tooHigh
                    ? `You can add up to ${formatMoney(rupees(limits.maxTopUpPaise))} at a time.`
                    : rupeesToAdd * 100 > room
                      ? `Your wallet can hold up to ${formatMoney(rupees(limits.maxBalancePaise))}.`
                      : `Add ${formatMoney(rupees(limits.minTopUpPaise))} to ${formatMoney(rupees(limits.maxTopUpPaise))} at a time. The wallet holds up to ${formatMoney(rupees(limits.maxBalancePaise))}.`}
              </Text>
            ) : null}

            <Pressable
              style={[
                styles.primary,
                (busy || !rupeesToAdd || tooLow || tooHigh || rupeesToAdd * 100 > room) && styles.disabled,
              ]}
              disabled={busy || !rupeesToAdd || tooLow || tooHigh || rupeesToAdd * 100 > room}
              onPress={begin}
            >
              {busy ? (
                <ActivityIndicator color={colors.surface} size="small" />
              ) : (
                <Text style={styles.primaryText}>
                  {rupeesToAdd ? `Add ${formatMoney(rupeesToAdd)}` : 'Add money'}
                </Text>
              )}
            </Pressable>
          </View>

          <Text style={styles.sectionTitle}>History</Text>

          {wallet && wallet.transactions.length === 0 ? (
            <Text style={styles.empty}>Nothing yet. Money you add, spend or get back shows up here.</Text>
          ) : (
            wallet?.transactions.map(entry => (
              <View key={entry.id} style={styles.entry}>
                <View style={styles.entryIcon}>
                  <Feather
                    name={entry.type === 'credit' ? 'arrow-down-left' : 'arrow-up-right'}
                    size={16}
                    color={entry.type === 'credit' ? colors.brand : colors.body}
                  />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.entryLabel}>
                    {entry.label}
                    {entry.orderNumber ? ` · #${entry.orderNumber}` : ''}
                  </Text>
                  <Text style={styles.entryMeta}>
                    {when(entry.createdAt)}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </Text>
                </View>
                <View style={styles.entryRight}>
                  <Text style={[styles.entryAmount, entry.type === 'credit' && styles.entryCredit]}>
                    {entry.type === 'credit' ? '+' : '−'}
                    {formatMoney(rupees(entry.amountPaise))}
                  </Text>
                  <Text style={styles.entryMeta}>Balance {formatMoney(rupees(entry.balanceAfterPaise))}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xxxl },
  error: { ...type.small, color: colors.danger, marginTop: space.md },

  balanceCard: {
    padding: space.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.brand,
    ...shadow.card,
  },
  balanceLabel: { ...type.small, color: colors.surface, opacity: 0.85 },
  balance: { ...type.display, color: colors.surface, marginTop: space.xs, fontVariant: ['tabular-nums'] },
  balanceHint: { ...type.caption, color: colors.surface, opacity: 0.85, marginTop: space.sm },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  noticeText: { flex: 1, ...type.smallStrong, color: colors.brandInk },

  card: {
    marginTop: space.lg,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  cardTitle: { ...type.heading, color: colors.ink },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  rupee: { ...type.title, color: colors.ink },
  input: { flex: 1, ...type.title, color: colors.ink, paddingVertical: space.md, paddingLeft: space.sm },
  chips: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  chipChosen: { borderColor: colors.brand, backgroundColor: colors.brand },
  chipText: { ...type.smallStrong, color: colors.ink },
  chipTextChosen: { color: colors.surface },
  limit: { ...type.caption, color: colors.muted, marginTop: space.md },
  primary: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  primaryText: { ...type.bodyStrong, color: colors.surface },
  disabled: { opacity: 0.5 },

  sectionTitle: { ...type.overline, color: colors.muted, marginTop: space.xl, marginBottom: space.sm },
  empty: { ...type.small, color: colors.muted },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  entryIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryLabel: { ...type.bodyStrong, color: colors.ink },
  entryMeta: { ...type.caption, color: colors.muted, marginTop: 1 },
  entryRight: { alignItems: 'flex-end' },
  entryAmount: { ...type.bodyStrong, color: colors.ink, fontVariant: ['tabular-nums'] },
  entryCredit: { color: colors.brand },
})
