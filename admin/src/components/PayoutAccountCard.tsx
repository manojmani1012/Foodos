import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../lib/api'
import { BANK_STATUS, formatDateTime } from '../lib/format'
import { useToast } from '../lib/toast'
import type { PayoutAccount } from '../lib/types'
import { Card, ConfirmDialog, Details, ErrorBox, Field, Modal, StatusBadge } from './ui'

type Kind = 'restaurant' | 'rider'

// Where a partner's payouts go. Admin can enter or edit the details, then
// verify or reject them. Restaurants are paid to a bank account only; riders
// can have a bank account or a UPI ID. Foodos staff send the money themselves
// (NEFT / RTGS) and mark the payout paid.
function AccountForm({
  kind,
  account,
  path,
  onSaved,
  onClose,
}: {
  kind: Kind
  account: PayoutAccount | null | undefined
  path: string
  onSaved: (data: any) => void
  onClose: () => void
}) {
  const [form, setForm] = useState({
    holder: account?.holder || '',
    accountNumber: account?.accountNumber || '',
    ifsc: account?.ifsc || '',
    bankName: account?.bankName || '',
    upiId: account?.upiId || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))

  async function save(event?: FormEvent) {
    event?.preventDefault()
    const holder = form.holder.trim()
    const accountNumber = form.accountNumber.trim()
    const ifsc = form.ifsc.trim().toUpperCase()
    const bankName = form.bankName.trim()
    const upiId = form.upiId.trim()
    const anyBank = !!(holder || accountNumber || ifsc)

    if (kind === 'restaurant') {
      if (!holder || !accountNumber || !ifsc) return setError('Account holder, account number and IFSC are all needed')
    } else {
      if (anyBank && !(holder && accountNumber && ifsc)) return setError('For a bank account, fill the holder, account number and IFSC together')
      if (!anyBank && !upiId) return setError('Add a bank account or a UPI ID')
    }
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return setError('The IFSC looks wrong. It is 11 characters, like HDFC0001234')

    setBusy(true)
    setError('')

    try {
      const body =
        kind === 'restaurant'
          ? { holder, accountNumber, ifsc, bankName: bankName || null }
          : {
              holder: holder || null,
              accountNumber: accountNumber || null,
              ifsc: ifsc || null,
              bankName: bankName || null,
              upiId: upiId || null,
            }
      const data = await api<any>(path, { method: 'PUT', body })
      onSaved(data)
      onClose()
    } catch (caught: any) {
      setError(caught?.message || 'Could not save the details')
      setBusy(false)
    }
  }

  return (
    <Modal
      title={account ? 'Edit payout details' : 'Add payout details'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={save}>
        <p className="muted small">
          {kind === 'restaurant'
            ? 'Restaurants are paid to a bank account.'
            : 'Riders can be paid to a bank account or a UPI ID.'}{' '}
          Saved details wait for verification before any payout can be marked paid.
        </p>
        <Field label="Account holder name">
          {(id) => <input id={id} className="input" value={form.holder} maxLength={80} onChange={(e) => set('holder', e.target.value)} />}
        </Field>
        <div className="form-grid two">
          <Field label="Account number">
            {(id) => <input id={id} className="input mono" inputMode="numeric" value={form.accountNumber} maxLength={20} onChange={(e) => set('accountNumber', e.target.value.replace(/\s/g, ''))} />}
          </Field>
          <Field label="IFSC">
            {(id) => <input id={id} className="input mono" value={form.ifsc} maxLength={11} onChange={(e) => set('ifsc', e.target.value.toUpperCase().replace(/\s/g, ''))} />}
          </Field>
        </div>
        <Field label="Bank name (optional)">
          {(id) => <input id={id} className="input" value={form.bankName} maxLength={60} onChange={(e) => set('bankName', e.target.value)} />}
        </Field>
        {kind === 'rider' && (
          <Field label="UPI ID (optional if a bank account is added)" hint="Leave the bank fields empty to pay to UPI only.">
            {(id) => <input id={id} className="input mono" value={form.upiId} maxLength={60} autoCapitalize="none" onChange={(e) => set('upiId', e.target.value.trim())} />}
          </Field>
        )}
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  )
}

export function PayoutAccountCard({
  kind,
  partyId,
  account,
  onChanged,
}: {
  kind: Kind
  partyId: string
  account: PayoutAccount | null | undefined
  // Receives the updated restaurant / rider returned by the API.
  onChanged: (party: any) => void
}) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [deciding, setDeciding] = useState<'verify' | 'reject' | null>(null)
  const base = `/api/v1/admin/${kind === 'restaurant' ? 'restaurants' : 'riders'}/${partyId}/payout-account`
  const owner = kind === 'restaurant' ? 'owner' : 'rider'
  const hasBank = !!(account?.accountNumber || account?.ifsc || account?.holder)

  async function decide(reason: string) {
    const approve = deciding === 'verify'
    const result = await api<any>(`${base}/verify`, { method: 'POST', body: approve ? { approve } : { approve, reason } })
    onChanged(result[kind])
    toast(approve ? 'Details verified' : `Details rejected. The ${owner} is asked to fix them`)
  }

  return (
    <Card
      title={kind === 'restaurant' ? 'Bank details for payouts' : 'Payout account'}
      actions={
        <>
          {account && <StatusBadge map={BANK_STATUS2} value={account.status} />}{' '}
          <button className="btn btn-small" onClick={() => setEditing(true)}>
            {account ? 'Edit' : 'Add details'}
          </button>
        </>
      }
    >
      {!account ? (
        <p className="muted">
          Not added yet. {kind === 'restaurant' ? 'The owner can add them in the Restaurant app under Payouts, or you can add them here.' : 'The rider can add them in the Delivery app, or you can add them here.'}{' '}
          Staff cannot mark a payout paid until the details are verified.
        </p>
      ) : (
        <>
          {account.status === 'rejected' && account.rejectReason && (
            <div className="notice notice-danger">Rejected: {account.rejectReason}</div>
          )}
          <Details
            rows={[
              ...(kind === 'restaurant' || hasBank
                ? ([
                    ['Account holder', account.holder],
                    ['Account number', account.accountNumber ? <span key="a" className="mono">{account.accountNumber}</span> : null],
                    ['IFSC', account.ifsc ? <span key="i" className="mono">{account.ifsc}</span> : null],
                    ['Bank', account.bankName],
                  ] as [ReactNode, ReactNode][])
                : []),
              ...(kind === 'rider'
                ? ([['UPI ID', account.upiId ? <span key="u" className="mono">{account.upiId}</span> : null]] as [ReactNode, ReactNode][])
                : []),
              ['Last changed', account.updatedAt ? formatDateTime(account.updatedAt) : null],
            ]}
          />
          {account.status !== 'verified' && (
            <p className="muted small">
              Check the details with the {owner} (a cancelled cheque, bank statement{kind === 'rider' ? ' or a UPI screenshot' : ''}) before verifying.
            </p>
          )}
          <div className="row-gap">
            {account.status !== 'verified' && (
              <button className="btn btn-small btn-primary" onClick={() => setDeciding('verify')}>
                Verify
              </button>
            )}
            {account.status !== 'rejected' && (
              <button className="btn btn-small btn-danger" onClick={() => setDeciding('reject')}>
                Reject
              </button>
            )}
          </div>
        </>
      )}

      {editing && (
        <AccountForm
          kind={kind}
          account={account}
          path={base}
          onSaved={(data) => {
            onChanged(data[kind])
            toast('Details saved. They are pending verification')
          }}
          onClose={() => setEditing(false)}
        />
      )}

      {deciding && (
        <ConfirmDialog
          title={deciding === 'verify' ? 'Verify these details?' : 'Reject these details?'}
          body={
            <p>
              {deciding === 'verify'
                ? `Payouts to this ${owner === 'owner' ? 'restaurant' : 'rider'} can then be marked paid. If the details change later, they need checking again.`
                : `The ${owner} sees the reason in their app and can correct the details. Payouts cannot be marked paid meanwhile.`}
            </p>
          }
          confirmLabel={deciding === 'verify' ? 'Verify' : 'Reject'}
          danger={deciding === 'reject'}
          reasonLabel={deciding === 'reject' ? 'What is wrong' : undefined}
          reasonHint={`The ${owner} sees this.`}
          onConfirm={decide}
          onClose={() => setDeciding(null)}
        />
      )}
    </Card>
  )
}

// "Pending verification" until Foodos has checked the account.
const BANK_STATUS2 = {
  ...BANK_STATUS,
  pending: { ...BANK_STATUS.pending, label: 'Pending verification' },
}
