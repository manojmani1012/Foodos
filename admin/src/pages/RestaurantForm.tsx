import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import MapPicker from '../components/Map'
import { Card, ErrorBox, Field, PageHeader, Spinner } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { useToast } from '../lib/toast'
import type { PaymentSettings, Restaurant } from '../lib/types'

type Plan = 'standard' | 'subscription' | 'custom'

type Form = {
  ownerPhone: string
  ownerName: string
  name: string
  description: string
  cuisines: string
  addressLine: string
  city: string
  pincode: string
  phone: string
  isVeg: boolean
  fssaiNumber: string
  gstNumber: string
  commissionPlan: Plan
  commissionPct: string
  avgPrepMinutes: string
  deliveryRadiusKm: string
  location: { latitude: number; longitude: number } | null
}

const EMPTY: Form = {
  ownerPhone: '',
  ownerName: '',
  name: '',
  description: '',
  cuisines: '',
  addressLine: '',
  city: 'Chennai',
  pincode: '',
  phone: '',
  isVeg: false,
  fssaiNumber: '',
  gstNumber: '',
  commissionPlan: 'standard',
  commissionPct: '22',
  avgPrepMinutes: '30',
  deliveryRadiusKm: '',
  location: null,
}

function fromRestaurant(restaurant: Restaurant): Form {
  return {
    ownerPhone: restaurant.owner.phone,
    ownerName: restaurant.owner.name || '',
    name: restaurant.name,
    description: restaurant.description || '',
    cuisines: restaurant.cuisines.join(', '),
    addressLine: restaurant.addressLine,
    city: restaurant.city,
    pincode: restaurant.pincode || '',
    phone: restaurant.phone || '',
    isVeg: restaurant.isVeg,
    fssaiNumber: restaurant.fssaiNumber || '',
    gstNumber: restaurant.gstNumber || '',
    commissionPlan: restaurant.commissionPlan || 'custom',
    commissionPct: String(restaurant.commissionPct),
    avgPrepMinutes: String(restaurant.avgPrepMinutes),
    deliveryRadiusKm: restaurant.deliveryRadiusKm !== null ? String(restaurant.deliveryRadiusKm) : '',
    location:
      restaurant.latitude !== null && restaurant.longitude !== null
        ? { latitude: restaurant.latitude, longitude: restaurant.longitude }
        : null,
  }
}

