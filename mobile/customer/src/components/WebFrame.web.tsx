import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '@/theme'

// The website on a laptop: the app as a centred column rather than stretched
// edge to edge, which is how its screens were designed to be read. On a phone
// browser the column simply fills the screen.
export function WebFrame({ children }: { children: ReactNode }) {
  return (
    <View style={styles.page}>
      <View style={styles.column}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', backgroundColor: '#e9edeb' },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: 560,
    backgroundColor: colors.ground,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
})
