// Photo proof for refunds, and the refunds restaurants have asked for. The
// photos load with the admin's sign-in and are never linked publicly.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, apiBlob } from '../lib/api'
import { formatDateTime, formatMoney, plural } from '../lib/format'
import { useToast } from '../lib/toast'
import type { RefundRequest } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { Card, ConfirmDialog, ErrorBox, Field, Modal, Spinner } from './ui'

function Photo({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let objectUrl: string | null = null
    let gone = false

    apiBlob(`/api/v1/admin/refund-photos/${id}/file`)
      .then((blob) => {
        if (gone) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch((loadError) => !gone && setError(loadError.message))

    return () => {
      gone = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id])

  if (error) return <ErrorBox error={error} />
  return url ? <img className="doc-photo" src={url} alt="Photo of the problem" /> : <Spinner label="Loading the photo" />
}

export function RefundPhotos({ photoIds }: { photoIds: string[] }) {
  const [open, setOpen] = useState(false)

  if (photoIds.length === 0) return null

  return (
    <>
      <button type="button" className="btn btn-small" onClick={() => setOpen(true)}>
        View {plural(photoIds.length, 'photo')}
      </button>
      {open && (
        <Modal title="Photo proof" wide onClose={() => setOpen(false)}>
          <div className="stack">
            {photoIds.map((id) => (
              <Photo key={id} id={id} />
            ))}
          </div>
        </Modal>
      )}
    </>
  )
}

function Approve({ request, onDone, onClose }: { request: RefundRequest; onDone: () => void; onClose: () => void }) {
  const [amount, setAmount] = useState(String(request.amountPaise / 100))

  return (
    <ConfirmDialog
      title={`Refund ${request.orderNumber}?`}
      body={
        <>
          <p>
            The customer is refunded and the amount comes off {request.restaurantName}'s next payout. Check the photos first.
          </p>
          <Field label="Amount (₹)" hint={`The restaurant asked for ${formatMoney(request.amountPaise)}. You can refund less.`}>
            {(id) => <input id={id} className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
        </>
      }
      confirmLabel="Approve and refund"
      onConfirm={async () => {
        const paise = Math.round(Number(amount) * 100)
        if (!(paise > 0) || paise > request.amountPaise) {
          throw new Error(`Enter an amount up to ${formatMoney(request.amountPaise)}`)
        }
        await api(`/api/v1/admin/refund-requests/${request.id}/approve`, { method: 'POST', body: { amountPaise: paise } })
        onDone()
      }}
      onClose={onClose}
    />
  )
}

// Shown only while something is waiting.
export function RefundRequests() {
  const toast = useToast()
  const state = useLoad(
    () => api<{ requests: RefundRequest[] }>('/api/v1/admin/refund-requests'),
    'refund-requests',
    60_000
  )
  const [acting, setActing] = useState<{ request: RefundRequest; action: 'approve' | 'reject' } | null>(null)
  const requests = state.data?.requests ?? []

  if (state.error && !state.data) return <ErrorBox error={state.error} onRetry={state.reload} />
  if (requests.length === 0) return null

  function done(message: string) {
    toast(message)
    state.reload()
  }

  return (
    <Card title={`Refunds restaurants have asked for · ${requests.length}`}>
      <ul className="doc-list">
        {requests.map((request) => (
          <li key={request.id}>
            <div>
              <Link to={`/orders/${request.orderId}`}>
                <strong>{request.orderNumber}</strong>
              </Link>{' '}
              · {request.restaurantName} · <strong>{formatMoney(request.amountPaise)}</strong> of{' '}
              {formatMoney(request.orderTotalPaise)}
              <div className="muted small">
                “{request.reason}” · {formatDateTime(request.createdAt)}
              </div>
            </div>
            <div className="row-gap">
              <RefundPhotos photoIds={request.photoIds} />
              <button className="btn btn-small btn-primary" onClick={() => setActing({ request, action: 'approve' })}>
                Approve
              </button>
              <button className="btn btn-small" onClick={() => setActing({ request, action: 'reject' })}>
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>

      {acting?.action === 'approve' && (
        <Approve request={acting.request} onDone={() => done('Refund made')} onClose={() => setActing(null)} />
      )}
      {acting?.action === 'reject' && (
        <ConfirmDialog
          title={`Reject the refund for ${acting.request.orderNumber}?`}
          body={<p>No money moves. The restaurant sees your reason.</p>}
          confirmLabel="Reject"
          danger
          reasonLabel="Why not?"
          onConfirm={async (reason) => {
            await api(`/api/v1/admin/refund-requests/${acting.request.id}/reject`, { method: 'POST', body: { reason } })
            done('Request rejected')
          }}
          onClose={() => setActing(null)}
        />
      )}
    </Card>
  )
}
