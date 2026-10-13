import * as Location from 'expo-location'
import { useEffect, useRef } from 'react'

import { sendLocation } from './delivery'

// Shares the rider's position while they are online, so offers can show the
// distance to each restaurant and the customer can follow their order.
//
// Foreground only: it runs while the app is open. Tracking with the screen off
// needs background location permission and a persistent notification, which
// is a later change.

const EVERY_MS = 20000
const EVERY_METRES = 50

export function useLocationSharing(enabled: boolean, onDenied?: () => void) {
  const subscription = useRef<Location.LocationSubscription | null>(null)

  useEffect(() => {
    let cancelled = false

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
        sendLocation(first.coords.latitude, first.coords.longitude).catch(() => {})
      }

      if (cancelled) return

      subscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: EVERY_MS,
          distanceInterval: EVERY_METRES,
        },
        position => {
          // A dropped update is replaced by the next one; not worth retrying.
          sendLocation(position.coords.latitude, position.coords.longitude).catch(() => {})
        },
      )
    }

    if (enabled) {
      start().catch(() => {})
    }

    return () => {
      cancelled = true
      subscription.current?.remove()
      subscription.current = null
    }
    // onDenied is a callback for an alert; re-subscribing when it changes
    // identity would restart GPS on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}
