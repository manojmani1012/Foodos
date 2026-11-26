import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Card, Details, ErrorBox, Loadable, PageHeader, StatusBadge } from '../components/ui'
import { api } from '../lib/api'
import { formatDateTime, formatPhone } from '../lib/format'
import { useToast } from '../lib/toast'
import type { SupportTicket as Ticket } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { RAISED_BY, TICKET_STATUS } from './Support'

// Where to read more about the person who raised it.
const PERSON_PAGE: Record<string, string> = { customer: '/customers', delivery_partner: '/riders' }

function ReplyBox({ ticket, onSaved }: { ticket: Ticket; onSaved: (ticket: Ticket) => void }) {
  const toast = useToast()
  const [message, setMessage] = useState('')
  const [internal, setInternal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const closed = ticket.status === 'closed'

  async function send(event?: FormEvent) {
    event?.preventDefault()
    if (!message.trim()) return

    setBusy(true)
    setError('')

    try {
      const { ticket: saved } = await api<{ ticket: Ticket }>(`/api/v1/admin/support/tickets/${ticket.id}/messages`, {
        method: 'POST',
        body: { message: message.trim(), internal },
      })
      onSaved(saved)
      setMessage('')
      toast(internal ? 'Note added' : 'Reply sent')
    } catch (caught: any) {
      setError(caught?.message || 'Could not send')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={send}>
      <textarea
        className="input"
        rows={4}
        maxLength={2000}
        value={message}
        placeholder={internal ? 'A note for the team. The person never sees it.' : 'Your reply. It appears in their app and as a notification.'}
        onChange={(e) => setMessage(e.target.value)}
        aria-label="Reply"
      />
      <label className="checkbox">
        <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
        Internal note (only the Foodos team sees it)
      </label>
      {closed && !internal && <p className="muted small">This ticket is closed. Reopen it to reply, or add an internal note.</p>}
      {error && <ErrorBox error={error} />}
      <div>
        <button className="btn btn-primary" disabled={busy || !message.trim() || (closed && !internal)}>
          {busy ? 'Sending…' : internal ? 'Add note' : 'Send reply'}
        </button>
      </div>
    </form>
  )
}

export default function SupportTicket() {
  const { id = '' } = useParams()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const state = useLoad(async () => (await api<{ ticket: Ticket }>(`/api/v1/admin/support/tickets/${id}`)).ticket, id, 30_000)

  async function setStatus(status: 'open' | 'resolved' | 'closed') {
    setBusy(true)

    try {
      const { ticket } = await api<{ ticket: Ticket }>(`/api/v1/admin/support/tickets/${id}/status`, { method: 'POST', body: { status } })
      state.setData(ticket)
      toast(status === 'open' ? 'Ticket reopened' : `Ticket ${status}`)
    } catch (caught: any) {
      toast(caught?.message || 'Could not change the status')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Loadable state={state}>
      {(ticket) => {
        const done = ticket.status === 'resolved' || ticket.status === 'closed'
        const personPage = PERSON_PAGE[ticket.role]

        return (
          <>
            <PageHeader
              back={{ to: '/support', label: 'Support' }}
              title={
                <>
                  {ticket.subject} <StatusBadge map={TICKET_STATUS} value={ticket.status} />{' '}
                  {ticket.priority === 'high' && <Badge tone="danger">Urgent</Badge>}
                </>
              }
              subtitle={`${ticket.ticketNumber} · raised ${formatDateTime(ticket.createdAt)}`}
              actions={
                <>
                  {!done && (
                    <button className="btn btn-primary" disabled={busy} onClick={() => setStatus('resolved')}>
                      Mark resolved
                    </button>
                  )}
                  {ticket.status !== 'closed' && (
                    <button className="btn" disabled={busy} onClick={() => setStatus('closed')}>
                      Close
                    </button>
                  )}
                  {done && (
                    <button className="btn" disabled={busy} onClick={() => setStatus('open')}>
                      Reopen
                    </button>
                  )}
                </>
              }
            />

            <div className="grid-2 align-start">
              <Card title="Conversation">
                <div className="thread">
                  {ticket.messages.map((message) => (
                    <div
                      key={message.id}
                      className={message.internal ? 'thread-item internal' : message.fromSupport ? 'thread-item support' : 'thread-item'}
                    >
                      <div className="thread-meta">
                        <strong>{message.internal ? 'Internal note' : message.fromSupport ? 'Foodos support' : ticket.person.name || 'Them'}</strong>
                        {message.fromSupport && message.author ? ` · ${message.author}` : ''} · {formatDateTime(message.createdAt)}
                      </div>
                      <div className="thread-body">{message.body}</div>
                    </div>
                  ))}
                </div>
                <ReplyBox ticket={ticket} onSaved={state.setData} />
              </Card>

              <Card title="Details">
                <Details
                  rows={[
                    [
                      'From',
                      personPage ? (
                        <Link key="p" to={`${personPage}/${ticket.person.id}`}>
                          {ticket.person.name || 'No name'}
                        </Link>
                      ) : (
                        ticket.person.name || 'No name'
                      ),
                    ],
                    ['App', RAISED_BY[ticket.role] || ticket.role],
                    ['Phone', <a key="t" href={`tel:${ticket.person.phone}`}>{formatPhone(ticket.person.phone)}</a>],
                    [
                      'Order',
                      ticket.order ? (
                        <Link key="o" className="mono" to={`/orders/${ticket.order.id}`}>
                          {ticket.order.orderNumber}
                        </Link>
                      ) : (
                        'Not about an order'
                      ),
                    ],
                    ['Resolved', ticket.resolvedAt ? formatDateTime(ticket.resolvedAt) : '—'],
                  ]}
                />
              </Card>
            </div>
          </>
        )
      }}
    </Loadable>
  )
}
