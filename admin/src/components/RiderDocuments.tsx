// A rider's licence, RC and Aadhaar, as photographed in the Delivery app.
// The photos are identity papers: they load with the admin's sign-in and are
// never cached or linked publicly. Reject needs a reason the rider sees.

import { useEffect, useState } from 'react'
import { api, apiBlob } from '../lib/api'
import { timeAgo } from '../lib/format'
import { useToast } from '../lib/toast'
import type { Rider, RiderDocument } from '../lib/types'
import { Badge, Card, ConfirmDialog, ErrorBox, Modal, Spinner } from './ui'

const STATUS: Record<RiderDocument['status'], { label: string; tone: 'neutral' | 'warning' | 'success' | 'danger' }> = {
  missing: { label: 'Not uploaded', tone: 'neutral' },
  pending: { label: 'To check', tone: 'warning' },
  verified: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
}

export function RiderDocuments({ rider, onChange }: { rider: Rider; onChange: (rider: Rider) => void }) {
  const toast = useToast()
  const [viewing, setViewing] = useState<RiderDocument | null>(null)
  const [rejecting, setRejecting] = useState<RiderDocument | null>(null)

  async function review(doc: RiderDocument, status: 'verified' | 'rejected', reason?: string) {
    const { rider: updated } = await api<{ rider: Rider }>(
      `/api/v1/admin/riders/${rider.id}/documents/${doc.type}/review`,
      { method: 'POST', body: { status, reason: reason || null } },
    )

    onChange(updated)
    setViewing(null)
    toast(status === 'verified' ? `${doc.label} approved` : `${doc.label} rejected`)
  }

  const approved = rider.documents.filter((doc) => doc.status === 'verified').length

  return (
    <Card title={`Documents · ${approved} of ${rider.documents.length} approved`}>
      <ul className="doc-list">
        {rider.documents.map((doc) => (
          <li key={doc.type}>
            <div>
              <strong>{doc.label}</strong> <Badge tone={STATUS[doc.status].tone}>{STATUS[doc.status].label}</Badge>
              <div className="muted small">
                {doc.uploadedAt ? `Uploaded ${timeAgo(doc.uploadedAt)}` : 'The rider uploads it under Profile in the Delivery app'}
                {doc.status === 'rejected' && doc.rejectionReason ? ` · "${doc.rejectionReason}"` : ''}
              </div>
            </div>
            {doc.fileUrl && (
              <button className="btn" onClick={() => setViewing(doc)}>
                {doc.status === 'pending' ? 'Check' : 'View'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {viewing && (
        <DocumentViewer
          doc={viewing}
          onClose={() => setViewing(null)}
          onApprove={() => review(viewing, 'verified')}
          onReject={() => {
            setRejecting(viewing)
            setViewing(null)
          }}
        />
      )}

      {rejecting && (
        <ConfirmDialog
          title={`Reject ${rejecting.label}?`}
          body={<p>The rider sees your reason in the Delivery app and can send a new photo.</p>}
          confirmLabel="Reject"
          danger
          reasonLabel="What is wrong with it?"
          reasonHint="For example: blurred, cut off, expired, or not the rider's own."
          onConfirm={(reason) => review(rejecting, 'rejected', reason)}
          onClose={() => setRejecting(null)}
        />
      )}
    </Card>
  )
}

function DocumentViewer({
  doc,
  onClose,
  onApprove,
  onReject,
}: {
  doc: RiderDocument
  onClose: () => void
  onApprove: () => Promise<void>
  onReject: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null

    apiBlob(doc.fileUrl!)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch((loadError) => setError(loadError.message))

    // The photo is not kept in the page once the window closes.
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [doc.fileUrl])

  async function approve() {
    setBusy(true)
    try {
      await onApprove()
    } catch (approveError: any) {
      setError(approveError.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={doc.label}
      onClose={onClose}
      wide
      footer={
        doc.status !== 'verified' && (
          <>
            <button className="btn btn-danger" onClick={onReject} disabled={busy}>
              Reject
            </button>
            <button className="btn btn-primary" onClick={approve} disabled={busy || !url}>
              Approve
            </button>
          </>
        )
      }
    >
      {error ? (
        <ErrorBox error={error} />
      ) : url ? (
        <img className="doc-photo" src={url} alt={doc.label} />
      ) : (
        <Spinner label="Loading the photo" />
      )}
      <p className="muted small">Check the name matches the rider, the photo is clear, and the document has not expired.</p>
    </Modal>
  )
}
