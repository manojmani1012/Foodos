// Test accounts let the client's staff run a whole order from home or the
// office. An order from a test customer goes only to test riders, at any
// distance, with no "be at the pin" check, and stays out of payouts. Real
// orders never go to a test rider.

import { useState } from 'react'
import { api } from '../lib/api'
import { formatPhone } from '../lib/format'
import { useToast } from '../lib/toast'
import { Badge, Card, ConfirmDialog } from './ui'

export function TestBadge() {
  return <Badge tone="warning">Test</Badge>
}

export function TestAccountCard({
  userId,
  phone,
  isTest,
  onChange,
}: {
  userId: string
  phone: string
  isTest: boolean
  onChange: (isTest: boolean) => void
}) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)

  async function flip() {
    await api(`/api/v1/admin/accounts/${userId}/test`, { method: 'POST', body: { isTest: !isTest } })
    onChange(!isTest)
    toast(isTest ? 'Now a real account' : 'Now a test account')
  }

  return (
    <Card
      title={<>Test account {isTest && <TestBadge />}</>}
      actions={
        <button className="btn" onClick={() => setConfirming(true)}>
          {isTest ? 'Make real account' : 'Make test account'}
        </button>
      }
    >
      <p className="muted small">
        {isTest
          ? 'Orders this number places are test orders: they go only to test riders, at any distance, with no location check, and are not paid out. As a rider, it gets only test orders.'
          : 'A real account. Make it a test account to run orders from home or the office for testing.'}
      </p>
      {confirming && (
        <ConfirmDialog
          title={isTest ? 'Make this a real account?' : 'Make this a test account?'}
          confirmLabel={isTest ? 'Make real account' : 'Make test account'}
          body={
            isTest ? (
              <p>{formatPhone(phone)} goes back to the real rules: real riders nearby, and the 100 m check at the restaurant and the customer.</p>
            ) : (
              <p>
                In every Foodos app, {formatPhone(phone)} becomes a test account. Its orders go only to test riders, wherever they are, with
                no location check, and are not paid out. As a rider, it gets only test orders. Use it only for staff who test.
              </p>
            )
          }
          onConfirm={flip}
          onClose={() => setConfirming(false)}
        />
      )}
    </Card>
  )
}
