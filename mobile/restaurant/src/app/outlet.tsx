import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
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

import { ScreenHeader } from '@/components/ScreenHeader'
import { fetchRestaurant, shortTime, updateOutlet, type OutletChanges } from '@/lib/restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

const PREP_CHOICES = [10, 15, 20, 25, 30, 40, 45, 60]
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

// Accepts "9:30", "0930" or "09:30" and returns "09:30", or null if it is not a time.
function normaliseTime(text: string): string | null {
  const digits = text.replace(/\D/g, '')

  if (digits.length < 3 || digits.length > 4) return null

  const padded = digits.padStart(4, '0')
  const value = `${padded.slice(0, 2)}:${padded.slice(2)}`

  return TIME.test(value) ? value : null
}

export default function OutletScreen() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [opensAt, setOpensAt] = useState('')
  const [closesAt, setClosesAt] = useState('')
  const [prep, setPrep] = useState(30)
  const [phone, setPhone] = useState('')
  const [description, setDescription] = useState('')

  // What was loaded, so only real changes are sent.
  const [original, setOriginal] = useState<OutletChanges>({})

  useEffect(() => {
    fetchRestaurant()
      .then(restaurant => {
        const loaded = {
          opensAt: shortTime(restaurant.opensAt),
          closesAt: shortTime(restaurant.closesAt),
          avgPrepMinutes: restaurant.avgPrepMinutes,
          phone: restaurant.phone ?? '',
          description: restaurant.description ?? '',
        }

        setOpensAt(loaded.opensAt)
        setClosesAt(loaded.closesAt)
        setPrep(loaded.avgPrepMinutes)
        setPhone(loaded.phone)
        setDescription(loaded.description)
        setOriginal(loaded)
      })
      .catch(loadError => setError(loadError.message || 'Could not load your outlet'))
      .finally(() => setLoading(false))
  }, [])

  const opens = opensAt.trim() ? normaliseTime(opensAt) : ''
  const closes = closesAt.trim() ? normaliseTime(closesAt) : ''
  // Either both times are set, or neither ("no fixed hours").
  const hoursValid = opens !== null && closes !== null && !!opens === !!closes

  async function save() {
    if (!hoursValid || saving) return

    const next: OutletChanges = {
      opensAt: opens || null,
      closesAt: closes || null,
      avgPrepMinutes: prep,
      phone: phone.trim() || null,
      description: description.trim() || null,
    }

    const changes: OutletChanges = {}

    for (const key of Object.keys(next) as (keyof OutletChanges)[]) {
      const before = original[key] === '' ? null : original[key]

      if (next[key] !== before) {
        ;(changes as any)[key] = next[key]
      }
    }

    if (Object.keys(changes).length === 0) {
      router.back()
      return
    }

    setSaving(true)
    setError('')

    try {
      await updateOutlet(changes)
      router.back()
    } catch (saveError: any) {
      setError(saveError.message || 'Could not save your changes')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title="Outlet settings" />
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title="Outlet settings" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.label}>Opening hours</Text>
          <View style={styles.hoursRow}>
            <View style={styles.flex}>
              <Text style={styles.subLabel}>Opens</Text>
              <TextInput
                style={[styles.input, opens === null && styles.inputInvalid]}
                placeholder="09:00"
                placeholderTextColor={colors.muted}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                value={opensAt}
                onChangeText={setOpensAt}
                onBlur={() => opens && setOpensAt(opens)}
              />
            </View>
            <View style={styles.flex}>
              <Text style={styles.subLabel}>Closes</Text>
              <TextInput
                style={[styles.input, closes === null && styles.inputInvalid]}
                placeholder="23:00"
                placeholderTextColor={colors.muted}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                value={closesAt}
                onChangeText={setClosesAt}
                onBlur={() => closes && setClosesAt(closes)}
              />
            </View>
          </View>
          <Text style={[styles.hint, !hoursValid && styles.hintError]}>
            {!hoursValid
              ? 'Use 24-hour times like 09:30 and 23:00, and set both or neither.'
              : 'Shown to customers on your page. They do not open or close you automatically: use the Accepting orders switch for that. Leave both empty for no fixed hours.'}
          </Text>

          <Text style={styles.label}>Average preparation time</Text>
          <View style={styles.chips}>
            {PREP_CHOICES.map(minutes => {
              const active = minutes === prep

              return (
                <Pressable
                  key={minutes}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setPrep(minutes)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{minutes} min</Text>
                </Pressable>
              )
            })}
          </View>
          <Text style={styles.hint}>
            Used to tell customers when to expect their food. Set it honestly: late food costs more
            ratings than a longer estimate.
          </Text>

          <Text style={styles.label}>Restaurant phone</Text>
          <TextInput
            style={styles.input}
            placeholder="044 2345 6789"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            maxLength={20}
            value={phone}
            onChangeText={setPhone}
          />
          <Text style={styles.hint}>Shown to customers and riders who need to reach you.</Text>

          <Text style={styles.label}>About your restaurant</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Hyderabadi dum biryani, slow-cooked in small batches since 1998."
            placeholderTextColor={colors.muted}
            maxLength={300}
            multiline
            value={description}
            onChangeText={setDescription}
          />
          <Text style={styles.hint}>{description.length}/300 · shown on your page</Text>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={[styles.primaryButton, (!hoursValid || saving) && styles.disabled]}
            onPress={save}
            disabled={!hoursValid || saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Save changes</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space.lg, paddingBottom: space.xxxl },

  label: { ...type.overline, color: colors.muted, marginTop: space.lg, marginBottom: space.sm },
  subLabel: { ...type.caption, color: colors.body, marginBottom: space.xs },
  hint: { ...type.caption, color: colors.muted, marginTop: space.sm, lineHeight: 16 },
  hintError: { color: colors.danger },

  hoursRow: { flexDirection: 'row', gap: space.md },
  input: {
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...type.body,
    color: colors.ink,
  },
  inputInvalid: { borderColor: colors.danger },
  textArea: { minHeight: 84, textAlignVertical: 'top' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { ...type.small, color: colors.body },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  footer: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    ...shadow.bar,
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  primaryButtonText: { ...type.bodyStrong, color: '#fff' },
  disabled: { opacity: 0.5 },

  error: {
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
