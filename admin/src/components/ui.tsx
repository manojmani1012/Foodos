// The small building blocks every screen is made of.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ApiError } from '../lib/api'

type Tone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function StatusBadge({ map, value }: { map: Record<string, { label: string; tone: Tone }>; value: string }) {
  const entry = map[value] || { label: value, tone: 'neutral' as Tone }
  return <Badge tone={entry.tone}>{entry.label}</Badge>
}

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  back?: { to: string; label: string }
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        {back && (
          <Link className="back-link" to={back.to}>
            ← {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Card({
  title,
  actions,
  children,
  flush,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  flush?: boolean
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      <div className={flush ? 'card-body flush' : 'card-body'}>{children}</div>
    </section>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="spinner-row" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error | string; onRetry?: () => void }) {
  const message = typeof error === 'string' ? error : error.message
  return (
    <div className="error-box" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button className="btn btn-small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Empty({ title, body }: { title: string; body?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {body && <p className="empty-body">{body}</p>}
    </div>
  )
}

// Loading, failed, or ready: the three states of every data-backed panel.
export function Loadable<T>({
  state,
  children,
}: {
  state: { data: T | null; error: ApiError | null; loading: boolean; reload: () => void }
  children: (data: T) => ReactNode
}) {
  if (state.data) {
    return (
      <>
        {state.error && <ErrorBox error={state.error} onRetry={state.reload} />}
        {children(state.data)}
      </>
    )
  }

  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />

  return <Spinner />
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; count?: number; alert?: boolean }[]
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={value === option.value}
          className={value === option.value ? 'tab active' : 'tab'}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && (
            <span className={option.alert && option.count > 0 ? 'tab-count alert' : 'tab-count'}>{option.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const [text, setText] = useState(value)

  useEffect(() => setText(value), [value])

  // Searches once typing pauses, not on every key.
  useEffect(() => {
    if (text === value) return
    const timer = window.setTimeout(() => onChange(text.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [text, value, onChange])

  return (
    <input
      className="input search"
      type="search"
      value={text}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(event) => setText(event.target.value)}
    />
  )
}

export function Pagination({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number
  limit: number
  offset: number
  onChange: (offset: number) => void
}) {
  if (total <= limit) return null

  const first = offset + 1
  const last = Math.min(offset + limit, total)

  return (
    <div className="pagination">
      <span>
        {first}–{last} of {total}
      </span>
      <button className="btn btn-small" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        Previous
      </button>
      <button className="btn btn-small" disabled={last >= total} onClick={() => onChange(offset + limit)}>
        Next
      </button>
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
  to,
  tone,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  to?: string
  tone?: 'warning' | 'danger'
}) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </>
  )

  const className = `stat${tone ? ` stat-${tone}` : ''}${to ? ' stat-link' : ''}`

  return to ? (
    <Link className={className} to={to}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

export function Details({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="details">
      {rows.map(([term, value], index) => (
        <div key={index} className="details-row">
          <dt>{term}</dt>
          <dd>{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className={error ? 'field has-error' : 'field'}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
    return () => element?.close()
  }, [])

  return (
    <dialog
      ref={dialog}
      className={wide ? 'modal wide' : 'modal'}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  )
}

// A confirmation for anything that changes what customers or partners see.
// When `reasonLabel` is given a reason must be typed, and it is kept in the
// activity log.
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  reasonLabel,
  reasonHint,
  onConfirm,
  onClose,
}: {
  title: string
  body: ReactNode
  confirmLabel: string
  danger?: boolean
  reasonLabel?: string
  reasonHint?: string
  onConfirm: (reason: string) => Promise<void>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const needsReason = !!reasonLabel

  async function confirm() {
    if (needsReason && reason.trim().length < 3) {
      setError('Write a short reason')
      return
    }

    setBusy(true)
    setError('')

    try {
      await onConfirm(reason.trim())
      onClose()
    } catch (caught: any) {
      setError(caught?.message || 'That did not work. Try again')
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Go back
          </button>
          <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={confirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-body">{body}</div>
      {needsReason && (
        <Field label={reasonLabel!} hint={reasonHint}>
          {(id) => (
            <textarea
              id={id}
              className="input"
              rows={3}
              maxLength={300}
              value={reason}
              autoFocus
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      )}
      {error && <ErrorBox error={error} />}
    </Modal>
  )
}

export function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={ok ? 'check ok' : 'check'}>
      <span className="check-mark" aria-hidden="true">
        {ok ? '✓' : '○'}
      </span>
      <span>{children}</span>
      <span className="sr-only">{ok ? '(done)' : '(not done)'}</span>
    </li>
  )
}
