import { Feather } from '@expo/vector-icons'
import { Redirect, Tabs } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAuth } from '@/lib/AuthContext'
import { NewOrderAlertProvider, useNewOrders } from '@/lib/NewOrderAlert'
import { colors, type } from '@/theme'

// The four places an owner needs at any time. An order pushes on top of these.
export default function TabLayout() {
  const { status } = useAuth()

  // Signing out from the profile tab leaves this group mounted, so the guard
  // belongs here rather than only on the entry screen.
  if (status === 'signed-out') {
    return <Redirect href="/login" />
  }

  return (
    <NewOrderAlertProvider>
      <OwnerTabs />
    </NewOrderAlertProvider>
  )
}

function OwnerTabs() {
  const { newOrders } = useNewOrders()

  // Phones draw their own navigation bar (three buttons, or a gesture strip)
  // over the bottom of the app. The tab bar grows by that much, so its
  // buttons sit above the phone's instead of underneath them.
  const insets = useSafeAreaInsets()

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
          title: 'Today',
          tabBarIcon: ({ color, size }) => <Feather name="home" size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          // Orders waiting to be accepted, so the count is visible from any tab.
          tabBarBadge: newOrders > 0 ? newOrders : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.danger, fontSize: 11 },
          tabBarIcon: ({ color, size }) => (
            <Feather name="clipboard" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'Menu',
          tabBarIcon: ({ color, size }) => <Feather name="book-open" size={size - 2} color={color} />,
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
