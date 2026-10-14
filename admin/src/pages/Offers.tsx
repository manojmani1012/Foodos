import { useState, type FormEvent } from 'react'
import { Badge, Card, Empty, ErrorBox, Field, Loadable, Modal, PageHeader } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDate, formatMoney } from '../lib/format'
import { useToast } from '../lib/toast'
import type { Offer, RestaurantRow } from '../lib/types'
import { useLoad } from '../lib/useLoad'

const STATE: Record<Offer['state'], { label: string; tone: 'success' | 'neutral' | 'info' | 'warning' }> = {
  live: { label: 'Live', tone: 'success' },
  paused: { label: 'Paused', tone: 'neutral' },
  scheduled: { label: 'Starts later', tone: 'info' },
  expired: { label: 'Ended', tone: 'neutral' },
  used_up: { label: 'Fully used', tone: 'warning' },
}

export function describeOffer(offer: Pick<Offer, 'type' | 'percentOff' | 'flatOffPaise' | 'maxDiscountPaise' | 'minOrderPaise'>) {
  const value =
    offer.type === 'percent'
      ? `${offer.percentOff}% off${offer.maxDiscountPaise ? ` up to ${formatMoney(offer.maxDiscountPaise)}` : ''}`
      : offer.type === 'flat'
        ? `${formatMoney(offer.flatOffPaise)} off`
        : 'Free delivery'

  return offer.minOrderPaise ? `${value} on orders above ${formatMoney(offer.minOrderPaise)}` : value
}

// A datetime-local input wants "2026-10-14T09:30" in local time; the panel
// treats every date as India time.
function toInput(iso: string | null) {
  if (!iso) return ''
  const india = new Date(new Date(iso).getTime() + 5.5 * 3_600_000)
  return india.toISOString().slice(0, 16)
}

function fromInput(value: string) {
  return value ? `${value}:00+05:30` : null
}

type Form = {
  name: string
  code: string
  type: Offer['type']
  percentOff: string
  flatOff: string
  maxDiscount: string
  minOrder: string
  firstOrderOnly: boolean
  restaurantId: string
  usageLimit: string
  perUserLimit: string
  validFrom: string
  validUntil: string
}

function toForm(offer: Offer | null): Form {
  return {
    name: offer?.name || '',
    code: offer?.code || '',
    type: offer?.type || 'percent',
    percentOff: offer?.percentOff ? String(offer.percentOff) : '',
    flatOff: offer?.flatOffPaise ? String(offer.flatOffPaise / 100) : '',
    maxDiscount: offer?.maxDiscountPaise ? String(offer.maxDiscountPaise / 100) : '',
    minOrder: offer?.minOrderPaise ? String(offer.minOrderPaise / 100) : '',
    firstOrderOnly: offer?.firstOrderOnly || false,
    restaurantId: offer?.restaurant?.id || '',
    usageLimit: offer?.usageLimit ? String(offer.usageLimit) : '',
    perUserLimit: String(offer?.perUserLimit ?? 1),
    validFrom: offer ? toInput(offer.validFrom) : '',
    validUntil: toInput(offer?.validUntil ?? null),
  }
}

const rupeesToPaise = (value: string) => (value.trim() ? Math.round(Number(value) * 100) : null)

