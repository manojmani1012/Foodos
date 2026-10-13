import { Feather } from '@expo/vector-icons'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { useState } from 'react'
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
import { SafeAreaView } from 'react-native-safe-area-context'

import { useLocation } from '@/lib/LocationContext'
import { addAddress, formatAddress } from '@/lib/orders'
import { colors, radius, shadow, space, type } from '@/theme'

import { Header } from './cart'

const LABELS = ['Home', 'Work', 'Other']

export default function LocationScreen() {
  const router = useRouter()
  const location = useLocation()

  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({
    label: 'Home',
    line1: '',
    line2: '',
    city: 'Chennai',
    pincode: '',
  })
  // Pinned only when the customer asks: an office address added from home must
  // not send the rider to their home.
  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null)
  const [pinning, setPinning] = useState(false)

  async function pinCurrentLocation() {
    setPinning(true)
    setError('')

    try {
      const permission = await Location.requestForegroundPermissionsAsync()

      if (permission.status !== 'granted') {
        setError('Allow location access to pin this address, or save it without a pin')
        return
      }

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })

      setPin({ latitude: position.coords.latitude, longitude: position.coords.longitude })
    } catch {
      setError('Could not get your location. Try again outdoors, or save without a pin')
    } finally {
      setPinning(false)
    }
  }

  async function save() {
    if (!draft.line1.trim() || !draft.city.trim()) {
      setError('Enter the street and city')
      return
    }

    setSaving(true)
    setError('')

    try {
      const saved = await addAddress({
        ...draft,
        line2: draft.line2 || null,
        pincode: draft.pincode || null,
        latitude: pin?.latitude ?? null,
        longitude: pin?.longitude ?? null,
      })

      await location.reload()
      location.select(saved)
      setAdding(false)
      setDraft({ label: 'Home', line1: '', line2: '', city: 'Chennai', pincode: '' })
      setPin(null)
    } catch (saveError: any) {
      setError(saveError.message || 'Could not save that address')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} title="Delivery address" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {location.loading && location.addresses.length === 0 ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: space.xxl }} />
          ) : (
            location.addresses.map(address => {
              const selected = location.selected?.id === address.id

              return (
                <Pressable
                  key={address.id}
                  style={[styles.addressCard, selected && styles.addressCardSelected]}
                  onPress={() => {
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
                    </View>
                    <Text style={styles.addressText}>{formatAddress(address)}</Text>
                  </View>

                  {selected && <Feather name="check-circle" size={20} color={colors.brand} />}
                </Pressable>
              )
            })
          )}

          {adding ? (
            <View style={styles.form}>
              <Text style={styles.formTitle}>New address</Text>

              <View style={styles.labelRow}>
                {LABELS.map(label => (
                  <Pressable
                    key={label}
                    style={[styles.labelChip, draft.label === label && styles.labelChipActive]}
                    onPress={() => setDraft({ ...draft, label })}
                  >
                    <Text
                      style={[
                        styles.labelChipText,
                        draft.label === label && styles.labelChipTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Field
                label="House / flat / street"
                value={draft.line1}
                onChangeText={text => setDraft({ ...draft, line1: text })}
                placeholder="12, Lake View Road"
                autoFocus
              />
              <Field
                label="Area / landmark"
                value={draft.line2}
                onChangeText={text => setDraft({ ...draft, line2: text })}
                placeholder="Near Velachery MRTS"
              />
              <Field
                label="City"
                value={draft.city}
                onChangeText={text => setDraft({ ...draft, city: text })}
                placeholder="Chennai"
              />
              <Field
                label="Pincode"
                value={draft.pincode}
                onChangeText={text => setDraft({ ...draft, pincode: text.replace(/\D/g, '') })}
                placeholder="600042"
                keyboardType="number-pad"
                maxLength={6}
              />

              {pin ? (
                <View style={styles.pinned}>
                  <Feather name="map-pin" size={15} color={colors.brand} />
                  <Text style={styles.pinnedText}>Pinned to where you are now</Text>
                  <Pressable onPress={() => setPin(null)} hitSlop={8}>
                    <Text style={styles.pinClear}>Remove</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={[styles.pinButton, pinning && styles.disabled]}
                  onPress={pinCurrentLocation}
                  disabled={pinning}
                >
                  {pinning ? (
                    <ActivityIndicator color={colors.brand} size="small" />
                  ) : (
                    <Feather name="crosshair" size={15} color={colors.brand} />
                  )}
                  <Text style={styles.pinButtonText}>Use my current location</Text>
                </Pressable>
              )}
              <Text style={styles.pinHint}>
                Only if you are at this address now. It lets the delivery partner navigate straight to
                your door.
              </Text>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <View style={styles.formActions}>
                <Pressable
                  style={[styles.saveButton, saving && styles.disabled]}
                  onPress={save}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color={colors.surface} size="small" />
                  ) : (
                    <Text style={styles.saveButtonText}>Save address</Text>
                  )}
                </Pressable>
                <Pressable style={styles.cancelButton} onPress={() => setAdding(false)}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={styles.addButton} onPress={() => setAdding(true)}>
              <Feather name="plus" size={17} color={colors.brand} />
              <Text style={styles.addButtonText}>Add a new address</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Field({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.faint} {...props} />
    </View>
  )
}

const styles = StyleSheet.create({
  pinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.sm,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.brand,
    borderStyle: 'dashed',
  },
  pinButtonText: { ...type.smallStrong, color: colors.brand },
  pinned: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  pinnedText: { ...type.smallStrong, color: colors.brandInk, flex: 1 },
  pinClear: { ...type.smallStrong, color: colors.danger },
  pinHint: { ...type.caption, color: colors.muted, marginTop: space.xs, lineHeight: 16 },

  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxxl },

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
  formTitle: { ...type.overline, color: colors.muted, marginBottom: space.md },
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
  errorText: { ...type.small, color: colors.danger, marginBottom: space.sm },
  formActions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  saveButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  saveButtonText: { ...type.bodyStrong, color: colors.surface },
  cancelButton: {
    paddingHorizontal: space.xl,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  cancelButtonText: { ...type.smallStrong, color: colors.body },
  disabled: { opacity: 0.6 },
})
