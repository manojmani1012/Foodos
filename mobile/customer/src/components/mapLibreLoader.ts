// The website's maps (tracking and the address pin) draw MapLibre straight into
// the page. Not in an iframe: a page written into a frame would need inline
// script, which the site's Content-Security-Policy deliberately forbids.

// The same pinned release the app uses.
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.24.0/dist'

let loading: Promise<any> | null = null

// The library is fetched the first time a map is shown, not with the site.
export function loadMapLibre(): Promise<any> {
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
