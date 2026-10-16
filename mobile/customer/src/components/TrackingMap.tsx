import { useEffect, useMemo, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import { WebView } from 'react-native-webview'

import { buildPage, mapStyles as styles, type Point } from './trackingMapPage'

// The phone version: the map page in a WebView.
export function TrackingMap({
  restaurant,
  home,
  rider,
}: {
  restaurant: Point | null
  home: Point | null
  rider: Point | null
}) {
  const view = useRef<WebView>(null)
  const [failed, setFailed] = useState(false)

  // The page is built once from the fixed points; the rider then moves by
  // script, so the map does not reload and lose the customer's zoom.
  const html = useMemo(
    () => buildPage(restaurant, home, rider),
    // Only the fixed ends of the trip rebuild the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [restaurant?.latitude, restaurant?.longitude, home?.latitude, home?.longitude],
  )

  useEffect(() => {
    if (!rider) return

    view.current?.injectJavaScript(
      `window.moveRider && window.moveRider(${rider.latitude}, ${rider.longitude}); true;`,
    )
  }, [rider?.latitude, rider?.longitude])

  if (failed || (!restaurant && !home && !rider)) return null

  return (
    <View style={styles.frame}>
      <WebView
        ref={view}
        source={{ html, baseUrl: 'https://tiles.openfreemap.org' }}
        originWhitelist={['*']}
        javaScriptEnabled
        scrollEnabled={false}
        style={styles.web}
        onMessage={event => {
          if (event.nativeEvent.data === 'map-failed') setFailed(true)
        }}
        onError={() => setFailed(true)}
      />
      <View style={styles.legend} pointerEvents="none">
        <Text style={styles.legendText}>🍽 Restaurant · 🛵 Rider · 🏠 You</Text>
      </View>
    </View>
  )
}
