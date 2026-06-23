/* ============================================================
   Shared Leaflet / OpenStreetMap helpers for the admin map pages
   (Flood Map, Hazard Layer, …).

   The Conceptual Framework specifies Leaflet.js + OpenStreetMap +
   Overpass for all mapping, so every admin map screen reuses the same
   Cabuyao boundary lock, coordinate readout and risk vocabulary defined
   here instead of re-implementing them per page.
   ============================================================ */

import { useEffect, useRef } from 'react'
import { useMap, useMapEvents, CircleMarker, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import { barangayOuterRings, barangayBounds } from '../../data/cabuyaoBarangays.js'
import { useGeolocation } from '../../hooks/useGeolocation.js'
import './locateControl.css'

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
let cabuyaoRingsPromise = null
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
 * The official Cabuyao City boundary as [lat, lng] outer rings, fetched once
 * per session from OpenStreetMap (Nominatim) with an approximate box as the
 * offline fallback. Shared by the Leaflet CabuyaoLock AND the Mapbox 3D
 * boundary layer so both views draw the exact same border.
 */
export function loadCabuyaoRings() {
  if (cabuyaoRingsCache) return Promise.resolve(cabuyaoRingsCache)
  if (cabuyaoRingsPromise) return cabuyaoRingsPromise
  cabuyaoRingsPromise = fetch(NOMINATIM_URL, { headers: { Accept: 'application/json' } })
    .then((res) => res.json())
    .then((data) => {
      const rings = ringsFromGeoJSON(data?.[0]?.geojson)
      cabuyaoRingsCache = rings && rings.length ? rings : [CABUYAO_FALLBACK_RING]
      return cabuyaoRingsCache
    })
    .catch(() => {
      cabuyaoRingsCache = [CABUYAO_FALLBACK_RING]
      return cabuyaoRingsCache
    })
  return cabuyaoRingsPromise
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

    loadCabuyaoRings().then(apply)
    return () => {
      cancelled = true
      if (maskLayer) map.removeLayer(maskLayer)
      if (outlineLayer) map.removeLayer(outlineLayer)
    }
  }, [map])

  return null
}

/**
 * Locks the map to a SINGLE barangay — the official's own jurisdiction. Greys
 * out + disables everything outside the barangay border and clamps panning/zoom
 * to it, so an official in "My Barangay" view literally cannot see or interact
 * with neighbouring barangays. The barangay polygon is bundled (no fetch), so
 * unlike CabuyaoLock this applies synchronously. Drop-in alternative to
 * CabuyaoLock; switching the two (mine ⇄ city) re-establishes the right bounds.
 */
export function BarangayLock({ name }) {
  const map = useMap()

  useEffect(() => {
    const rings = barangayOuterRings(name)
    const bounds = barangayBounds(name)
    if (!rings.length || !bounds) return undefined

    // Barangay outline (blue, non-interactive) — the jurisdiction border.
    const outline = L.polygon(rings, {
      color: '#1A3A7A',
      weight: 2.5,
      fill: false,
      interactive: false,
    }).addTo(map)

    // Grey mask: world rectangle with the barangay cut out as holes. The filled
    // (outside) area swallows clicks; the holes let clicks reach the barangay.
    const world = [
      [-90, -180],
      [90, -180],
      [90, 180],
      [-90, 180],
    ]
    const mask = L.polygon([world, ...rings], {
      stroke: false,
      fillColor: '#9ca3af',
      fillOpacity: 0.6,
      fillRule: 'evenodd',
      interactive: true,
    }).addTo(map)
    mask.on('click', (e) => L.DomEvent.stop(e))

    // Clamp panning/zoom to the barangay.
    const b = L.latLngBounds(bounds)
    map.setMaxBounds(b.pad(0.4))
    map.options.maxBoundsViscosity = 1.0
    map.setMinZoom(Math.floor(map.getBoundsZoom(b)))
    map.fitBounds(b, { padding: [24, 24] })

    return () => {
      map.removeLayer(outline)
      map.removeLayer(mask)
      // Release the clamp so a sibling lock (CabuyaoLock for City view) can
      // re-fit cleanly when the official toggles back.
      map.setMaxBounds(null)
      map.setMinZoom(0)
    }
  }, [map, name])

  return null
}

