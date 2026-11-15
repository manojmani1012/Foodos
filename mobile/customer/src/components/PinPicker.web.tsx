import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import type { Point } from '@/lib/catalogue'
import { colors, space, type } from '@/theme'

import { CentrePin } from './CentrePin'
import { loadMapLibre } from './mapLibreLoader'
import { PIN_MAP_STYLE, PIN_ZOOM } from './pinPickerPage'

export type PinPickerHandle = { moveTo: (point: Point) => void }

type Props = {
  initial: Point
  onMove: (point: Point) => void
  onMoving?: () => void
}

// The website version: MapLibre drawn straight into the page, with the same
// fixed centre pin as the app.
export const PinPicker = forwardRef<PinPickerHandle, Props>(function PinPicker({ initial, onMove, onMoving }, ref) {
  const container = useRef<HTMLDivElement | null>(null)
  const map = useRef<any>(null)
  const callbacks = useRef({ onMove, onMoving })
  callbacks.current = { onMove, onMoving }
  const [failed, setFailed] = useState(false)
  const [lifted, setLifted] = useState(false)

  // A move asked for before the map has loaded is held and made once it has.
  const pending = useRef<Point | null>(null)

  useImperativeHandle(ref, () => ({
    moveTo(point: Point) {
      if (map.current) map.current.jumpTo({ center: [point.longitude, point.latitude], zoom: PIN_ZOOM })
      else pending.current = point
    },
  }))

  useEffect(() => {
    let removed = false

    loadMapLibre()
      .then(maplibregl => {
        if (removed || !container.current) return

        const instance = new maplibregl.Map({
          container: container.current,
          style: PIN_MAP_STYLE,
          center: [initial.longitude, initial.latitude],
          zoom: PIN_ZOOM,
          attributionControl: { compact: true },
        })

        const report = () => {
          const centre = instance.getCenter()
          setLifted(false)
          callbacks.current.onMove({ latitude: centre.lat, longitude: centre.lng })
        }

        instance.on('movestart', () => {
          setLifted(true)
          callbacks.current.onMoving?.()
        })
        instance.on('moveend', report)
        instance.on('load', report)

        map.current = instance

        if (pending.current) {
          instance.jumpTo({ center: [pending.current.longitude, pending.current.latitude], zoom: PIN_ZOOM })
          pending.current = null
        }
      })
      .catch(() => {
        if (!removed) setFailed(true)
      })

    return () => {
      removed = true
      map.current?.remove()
      map.current = null
    }
    // Built once: the customer's own moves must not be undone by a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (failed) {
    return (
      <View style={[styles.fill, styles.failed]}>
        <Text style={styles.failedText}>The map could not load. Check your connection and try again.</Text>
      </View>
    )
  }

  return (
    <View style={styles.fill}>
      {createElement('div', {
        ref: container,
        role: 'application',
        'aria-label': 'Map: move it until the pin is on your door',
        style: { width: '100%', height: '100%' },
      })}
      <CentrePin lifted={lifted} />
    </View>
  )
})

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#eef1ef' },
  failed: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  failedText: { ...type.small, color: colors.muted, textAlign: 'center' },
})
