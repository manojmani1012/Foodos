import { StyleSheet } from 'react-native'

import { colors, radius, space, type } from '@/theme'

// The customer's view of their order on a map: restaurant, home, and the rider.
//
// Drawn with MapLibre GL JS inside a WebView rather than a native map library
// (the website draws the same map directly: TrackingMap.web.tsx).
// The tiles are OpenFreeMap's: free, no API key, no usage limits, commercial
// use allowed with the attribution MapLibre shows in the corner. A WebView adds
// no native code, so the app build cannot break over it and it works in Expo
// Go too. It needs internet, which ordering food does anyway.

// Pinned, so a new MapLibre release cannot change the map unannounced.
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.24.0/dist'
const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

export type Point = { latitude: number; longitude: number }

export function buildPage(restaurant: Point | null, home: Point | null, rider: Point | null): string {
  const points = { restaurant, home, rider }

  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.css" />
  <script src="${MAPLIBRE}/maplibre-gl.js"></script>
  <style>
    html, body, #map { margin: 0; width: 100%; height: 100%; background: #eef1ef; }
    .pin { font-size: 22px; line-height: 1; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.35)); }
    .rider { font-size: 26px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    (function () {
      var points = ${JSON.stringify(points)};

      if (typeof maplibregl === 'undefined') {
        window.ReactNativeWebView.postMessage('map-failed');
        return;
      }

      var all = [points.restaurant, points.home, points.rider].filter(Boolean);
      var first = all[0];

      var map = new maplibregl.Map({
        container: 'map',
        style: '${STYLE}',
        center: [first.longitude, first.latitude],
        zoom: 13,
        attributionControl: { compact: true }
      });

      map.on('error', function () {});

      function pin(text, point, extra) {
        var el = document.createElement('div');
        el.className = 'pin ' + (extra || '');
        el.textContent = text;
        return new maplibregl.Marker({ element: el }).setLngLat([point.longitude, point.latitude]).addTo(map);
      }

      if (points.restaurant) pin('🍽', points.restaurant);
      if (points.home) pin('🏠', points.home);
      var rider = points.rider ? pin('🛵', points.rider, 'rider') : null;

      function fit() {
        var shown = [points.restaurant, points.home, rider && points.rider].filter(Boolean);
        if (shown.length < 2) return;
        var bounds = new maplibregl.LngLatBounds();
        shown.forEach(function (p) { bounds.extend([p.longitude, p.latitude]); });
        map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
      }

      map.on('load', fit);

      // Called from the app each time the rider's position arrives.
      window.moveRider = function (latitude, longitude) {
        points.rider = { latitude: latitude, longitude: longitude };
        if (rider) {
          rider.setLngLat([longitude, latitude]);
        } else {
          rider = pin('🛵', points.rider, 'rider');
          fit();
        }
      };
    })();
  </script>
</body>
</html>`
}

export const mapStyles = StyleSheet.create({
  frame: {
    height: 220,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#eef1ef',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  web: { flex: 1, backgroundColor: 'transparent' },
  legend: {
    position: 'absolute',
    left: space.sm,
    top: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  legendText: { ...type.caption, color: colors.body },
})
