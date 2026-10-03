import { Feather } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '@/lib/AuthContext'
import { useThemePreference, type ThemeChoice } from '@/lib/ThemeContext'
import { deleteAccount } from '@/lib/profile'
import { colors, radius, shadow, space, type } from '@/theme'

import { Header } from './cart'

const THEMES: { id: ThemeChoice; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[] = [
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
  { id: 'system', label: 'System', icon: 'smartphone' },
]

export default function SettingsScreen() {
  const router = useRouter()
  const { signOut } = useAuth()
  const theme = useThemePreference()

  const [orderUpdates, setOrderUpdates] = useState(true)
  const [offers, setOffers] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Two steps, because this cannot be undone.
  function confirmDelete() {
    Alert.alert(
      'Delete your account?',
      'Your saved addresses, favourites and personal details are removed. Past orders stay with the restaurants as their sales records, but are no longer linked to you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            Alert.alert('This cannot be undone', 'Delete your Foodos account permanently?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete for ever', style: 'destructive', onPress: remove },
            ]),
        },
      ],
    )
  }

  async function remove() {
    setDeleting(true)

    try {
      await deleteAccount()
      await signOut()
      router.replace('/login')
    } catch (error: any) {
      Alert.alert('Could not delete', error.message || 'Please try again')
      setDeleting(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} title="Settings" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Appearance</Text>

          <View style={styles.themeRow}>
            {THEMES.map(option => {
              const active = theme.choice === option.id

              return (
                <Pressable
                  key={option.id}
                  style={[styles.themeOption, active && styles.themeOptionActive]}
                  onPress={() => theme.setChoice(option.id)}
                >
                  <Feather
                    name={option.icon}
                    size={18}
                    color={active ? colors.surface : colors.body}
                  />
                  <Text style={[styles.themeLabel, active && styles.themeLabelActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          <Text style={styles.hint}>
            {theme.choice === 'system'
              ? `Following your phone, currently ${theme.resolved}.`
              : `Always ${theme.choice}.`}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Notifications</Text>

          <View style={styles.toggleRow}>
            <View style={styles.flex}>
              <Text style={styles.toggleLabel}>Order updates</Text>
              <Text style={styles.toggleHint}>When your order is accepted, ready or delivered</Text>
            </View>
            <Switch
              value={orderUpdates}
              onValueChange={setOrderUpdates}
              trackColor={{ true: colors.brand, false: colors.lineStrong }}
              thumbColor={colors.surface}
            />
          </View>

          <View style={[styles.toggleRow, styles.toggleDivider]}>
            <View style={styles.flex}>
              <Text style={styles.toggleLabel}>Offers and promotions</Text>
              <Text style={styles.toggleHint}>Discounts from restaurants near you</Text>
            </View>
            <Switch
              value={offers}
              onValueChange={setOffers}
              trackColor={{ true: colors.brand, false: colors.lineStrong }}
              thumbColor={colors.surface}
            />
          </View>

          {/* Honest about what these do today: the preference is saved, but
              nothing sends push messages until Firebase is connected. */}
          <Text style={styles.hint}>Push notifications are not connected yet.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>About</Text>

          <Row
            icon="file-text"
            label="Terms and conditions"
            onPress={() => WebBrowser.openBrowserAsync('https://foodos.in/terms')}
          />
          <Row
            icon="shield"
            label="Privacy policy"
            onPress={() => WebBrowser.openBrowserAsync('https://foodos.in/privacy')}
            divider
          />
          <Row icon="info" label="Version" value="1.0.0 (development)" divider />
        </View>

        <Pressable style={styles.deleteButton} onPress={confirmDelete} disabled={deleting}>
          <Feather name="trash-2" size={17} color={colors.danger} />
          <Text style={styles.deleteText}>
            {deleting ? 'Deleting…' : 'Delete my account'}
          </Text>
        </Pressable>

        <Text style={styles.footnote}>
          Deleting removes your details. Past orders stay with the restaurants as their own records.
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

function Row({
  icon,
  label,
  value,
  onPress,
  divider,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  value?: string
  onPress?: () => void
  divider?: boolean
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        divider && styles.rowDivider,
        pressed && onPress && styles.rowPressed,
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      <Feather name={icon} size={17} color={colors.muted} />
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress ? <Feather name="external-link" size={15} color={colors.faint} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxxl },

  card: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  cardTitle: { ...type.overline, color: colors.muted, marginBottom: space.md },
  hint: { ...type.caption, color: colors.faint, marginTop: space.md },

  themeRow: { flexDirection: 'row', gap: space.sm },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  themeOptionActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  themeLabel: { ...type.caption, color: colors.body, fontWeight: '600' },
  themeLabelActive: { color: colors.surface },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  toggleDivider: {
    marginTop: space.sm,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  toggleLabel: { ...type.bodyStrong, color: colors.ink },
  toggleHint: { ...type.caption, color: colors.muted, marginTop: 1 },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rowPressed: { opacity: 0.6 },
  rowLabel: { flex: 1, ...type.body, color: colors.ink },
  rowValue: { ...type.caption, color: colors.muted },

  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surface,
  },
  deleteText: { ...type.bodyStrong, color: colors.danger },
  footnote: { ...type.caption, color: colors.faint, textAlign: 'center', lineHeight: 16 },
})
