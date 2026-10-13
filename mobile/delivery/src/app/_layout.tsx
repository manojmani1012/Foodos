import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { AuthProvider, useAuth } from '@/lib/AuthContext'

// Hold the splash until we know whether this rider is already signed in, so a
// returning rider never sees the login screen flash before Home.
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
      {/* Every screen here signs in as a delivery partner, so the session the
          API issues is scoped to that role. A rider who also orders food gets
          nothing extra from this app. */}
      <AuthProvider role="delivery_partner">
        <SplashGate>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
        </SplashGate>
      </AuthProvider>
    </SafeAreaProvider>
  )
}
