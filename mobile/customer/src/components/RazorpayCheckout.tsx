import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'

import type { PaymentIntent } from '@/lib/orders'
import { colors } from '@/theme'

import type { CheckoutMessage } from './RazorpayCheckout.types'

// Razorpay's checkout is a web widget. Loading it in a WebView keeps payments
// working inside Expo Go; their native SDK needs a development build, and the
// server side is identical either way.
function checkoutHtml(intent: PaymentIntent): string {
  const customer = intent.customer

  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <style>
      html, body { margin: 0; height: 100%; background: #f4f6f5; font-family: system-ui, sans-serif; }
      .waiting { display: flex; height: 100%; align-items: center; justify-content: center; color: #8a9299; }
    </style>
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  </head>
  <body>
    <div class="waiting">Opening secure checkout…</div>
    <script>
      function send(message) {
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      }

      var options = {
        key: ${JSON.stringify(intent.keyId)},
        amount: ${intent.amountPaise},
        currency: ${JSON.stringify(intent.currency)},
        order_id: ${JSON.stringify(intent.razorpayOrderId)},
        name: 'Foodos',
        description: 'Order #' + ${JSON.stringify(intent.orderNumber)},
        theme: { color: '#1a5c35' },
        prefill: {
          name: ${JSON.stringify(customer.name || '')},
          contact: ${JSON.stringify(customer.phone || '')},
          email: ${JSON.stringify(customer.email || '')}
        },
        handler: function (response) {
          send({
            type: 'success',
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature
          });
        },
        modal: {
          ondismiss: function () { send({ type: 'dismissed' }); }
        }
      };

      try {
        var rzp = new Razorpay(options);
        rzp.on('payment.failed', function (response) {
          send({ type: 'failed', reason: (response.error && response.error.description) || 'Payment failed' });
        });
        rzp.open();
      } catch (error) {
        send({ type: 'failed', reason: String(error) });
      }
    </script>
  </body>
</html>`
}

// The phone version: Razorpay's checkout page in a WebView, which reports back
// through postMessage.
export function RazorpayCheckout({
  intent,
  onMessage,
}: {
  intent: PaymentIntent
  onMessage: (message: CheckoutMessage) => void
}) {
  return (
    <WebView
      source={{ html: checkoutHtml(intent), baseUrl: 'https://checkout.razorpay.com' }}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      startInLoadingState
      renderLoading={() => (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      )}
      onMessage={event => {
        try {
          onMessage(JSON.parse(event.nativeEvent.data))
        } catch {
          // Not one of ours.
        }
      }}
      onError={() => onMessage({ type: 'failed', reason: 'Could not load the payment page' })}
    />
  )
}

const styles = StyleSheet.create({
  centered: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ground },
})
