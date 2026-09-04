import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import './oneWayArrows.css'

/* ============================================================
   One-way direction arrows.

   290 of Cabuyao's 4,853 ways are one-way — SLEX and its ramps, stretches of
   the National Highway, 21 roundabouts, and a scattering of subdivision
   streets. The router obeys them (routeEngine's ONE-WAY block); this is how a
   person reading the map can see the same thing, which matters when the
   operator is deciding whether the route they were handed is sane.

   WHY ITS OWN LAYER RATHER THAN PART OF RoadNetworkLayer
   That layer draws the whole network into a single canvas in one pass, which
   is what keeps hover and click responsive over thousands of segments. Arrows
   need to be rotated, individually positioned symbols; putting them in that
   canvas would mean re-drawing the network every time the map moved.

   WHY ZOOM-GATED
   Below MIN_ZOOM the arrows are smaller than the gap between the roads they
   sit on, so they read as speckle over the map and hide the flood colours,
   which are the point of these screens. Above it there are rarely more than a
   few dozen in view. This is the same threshold OSM's own cartography uses,
   and for the same reason.

   The arrow always points the way traffic is ALLOWED to go, which for
   `oneway = -1` is backwards along the stored geometry.
   ============================================================ */

const MIN_ZOOM = 16
// Metres between repeats along a long one-way road, so a highway carries a
// run of arrows rather than one lonely marker in the middle.
const SPACING_M = 140

const arrowIcon = (deg, wrong) => L.divIcon({
  className: 'ow-arrow-wrap',
  html: `<span class="ow-arrow${wrong ? ' ow-arrow--wrong' : ''}" style="transform:rotate(${deg}deg)"></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

function metresBetween([lat1, lng1], [lat2, lng2]) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Compass bearing a → b, degrees clockwise from north. */
function bearingDeg([lat1, lng1], [lat2, lng2]) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLng = toRad(lng2 - lng1)
  const y = Math.sin(dLng) * Math.cos(toRad(lat2))
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

/**
 * @param roads      the road FeatureCollection (properties.oneway: 0 | ±1)
 * @param wrongWays  way ids the current route counterflows along — drawn red,
 *                   so a relaxed route shows WHERE it breaks the rule
 */
export default function OneWayArrowsLayer({ roads, wrongWays = [] }) {
  const map = useMap()
  const groupRef = useRef(null)
  const wrongRef = useRef(new Set(wrongWays))
  wrongRef.current = new Set(wrongWays)

  useEffect(() => {
    if (!roads) return undefined
    const group = L.layerGroup().addTo(map)
    groupRef.current = group

    // Only the one-way ways, pre-filtered once: 290 of 4,853, so every redraw
    // below walks 6% of the network instead of all of it.
    const oneways = (roads.features || []).filter((f) => f.properties?.oneway)

    function redraw() {
      group.clearLayers()
      if (map.getZoom() < MIN_ZOOM) return
      const bounds = map.getBounds().pad(0.15)

      for (const f of oneways) {
        const dir = f.properties.oneway
        const coords = f.geometry?.coordinates
        if (!Array.isArray(coords) || coords.length < 2) continue

        // [lng,lat] → [lat,lng], reversed when traffic runs against the
        // stored geometry, so the walk below always goes the LEGAL way.
        let pts = coords.map(([lng, lat]) => [lat, lng])
        if (dir === -1) pts = pts.reverse()

        const wrong = wrongRef.current.has(f.properties.id)
        let since = SPACING_M // place one at the first in-view vertex
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1]
          const b = pts[i]
          since += metresBetween(a, b)
          if (since < SPACING_M) continue
          const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
          if (!bounds.contains(mid)) continue
          since = 0
          group.addLayer(L.marker(mid, {
            icon: arrowIcon(bearingDeg(a, b), wrong),
            interactive: false,
            keyboard: false,
          }))
        }
      }
    }

    redraw()
    map.on('moveend zoomend', redraw)
    return () => {
      map.off('moveend zoomend', redraw)
      map.removeLayer(group)
      groupRef.current = null
    }
  }, [map, roads])

  // Recolour when the route changes without rebuilding the whole layer.
  useEffect(() => {
    if (groupRef.current) map.fire('moveend')
  }, [map, wrongWays])

  return null
}
