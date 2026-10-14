import { Feather } from '@expo/vector-icons'
import { Redirect, Tabs } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAuth } from '@/lib/AuthContext'
import { colors, type } from '@/theme'

// Three places a rider needs. The delivery in progress pushes on top of these.
export default function TabLayout() {
  const { status } = useAuth()

  // Phones draw their own navigation bar (three buttons, or a gesture strip)
  // over the bottom of the app. The tab bar grows by that much, so its
  // buttons sit above the phone's instead of underneath them.
  const insets = useSafeAreaInsets()

  // Signing out from Profile leaves this group mounted, so the guard lives here.
  if (status === 'signed-out') {
    return <Redirect href="/login" />
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          height: 60 + insets.bottom,
          paddingTop: 6,
          paddingBottom: 8 + insets.bottom,
        },
        tabBarLabelStyle: { ...type.caption, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Feather name="navigation" size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: ({ color, size }) => <Feather name="trending-up" size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Feather name="user" size={size - 2} color={color} />,
        }}
      />
    </Tabs>
  )
}
