import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import type { PaymentIntent } from '@/lib/orders'
import { colors, type } from '@/theme'

import type { CheckoutMessage } from './RazorpayCheckout.types'

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js'

let scriptLoading: Promise<void> | null = null

// Razorpay's script, added to the page once and reused for later payments.
function loadRazorpay(): Promise<void> {
  if ((window as any).Razorpay) return Promise.resolve()

  if (!scriptLoading) {
    scriptLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_URL
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => {
        scriptLoading = null
        reject(new Error('Could not load the payment page. Check your connection and try again'))
      }
      document.body.appendChild(script)
    })
  }

  return scriptLoading
}

// The browser version: Razorpay's own checkout window over this page. Same
// options and the same three outcomes as the phone version.
export function RazorpayCheckout({
  intent,
  onMessage,
}: {
  intent: PaymentIntent
  onMessage: (message: CheckoutMessage) => void
}) {
  useEffect(() => {
    let cancelled = false

    loadRazorpay()
      .then(() => {
        if (cancelled) return

        const customer = intent.customer
        const Razorpay = (window as any).Razorpay
        const checkout = new Razorpay({
          key: intent.keyId,
          amount: intent.amountPaise,
          currency: intent.currency,
          order_id: intent.razorpayOrderId,
          name: 'Foodos',
          description: `Order #${intent.orderNumber}`,
          theme: { color: '#1a5c35' },
          prefill: { name: customer.name || '', contact: customer.phone || '', email: customer.email || '' },
          handler: (response: any) =>
            onMessage({
              type: 'success',
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            }),
          modal: { ondismiss: () => onMessage({ type: 'dismissed' }) },
        })

        checkout.on('payment.failed', (response: any) =>
          onMessage({ type: 'failed', reason: response?.error?.description || 'Payment failed' }),
        )
        checkout.open()
      })
      .catch((error: Error) => {
        if (!cancelled) onMessage({ type: 'failed', reason: error.message })
      })

    return () => {
      cancelled = true
    }
    // One checkout per payment attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent.razorpayOrderId])

  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color={colors.brand} />
      <Text style={styles.text}>Opening secure checkout…</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.ground },
  text: { ...type.body, color: colors.muted },
})
