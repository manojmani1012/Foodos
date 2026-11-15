import * as Location from 'expo-location'
import { useEffect, useRef } from 'react'

import { sendLocation } from './delivery'

// Shares the rider's position while they are online. Dispatch offers each
// order to the nearest rider by this position, and ignores riders whose last
// position is a few minutes old, so a rider standing still still checks in.
//
// Foreground only: it runs while the app is open. Tracking with the screen off
// needs background location permission and a persistent notification, which
// is a later change.

const EVERY_MS = 20000
const EVERY_METRES = 50
// Sent even when the rider has not moved: waiting at a restaurant is exactly
// when they should be offered its orders.
const HEARTBEAT_MS = 45000

export function useLocationSharing(enabled: boolean, onDenied?: () => void) {
  const subscription = useRef<Location.LocationSubscription | null>(null)
  const last = useRef<{ latitude: number; longitude: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    let heartbeat: ReturnType<typeof setInterval> | null = null

    function share(latitude: number, longitude: number) {
      last.current = { latitude, longitude }
      // A dropped update is replaced by the next one; not worth retrying.
      sendLocation(latitude, longitude).catch(() => {})
    }

    async function start() {
      const permission = await Location.requestForegroundPermissionsAsync()

      if (permission.status !== 'granted') {
        onDenied?.()
        return
      }

      // Send one fix straight away rather than waiting for the first movement.
      const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(
        () => null,
      )

      if (first && !cancelled) {
        share(first.coords.latitude, first.coords.longitude)
      }

      if (cancelled) return

      heartbeat = setInterval(() => {
        if (last.current) share(last.current.latitude, last.current.longitude)
      }, HEARTBEAT_MS)

      subscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: EVERY_MS,
          distanceInterval: EVERY_METRES,
        },
        position => share(position.coords.latitude, position.coords.longitude),
      )
    }

    if (enabled) {
      start().catch(() => {})
    }

    return () => {
      cancelled = true
      if (heartbeat) clearInterval(heartbeat)
      subscription.current?.remove()
      subscription.current = null
    }
    // onDenied is a callback for an alert; re-subscribing when it changes
    // identity would restart GPS on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}
