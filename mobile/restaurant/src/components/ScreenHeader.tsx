import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, radius, space, type } from '@/theme'

// The back-arrow header used by every screen pushed on top of the tabs.
export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const router = useRouter()

  return (
    <View style={styles.header}>
      <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8}>
        <Feather name="chevron-left" size={22} color={colors.ink} />
      </Pressable>
      <View style={styles.titles}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  back: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ground,
  },
  titles: { flex: 1 },
  title: { ...type.heading, color: colors.ink },
  subtitle: { ...type.caption, color: colors.muted },
})
