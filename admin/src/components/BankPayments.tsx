// Paying through the bank: the money available (balance less the reserve),
// one file of due payouts for the bank's bulk upload, and the bank's result.

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { api, apiDownload } from '../lib/api'
import { formatDateTime, formatDay, formatMoney, formatSigned, plural } from '../lib/format'
import { useToast } from '../lib/toast'
import type { BankFile, BankFunds, BankResult } from '../lib/types'
import { useLoad } from '../lib/useLoad'
import { Badge, Card, ConfirmDialog, ErrorBox, Field, Loadable, Modal, Stat } from './ui'

const BASE = '/api/v1/admin/finance'

// The warning when due payouts are more than the money that can be spent.
export function ShortfallNotice({ funds }: { funds: BankFunds }) {
  if (!funds.shortfallPaise) return null

  return (
    <div className="notice notice-warning" role="alert">
      <strong>Not enough money: short by {formatMoney(funds.shortfallPaise)}.</strong> Oldest dues are paid first.{' '}
      {funds.oldestWaiting &&
        `${funds.oldestWaiting.partyName || 'A partner'} (${formatMoney(funds.oldestWaiting.netPaise)}, earnings from ${formatDay(
          funds.oldestWaiting.periodStart
        )}) and everything newer is waiting.`}
    </div>
  )
}

function BalanceForm({ funds, onSaved }: { funds: BankFunds; onSaved: () => void }) {
  const toast = useToast()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    const amount = Number(value.replace(/,/g, ''))

    if (!value.trim() || !Number.isFinite(amount) || amount < 0) {
      setError('Enter the balance in rupees')
      return
    }

    setBusy(true)
    setError('')

    try {
      await api(`${BASE}/bank-balance`, { method: 'PUT', body: { balancePaise: Math.round(amount * 100) } })
      setValue('')
      toast('Bank balance saved')
      onSaved()
    } catch (caught: any) {
      setError(caught?.message || 'Could not save the balance')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form className="toolbar" onSubmit={save}>
        <input
          className="input"
          inputMode="decimal"
          placeholder="Balance in your bank now (₹)"
          aria-label="Balance in your bank now in rupees"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn btn-small" disabled={busy}>
          {busy ? 'Saving…' : 'Update balance'}
        </button>
        <span className="muted small">
          {funds.balanceAt
            ? `Last entered ${formatDateTime(funds.balanceAt)}`
            : 'Not entered yet, so bank files are not limited by money.'}
        </span>
      </form>
      {error && <ErrorBox error={error} />}
    </>
  )
}

const OUTCOME = {
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  done: { label: 'Already recorded', tone: 'neutral' },
  problem: { label: 'Check by hand', tone: 'warning' },
} as const

function ResultUpload({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<BankResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send(csv: string, apply: boolean) {
    setBusy(true)
    setError('')

    try {
      const result = await api<BankResult>(`${BASE}/bank-results`, { method: 'POST', body: { csv, apply } })
      setPreview(result)

      if (apply) {
        toast(`${plural(result.summary.paid, 'payout')} marked paid, ${result.summary.failed} failed`)
        onApplied()
      }
    } catch (caught: any) {
      setPreview(null)
      setError(caught?.message || 'Could not read the file')
    } finally {
      setBusy(false)
    }
  }

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > 500_000) {
      setError('That file is too large. Upload up to 500 KB at a time')
      return
    }

    const csv = await file.text()

    if (!csv.trim()) {
      setError('That file is empty')
      return
    }

    setText(csv)
    await send(csv, false)
  }

  const changes = preview ? preview.summary.paid + preview.summary.failed : 0

  return (
    <Modal
      wide
      title="Upload the bank's result"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Close
          </button>
          {preview && !preview.applied && (
            <button className="btn btn-primary" disabled={busy || changes === 0} onClick={() => send(text, true)}>
              {busy ? 'Working…' : `Apply ${plural(changes, 'change')}`}
            </button>
          )}
        </>
      }
    >
      <p className="muted small">
        A CSV file with the columns Payment reference, Status and UTR. Reason and Amount are optional. Nothing changes until
        you press Apply.
      </p>
      <Field label="Result file (CSV)">
        {(id) => <input id={id} className="input" type="file" accept=".csv,text/csv" onChange={choose} disabled={busy} />}
      </Field>
      {error && <ErrorBox error={error} />}
      {preview && (
        <>
          <p>
            <strong>{preview.applied ? 'Done: ' : 'This file will: '}</strong>
            {preview.summary.paid} paid · {preview.summary.failed} failed · {preview.summary.done} already recorded ·{' '}
            {preview.summary.problem} to check by hand
          </p>
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Reference</th>
                  <th>Partner</th>
                  <th className="num">Amount</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{row.reference || '—'}</td>
                    <td>{row.partyName || '—'}</td>
                    <td className="num">{row.amountPaise != null ? formatMoney(row.amountPaise) : '—'}</td>
                    <td>
                      <Badge tone={OUTCOME[row.outcome].tone}>{OUTCOME[row.outcome].label}</Badge>
                      <div className="sub">{row.message || row.utr || row.reason}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  )
}

