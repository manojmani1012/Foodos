import { lazy, Suspense, type ComponentProps } from 'react'

// Loaded only when an order page needs it, like the restaurant map.
const RidersMapView = lazy(() => import('./RidersMapView'))

export default function RidersMap(props: ComponentProps<typeof RidersMapView>) {
  return (
    <Suspense fallback={<div className="map-fallback" style={{ height: props.height ?? 280 }}>Loading map…</div>}>
      <RidersMapView {...props} />
    </Suspense>
  )
}
