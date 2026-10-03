import { Feather } from '@expo/vector-icons'
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

import { fetchProfile, updateProfile } from '@/lib/profile'
import { colors, radius, shadow, space, type } from '@/theme'

import { Header } from './cart'

export default function EditProfileScreen() {
  const router = useRouter()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchProfile()
      .then(profile => {
        setFullName(profile.fullName ?? '')
        setEmail(profile.email ?? '')
        setPhone(profile.phone ?? '')
      })
      .catch((loadError: any) => setError(loadError.message || 'Could not load your profile'))
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setError('')

    try {
      await updateProfile({
        fullName: fullName.trim() || null,
        // Sent only when filled in, so saving a name never clears an email.
        ...(email.trim() ? { email: email.trim() } : {}),
      })

      router.back()
    } catch (saveError: any) {
      setError(saveError.message || 'Could not save your details')
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={colors.brand} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} title="Edit profile" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.label}>Your name</Text>
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Som Raj"
                placeholderTextColor={colors.faint}
                autoCapitalize="words"
                autoFocus
              />
              <Text style={styles.hint}>Restaurants and delivery partners see this name.</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.faint}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.hint}>Used for receipts. Optional.</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Phone number</Text>
              <View style={styles.readOnly}>
                <Text style={styles.readOnlyText}>{phone}</Text>
                <Feather name="lock" size={15} color={colors.faint} />
              </View>
              <Text style={styles.hint}>
                Your phone number is how you sign in, so it cannot be changed here. Contact support
                to move your account to a new number.
              </Text>
            </View>
          </View>

          {error ? (
            <View style={styles.error}>
              <Feather name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable style={[styles.save, saving && styles.disabled]} onPress={save} disabled={saving}>
            {saving ? (
              <ActivityIndicator color={colors.surface} size="small" />
            ) : (
              <Text style={styles.saveText}>Save changes</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ground,
  },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxxl },

  card: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  field: { marginBottom: space.lg },
  label: { ...type.overline, color: colors.muted, marginBottom: space.sm },
  input: {
    height: 50,
    paddingHorizontal: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    ...type.body,
    color: colors.ink,
  },
  readOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.ground,
  },
  readOnlyText: { flex: 1, ...type.body, color: colors.muted },
  hint: { ...type.caption, color: colors.faint, marginTop: space.sm, lineHeight: 16 },

  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  errorText: { flex: 1, ...type.small, color: colors.danger },

  save: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  saveText: { ...type.bodyStrong, color: colors.surface },
  disabled: { opacity: 0.6 },
})
