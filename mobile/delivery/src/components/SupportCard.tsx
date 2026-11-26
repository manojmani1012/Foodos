import { Feather } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'

import { API_BASE_URL, request } from '@/lib/apiClient'
import { colors, radius, shadow, space, type } from '@/theme'

type Info = { supportPhone: string | null; supportEmail: string | null; supportHours: string | null }

type Row = { icon: keyof typeof Feather.glyphMap; label: string; hint?: string; url: string }

// "Help": how to reach Foodos, and the policy pages. Call and email appear
// once Foodos has set its support number and address.
export function SupportCard() {
  const [info, setInfo] = useState<Info | null>(null)

  useEffect(() => {
    request('/api/v1/support/info')
      .then(setInfo)
      .catch(() => {})
  }, [])

  const rows: Row[] = [
    ...(info?.supportPhone
      ? [{ icon: 'phone' as const, label: 'Call Foodos support', hint: info.supportHours ?? info.supportPhone, url: `tel:${info.supportPhone}` }]
      : []),
    ...(info?.supportEmail
      ? [{ icon: 'mail' as const, label: 'Email Foodos support', hint: info.supportEmail, url: `mailto:${info.supportEmail}` }]
      : []),
    { icon: 'info', label: 'Contact us', url: `${API_BASE_URL}/legal/contact` },
    { icon: 'file-text', label: 'Terms of Use', url: `${API_BASE_URL}/legal/terms` },
    { icon: 'shield', label: 'Privacy Policy', url: `${API_BASE_URL}/legal/privacy` },
  ]

  return (
    <>
      <Text style={styles.title}>Help</Text>
      <View style={styles.card}>
        {rows.map((row, index) => (
          <Pressable
            key={row.label}
            style={[styles.row, index > 0 && styles.divider]}
            onPress={() => Linking.openURL(row.url).catch(() => {})}
            accessibilityRole="link"
          >
            <Feather name={row.icon} size={16} color={colors.brand} />
            <View style={styles.flex}>
              <Text style={styles.label}>{row.label}</Text>
              {row.hint ? <Text style={styles.hint}>{row.hint}</Text> : null}
            </View>
            <Feather name="external-link" size={15} color={colors.faint} />
          </Pressable>
        ))}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { ...type.overline, color: colors.muted, marginTop: space.lg, marginBottom: space.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  label: { ...type.bodyStrong, color: colors.ink },
  hint: { ...type.caption, color: colors.muted, marginTop: 1 },
})