/**
 * Segmented "My Barangay / City" jurisdiction switch for the barangay map
 * toolbars. Reuses the 2D/3D toggle styling (.map3d-viewtoggle) so the two
 * controls read as a matched pair.
 */
export function JurisdictionToggle({ value, onChange, brgyLabel = 'My Barangay', className = '' }) {
  return (
    <div className={`map3d-viewtoggle ${className}`} role="group" aria-label="Map jurisdiction">
      <button type="button" className={value === 'mine' ? 'active' : ''} onClick={() => onChange('mine')}>
        {brgyLabel}
      </button>
      <button type="button" className={value === 'city' ? 'active' : ''} onClick={() => onChange('city')}>
        City
      </button>
    </div>
  )
}

/**
 * "Locate me" map control + a live "You are here" marker.
 *
 * The system uses each user's REAL device position. Clicking the crosshair asks
 * the browser for permission (HTML5 Geolocation) and, once granted, drops a blue
 * "You are here" dot at the device's true coordinates and flies the map there —
 * even if that's outside Cabuyao: the Cabuyao pan/zoom clamp is released so the
 * camera can travel to wherever the user actually is. A denial is shown inline
 * (a small message beside the button), never as a crash.
 *
 * Must live inside <MapContainer>. Optional `onLocated(coords)` lets a page
 * react to the fix (e.g. measure distance to the nearest shelter).
 */
export function LocateControl({ position = 'topright', onLocated }) {
  const map = useMap()
  const { coords, error, loading, locate } = useGeolocation()
  const handlerRef = useRef(null)
  const msgRef = useRef(null)
  const btnRef = useRef(null)

  // Keep the latest handler in a ref so the once-created button always runs
  // current logic without re-adding the Leaflet control.
  handlerRef.current = async () => {
    try {
      const c = await locate()
      // Release the Cabuyao clamp so the camera can reach the user's true
      // position anywhere in the world, then fly there.
      map.setMaxBounds(null)
      map.setMinZoom(0)
      map.flyTo([c.lat, c.lng], 16, { duration: 1.2 })
      onLocated?.(c)
    } catch {
      /* error surfaced via the `error` state effect below */
    }
  }

  useEffect(() => {
    const control = L.control({ position })
    control.onAdd = () => {
      const wrap = L.DomUtil.create('div', 'leaflet-bar locate-control')
      const btn = L.DomUtil.create('a', 'locate-btn', wrap)
      btn.href = '#'
      btn.title = 'Show my location'
      btn.setAttribute('role', 'button')
      btn.setAttribute('aria-label', 'Show my location')
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>'
      const msg = L.DomUtil.create('span', 'locate-msg', wrap)
      msgRef.current = msg
      btnRef.current = btn
      L.DomEvent.disableClickPropagation(wrap)
      L.DomEvent.on(btn, 'click', (e) => {
        L.DomEvent.stop(e)
        handlerRef.current?.()
      })
      return wrap
    }
    control.addTo(map)
    return () => control.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  // Reflect loading / error onto the existing control (no re-create).
  useEffect(() => {
    if (btnRef.current) btnRef.current.classList.toggle('loading', loading)
  }, [loading])
  useEffect(() => {
    const msg = msgRef.current
    if (!msg) return undefined
    if (error) {
      msg.textContent = error
      msg.classList.add('show')
      const id = setTimeout(() => msg.classList.remove('show'), 5000)
      return () => clearTimeout(id)
    }
    msg.classList.remove('show')
    return undefined
  }, [error])

  if (!coords) return null
  return (
    <CircleMarker
      center={[coords.lat, coords.lng]}
      radius={8}
      pathOptions={{ color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
    >
      <Tooltip direction="top" offset={[0, -6]}>You are here</Tooltip>
    </CircleMarker>
  )
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
