import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '@/lib/AuthContext'
import { useLocation } from '@/lib/LocationContext'
import { fetchProfile, type Profile } from '@/lib/profile'
import { colors, radius, shadow, space, type } from '@/theme'

type Row = {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  hint?: string
  onPress?: () => void
  disabled?: boolean
}

export default function ProfileScreen() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const location = useLocation()
  const [signingOut, setSigningOut] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)

  // Refreshed on every visit, so a name set a moment ago is already showing.
  useFocusEffect(
    useCallback(() => {
      fetchProfile()
        .then(setProfile)
        .catch(() => {
          // The screen still works from the session's own details.
        })
    }, []),
  )

  // Confirmed, not instant: signing out by mis-tapping an avatar is how the
  // previous version behaved and it was far too easy to do by accident.
  function confirmSignOut() {
    Alert.alert('Sign out?', 'You will need your phone number and an OTP to sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true)
          await signOut()
          router.replace('/login')
        },
      },
    ])
  }

  const rows: Row[] = [
    {
      icon: 'edit-2',
      label: 'Edit profile',
      hint: 'Your name and email',
      onPress: () => router.push('/edit-profile'),
    },
    {
      icon: 'file-text',
      label: 'My orders',
      hint: profile
        ? `${profile.stats.deliveredOrders} delivered`
        : 'Track and review past orders',
      onPress: () => router.push('/orders'),
    },
    {
      icon: 'map-pin',
      label: 'Saved addresses',
      hint: location.addresses.length
        ? `${location.addresses.length} saved`
        : 'Add a delivery address',
      onPress: () => router.push('/location'),
    },
    { icon: 'heart', label: 'Favourites', onPress: () => router.push('/favourites') },
    {
      icon: 'settings',
      label: 'Settings',
      hint: 'Theme, notifications, account',
      onPress: () => router.push('/settings'),
    },
    {
      icon: 'credit-card',
      label: 'Payment methods',
      hint: 'UPI, cards and cash on delivery',
      disabled: true,
    },
    { icon: 'help-circle', label: 'Help & support', hint: 'Coming soon', disabled: true },
  ]

  const displayName = profile?.fullName || user?.fullName || 'Add your name'
  const initials = (profile?.fullName || user?.fullName || user?.phone || 'U').slice(-2)

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.name}>{displayName}</Text>
            <Text style={styles.phone}>{profile?.phone ?? user?.phone ?? ''}</Text>
          </View>
        </View>

        <View style={styles.card}>
          {rows.map((row, index) => (
            <Pressable
              key={row.label}
              style={({ pressed }) => [
                styles.row,
                index > 0 && styles.rowDivider,
                pressed && !row.disabled && styles.rowPressed,
                row.disabled && styles.rowDisabled,
              ]}
              onPress={row.onPress}
              disabled={row.disabled}
            >
              <View style={styles.rowIcon}>
                <Feather name={row.icon} size={17} color={row.disabled ? colors.faint : colors.brand} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                {row.hint ? <Text style={styles.rowHint}>{row.hint}</Text> : null}
              </View>
              {!row.disabled && <Feather name="chevron-right" size={18} color={colors.faint} />}
            </Pressable>
          ))}
        </View>

        <Pressable
          style={styles.signOut}
          onPress={confirmSignOut}
          disabled={signingOut}
        >
          <Feather name="log-out" size={17} color={colors.danger} />
          <Text style={styles.signOutText}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
        </Pressable>

        <Text style={styles.version}>Foodos · development build</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxxl },

  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...type.heading, color: colors.surface },
  name: { ...type.heading, color: colors.ink },
  phone: { ...type.small, color: colors.muted, marginTop: 2 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: 'hidden',
    ...shadow.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rowPressed: { backgroundColor: colors.raised },
  rowDisabled: { opacity: 0.5 },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { ...type.bodyStrong, color: colors.ink },
  rowHint: { ...type.caption, color: colors.muted, marginTop: 1 },

  signOut: {
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
  signOutText: { ...type.bodyStrong, color: colors.danger },
  version: { ...type.caption, color: colors.faint, textAlign: 'center' },
})
