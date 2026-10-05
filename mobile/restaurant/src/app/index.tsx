import { Redirect } from 'expo-router'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { useAuth } from '@/lib/AuthContext'
import { colors } from '@/theme'

// The entry point only decides where to go. The splash is still up while the
// session is being restored, so this spinner is rarely seen.
export default function Index() {
  const { status } = useAuth()

  if (status === 'loading') {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    )
  }

  return <Redirect href={status === 'signed-in' ? '/(tabs)' : '/login'} />
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ground },
})