export default function RestaurantForm() {
  const { id } = useParams()
  const editing = !!id
  const navigate = useNavigate()
  const toast = useToast()

  const [form, setForm] = useState<Form>(EMPTY)
  const [loading, setLoading] = useState(editing)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [rates, setRates] = useState<Pick<PaymentSettings, 'commissionStandardPct' | 'commissionSubscriptionPct'> | null>(null)

  // The plan rates come from Settings; only shown as a hint, so a failure is ignored.
  useEffect(() => {
    api<{ settings: PaymentSettings }>('/api/v1/admin/finance/settings')
      .then(({ settings }) => setRates(settings))
      .catch(() => setRates(null))
  }, [])

  useEffect(() => {
    if (!id) return
    api<{ restaurant: Restaurant }>(`/api/v1/admin/restaurants/${id}`)
      .then(({ restaurant }) => setForm(fromRestaurant(restaurant)))
      .catch((caught) => setLoadError(caught))
      .finally(() => setLoading(false))
  }, [id])

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => ({ ...current, [key]: '' }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setFieldErrors({})

    // Riders navigate to the pin, and it decides who the outlet delivers to.
    if (!form.location) {
      setFieldErrors({ latitude: 'Put the restaurant on the map: click its building, or paste its coordinates' })
      return
    }

    setSaving(true)

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      cuisines: form.cuisines.split(',').map((cuisine) => cuisine.trim()).filter(Boolean),
      addressLine: form.addressLine.trim(),
      city: form.city.trim(),
      pincode: form.pincode.trim() || null,
      phone: form.phone.trim() || null,
      isVeg: form.isVeg,
      fssaiNumber: form.fssaiNumber.trim() || null,
      gstNumber: form.gstNumber.trim() || null,
      commissionPlan: form.commissionPlan,
      avgPrepMinutes: Number(form.avgPrepMinutes),
      deliveryRadiusKm: form.deliveryRadiusKm.trim() ? Number(form.deliveryRadiusKm) : null,
      latitude: form.location.latitude,
      longitude: form.location.longitude,
      ownerName: form.ownerName.trim(),
    }

    // The plan rates follow Settings; a percentage is only sent for a custom rate.
    if (form.commissionPlan === 'custom') body.commissionPct = Number(form.commissionPct)
    if (!editing) body.ownerPhone = form.ownerPhone.trim()

    try {
      const { restaurant } = await api<{ restaurant: Restaurant }>(
        editing ? `/api/v1/admin/restaurants/${id}` : '/api/v1/admin/restaurants',
        { method: editing ? 'PATCH' : 'POST', body }
      )

      toast(editing ? 'Changes saved' : `${restaurant.name} added. It stays pending until you make it live`)
      navigate(`/restaurants/${restaurant.id}`)
    } catch (caught: any) {
      setSaving(false)

      if (caught instanceof ApiError && Object.keys(caught.fields).length) {
        const fields: Record<string, string> = {}
        for (const [key, message] of Object.entries(caught.fields)) {
          fields[key.split('.')[0]] = String(message).replace(/^Value error, /, '')
        }
        setFieldErrors(fields)
        setError(fields.body || 'Check the highlighted fields')
      } else {
        setError(caught?.message || 'Could not save')
      }
    }
  }

  if (loading) return <Spinner />
  if (loadError) return <ErrorBox error={loadError} />

  return (
    <>
      <PageHeader
        back={editing ? { to: `/restaurants/${id}`, label: form.name || 'Restaurant' } : { to: '/restaurants', label: 'Restaurants' }}
        title={editing ? `Edit ${form.name}` : 'Add a restaurant'}
        subtitle={
          editing
            ? undefined
            : 'The owner signs in to the Foodos Restaurant app with their phone number, adds the menu and photos, and you make it live when it is ready.'
        }
      />

      <form className="stack form-page" onSubmit={submit} noValidate>
        <Card title="Owner">
          <div className="form-grid">
            <Field
              label="Owner's mobile number"
              hint={editing ? 'The number cannot be changed here.' : 'They sign in to the Restaurant app with this number.'}
              error={fieldErrors.ownerPhone}
            >
              {(fieldId) => (
                <input
                  id={fieldId}
                  className="input"
                  inputMode="tel"
                  placeholder="98765 43210"
                  value={form.ownerPhone}
                  disabled={editing}
                  required
                  onChange={(e) => set('ownerPhone', e.target.value)}
                />
              )}
            </Field>
            <Field label="Owner's name" error={fieldErrors.ownerName}>
              {(fieldId) => (
                <input id={fieldId} className="input" value={form.ownerName} required onChange={(e) => set('ownerName', e.target.value)} />
              )}
            </Field>
          </div>
        </Card>

        <Card title="Restaurant">
          <div className="form-grid">
            <Field label="Name" hint="As customers will see it." error={fieldErrors.name}>
              {(fieldId) => <input id={fieldId} className="input" value={form.name} required onChange={(e) => set('name', e.target.value)} />}
            </Field>
            <Field label="Cuisines" hint="Separate with commas, e.g. Biryani, North Indian. Customers filter by these." error={fieldErrors.cuisines}>
              {(fieldId) => <input id={fieldId} className="input" value={form.cuisines} required onChange={(e) => set('cuisines', e.target.value)} />}
            </Field>
            <Field label="Short description" hint="Optional. The owner can change it in the app." error={fieldErrors.description}>
              {(fieldId) => (
                <textarea id={fieldId} className="input" rows={2} maxLength={300} value={form.description} onChange={(e) => set('description', e.target.value)} />
              )}
            </Field>
            <Field label="Restaurant phone" hint="Optional. Riders and Foodos call this one." error={fieldErrors.phone}>
              {(fieldId) => <input id={fieldId} className="input" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />}
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={form.isVeg} onChange={(e) => set('isVeg', e.target.checked)} />
              Pure veg restaurant (shows the Pure Veg badge)
            </label>
          </div>
        </Card>

        <Card title="Location">
          <div className="form-grid">
            <Field label="Street address" hint="Building, street and area." error={fieldErrors.addressLine}>
              {(fieldId) => <input id={fieldId} className="input" value={form.addressLine} required onChange={(e) => set('addressLine', e.target.value)} />}
            </Field>
            <div className="form-grid two">
              <Field label="City" hint="Shown to customers and used in reports." error={fieldErrors.city}>
                {(fieldId) => <input id={fieldId} className="input" value={form.city} required onChange={(e) => set('city', e.target.value)} />}
              </Field>
              <Field label="PIN code" error={fieldErrors.pincode}>
                {(fieldId) => <input id={fieldId} className="input" inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => set('pincode', e.target.value)} />}
              </Field>
            </div>
          </div>
          <p className="field-label">Map pin (required)</p>
          <p className="muted small">
            Riders navigate to this pin, nearby riders are offered its orders, and only customers within its delivery
            radius can order. Put it on the building's entrance.
          </p>
          {(fieldErrors.latitude || fieldErrors.longitude) && <p className="field-error">{fieldErrors.latitude || fieldErrors.longitude}</p>}
          <MapPicker value={form.location} onChange={(location) => set('location', location)} />
        </Card>

        <Card title="Licences and terms">
          <div className="form-grid two">
            <Field label="FSSAI licence number" hint="14 digits. Required by law before selling food online." error={fieldErrors.fssaiNumber}>
              {(fieldId) => <input id={fieldId} className="input" inputMode="numeric" maxLength={14} value={form.fssaiNumber} onChange={(e) => set('fssaiNumber', e.target.value)} />}
            </Field>
            <Field label="GSTIN" hint="Optional. 15 characters." error={fieldErrors.gstNumber}>
              {(fieldId) => <input id={fieldId} className="input" maxLength={15} value={form.gstNumber} onChange={(e) => set('gstNumber', e.target.value.toUpperCase())} />}
            </Field>
            <Field
              label="Commission plan"
              hint={
                form.commissionPlan === 'standard'
                  ? `Foodos takes ${rates ? `${rates.commissionStandardPct}%` : 'the standard rate'} of the food value, as set in Settings.`
                  : form.commissionPlan === 'subscription'
                    ? `Foodos takes ${rates ? `${rates.commissionSubscriptionPct}%` : 'the subscription rate'} of the food value, as set in Settings.`
                    : 'A rate agreed with this restaurant. It does not change when Settings change.'
              }
              error={fieldErrors.commissionPlan}
            >
              {(fieldId) => (
                <select id={fieldId} className="input" value={form.commissionPlan} onChange={(e) => set('commissionPlan', e.target.value as Plan)}>
                  <option value="standard">Standard{rates ? ` (${rates.commissionStandardPct}%)` : ''}</option>
                  <option value="subscription">Subscription{rates ? ` (${rates.commissionSubscriptionPct}%)` : ''}</option>
                  <option value="custom">Custom rate</option>
                </select>
              )}
            </Field>
            {form.commissionPlan === 'custom' && (
              <Field label="Commission (%)" hint="Foodos's share of the food value on each delivered order." error={fieldErrors.commissionPct}>
                {(fieldId) => (
                  <input id={fieldId} className="input" type="number" min={0} max={100} step={0.5} value={form.commissionPct} onChange={(e) => set('commissionPct', e.target.value)} />
                )}
              </Field>
            )}
            <Field label="Usual preparation time (minutes)" hint="Used for the delivery time customers see." error={fieldErrors.avgPrepMinutes}>
              {(fieldId) => (
                <input id={fieldId} className="input" type="number" min={5} max={120} value={form.avgPrepMinutes} onChange={(e) => set('avgPrepMinutes', e.target.value)} />
              )}
            </Field>
            <Field
              label="Delivery radius (km)"
              hint="Customers further than this from the pin cannot order. Leave blank for the Foodos default (7 km)."
              error={fieldErrors.deliveryRadiusKm}
            >
              {(fieldId) => (
                <input id={fieldId} className="input" type="number" min={1} max={30} step={0.5} placeholder="7" value={form.deliveryRadiusKm} onChange={(e) => set('deliveryRadiusKm', e.target.value)} />
              )}
            </Field>
          </div>
        </Card>

        {error && <ErrorBox error={error} />}

        <div className="form-actions">
          <button type="button" className="btn" onClick={() => navigate(-1)} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add restaurant'}
          </button>
        </div>
      </form>
    </>
  )
}
