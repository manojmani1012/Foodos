import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { AuthProvider, useAuth } from '@/lib/AuthContext'

// Hold the splash until we know whether this owner is already signed in, so a
// returning user never sees the login screen flash before the dashboard.
SplashScreen.preventAutoHideAsync().catch(() => {})

function SplashGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()

  useEffect(() => {
    if (status !== 'loading') {
      // Nothing else hides the splash, so if this never runs the app sits on
      // the logo for ever.
      SplashScreen.hideAsync().catch(() => {})
    }
  }, [status])

  return <>{children}</>
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* Every screen here signs in as the restaurant owner, so the session
          the API issues is scoped to that role. An owner who also orders food
          gets nothing extra from this app. */}
      <AuthProvider role="restaurant_owner">
        <SplashGate>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
        </SplashGate>
      </AuthProvider>
    </SafeAreaProvider>
  )
}
