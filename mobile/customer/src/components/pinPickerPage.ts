import type { Point } from '@/lib/catalogue'

// The map behind the "drag the map to your door" screen, for the phone's
// WebView (the website draws the same map directly: PinPicker.web.tsx).
//
// The pin itself is not on the map: the app draws it fixed in the middle and
// the customer moves the map under it, the way Swiggy and Zomato do. Each time
// the map stops, the page reports the point under the pin.

const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.24.0/dist'
export const PIN_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

// Close enough to tell one building from the next.
export const PIN_ZOOM = 17

export function buildPinPage(center: Point): string {
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.css" />
  <script src="${MAPLIBRE}/maplibre-gl.js"></script>
  <style>html, body, #map { margin: 0; width: 100%; height: 100%; background: #eef1ef; }</style>
</head>
<body>
  <div id="map"></div>
  <script>
    (function () {
      function send(message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)); }

      if (typeof maplibregl === 'undefined') { send({ type: 'failed' }); return; }

      var map = new maplibregl.Map({
        container: 'map',
        style: '${PIN_MAP_STYLE}',
        center: [${center.longitude}, ${center.latitude}],
        zoom: ${PIN_ZOOM},
        attributionControl: { compact: true }
      });

      map.on('error', function () {});

      function report() {
        var c = map.getCenter();
        send({ type: 'moved', latitude: c.lat, longitude: c.lng });
      }

      map.on('movestart', function () { send({ type: 'moving' }); });
      map.on('moveend', report);
      map.on('load', report);

      // Called from the app: a search result, or "use my current location".
      window.moveTo = function (latitude, longitude) {
        map.jumpTo({ center: [longitude, latitude], zoom: ${PIN_ZOOM} });
      };
    })();
  </script>
</body>
</html>`
}
