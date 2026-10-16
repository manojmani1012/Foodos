import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  confirmPayment,
  fetchPaymentStatus,
  startPayment,
  type PaymentIntent,
} from '@/lib/orders'
import { RazorpayCheckout } from '@/components/RazorpayCheckout'
import type { CheckoutMessage } from '@/components/RazorpayCheckout.types'
import { colors, radius, shadow, space, type } from '@/theme'

type Stage = 'preparing' | 'checkout' | 'verifying' | 'failed'

export default function PaymentScreen() {
  const { orderId, orderNumber } = useLocalSearchParams<{ orderId: string; orderNumber?: string }>()
  const router = useRouter()

  const [intent, setIntent] = useState<PaymentIntent | null>(null)
  const [stage, setStage] = useState<Stage>('preparing')
  const [error, setError] = useState('')

  // Razorpay can call back more than once; the order must only be confirmed once.
  const settled = useRef(false)

  const begin = useCallback(async () => {
    if (!orderId) return

    setStage('preparing')
    setError('')

    try {
      setIntent(await startPayment(orderId))
      setStage('checkout')
    } catch (startError: any) {
      setError(startError.message || 'Could not start the payment')
      setStage('failed')
    }
  }, [orderId])

  useEffect(() => {
    begin()
  }, [begin])

  const goToOrder = useCallback(() => {
    router.replace({ pathname: '/order/[id]', params: { id: String(orderId) } })
  }, [orderId, router])

  // Leaving mid-payment would strand the order, so the back button asks the
  // server what actually happened rather than just closing the screen.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stage === 'checkout') {
        onDismissed()
        return true
      }

      return false
    })

    return () => subscription.remove()
  })

  async function onSuccess(result: {
    razorpayOrderId: string
    razorpayPaymentId: string
    razorpaySignature: string
  }) {
    if (settled.current) return

    settled.current = true
    setStage('verifying')

    try {
      // The server checks Razorpay's signature; this call reporting success is
      // not enough on its own.
      await confirmPayment(String(orderId), result)
      goToOrder()
    } catch (confirmError: any) {
      // The money may well have left. The webhook is the backstop, so the
      // status is checked rather than declaring failure.
      await reconcile(confirmError.message || 'Could not verify your payment')
    }
  }

  async function onDismissed() {
    if (settled.current) return

    settled.current = true
    setStage('verifying')

    await reconcile('Payment was cancelled')
  }

  async function reconcile(fallbackMessage: string) {
    try {
      const status = await fetchPaymentStatus(String(orderId))

      if (status.paymentStatus === 'paid') {
        goToOrder()
        return
      }
    } catch {
      // Fall through to the failure screen.
    }

    settled.current = false
    setError(fallbackMessage)
    setStage('failed')
  }

  function onCheckoutMessage(message: CheckoutMessage) {
    if (message.type === 'success') onSuccess(message)
    else if (message.type === 'dismissed') onDismissed()
    else {
      settled.current = true
      setError(message.reason || 'Payment failed')
      setStage('failed')
      settled.current = false
    }
  }

  if (stage === 'checkout' && intent) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <RazorpayCheckout intent={intent} onMessage={onCheckoutMessage} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.centered}>
        {stage === 'failed' ? (
          <View style={styles.card}>
            <Feather name="alert-circle" size={38} color={colors.danger} />
            <Text style={styles.title}>Payment not completed</Text>
            <Text style={styles.message}>{error}</Text>
            <Text style={styles.note}>
              Your order is saved and has not been charged. You can try again, or pay the rider in
              cash.
            </Text>

            <Pressable
              style={styles.primary}
              onPress={() => {
                settled.current = false
                begin()
              }}
            >
              <Text style={styles.primaryText}>Try payment again</Text>
            </Pressable>

            <Pressable style={styles.ghost} onPress={goToOrder}>
              <Text style={styles.ghostText}>View order</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <ActivityIndicator size="large" color={colors.brand} />
            <Text style={styles.waiting}>
              {stage === 'verifying' ? 'Confirming your payment…' : 'Preparing secure checkout…'}
            </Text>
            {orderNumber ? <Text style={styles.orderNumber}>Order #{orderNumber}</Text> : null}
          </>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.lg,
    backgroundColor: colors.ground,
  },
  waiting: { ...type.body, color: colors.body },
  orderNumber: { ...type.caption, color: colors.muted },

  card: {
    width: '100%',
    alignItems: 'center',
    gap: space.sm,
    padding: space.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  title: { ...type.heading, color: colors.ink, marginTop: space.sm },
  message: { ...type.body, color: colors.body, textAlign: 'center' },
  note: {
    ...type.caption,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 17,
    marginTop: space.xs,
  },
  primary: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  primaryText: { ...type.bodyStrong, color: colors.surface },
  ghost: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: space.md },
  ghostText: { ...type.smallStrong, color: colors.brand },
})
