import { Feather } from '@expo/vector-icons'
import * as Location from 'expo-location'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { PinPicker, type PinPickerHandle } from '@/components/PinPicker'
import type { Point } from '@/lib/catalogue'
import { useLocation } from '@/lib/LocationContext'
import { addAddress, formatAddress, hasPin, updateAddress, type Address } from '@/lib/orders'
import { colors, radius, shadow, space, type } from '@/theme'

import { Header } from './cart'

const LABELS = ['Home', 'Work', 'Other']

// Where the map opens when the phone's location is not available.
const CHENNAI: Point = { latitude: 13.0827, longitude: 80.2707 }

// Street names come from the phone's own geocoder: free and on the device.
// Browsers have none, so the website asks the customer to type the area.
const CAN_GEOCODE = Platform.OS !== 'web'

type Place = { area: string; city: string; pincode: string }

type Draft = {
  label: string
  line1: string
  line2: string
  landmark: string
  city: string
  pincode: string
}

const EMPTY: Draft = { label: 'Home', line1: '', line2: '', landmark: '', city: '', pincode: '' }

async function describe(point: Point): Promise<Place | null> {
  if (!CAN_GEOCODE) return null

  try {
    const [found] = await Location.reverseGeocodeAsync(point)

    if (!found) return null

    return {
      area: [found.street, found.district].filter(Boolean).join(', ') || found.name || found.subregion || '',
      city: found.city || found.subregion || found.region || '',
      pincode: found.postalCode || '',
    }
  } catch {
    return null
  }
}