function FileRow({ file, onChanged }: { file: BankFile; onChanged: () => void }) {
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState('')

  async function download() {
    setError('')
    try {
      await apiDownload(`${BASE}/bank-files/${file.id}/download`, {}, `foodos-bank-file-${file.number}.csv`)
    } catch (caught: any) {
      setError(caught?.message || 'Could not download the file')
    }
  }

  const untouched = !file.cancelledAt && file.waiting === file.paymentCount

  return (
    <tr>
      <td data-label="File">
        File {file.number}
        <div className="sub">
          {formatDateTime(file.createdAt)}
          {file.createdBy ? ` · ${file.createdBy}` : ''}
        </div>
      </td>
      <td data-label="Payments">
        {plural(file.paymentCount, 'payment')} · {formatMoney(file.totalPaise)}
      </td>
      <td data-label="Result">
        {file.cancelledAt ? (
          <Badge tone="neutral">Cancelled</Badge>
        ) : (
          [
            file.waiting ? `${file.waiting} waiting` : '',
            file.paid ? `${file.paid} paid` : '',
            file.failed ? `${file.failed} failed` : '',
          ]
            .filter(Boolean)
            .join(' · ') || 'No payouts left on this file'
        )}
        {error && <ErrorBox error={error} />}
      </td>
      <td className="row-actions">
        {!file.cancelledAt && (
          <button className="btn btn-small" onClick={download}>
            Download
          </button>
        )}
        {untouched && (
          <button className="btn btn-small btn-ghost" onClick={() => setCancelling(true)}>
            Cancel
          </button>
        )}
        {cancelling && (
          <ConfirmDialog
            title={`Cancel bank file ${file.number}?`}
            body={
              <p>
                Only do this if the file was <strong>not</strong> uploaded to the bank. Its payouts go back to scheduled and can
                go into a new file, so cancelling a file the bank already has would pay people twice.
              </p>
            }
            confirmLabel="It was not sent: cancel it"
            danger
            onConfirm={async () => {
              await api(`${BASE}/bank-files/${file.id}/cancel`, { method: 'POST' })
              onChanged()
            }}
            onClose={() => setCancelling(false)}
          />
        )}
      </td>
    </tr>
  )
}

export default function BankPayments({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const toast = useToast()
  const [version, setVersion] = useState(0)
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const state = useLoad(async () => {
    const [funds, files] = await Promise.all([
      api<{ funds: BankFunds }>(`${BASE}/funds`),
      api<{ files: BankFile[] }>(`${BASE}/bank-files`),
    ])
    return { funds: funds.funds, files: files.files }
  }, `bank:${refreshKey}:${version}`)

  function changed() {
    setVersion((current) => current + 1)
    onChanged()
  }

  return (
    <Card title="Pay through the bank (NEFT / RTGS)">
      <Loadable state={state}>
        {({ funds, files }) => (
          <div className="stack">
            <ShortfallNotice funds={funds} />
            <div className="stats">
              <Stat label="Bank balance" value={funds.balancePaise == null ? 'Not entered' : formatMoney(funds.balancePaise)} />
              <Stat label="Always kept in the bank" value={formatMoney(funds.reservePaise)} hint="Change it in Settings" />
              <Stat
                label="Free to pay out"
                value={funds.availablePaise == null ? '—' : formatSigned(funds.availablePaise)}
                hint={
                  funds.availablePaise == null
                    ? undefined
                    : `After the reserve, ${formatMoney(funds.waitingOnBankPaise)} in bank files and ${formatMoney(
                        funds.paidSinceBalancePaise
                      )} paid since`
                }
                tone={funds.availablePaise != null && funds.availablePaise < 0 ? 'danger' : undefined}
              />
              <Stat
                label="Due now"
                value={formatMoney(funds.due.netPaise)}
                hint={plural(funds.due.count, 'payout')}
                tone={funds.shortfallPaise ? 'warning' : undefined}
              />
            </div>
            <BalanceForm funds={funds} onSaved={changed} />

            <p className="small">
              <strong>{plural(funds.ready.count, 'payout')}</strong> ({formatMoney(funds.ready.netPaise)}) can go into a bank
              file now.
              {funds.upi.count > 0 && ` ${plural(funds.upi.count, 'rider')} with only a UPI ID: pay by UPI and mark paid by hand.`}
              {funds.blocked.count > 0 && ` ${plural(funds.blocked.count, 'payout')} blocked by bank details.`}
              {funds.waitingForFunds.count > 0 && ` ${plural(funds.waitingForFunds.count, 'payout')} waiting for money.`}
            </p>
            <div className="row-gap">
              <button className="btn btn-primary" disabled={funds.ready.count === 0} onClick={() => setCreating(true)}>
                Create bank file
              </button>
              <button className="btn" onClick={() => setUploading(true)}>
                Upload bank result
              </button>
            </div>

            {files.length > 0 && (
              <div className="table-wrap">
                <table className="table compact stack-on-phone">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Payments</th>
                      <th>Result</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file) => (
                      <FileRow key={file.id} file={file} onChanged={changed} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {creating && (
              <ConfirmDialog
                title="Create a bank file?"
                body={
                  <p>
                    Up to {plural(funds.ready.count, 'payout')} ({formatMoney(funds.ready.netPaise)}) are marked Processing.
                    Download the file, upload it to your bank, then upload the bank's result here.
                  </p>
                }
                confirmLabel="Create file"
                onConfirm={async () => {
                  const { file } = await api<{ file: BankFile }>(`${BASE}/bank-files`, { method: 'POST' })
                  toast(`Bank file ${file.number} created`)
                  changed()
                  await apiDownload(`${BASE}/bank-files/${file.id}/download`, {}, `foodos-bank-file-${file.number}.csv`).catch(
                    () => toast('The file is ready. Use Download to save it')
                  )
                }}
                onClose={() => setCreating(false)}
              />
            )}
            {uploading && <ResultUpload onClose={() => setUploading(false)} onApplied={changed} />}
          </div>
        )}
      </Loadable>
    </Card>
  )
}
