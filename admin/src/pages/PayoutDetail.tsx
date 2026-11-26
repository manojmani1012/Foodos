import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Card, ConfirmDialog, Details, Empty, ErrorBox, Field, Loadable, Modal, PageHeader, StatusBadge } from '../components/ui'
import { api } from '../lib/api'
import {
  formatDateTime,
  formatDay,
  formatMoney,
  formatPayDay,
  formatPhone,
  formatSigned,
  indiaToday,
  PARTY_LABEL,
  PAYOUT_STATUS,
  titleCase,
} from '../lib/format'
import { useToast } from '../lib/toast'
import type { LedgerEntry, Payout, PayoutRow } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { DueBadge, partyLink } from './Payouts'

type Action = 'paid' | 'failed' | 'hold' | 'release' | 'reschedule' | 'retry' | 'cancel'

const ENTRY_KIND: Record<string, string> = {
  order: 'Order',
  delivery: 'Delivery',
  cash_collected: 'Cash collected',
  cash_deposit: 'Cash handed over',
  refund: 'Refund',
  adjustment: 'Adjustment',
}

const BREAKDOWN_LABEL: Record<string, string> = {
  foodPaise: 'food',
  packagingPaise: 'packaging',
  commissionPaise: 'commission',
  gstOnCommissionPaise: 'GST on commission',
  tdsPaise: 'TDS',
  basePaise: 'base',
  distancePaise: 'distance',
  incentivePaise: 'incentive',
  orderIncentivePaise: 'order incentive',
  tipPaise: 'tip',
}

// Deductions shown with a minus sign.
const DEDUCTIONS = new Set(['commissionPaise', 'gstOnCommissionPaise', 'tdsPaise'])

function breakdownText(entry: LedgerEntry) {
  const breakdown = entry.breakdown || {}
  const parts: string[] = []

  for (const [key, label] of Object.entries(BREAKDOWN_LABEL)) {
    const value = breakdown[key]
    if (typeof value !== 'number' || value === 0) continue
    // The per-order incentive is already inside the incentive total.
    if (key === 'orderIncentivePaise' && breakdown.incentivePaise) continue
    const pct = key === 'commissionPaise' && breakdown.commissionPct ? ` (${breakdown.commissionPct}%)` : ''
    parts.push(`${DEDUCTIONS.has(key) ? '−' : ''}${formatMoney(value)} ${label}${pct}`)
  }

  if (typeof breakdown.distanceKm === 'number' && breakdown.distanceKm > 0) parts.push(`${breakdown.distanceKm} km`)
  return parts.join(' · ')
}

function allowed(status: string): Action[] {
  switch (status) {
    case 'scheduled':
      return ['paid', 'hold', 'reschedule', 'failed', 'cancel']
    case 'on_hold':
      return ['release', 'paid', 'reschedule', 'cancel']
    case 'failed':
      return ['retry', 'paid', 'hold', 'cancel']
    case 'processing':
      return ['paid', 'failed']
    default:
      return []
  }
}

const LABEL: Record<Action, string> = {
  paid: 'Mark paid',
  failed: 'Mark failed',
  hold: 'Hold',
  release: 'Release',
  reschedule: 'Reschedule',
  retry: 'Retry',
  cancel: 'Cancel payout',
}

function Copyable({ value }: { value: string | null }) {
  const toast = useToast()
  if (!value) return <span className="muted">—</span>

  return (
    <span className="row-gap">
      <span className="mono copyable">{value}</span>
      <button
        type="button"
        className="btn btn-small btn-ghost"
        onClick={() =>
          navigator.clipboard?.writeText(value).then(
            () => toast('Copied'),
            () => toast('Could not copy. Select the text instead', 'error')
          )
        }
      >
        Copy
      </button>
    </span>
  )
}