// Saving an address is three steps, like Swiggy and Zomato: choose the
// address (or add one), put the pin on the door on a map, then the details
// the rider needs at the door. The pin is required: it is what the rider
// navigates to, and what decides which restaurants deliver.
export default function LocationScreen() {
  const router = useRouter()
  const location = useLocation()
  const insets = useSafeAreaInsets()
  // "Pin needed" from the home screen opens straight on the map for that address.
  const { pin: pinId } = useLocalSearchParams<{ pin?: string }>()

  const [mode, setMode] = useState<'list' | 'map' | 'details'>('list')
  const [editing, setEditing] = useState<Address | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [point, setPoint] = useState<Point | null>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [describing, setDescribing] = useState(false)
  const [start, setStart] = useState<Point>(CHENNAI)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const map = useRef<PinPickerHandle>(null)
  const describeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!pinId) return

    const address = location.addresses.find(a => a.id === pinId)

    if (address) openMap(address)
    // Only when the screen opens with an address to pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinId, location.addresses.length])

  async function currentPosition(): Promise<Point | null> {
    try {
      const permission = await Location.requestForegroundPermissionsAsync()

      if (permission.status !== 'granted') return null

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })

      return { latitude: position.coords.latitude, longitude: position.coords.longitude }
    } catch {
      return null
    }
  }

  function openMap(address: Address | null) {
    setEditing(address)
    setDraft(
      address
        ? {
            label: address.label,
            line1: address.line1,
            line2: address.line2 || '',
            landmark: address.landmark || '',
            city: address.city,
            pincode: address.pincode || '',
          }
        : EMPTY,
    )
    setPoint(null)
    setPlace(null)
    setError('')
    setQuery('')

    // Start near something familiar, then jump to where the phone is.
    const pinned = location.addresses.find(hasPin)
    setStart(pinned ? { latitude: pinned.latitude!, longitude: pinned.longitude! } : CHENNAI)
    setMode('map')
    goToMyLocation()
  }

  async function goToMyLocation() {
    setLocating(true)
    const here = await currentPosition()
    setLocating(false)

    if (here) {
      map.current?.moveTo(here)
    } else {
      setError('Allow location access, or move the map to your address')
    }
  }

  function onMove(next: Point) {
    setPoint(next)
    setError('')

    // Looked up once the map settles, not for every frame of a drag.
    if (describeTimer.current) clearTimeout(describeTimer.current)

    if (!CAN_GEOCODE) return

    setDescribing(true)
    describeTimer.current = setTimeout(async () => {
      setPlace(await describe(next))
      setDescribing(false)
    }, 500)
  }

  async function search() {
    const text = query.trim()

    if (!text) return

    setSearching(true)
    setError('')

    try {
      const [found] = await Location.geocodeAsync(`${text}, India`)

      if (found) {
        map.current?.moveTo({ latitude: found.latitude, longitude: found.longitude })
      } else {
        setError(`Could not find "${text}". Try a nearby landmark or move the map`)
      }
    } catch {
      setError(`Could not find "${text}". Try a nearby landmark or move the map`)
    } finally {
      setSearching(false)
    }
  }

  function confirmPin() {
    if (!point) return

    // What the map found fills the blanks; anything typed before stays.
    setDraft(current => ({
      ...current,
      line2: current.line2 || place?.area || '',
      city: current.city || place?.city || '',
      pincode: current.pincode || place?.pincode || '',
    }))
    setMode('details')
  }

  async function save() {
    if (!point) {
      setMode('map')
      return
    }

    if (draft.line1.trim().length < 2) {
      setError('Enter your house, flat or floor number')
      return
    }

    if (draft.line2.trim().length < 2) {
      setError('Enter the street or area')
      return
    }

    if (draft.city.trim().length < 2) {
      setError('Enter the city')
      return
    }

    setSaving(true)
    setError('')

    const body = {
      label: draft.label,
      line1: draft.line1.trim(),
      line2: draft.line2.trim(),
      landmark: draft.landmark.trim() || null,
      city: draft.city.trim(),
      pincode: draft.pincode || null,
      latitude: point.latitude,
      longitude: point.longitude,
    }

    try {
      const saved = editing ? await updateAddress(editing.id, body) : await addAddress(body)

      await location.reload()
      location.select(saved)
      setMode('list')
      setEditing(null)

      // Came here to pin one address for the home screen: go straight back.
      if (pinId) router.back()
    } catch (saveError: any) {
      setError(saveError.message || 'Could not save that address')
    } finally {
      setSaving(false)
    }
  }

  if (mode === 'map') {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => setMode('list')} title={editing ? `Pin ${editing.label}` : 'Choose delivery location'} />

        {CAN_GEOCODE ? (
          <View style={styles.searchRow}>
            <Feather name="search" size={16} color={colors.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search for an area, street or landmark"
              placeholderTextColor={colors.faint}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={search}
              returnKeyType="search"
            />
            {searching ? <ActivityIndicator color={colors.brand} size="small" /> : null}
          </View>
        ) : null}

        <View style={styles.flex}>
          <PinPicker ref={map} initial={start} onMove={onMove} onMoving={() => setDescribing(CAN_GEOCODE)} />

          <Pressable style={styles.locateButton} onPress={goToMyLocation} disabled={locating}>
            {locating ? (
              <ActivityIndicator color={colors.brand} size="small" />
            ) : (
              <Feather name="crosshair" size={15} color={colors.brand} />
            )}
            <Text style={styles.locateText}>Use my current location</Text>
          </Pressable>
        </View>

        <View style={[styles.sheet, { paddingBottom: space.lg + insets.bottom }]}>
          <Text style={styles.sheetLabel}>Delivering to</Text>
          {CAN_GEOCODE ? (
            describing || !point ? (
              <Text style={styles.sheetArea}>Finding the address…</Text>
            ) : (
              <Text style={styles.sheetArea} numberOfLines={2}>
                {place ? [place.area, place.city].filter(Boolean).join(', ') : 'Pinned on the map'}
              </Text>
            )
          ) : (
            <Text style={styles.sheetArea}>Move the map until the pin is on your door</Text>
          )}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable style={[styles.saveButton, !point && styles.disabled]} onPress={confirmPin} disabled={!point}>
            <Text style={styles.saveButtonText}>Confirm location</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  if (mode === 'details') {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header onBack={() => setMode('map')} title="Address details" />

        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Pressable style={styles.pinned} onPress={() => setMode('map')}>
              <Feather name="map-pin" size={16} color={colors.brand} />
              <Text style={styles.pinnedText} numberOfLines={2}>
                {place ? [place.area, place.city].filter(Boolean).join(', ') : 'Pinned on the map'}
              </Text>
              <Text style={styles.pinChange}>Change</Text>
            </Pressable>

            <View style={styles.form}>
              <Field
                label="House / flat / floor *"
                value={draft.line1}
                onChangeText={text => setDraft({ ...draft, line1: text })}
                placeholder="Flat 4B, Lakshmi Apartments"
                autoFocus
              />
              <Field
                label="Street / area *"
                value={draft.line2}
                onChangeText={text => setDraft({ ...draft, line2: text })}
                placeholder="Lake View Road, Anna Nagar"
              />
              <Field
                label="Landmark (optional)"
                value={draft.landmark}
                onChangeText={text => setDraft({ ...draft, landmark: text })}
                placeholder="Opposite the temple"
              />
              <View style={styles.twoFields}>
                <View style={styles.flex}>
                  <Field
                    label="City *"
                    value={draft.city}
                    onChangeText={text => setDraft({ ...draft, city: text })}
                    placeholder="Chennai"
                  />
                </View>
                <View style={styles.flex}>
                  <Field
                    label="Pincode"
                    value={draft.pincode}
                    onChangeText={text => setDraft({ ...draft, pincode: text.replace(/\D/g, '') })}
                    placeholder="600040"
                    keyboardType="number-pad"
                    maxLength={6}
                  />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Save as</Text>
              <View style={styles.labelRow}>
                {LABELS.map(label => (
                  <Pressable
                    key={label}
                    style={[styles.labelChip, draft.label === label && styles.labelChipActive]}
                    onPress={() => setDraft({ ...draft, label })}
                  >
                    <Text style={[styles.labelChipText, draft.label === label && styles.labelChipTextActive]}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Pressable style={[styles.saveButton, saving && styles.disabled]} onPress={save} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color={colors.surface} size="small" />
                ) : (
                  <Text style={styles.saveButtonText}>Save address</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header onBack={() => router.back()} title="Delivery address" />

      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.addButton} onPress={() => openMap(null)}>
          <Feather name="plus" size={17} color={colors.brand} />
          <Text style={styles.addButtonText}>Add a new address</Text>
        </Pressable>

        {location.loading && location.addresses.length === 0 ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: space.xxl }} />
        ) : (
          location.addresses.map(address => {
            const selected = location.selected?.id === address.id
            const pinned = hasPin(address)

            return (
              <Pressable
                key={address.id}
                style={[styles.addressCard, selected && styles.addressCardSelected]}
                onPress={() => {
                  // An address with no pin cannot be ordered to; pin it first.
                  if (!pinned) {
                    openMap(address)
                    return
                  }

                  location.select(address)
                  router.back()
                }}
              >
                <View style={styles.addressIcon}>
                  <Feather
                    name={address.label.toLowerCase() === 'work' ? 'briefcase' : 'home'}
                    size={17}
                    color={selected ? colors.brand : colors.muted}
                  />
                </View>

                <View style={styles.flex}>
                  <View style={styles.addressTitleRow}>
                    <Text style={styles.addressLabel}>{address.label}</Text>
                    {address.isDefault && (
                      <View style={styles.defaultPill}>
                        <Text style={styles.defaultPillText}>Default</Text>
                      </View>
                    )}
                    {!pinned && (
                      <View style={styles.needsPinPill}>
                        <Text style={styles.needsPinText}>Pin needed</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.addressText}>{formatAddress(address)}</Text>
                  {!pinned ? (
                    <Text style={styles.needsPinHint}>Tap to put this address on the map before ordering</Text>
                  ) : null}
                </View>

                {selected && pinned && <Feather name="check-circle" size={20} color={colors.brand} />}
              </Pressable>
            )
          })
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.faint} {...props} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxxl },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
  },
  searchInput: { flex: 1, ...type.body, color: colors.ink, padding: 0 },

  locateButton: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.brand,
    ...shadow.card,
  },
  locateText: { ...type.smallStrong, color: colors.brand },

  sheet: {
    padding: space.lg,
    gap: space.sm,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    ...shadow.bar,
  },
  sheetLabel: { ...type.overline, color: colors.muted },
  sheetArea: { ...type.heading, color: colors.ink },

  pinned: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  pinnedText: { ...type.smallStrong, color: colors.brandInk, flex: 1 },
  pinChange: { ...type.smallStrong, color: colors.brand },

  addressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.card,
  },
  addressCardSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  addressIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  addressLabel: { ...type.bodyStrong, color: colors.ink },
  defaultPill: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  defaultPillText: { ...type.caption, color: colors.surface, fontSize: 10, fontWeight: '700' },
  needsPinPill: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.warningSoft,
  },
  needsPinText: { ...type.caption, color: colors.warning, fontSize: 10, fontWeight: '700' },
  needsPinHint: { ...type.caption, color: colors.warning, marginTop: 2 },
  addressText: { ...type.small, color: colors.muted, marginTop: 2 },

  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.brand,
    backgroundColor: colors.surface,
  },
  addButtonText: { ...type.bodyStrong, color: colors.brand },

  form: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  twoFields: { flexDirection: 'row', gap: space.md },
  labelRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.lg },
  labelChip: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  labelChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  labelChipText: { ...type.smallStrong, color: colors.body },
  labelChipTextActive: { color: colors.surface },

  field: { marginBottom: space.md },
  fieldLabel: { ...type.caption, color: colors.muted, marginBottom: space.xs },
  input: {
    height: 48,
    paddingHorizontal: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    ...type.body,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  errorText: { ...type.small, color: colors.danger },
  saveButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    minHeight: 50,
  },
  saveButtonText: { ...type.bodyStrong, color: colors.surface },
  disabled: { opacity: 0.6 },
})
