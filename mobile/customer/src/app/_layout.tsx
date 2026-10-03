import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { AuthProvider, useAuth } from '@/lib/AuthContext'
import { CartProvider } from '@/lib/CartContext'
import { DishProvider } from '@/lib/DishContext'
import { LocationProvider } from '@/lib/LocationContext'
import { ThemePreferenceProvider } from '@/lib/ThemeContext'

// Hold the splash until we know whether this person is already signed in, so a
// returning user never sees the login screen flash before Home appears.
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
      <ThemePreferenceProvider>
        {/* Every screen in this app signs in as a customer, so the session the
            API issues is scoped to that role. */}
        <AuthProvider role="customer">
          <LocationProvider>
            <CartProvider>
              <DishProvider>
                <SplashGate>
                  <StatusBar style="dark" />
                  <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
                </SplashGate>
              </DishProvider>
            </CartProvider>
          </LocationProvider>
        </AuthProvider>
      </ThemePreferenceProvider>
    </SafeAreaProvider>
  )
}