// Mark paid (with the bank reference) or reschedule (with a date).
function ActionForm({
  payout,
  action,
  onDone,
  onClose,
}: {
  payout: Payout
  action: 'paid' | 'reschedule'
  onDone: (payout: PayoutRow) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(action === 'reschedule' ? payout.scheduledFor || indiaToday() : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event?: FormEvent) {
    event?.preventDefault()
    const text = value.trim()

    if (action === 'paid' && (text.length < 4 || text.length > 60)) {
      setError('Enter the bank or UPI reference (UTR) of the transfer, 4 to 60 characters')
      return
    }
    if (action === 'reschedule' && (!text || text < indiaToday())) {
      setError('Pick today or a later date')
      return
    }

    setBusy(true)
    setError('')

    try {
      const result = await api<{ payout: PayoutRow }>(`/api/v1/admin/finance/payouts/${payout.id}/${action}`, {
        method: 'POST',
        body: action === 'paid' ? { reference: text } : { date: text },
      })
      onDone(result.payout)
      onClose()
    } catch (caught: any) {
      setError(caught?.message || 'That did not work. Try again')
      setBusy(false)
    }
  }

  return (
    <Modal
      title={action === 'paid' ? `Mark ${formatMoney(payout.netPaise)} paid` : 'Reschedule payout'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Go back
          </button>
          <button className="btn btn-primary" onClick={() => save()} disabled={busy}>
            {busy ? 'Saving…' : action === 'paid' ? 'Mark paid' : 'Reschedule'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={save}>
        {action === 'paid' ? (
          <>
            <p>
              Send <strong>{formatMoney(payout.netPaise)}</strong> to {payout.partyName || 'the partner'} from the Foodos bank
              account or UPI first, then enter the transfer's reference here. Foodos Admin does not move the money itself.
            </p>
            {!payout.bank?.verified && (
              <div className="notice notice-warning">These bank details have not been verified. Check them before sending.</div>
            )}
            <Field label="Bank / UPI reference (UTR)" hint="The partner sees it in their app, with a notification.">
              {(id) => <input id={id} className="input mono" value={value} maxLength={60} autoFocus onChange={(e) => setValue(e.target.value)} />}
            </Field>
          </>
        ) : (
          <Field label="New pay date" hint="The partner sees the new date in their app.">
            {(id) => <input id={id} className="input" type="date" min={indiaToday()} value={value} onChange={(e) => setValue(e.target.value)} />}
          </Field>
        )}
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  )
}

export default function PayoutDetail() {
  const { id = '' } = useParams()
  const toast = useToast()
  const [action, setAction] = useState<Action | null>(null)

  const state = useLoad(async () => (await api<{ payout: Payout }>(`/api/v1/admin/finance/payouts/${id}`)).payout, id)

  function applied(message: string) {
    toast(message)
    // The action returns the row only; reload for the history and entries.
    state.reload()
  }

  async function simple(kind: Action, reason: string) {
    const body = kind === 'hold' || kind === 'failed' || kind === 'cancel' ? { reason } : undefined
    await api<{ payout: PayoutRow }>(`/api/v1/admin/finance/payouts/${id}/${kind}`, { method: 'POST', body })
    applied(
      {
        hold: 'Payout put on hold',
        release: 'Payout released. It is scheduled again',
        retry: 'Payout scheduled again',
        failed: 'Payout marked failed',
        cancel: 'Payout cancelled. Its earnings go into the next payout',
      }[kind as 'hold'] || 'Done'
    )
  }

  return (
    <Loadable state={state}>
      {(payout) => {
        const actions = allowed(payout.status)
        const bank = payout.bankDetails
        const party = PARTY_LABEL[payout.partyType] || 'Partner'

        const confirm: Partial<Record<Action, { title: string; body: ReactNode; reason?: string; danger?: boolean; label: string }>> = {
          hold: {
            title: 'Put this payout on hold?',
            body: <p>It will not be paid until someone releases it. The partner is told it is on hold, with the reason.</p>,
            reason: 'Reason',
            label: 'Hold payout',
          },
          release: {
            title: 'Release this payout?',
            body: <p>It goes back to scheduled, for {formatPayDay(payout.scheduledFor)}.</p>,
            label: 'Release',
          },
          retry: {
            title: 'Retry this payout?',
            body: <p>It goes back to scheduled, for {formatPayDay(payout.scheduledFor)}. Check the bank details first.</p>,
            label: 'Retry',
          },
          failed: {
            title: 'Mark this payout failed?',
            body: <p>Use this when the bank returned or refused the transfer. The partner is told Foodos will retry.</p>,
            reason: 'What went wrong',
            danger: true,
            label: 'Mark failed',
          },
          cancel: {
            title: 'Cancel this payout?',
            body: (
              <p>
                Its {payout.entryCount} entries are released and go into the partner's next payout. Nothing is paid for this one.
              </p>
            ),
            reason: 'Reason',
            danger: true,
            label: 'Cancel payout',
          },
        }

        const dialog = action ? confirm[action] : undefined

        return (
          <>
            <PageHeader
              back={{ to: '/payouts', label: 'Payouts' }}
              title={
                <>
                  {formatSigned(payout.netPaise)} to {payout.partyName || 'No name'}{' '}
                  <StatusBadge map={PAYOUT_STATUS} value={payout.status} /> <DueBadge payout={payout} />
                </>
              }
              subtitle={`${party} · earnings ${formatDay(payout.periodStart)} – ${formatDay(payout.periodEnd)} · pay date ${formatPayDay(payout.scheduledFor)}`}
              actions={actions.map((kind) => (
                <button
                  key={kind}
                  className={kind === 'paid' ? 'btn btn-primary' : kind === 'cancel' || kind === 'failed' ? 'btn btn-danger' : 'btn'}
                  onClick={() => setAction(kind)}
                >
                  {LABEL[kind]}
                </button>
              ))}
            />

            {payout.status === 'on_hold' && payout.holdReason && (
              <div className="notice notice-warning">On hold: {payout.holdReason}</div>
            )}
            {payout.status === 'failed' && (
              <div className="notice notice-danger">Failed{payout.failureReason ? `: ${payout.failureReason}` : ''}</div>
            )}
            {payout.status === 'paid' && (
              <div className="notice notice-info">
                Paid {formatDateTime(payout.paidAt)}
                {payout.reference ? (
                  <>
                    {' '}
                    · reference <span className="mono">{payout.reference}</span>
                  </>
                ) : null}
              </div>
            )}
            {payout.netPaise < 0 && (
              <div className="notice notice-warning">
                This partner owes Foodos {formatMoney(-payout.netPaise)} for this period (cash collected, refunds or adjustments).
              </div>
            )}

            <div className="grid-2 align-start">
              <div className="stack">
                <Card title="Amounts">
                  <Details
                    rows={[
                      ['Earnings', formatMoney(payout.grossPaise)],
                      ...(payout.commissionPaise
                        ? ([['Commission and tax', `−${formatMoney(payout.commissionPaise)}`]] as [ReactNode, ReactNode][])
                        : []),
                      ['Adjustments, refunds and cash', formatSigned(payout.adjustmentsPaise)],
                      [<strong key="n">To pay</strong>, <strong key="v">{formatSigned(payout.netPaise)}</strong>],
                    ]}
                  />
                </Card>

                <Card title="Pay to">
                  {!payout.bank?.verified && (
                    <div className="notice notice-warning">
                      {bank
                        ? 'These bank details have not been verified yet. Check them before sending money.'
                        : 'No bank details on file. Ask the partner to add them in their app.'}
                      {payout.partyType === 'restaurant' && (
                        <>
                          {' '}
                          <Link to={`/restaurants/${payout.partyId}`}>Verify on the restaurant page</Link>
                        </>
                      )}
                    </div>
                  )}
                  <Details
                    rows={[
                      [
                        'Name',
                        <Link key="p" to={partyLink(payout.partyType, payout.partyId)}>
                          {payout.partyName || 'No name'}
                        </Link>,
                      ],
                      [
                        'Contact',
                        payout.contact?.phone ? (
                          <span key="c">
                            {payout.contact.name ? `${payout.contact.name} · ` : ''}
                            <a href={`tel:${payout.contact.phone}`}>{formatPhone(payout.contact.phone)}</a>
                          </span>
                        ) : null,
                      ],
                      ...(bank
                        ? ([
                            ['Account holder', <Copyable key="h" value={bank.holder} />],
                            ['Account number', <Copyable key="a" value={bank.accountNumber} />],
                            ['IFSC', <Copyable key="i" value={bank.ifsc} />],
                            ['Bank', bank.bankName],
                            ['UPI ID', <Copyable key="u" value={bank.upiId} />],
                          ] as [ReactNode, ReactNode][])
                        : ([['Bank', payout.bank?.summary || 'Not added']] as [ReactNode, ReactNode][])),
                    ]}
                  />
                </Card>

                <Card title="History">
                  {payout.history.length === 0 ? (
                    <p className="muted">Nothing recorded yet.</p>
                  ) : (
                    <ul className="activity-list">
                      {payout.history.map((event, index) => (
                        <li key={index}>
                          <strong>{titleCase(event.action)}</strong>
                          {event.note && <span> · “{event.note}”</span>}
                          <div className="sub">
                            {event.by || 'Foodos (automatic)'} · {formatDateTime(event.at)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              <Card title={`Entries (${payout.entries.length})`} flush>
                {payout.entries.length === 0 ? (
                  <Empty title="No entries" />
                ) : (
                  <div className="table-wrap">
                    <table className="table stack-on-phone">
                      <thead>
                        <tr>
                          <th>What</th>
                          <th>Day</th>
                          <th className="num">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payout.entries.map((entry) => {
                          const detail = breakdownText(entry)
                          return (
                            <tr key={entry.id}>
                              <td data-label="What">
                                {ENTRY_KIND[entry.kind] || titleCase(entry.kind)}
                                {entry.orderId && entry.orderNumber && (
                                  <>
                                    {' '}
                                    <Link className="mono" to={`/orders/${entry.orderId}`}>
                                      {entry.orderNumber}
                                    </Link>
                                  </>
                                )}
                                {detail && <div className="sub">{detail}</div>}
                                {entry.note && <div className="sub">“{entry.note}”</div>}
                              </td>
                              <td data-label="Day" className="nowrap">
                                {formatDay(entry.businessDate)}
                              </td>
                              <td data-label="Amount" className="num">
                                {formatSigned(entry.amountPaise)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            {(action === 'paid' || action === 'reschedule') && (
              <ActionForm
                payout={payout}
                action={action}
                onDone={() =>
                  applied(action === 'paid' ? `Marked paid. ${payout.partyName || 'The partner'} is notified` : 'Pay date changed')
                }
                onClose={() => setAction(null)}
              />
            )}

            {action && dialog && (
              <ConfirmDialog
                title={dialog.title}
                body={dialog.body}
                confirmLabel={dialog.label}
                danger={dialog.danger}
                reasonLabel={dialog.reason}
                reasonHint={action === 'hold' ? 'The partner sees this in their app.' : 'Kept with the payout and in the activity log.'}
                onConfirm={(reason) => simple(action, reason)}
                onClose={() => setAction(null)}
              />
            )}
          </>
        )
      }}
    </Loadable>
  )
}
