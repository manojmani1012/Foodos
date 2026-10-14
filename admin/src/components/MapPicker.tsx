import { Map as MapLibre, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// The map's worker is served from this site, beside the panel's own code.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef, useState } from 'react'

setWorkerUrl(workerUrl)

// OpenFreeMap: free street maps with no key or usage limit, attribution shown
// on the map as their terms ask.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const CHENNAI: [number, number] = [80.2707, 13.0827]

type Point = { latitude: number; longitude: number }

// Click the map or drag the pin to place a restaurant; or paste coordinates
// copied from Google Maps ("13.0339, 80.2619").
export default function MapPicker({
  value,
  onChange,
  readOnly,
  height = 320,
}: {
  value: Point | null
  onChange?: (point: Point | null) => void
  readOnly?: boolean
  height?: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibre | null>(null)
  const marker = useRef<Marker | null>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const [failed, setFailed] = useState(false)
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState('')

  useEffect(() => {
    if (!container.current) return

    let instance: MapLibre

    try {
      instance = new MapLibre({
        container: container.current,
        style: STYLE_URL,
        center: value ? [value.longitude, value.latitude] : CHENNAI,
        zoom: value ? 15 : 11,
        attributionControl: { compact: true },
      })
    } catch {
      // No WebGL (an old machine or a locked-down browser): coordinates can
      // still be typed in.
      setFailed(true)
      return
    }

    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    instance.on('error', (event) => {
      if (!instance.loaded() && String(event.error?.message || '').includes('style')) setFailed(true)
    })

    if (!readOnly) {
      instance.on('click', (event) => {
        changeRef.current?.({
          latitude: round(event.lngLat.lat),
          longitude: round(event.lngLat.lng),
        })
      })
    }

    map.current = instance

    // The map measures its box once when created, which can be before the
    // page has finished laying out; follow the box from then on.
    const resizer = new ResizeObserver(() => instance.resize())
    resizer.observe(container.current)

    return () => {
      resizer.disconnect()
      instance.remove()
      map.current = null
      marker.current = null
    }
    // The map is created once; the pin follows `value` in the effect below.
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!instance) return

    if (!value) {
      marker.current?.remove()
      marker.current = null
      return
    }

    const position: [number, number] = [value.longitude, value.latitude]

    if (!marker.current) {
      marker.current = new Marker({ color: '#1a5c35', draggable: !readOnly }).setLngLat(position).addTo(instance)
      marker.current.on('dragend', () => {
        const at = marker.current!.getLngLat()
        changeRef.current?.({ latitude: round(at.lat), longitude: round(at.lng) })
      })
    } else {
      marker.current.setLngLat(position)
    }

    const bounds = instance.getBounds()
    if (!bounds.contains(position)) instance.easeTo({ center: position, zoom: Math.max(instance.getZoom(), 14) })
  }, [value, readOnly])

  function applyPasted() {
    const match = pasted.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/)

    if (!match) {
      setPasteError('Paste two numbers separated by a comma, like 13.0339, 80.2619')
      return
    }

    const point = { latitude: round(Number(match[1])), longitude: round(Number(match[2])) }
    setPasteError('')
    setPasted('')
    onChange?.(point)
    map.current?.easeTo({ center: [point.longitude, point.latitude], zoom: 15 })
  }

  return (
    <div className="map-picker">
      {failed ? (
        <div className="map-fallback" style={{ height }}>
          The map could not load in this browser. Paste the coordinates below instead.
        </div>
      ) : (
        <div ref={container} className="map" style={{ height }} />
      )}

      {!readOnly && (
        <div className="map-tools">
          <div className="map-paste">
            <input
              className="input"
              value={pasted}
              placeholder="Paste from Google Maps: 13.0339, 80.2619"
              aria-label="Paste coordinates"
              onChange={(event) => setPasted(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  applyPasted()
                }
              }}
            />
            <button type="button" className="btn btn-small" onClick={applyPasted}>
              Use
            </button>
          </div>
          <span className="map-readout">
            {value ? (
              <>
                Pin at {value.latitude.toFixed(5)}, {value.longitude.toFixed(5)}{' '}
                <button type="button" className="link-btn" onClick={() => onChange?.(null)}>
                  Remove
                </button>
              </>
            ) : (
              'Click the map at the restaurant’s entrance.'
            )}
          </span>
          {pasteError && <p className="field-error">{pasteError}</p>}
        </div>
      )}
    </div>
  )
}

function round(value: number) {
  return Math.round(value * 1e6) / 1e6
}
