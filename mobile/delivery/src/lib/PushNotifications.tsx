import * as Notifications from 'expo-notifications'
import { useRouter, type Href } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'

import { useAuth } from '@/lib/AuthContext'
import { registerForPush } from '@/lib/pushToken'

// Notifications that arrive while the app is open are shown too. A rider
// looking at Earnings still needs to hear a new delivery.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  })
}

// "delivery": the trip in progress (food ready). "offer": Home, where new
// requests are listed (a new request, or a cancelled trip).
function routeFor(data: Record<string, unknown> | undefined): Href | null {
  if (data?.type === 'delivery') return '/delivery'
  if (data?.type === 'offer') return '/'

  return null
}

// Signs this phone up for push once someone is signed in, and opens the right
// screen when a notification is tapped.
export function PushNotifications() {
  const { status } = useAuth()
  const router = useRouter()
  const response = Notifications.useLastNotificationResponse()
  const handled = useRef<string | null>(null)

  useEffect(() => {
    if (status !== 'signed-in') return

    registerForPush().catch((error) => console.warn('[push] Could not sign up for notifications:', error?.message))
  }, [status])

  useEffect(() => {
    // Wait for sign-in: the screens a notification leads to need a session.
    if (status !== 'signed-in' || !response) return

    const id = response.notification.request.identifier
    if (handled.current === id) return
    handled.current = id

    const target = routeFor(response.notification.request.content.data)

    if (target) {
      try {
        router.push(target)
      } catch {
        // Navigation not ready yet; the notification stays in the tray.
      }
    }
  }, [response, status, router])

  return null
}
