import { LngLatBounds, Map as MapLibre, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef, useState } from 'react'

setWorkerUrl(workerUrl)

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

export type MapRider = { id: string; name: string; latitude: number; longitude: number; free: boolean }

function pin(text: string, title: string, background: string): HTMLElement {
  const element = document.createElement('div')
  element.textContent = text
  element.title = title
  element.style.cssText = `font-size:13px;font-weight:700;color:#fff;background:${background};padding:3px 7px;border-radius:12px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);white-space:nowrap;cursor:default`

  return element
}

// The restaurant and every rider with a known position, so an admin can see at
// a glance who is close enough to send.
export default function RidersMapView({
  restaurant,
  riders,
  height = 280,
}: {
  restaurant: { name: string; latitude: number; longitude: number }
  riders: MapRider[]
  height?: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!container.current) return

    let map: MapLibre

    try {
      map = new MapLibre({
        container: container.current,
        style: STYLE_URL,
        center: [restaurant.longitude, restaurant.latitude],
        zoom: 13,
        attributionControl: { compact: true },
      })
    } catch {
      setFailed(true)
      return
    }

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    new Marker({ element: pin('🍽 ' + restaurant.name, 'Restaurant', '#1a5c35') })
      .setLngLat([restaurant.longitude, restaurant.latitude])
      .addTo(map)

    const bounds = new LngLatBounds([restaurant.longitude, restaurant.latitude], [restaurant.longitude, restaurant.latitude])

    for (const rider of riders) {
      new Marker({ element: pin('🛵 ' + rider.name, rider.free ? 'Free' : 'Busy or offline', rider.free ? '#1565c0' : '#6b7280') })
        .setLngLat([rider.longitude, rider.latitude])
        .addTo(map)
      bounds.extend([rider.longitude, rider.latitude])
    }

    map.on('load', () => {
      if (riders.length) map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 })
    })

    // The panel's layout can change size after the map draws.
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container.current)

    return () => {
      observer.disconnect()
      map.remove()
    }
  }, [restaurant.latitude, restaurant.longitude, restaurant.name, riders])

  if (failed) return null

  return <div ref={container} className="map" style={{ height }} />
}
