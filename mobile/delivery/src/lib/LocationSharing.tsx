import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import { useEffect } from 'react'
import { Platform } from 'react-native'

import { sendLocation } from './delivery'

// Shares the rider's position while they are online or on a delivery.
// Dispatch offers each order to the nearest rider by this position, and
// ignores riders whose last position is a few minutes old, so a rider standing
// still still checks in.
//
// On Android it runs as a foreground service, as on Swiggy and Zomato: a
// "Foodos Delivery is using your location" notification stays up, and updates
// keep coming with the screen off or Google Maps in front. That needs only the
// usual "while using the app" permission. Swiping the app away stops it.
// Where the service cannot start (web, Expo Go) it falls back to updates while
// the app is open.
//
// Android marks positions from fake GPS apps; they go to the server marked,
// which refuses them.

const TASK = 'foodos-rider-location'
const EVERY_MS = 15000
const EVERY_METRES = 30
// Sent even when the rider has not moved: waiting at a restaurant is exactly
// when they should be offered its orders.
const HEARTBEAT_MS = 45000
// Updates closer together than this are not sent.
const MIN_GAP_MS = 10000

type Sent = { latitude: number; longitude: number; at: number }

let lastSent: Sent | null = null
let lastPosition: Location.LocationObject | null = null

function metresBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const x = (b.longitude - a.longitude) * Math.cos((((a.latitude + b.latitude) / 2) * Math.PI) / 180)
  const y = b.latitude - a.latitude

  return Math.sqrt(x * x + y * y) * 111_320
}

function share(position: Location.LocationObject, force = false) {
  const { latitude, longitude } = position.coords
  const now = Date.now()

  lastPosition = position

  if (!force && lastSent) {
    const gap = now - lastSent.at
    const moved = metresBetween(lastSent, { latitude, longitude })

    if (gap < MIN_GAP_MS || (moved < EVERY_METRES && gap < HEARTBEAT_MS)) return
  }

  lastSent = { latitude, longitude, at: now }
  // A dropped update is replaced by the next one; not worth retrying.
  sendLocation(latitude, longitude, position.mocked === true).catch(() => {})
}

// Defined at start-up (the root layout imports this file), so the service
// always has somewhere to deliver positions.
if (Platform.OS !== 'web') {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
    const latest = data?.locations?.[data.locations.length - 1]

    if (!error && latest) share(latest)
  })
}

// --- One sharer for the whole app ------------------------------------------
//
// Home (while online) and the delivery screen (while carrying an order) both
// want the position shared; it runs while either does. Starts and stops run
// one at a time, so a quick online-offline-online cannot leave two running.

let wanted = 0
let mode: 'off' | 'service' | 'watch' = 'off'
let watcher: Location.LocationSubscription | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
let queue: Promise<void> = Promise.resolve()

async function startService(): Promise<boolean> {
  if (Platform.OS === 'web') return false

  try {
    if (!(await Location.hasStartedLocationUpdatesAsync(TASK))) {
      await Location.startLocationUpdatesAsync(TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: EVERY_MS,
        // Every interval, moving or not: the heartbeat comes from here, since
        // timers in the app do not run reliably with the screen off.
        distanceInterval: 0,
        pausesUpdatesAutomatically: false,
        activityType: Location.ActivityType.AutomotiveNavigation,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Foodos Delivery is using your location',
          notificationBody: 'So you get orders near you and customers can follow their food. Go offline to stop.',
          notificationColor: '#1a5c35',
          killServiceOnDestroy: true,
        },
      })
    }

    return true
  } catch {
    return false
  }
}

async function startWatch() {
  heartbeat = setInterval(() => {
    if (lastPosition) share(lastPosition, true)
  }, HEARTBEAT_MS)

  watcher = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, timeInterval: EVERY_MS, distanceInterval: EVERY_METRES },
    position => share(position),
  )
}

async function stopAll() {
  if (Platform.OS !== 'web') {
    await Location.hasStartedLocationUpdatesAsync(TASK)
      .then(started => (started ? Location.stopLocationUpdatesAsync(TASK) : undefined))
      .catch(() => {})
  }

  watcher?.remove()
  watcher = null

  if (heartbeat) clearInterval(heartbeat)
  heartbeat = null
  mode = 'off'
}

async function reconcile(onDenied?: () => void) {
  if (wanted === 0) {
    // Also clears a service left running by an earlier session.
    if (mode !== 'off' || Platform.OS !== 'web') await stopAll()
    return
  }

  if (mode !== 'off') return

  const permission = await Location.requestForegroundPermissionsAsync()

  if (permission.status !== 'granted') {
    onDenied?.()
    return
  }

  // One fix straight away rather than waiting for the first update.
  const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null)

  if (first) share(first, true)

  // Nobody wants it any more: the queued call after this one stops it.
  if (wanted === 0) return

  if (await startService()) {
    mode = 'service'
  } else {
    await startWatch()
    mode = 'watch'
  }
}

function sync(onDenied?: () => void) {
  queue = queue.then(() => reconcile(onDenied)).catch(() => {})
}

export function useLocationSharing(enabled: boolean, onDenied?: () => void) {
  useEffect(() => {
    if (!enabled) {
      sync()
      return
    }

    wanted += 1
    sync(onDenied)

    return () => {
      wanted -= 1
      sync()
    }
    // onDenied is a callback for an alert; re-subscribing when it changes
    // identity would restart GPS on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}
