import { Feather } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
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

import { useAuth } from '@/lib/AuthContext'
import { API_BASE_URL } from '@/lib/apiClient'
import { fetchPartner, updatePartner, type Partner, type VehicleType } from '@/lib/delivery'
import { colors, radius, shadow, space, type } from '@/theme'

const VEHICLES: { key: VehicleType; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'bike', label: 'Bike', icon: 'navigation-2' },
  { key: 'scooter', label: 'Scooter', icon: 'navigation-2' },
  { key: 'ev', label: 'Electric', icon: 'zap' },
  { key: 'bicycle', label: 'Bicycle', icon: 'disc' },
]

const STATUS_TEXT: Record<Partner['status'], { label: string; tone: string; soft: string }> = {
  active: { label: 'Approved', tone: colors.brandInk, soft: colors.brandSoft },
  pending: { label: 'Under review', tone: colors.warning, soft: colors.warningSoft },
  suspended: { label: 'Suspended', tone: colors.danger, soft: colors.dangerSoft },
  rejected: { label: 'Not approved', tone: colors.danger, soft: colors.dangerSoft },
}

export default function ProfileScreen() {
  const { signOut } = useAuth()

  const [partner, setPartner] = useState<Partner | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const [name, setName] = useState('')
  const [vehicleType, setVehicleType] = useState<VehicleType>('bike')
  const [vehicleNumber, setVehicleNumber] = useState('')
  const [city, setCity] = useState('')

  const load = useCallback(async () => {
    try {
      const me = await fetchPartner()

      setPartner(me)
      setName(me.name ?? '')
      setVehicleType(me.vehicleType)
      setVehicleNumber(me.vehicleNumber ?? '')
      setCity(me.city ?? '')
      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load your profile')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const changed =
    !!partner &&
    (name.trim() !== (partner.name ?? '') ||
      vehicleType !== partner.vehicleType ||
      vehicleNumber.trim().toUpperCase() !== (partner.vehicleNumber ?? '') ||
      city.trim() !== (partner.city ?? ''))

  async function save() {
    if (!changed || saving) return

    setSaving(true)
    setError('')
    setSaved(false)

    try {
      setPartner(
        await updatePartner({
          ...(name.trim() ? { fullName: name.trim() } : {}),
          vehicleType,
          vehicleNumber: vehicleNumber.trim().toUpperCase(),
          city: city.trim(),
        }),
      )
      setSaved(true)
    } catch (saveError: any) {
      setError(saveError.message || 'Could not save your details')
    } finally {
      setSaving(false)
    }
  }

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You will stop receiving orders until you sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ])
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    )
  }

  const status = partner ? STATUS_TEXT[partner.status] : null

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>Profile</Text>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Feather name="user" size={24} color={colors.brand} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.name}>{partner?.name || 'Delivery partner'}</Text>
              <Text style={styles.phone}>{partner?.phone}</Text>
              {partner?.ratingCount ? (
                <Text style={styles.rating}>
                  ★ {partner.rating.toFixed(1)} ({partner.ratingCount} ratings)
                </Text>
              ) : null}
            </View>
            {status ? (
              <View style={[styles.statusPill, { backgroundColor: status.soft }]}>
                <Text style={[styles.statusText, { color: status.tone }]}>{status.label}</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.label}>Your name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="As on your driving licence"
            placeholderTextColor={colors.muted}
          />

          <Text style={styles.label}>Vehicle</Text>
          <View style={styles.vehicles}>
            {VEHICLES.map(vehicle => {
              const active = vehicle.key === vehicleType

              return (
                <Pressable
                  key={vehicle.key}
                  style={[styles.vehicle, active && styles.vehicleActive]}
                  onPress={() => setVehicleType(vehicle.key)}
                >
                  <Feather name={vehicle.icon} size={16} color={active ? '#fff' : colors.body} />
                  <Text style={[styles.vehicleText, active && styles.vehicleTextActive]}>{vehicle.label}</Text>
                </Pressable>
              )
            })}
          </View>

          <Text style={styles.label}>Vehicle number</Text>
          <TextInput
            style={styles.input}
            value={vehicleNumber}
            onChangeText={setVehicleNumber}
            placeholder="TN 09 AB 1234"
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
            maxLength={20}
          />
          <Text style={styles.hint}>Customers see this so they know which rider to look for.</Text>

          <Text style={styles.label}>City</Text>
          <TextInput
            style={styles.input}
            value={city}
            onChangeText={setCity}
            placeholder="Chennai"
            placeholderTextColor={colors.muted}
          />
          <Text style={styles.hint}>You only get orders from restaurants in this city.</Text>

          {saved && !changed ? <Text style={styles.saved}>Saved</Text> : null}

          <Pressable style={[styles.primary, (!changed || saving) && styles.dim]} onPress={save} disabled={!changed || saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save changes</Text>}
          </Pressable>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Connected to</Text>
            <Text style={styles.cardValue}>{API_BASE_URL}</Text>
          </View>

          <Pressable style={styles.signOut} onPress={confirmSignOut}>
            <Feather name="log-out" size={16} color={colors.danger} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.5 },

  header: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  heading: { ...type.title, color: colors.ink },

  content: { padding: space.lg, paddingBottom: space.xxxl },

  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  name: { ...type.heading, color: colors.ink },
  phone: { ...type.small, color: colors.muted, marginTop: 2 },
  rating: { ...type.caption, color: colors.star, marginTop: 2 },
  statusPill: { paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill },
  statusText: { ...type.caption, fontWeight: '700' },

  label: { ...type.overline, color: colors.muted, marginTop: space.lg, marginBottom: space.sm },
  hint: { ...type.caption, color: colors.muted, marginTop: space.xs },
  input: {
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...type.body,
    color: colors.ink,
  },

  vehicles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  vehicle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  vehicleActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  vehicleText: { ...type.smallStrong, color: colors.body },
  vehicleTextActive: { color: '#fff' },

  saved: { ...type.smallStrong, color: colors.brand, marginTop: space.lg, textAlign: 'center' },
  primary: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginTop: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  primaryText: { ...type.bodyStrong, color: '#fff' },

  card: {
    marginTop: space.xl,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  cardLabel: { ...type.overline, color: colors.muted },
  cardValue: { ...type.small, color: colors.ink, marginTop: space.xs },

  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.lg,
    paddingVertical: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  signOutText: { ...type.bodyStrong, color: colors.danger },

  error: {
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