function OfferDialog({
  offer,
  restaurants,
  onSaved,
  onClose,
}: {
  offer: Offer | null
  restaurants: RestaurantRow[]
  onSaved: (offer: Offer) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<Form>(toForm(offer))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }))

  async function save(event?: FormEvent) {
    event?.preventDefault()
    setBusy(true)
    setError('')
    setFields({})

    const body = {
      name: form.name.trim(),
      code: form.code.trim(),
      type: form.type,
      percentOff: form.type === 'percent' && form.percentOff ? Number(form.percentOff) : null,
      flatOffPaise: form.type === 'flat' ? rupeesToPaise(form.flatOff) : null,
      maxDiscountPaise: form.type === 'percent' ? rupeesToPaise(form.maxDiscount) : null,
      minOrderPaise: rupeesToPaise(form.minOrder) ?? 0,
      firstOrderOnly: form.firstOrderOnly,
      restaurantId: form.restaurantId || null,
      usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
      perUserLimit: Number(form.perUserLimit) || 1,
      ...(form.validFrom ? { validFrom: fromInput(form.validFrom) } : {}),
      validUntil: fromInput(form.validUntil),
    }

    try {
      const { offer: saved } = await api<{ offer: Offer }>(offer ? `/api/v1/admin/offers/${offer.id}` : '/api/v1/admin/offers', {
        method: offer ? 'PATCH' : 'POST',
        body,
      })
      onSaved(saved)
      onClose()
    } catch (caught: any) {
      setBusy(false)
      setError(caught?.message || 'Could not save')
      if (caught instanceof ApiError) setFields(caught.fields)
    }
  }

  const preview = describeOffer({
    type: form.type,
    percentOff: Number(form.percentOff) || 0,
    flatOffPaise: rupeesToPaise(form.flatOff),
    maxDiscountPaise: rupeesToPaise(form.maxDiscount),
    minOrderPaise: rupeesToPaise(form.minOrder) ?? 0,
  })

  return (
    <Modal
      title={offer ? `Edit ${offer.code}` : 'New offer'}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => save()} disabled={busy}>
            {busy ? 'Saving…' : offer ? 'Save changes' : 'Create offer'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={save}>
        <div className="form-grid two">
          <Field label="Name" hint="Shown to customers, e.g. Weekend Feast." error={fields.name}>
            {(id) => <input id={id} className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />}
          </Field>
          <Field label="Code" hint="What customers type. Letters and numbers only." error={fields.code}>
            {(id) => (
              <input id={id} className="input mono" value={form.code} maxLength={20} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s/g, ''))} />
            )}
          </Field>
        </div>

        <Field label="Discount">
          {(id) => (
            <select id={id} className="input" value={form.type} onChange={(e) => set('type', e.target.value as Form['type'])}>
              <option value="percent">Percentage off the food</option>
              <option value="flat">Fixed amount off</option>
              <option value="free_delivery">Free delivery</option>
            </select>
          )}
        </Field>

        <div className="form-grid two">
          {form.type === 'percent' && (
            <>
              <Field label="Percent off" error={fields.percentOff}>
                {(id) => <input id={id} className="input" type="number" min={1} max={100} value={form.percentOff} onChange={(e) => set('percentOff', e.target.value)} />}
              </Field>
              <Field label="Maximum discount (₹)" hint="Leave empty for no cap." error={fields.maxDiscountPaise}>
                {(id) => <input id={id} className="input" type="number" min={1} value={form.maxDiscount} onChange={(e) => set('maxDiscount', e.target.value)} />}
              </Field>
            </>
          )}
          {form.type === 'flat' && (
            <Field label="Amount off (₹)" error={fields.flatOffPaise}>
              {(id) => <input id={id} className="input" type="number" min={1} value={form.flatOff} onChange={(e) => set('flatOff', e.target.value)} />}
            </Field>
          )}
          <Field label="Minimum food value (₹)" hint="Leave empty for any order." error={fields.minOrderPaise}>
            {(id) => <input id={id} className="input" type="number" min={0} value={form.minOrder} onChange={(e) => set('minOrder', e.target.value)} />}
          </Field>
        </div>

        <p className="preview">Customers see: <strong>{preview}</strong></p>

        <div className="form-grid two">
          <Field label="Restaurant" hint="Leave as all for a platform-wide offer." error={fields.restaurantId}>
            {(id) => (
              <select id={id} className="input" value={form.restaurantId} onChange={(e) => set('restaurantId', e.target.value)}>
                <option value="">All restaurants</option>
                {restaurants.map((restaurant) => (
                  <option key={restaurant.id} value={restaurant.id}>
                    {restaurant.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <label className="checkbox">
            <input type="checkbox" checked={form.firstOrderOnly} onChange={(e) => set('firstOrderOnly', e.target.checked)} />
            Only on a customer's first order
          </label>
          <Field label="Uses per customer" error={fields.perUserLimit}>
            {(id) => <input id={id} className="input" type="number" min={1} max={100} value={form.perUserLimit} onChange={(e) => set('perUserLimit', e.target.value)} />}
          </Field>
          <Field label="Total uses" hint="Leave empty for unlimited." error={fields.usageLimit}>
            {(id) => <input id={id} className="input" type="number" min={1} value={form.usageLimit} onChange={(e) => set('usageLimit', e.target.value)} />}
          </Field>
          <Field label="Starts (India time)" hint="Leave empty to start now." error={fields.validFrom}>
            {(id) => <input id={id} className="input" type="datetime-local" value={form.validFrom} onChange={(e) => set('validFrom', e.target.value)} />}
          </Field>
          <Field label="Ends (India time)" hint="Leave empty to run until paused." error={fields.validUntil}>
            {(id) => <input id={id} className="input" type="datetime-local" value={form.validUntil} onChange={(e) => set('validUntil', e.target.value)} />}
          </Field>
        </div>

        <p className="muted small">The discount comes out of Foodos's share; the restaurant is paid in full for the food.</p>

        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  )
}

export default function Offers() {
  const toast = useToast()
  const [editing, setEditing] = useState<Offer | null | 'new'>(null)
  const state = useLoad(async () => (await api<{ offers: Offer[] }>('/api/v1/admin/offers')).offers, 'offers')
  const restaurants = useLoad(
    async () =>
      (await api<{ restaurants: RestaurantRow[] }>('/api/v1/admin/restaurants', { query: { status: 'active', limit: 100 } }))
        .restaurants,
    'offer-restaurants'
  )

  async function setActive(offer: Offer, isActive: boolean) {
    try {
      await api(`/api/v1/admin/offers/${offer.id}`, { method: 'PATCH', body: { isActive } })
      toast(isActive ? `${offer.code} is back on` : `${offer.code} paused. Customers can no longer use it`)
      state.reload()
    } catch (caught: any) {
      toast(caught?.message || 'Could not change the offer', 'error')
    }
  }

  return (
    <>
      <PageHeader
        title="Offers"
        subtitle="Coupon codes customers apply in the cart. Live platform-wide offers also show on the app's home screen."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            New offer
          </button>
        }
      />

      <Card flush>
        <Loadable state={state}>
          {(offers) =>
            offers.length === 0 ? (
              <Empty title="No offers yet" body="Create a coupon code with the button above." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Offer</th>
                      <th>Discount</th>
                      <th>Where</th>
                      <th>Runs</th>
                      <th className="num">Used</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {offers.map((offer) => (
                      <tr key={offer.id}>
                        <td>
                          <span className="mono strong">{offer.code}</span>
                          <div className="sub">{offer.name}</div>
                        </td>
                        <td>
                          {describeOffer(offer)}
                          {offer.firstOrderOnly && <div className="sub">First order only</div>}
                        </td>
                        <td>{offer.restaurant ? offer.restaurant.name : 'All restaurants'}</td>
                        <td>
                          {formatDate(offer.validFrom)}
                          <div className="sub">{offer.validUntil ? `to ${formatDate(offer.validUntil)}` : 'No end date'}</div>
                        </td>
                        <td className="num">
                          {offer.redemptions}
                          {offer.usageLimit ? ` / ${offer.usageLimit}` : ''}
                          <div className="sub">{formatMoney(offer.discountGivenPaise, { whole: true })} given</div>
                        </td>
                        <td>
                          <Badge tone={STATE[offer.state].tone}>{STATE[offer.state].label}</Badge>
                        </td>
                        <td className="row-actions">
                          <button className="btn btn-small" onClick={() => setEditing(offer)}>
                            Edit
                          </button>
                          {offer.isActive ? (
                            <button className="btn btn-small" onClick={() => setActive(offer, false)}>
                              Pause
                            </button>
                          ) : (
                            <button className="btn btn-small" onClick={() => setActive(offer, true)}>
                              Resume
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loadable>
      </Card>

      {editing && (
        <OfferDialog
          offer={editing === 'new' ? null : editing}
          restaurants={restaurants.data || []}
          onSaved={(saved) => {
            toast(editing === 'new' ? `${saved.code} created` : `${saved.code} saved`)
            state.reload()
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
