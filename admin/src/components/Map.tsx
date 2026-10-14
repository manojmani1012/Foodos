import { lazy, Suspense, type ComponentProps } from 'react'

// The map library is most of the panel's size, so it is fetched only when a
// screen with a map opens, not on sign-in.
const MapPicker = lazy(() => import('./MapPicker'))

export default function Map(props: ComponentProps<typeof MapPicker>) {
  return (
    <Suspense fallback={<div className="map-fallback" style={{ height: props.height ?? 320 }}>Loading map…</div>}>
      <MapPicker {...props} />
    </Suspense>
  )
}
