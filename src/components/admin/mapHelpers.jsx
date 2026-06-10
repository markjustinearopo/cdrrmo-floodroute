/* ============================================================
   Shared Leaflet / OpenStreetMap helpers for the admin map pages
   (Flood Map, Hazard Layer, …).

   The Conceptual Framework specifies Leaflet.js + OpenStreetMap +
   Overpass for all mapping, so every admin map screen reuses the same
   Cabuyao boundary lock, coordinate readout and risk vocabulary defined
   here instead of re-implementing them per page.
   ============================================================ */

import { useEffect, useRef } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'

/* ── Map centre / zoom (Cabuyao City Hall area) ──────────────────────────── */
export const CABUYAO_CENTER = [14.2476, 121.1367]
export const CABUYAO_ZOOM = 13

/* The 18 official barangays of Cabuyao City (alphabetical). */
export const BARANGAYS = [
  'Baclaran', 'Banay-Banay', 'Banlic', 'Bigaa', 'Butong', 'Casile',
  'Diezmo', 'Gulod', 'Mamatid', 'Marinig', 'Niugan', 'Pittland',
  'Poblacion Dos', 'Poblacion Tres', 'Poblacion Uno', 'Pulo', 'Sala',
  'San Isidro',
]

/**
 * Barangay / hazard safeness is driven by measured flood depth (metres).
 * Single source of truth, kept in sync with the Dashboard + the API contract.
 *   SAFE     < 0.1 m   LOW 0.1–<0.3 m   MODERATE 0.3–<0.5 m   HIGH >= 0.5 m
 */
export const DEPTH_THRESHOLDS = { low: 0.1, moderate: 0.3, high: 0.5 }

export function levelFromDepth(depth) {
  if (depth >= DEPTH_THRESHOLDS.high) return 'high'
  if (depth >= DEPTH_THRESHOLDS.moderate) return 'moderate'
  if (depth >= DEPTH_THRESHOLDS.low) return 'low'
  return 'safe'
}

export const RISK_META = {
  high: { label: 'HIGH', color: '#EF4444' },
  moderate: { label: 'MOD', color: '#F97316' },
  low: { label: 'LOW', color: '#EAB308' },
  safe: { label: 'SAFE', color: '#22C55E' },
}

export function formatPHT(date = new Date()) {
  return date.toLocaleTimeString('en-PH', {
    hour12: true,
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  })
}

/* ── Cabuyao boundary (OpenStreetMap / Nominatim) ────────────────────────── */
let cabuyaoRingsCache = null
const NOMINATIM_URL =
  'https://nominatim.openstreetmap.org/search?q=Cabuyao,Laguna,Philippines&format=json&polygon_geojson=1&limit=1'

// Approximate Cabuyao City bounding ring ([lat, lng]) — fallback only.
const CABUYAO_FALLBACK_RING = [
  [14.215, 121.095],
  [14.215, 121.205],
  [14.305, 121.205],
  [14.305, 121.095],
]

// Convert a Nominatim GeoJSON geometry into Leaflet [lat, lng] outer rings.
function ringsFromGeoJSON(geo) {
  if (!geo) return null
  const toLatLng = (ring) => ring.map(([lng, lat]) => [lat, lng])
  if (geo.type === 'Polygon') return [toLatLng(geo.coordinates[0])]
  if (geo.type === 'MultiPolygon') return geo.coordinates.map((poly) => toLatLng(poly[0]))
  return null
}

/**
 * Locks the map to Cabuyao: greys out + disables everything outside the city
 * boundary and clamps panning/zoom to it. The boundary is pulled from
 * OpenStreetMap (Nominatim) at runtime, with an approximate box as offline
 * fallback. Cached at module scope so it's only fetched once per session.
 */
export function CabuyaoLock() {
  const map = useMap()

  useEffect(() => {
    let cancelled = false
    let maskLayer
    let outlineLayer

    function apply(rings) {
      if (cancelled || !rings || !rings.length) return

      // City outline (thin red boundary, non-interactive).
      outlineLayer = L.polygon(rings, {
        color: '#C0181B',
        weight: 2,
        fill: false,
        interactive: false,
      }).addTo(map)

      // Grey mask: a world-sized rectangle with the city cut out as holes.
      // The filled (outside) area swallows clicks; the holes (Cabuyao) let
      // clicks reach the map underneath.
      const world = [
        [-90, -180],
        [90, -180],
        [90, 180],
        [-90, 180],
      ]
      maskLayer = L.polygon([world, ...rings], {
        stroke: false,
        fillColor: '#9ca3af',
        fillOpacity: 0.6,
        fillRule: 'evenodd',
        interactive: true,
      }).addTo(map)
      maskLayer.on('click', (e) => L.DomEvent.stop(e))

      // Clamp panning/zoom to the city.
      const bounds = outlineLayer.getBounds()
      map.setMaxBounds(bounds.pad(0.12))
      map.options.maxBoundsViscosity = 1.0
      map.setMinZoom(Math.floor(map.getBoundsZoom(bounds)))
      map.fitBounds(bounds, { padding: [16, 16] })
    }

    async function load() {
      if (cabuyaoRingsCache) {
        apply(cabuyaoRingsCache)
        return
      }
      try {
        const res = await fetch(NOMINATIM_URL, { headers: { Accept: 'application/json' } })
        const data = await res.json()
        const rings = ringsFromGeoJSON(data?.[0]?.geojson)
        cabuyaoRingsCache = rings && rings.length ? rings : [CABUYAO_FALLBACK_RING]
      } catch {
        cabuyaoRingsCache = [CABUYAO_FALLBACK_RING]
      }
      apply(cabuyaoRingsCache)
    }

    load()
    return () => {
      cancelled = true
      if (maskLayer) map.removeLayer(maskLayer)
      if (outlineLayer) map.removeLayer(outlineLayer)
    }
  }, [map])

  return null
}

/* ── Reads the Leaflet map centre/zoom and reports it upward ─────────────── */
export function CoordReadout({ onChange }) {
  const map = useMapEvents({
    moveend: () => report(),
    zoomend: () => report(),
  })
  const reported = useRef(false)

  function report() {
    const c = map.getCenter()
    onChange({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })
  }

  // Emit the initial position once on mount.
  useEffect(() => {
    if (reported.current) return
    reported.current = true
    report()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
