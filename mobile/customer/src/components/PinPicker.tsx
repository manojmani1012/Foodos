import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'

import type { Point } from '@/lib/catalogue'
import { colors, space, type } from '@/theme'

import { CentrePin } from './CentrePin'
import { buildPinPage } from './pinPickerPage'

export type PinPickerHandle = { moveTo: (point: Point) => void }

type Props = {
  // Where the map opens. Later moves go through moveTo, so the page is built once.
  initial: Point
  onMove: (point: Point) => void
  onMoving?: () => void
}

// The phone version: the map page in a WebView, with the pin drawn on top.
export const PinPicker = forwardRef<PinPickerHandle, Props>(function PinPicker({ initial, onMove, onMoving }, ref) {
  const view = useRef<WebView>(null)
  const [failed, setFailed] = useState(false)
  const [lifted, setLifted] = useState(false)

  const html = useMemo(
    () => buildPinPage(initial),
    // Built once: rebuilding would reload the map and lose the customer's place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // A move asked for before the map has loaded (the phone's location often
  // arrives first) is held and made once it has.
  const ready = useRef(false)
  const pending = useRef<Point | null>(null)

  function jump(point: Point) {
    view.current?.injectJavaScript(`window.moveTo && window.moveTo(${point.latitude}, ${point.longitude}); true;`)
  }

  useImperativeHandle(ref, () => ({
    moveTo(point: Point) {
      if (ready.current) jump(point)
      else pending.current = point
    },
  }))

  if (failed) {
    return (
      <View style={[styles.fill, styles.failed]}>
        <Text style={styles.failedText}>The map could not load. Check your connection and try again.</Text>
      </View>
    )
  }

  return (
    <View style={styles.fill}>
      <WebView
        ref={view}
        source={{ html, baseUrl: 'https://tiles.openfreemap.org' }}
        originWhitelist={['*']}
        javaScriptEnabled
        style={styles.web}
        onMessage={event => {
          let message: any

          try {
            message = JSON.parse(event.nativeEvent.data)
          } catch {
            return
          }

          if (message.type === 'failed') setFailed(true)

          if (message.type === 'moving') {
            setLifted(true)
            onMoving?.()
          }

          if (message.type === 'moved') {
            setLifted(false)
            onMove({ latitude: message.latitude, longitude: message.longitude })

            if (!ready.current) {
              ready.current = true

              if (pending.current) jump(pending.current)
              pending.current = null
            }
          }
        }}
        onError={() => setFailed(true)}
      />
      <CentrePin lifted={lifted} />
    </View>
  )
})

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#eef1ef' },
  web: { flex: 1, backgroundColor: 'transparent' },
  failed: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  failedText: { ...type.small, color: colors.muted, textAlign: 'center' },
})
