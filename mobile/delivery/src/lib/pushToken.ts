import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { request } from '@/lib/apiClient'

// Push notifications: this phone's Expo push token, sent to the API after
// sign-in and taken back before sign-out.
//
// Nothing here may stop the app working. No permission, no Firebase config in
// the build, no Expo project id yet, an emulator: each simply means no push.

let registeredToken: string | null = null

// The API sends to these channels. Android lets the person tune each one in
// Settings, and a channel's sound and importance are fixed once created.
async function createChannels() {
  if (Platform.OS !== 'android') return

  await Notifications.setNotificationChannelAsync('orders', {
    name: 'New deliveries',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    enableVibrate: true,
    vibrationPattern: [0, 400, 250, 400],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  })

  await Notifications.setNotificationChannelAsync('updates', {
    name: 'Order updates',
    importance: Notifications.AndroidImportance.DEFAULT,
  })
}

function expoProjectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
}

export async function registerForPush(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return

  const projectId = expoProjectId()

  if (!projectId) {
    console.info('[push] No Expo project id in app.json yet, so push notifications are off')
    return
  }

  // On Android 13 and later a channel must exist before the permission
  // prompt can appear.
  await createChannels()

  let { status } = await Notifications.getPermissionsAsync()

  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status
  }

  if (status !== 'granted') return

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })

  await request('/api/v1/notifications/push-token', {
    method: 'PUT',
    body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
  })

  registeredToken = token
}

// Called just before signing out, while the session still works, so the next
// person to use this phone does not get this person's notifications.
export async function forgetPushToken(): Promise<void> {
  const token = registeredToken
  registeredToken = null

  if (!token) return

  try {
    await request('/api/v1/notifications/push-token/remove', { method: 'POST', body: { token } })
  } catch {
    // Signing out goes ahead regardless.
  }
}
