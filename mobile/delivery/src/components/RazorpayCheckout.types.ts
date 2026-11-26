// What the checkout reports back, on the phone and in the browser alike.
export type CheckoutMessage =
  | { type: 'success'; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }
  | { type: 'dismissed' }
  | { type: 'failed'; reason?: string }
