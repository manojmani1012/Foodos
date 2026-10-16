import { createElement, useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'

import { mapStyles as styles, type Point } from './trackingMapPage'

// The website version: MapLibre drawn straight into the page, with the same
// tiles, pins and fitting as the app's WebView map. Not in an iframe: a page
// written into a frame would need inline script, which the site's
// Content-Security-Policy deliberately forbids.

// The same pinned release the app uses.
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.24.0/dist'
const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

let loading: Promise<any> | null = null

// The library is fetched the first time a map is shown, not with the site.
function loadMapLibre(): Promise<any> {
  const existing = (window as any).maplibregl
  if (existing) return Promise.resolve(existing)

  loading ??= new Promise((resolve, reject) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `${MAPLIBRE}/maplibre-gl.css`
    document.head.appendChild(css)

    const script = document.createElement('script')
    script.src = `${MAPLIBRE}/maplibre-gl.js`
    script.async = true
    script.onload = () => resolve((window as any).maplibregl)
    script.onerror = () => {
      loading = null
      reject(new Error('The map could not load'))
    }
    document.head.appendChild(script)
  })

  return loading
}

function pin(maplibregl: any, map: any, text: string, point: Point, size: number) {
  const element = document.createElement('div')
  element.textContent = text
  element.style.fontSize = `${size}px`
  element.style.lineHeight = '1'
  element.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))'

  return new maplibregl.Marker({ element }).setLngLat([point.longitude, point.latitude]).addTo(map)
}

export function TrackingMap({
  restaurant,
  home,
  rider,
}: {
  restaurant: Point | null
  home: Point | null
  rider: Point | null
}) {
  const container = useRef<HTMLDivElement | null>(null)
  const map = useRef<{ instance: any; library: any; rider: any; fit: () => void } | null>(null)
  const [failed, setFailed] = useState(false)
  const riderRef = useRef(rider)
  riderRef.current = rider

  // Built once from the fixed ends of the trip; the rider then moves without
  // the map reloading and losing the customer's zoom.
  useEffect(() => {
    if (!restaurant && !home && !rider) return

    let removed = false

    loadMapLibre()
      .then(maplibregl => {
        if (removed || !container.current) return

        const first = (restaurant || home || riderRef.current)!
        const instance = new maplibregl.Map({
          container: container.current,
          style: STYLE,
          center: [first.longitude, first.latitude],
          zoom: 13,
          attributionControl: { compact: true },
        })

        if (restaurant) pin(maplibregl, instance, '🍽', restaurant, 22)
        if (home) pin(maplibregl, instance, '🏠', home, 22)

        const state = {
          instance,
          library: maplibregl,
          rider: riderRef.current ? pin(maplibregl, instance, '🛵', riderRef.current, 26) : null,
          fit: () => {
            const shown = [restaurant, home, state.rider ? riderRef.current : null].filter(Boolean) as Point[]
            if (shown.length < 2) return

            const bounds = new maplibregl.LngLatBounds()
            shown.forEach(point => bounds.extend([point.longitude, point.latitude]))
            instance.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 })
          },
        }

        instance.on('load', state.fit)
        map.current = state
      })
      .catch(() => {
        if (!removed) setFailed(true)
      })

    return () => {
      removed = true
      map.current?.instance.remove()
      map.current = null
    }
    // Only the fixed ends of the trip rebuild the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.latitude, restaurant?.longitude, home?.latitude, home?.longitude])

  useEffect(() => {
    const state = map.current
    if (!state || !rider) return

    if (state.rider) {
      state.rider.setLngLat([rider.longitude, rider.latitude])
    } else {
      state.rider = pin(state.library, state.instance, '🛵', rider, 26)
      state.fit()
    }
  }, [rider?.latitude, rider?.longitude])

  if (failed || (!restaurant && !home && !rider)) return null

  return (
    <View style={styles.frame}>
      {createElement('div', {
        ref: container,
        role: 'img',
        'aria-label': 'Map of your order',
        style: { width: '100%', height: '100%' },
      })}
      <View style={styles.legend} pointerEvents="none">
        <Text style={styles.legendText}>🍽 Restaurant · 🛵 Rider · 🏠 You</Text>
      </View>
    </View>
  )
}
