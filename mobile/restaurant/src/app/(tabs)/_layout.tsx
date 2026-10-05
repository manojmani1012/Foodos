import { Feather } from '@expo/vector-icons'
import { Redirect, Tabs } from 'expo-router'

import { useAuth } from '@/lib/AuthContext'
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
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          height: 60,
          paddingTop: 6,
          paddingBottom: 8,
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
