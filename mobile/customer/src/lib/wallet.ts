import { request } from './apiClient'
import type { PaymentIntent } from './orders'

// The Foodos wallet: a prepaid balance that only pays for Foodos orders.

export type WalletEntry = {
  id: number
  type: 'credit' | 'debit'
  reason: 'topup' | 'refund' | 'order_payment' | 'cashback' | 'adjustment'
  label: string
  amountPaise: number
  balanceAfterPaise: number
  orderNumber: string | null
  // Only for an adjustment by Foodos: why.
  note: string | null
  createdAt: string
}

export type Wallet = {
  balancePaise: number
  limits: { maxBalancePaise: number; minTopUpPaise: number; maxTopUpPaise: number }
  transactions: WalletEntry[]
}

export async function fetchWallet(): Promise<Wallet> {
  return request('/api/v1/customer/wallet')
}

// A cheap read for the checkout, which only needs the balance.
export async function fetchWalletBalance(): Promise<number> {
  const body = await request('/api/v1/customer/wallet/balance')

  return body.balancePaise
}

export async function startTopUp(amountPaise: number): Promise<PaymentIntent> {
  const body = await request('/api/v1/customer/wallet/topup', { method: 'POST', body: { amountPaise } })

  return body.payment
}

export async function confirmTopUp(result: {
  razorpayOrderId: string
  razorpayPaymentId: string
  razorpaySignature: string
}): Promise<number> {
  const body = await request('/api/v1/customer/wallet/topup/confirm', { method: 'POST', body: result })

  return body.balancePaise
}
