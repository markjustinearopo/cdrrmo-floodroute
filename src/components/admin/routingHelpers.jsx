/* ============================================================
   Shared helpers for the admin ROUTING screens
   (Route Planning · Road Status · Override Routes).

   The Conceptual Framework specifies Leaflet.js + OpenStreetMap +
   Overpass for all mapping, so these screens reuse the same Cabuyao
   boundary lock + coordinate readout as the other map pages
   (../admin/mapHelpers) and pull the live Cabuyao road network from
   the Overpass API here.

   IMPORTANT — scope of this module: everything here supports the
   *manual* manipulation of routing by the admin (drawing routes,
   tagging road conditions, drawing manual overrides). The automatic,
   algorithmic flood-aware route suggestion is intentionally NOT built
   yet — it needs dedicated study — so the UI exposes it only as a
   clearly-disabled "coming soon" control.

   Until the Node/Express + PostGIS backend is wired in, the admin's
   manual edits are persisted client-side (localStorage) so they
   survive a refresh and flow between the three routing screens.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import './routingHelpers.css'

/* ── Cabuyao road-network bounding box (S, W, N, E) ──────────────────────────
   Matches the approximate city box used by the Cabuyao boundary lock in
   mapHelpers, padded slightly so edge roads aren't clipped. */
export const CABUYAO_BBOX = { s: 14.205, w: 121.085, n: 14.315, e: 121.215 }

/* ── Route + road vocabularies (single source of truth for the screens) ──── */
export const ROUTE_TYPES = {
  evacuation: { label: 'Evacuation', color: '#C0181B', desc: 'Residents → evacuation centre' },
  relief: { label: 'Relief / Supply', color: '#1A3A7A', desc: 'Supplies → affected barangay' },
  response: { label: 'Emergency Response', color: '#1A7A4A', desc: 'Responders → incident site' },
}

export const ROAD_STATUS = {
  open: { label: 'Passable', line: '#64748B', weight: 3, opacity: 0.5, swatch: '#22C55E' },
  flooded: { label: 'Flooded', line: '#F97316', weight: 5, opacity: 0.95, swatch: '#F97316' },
  blocked: { label: 'Closed', line: '#DC2626', weight: 5, opacity: 0.95, swatch: '#DC2626' },
}

/* ── Geometry helpers ────────────────────────────────────────────────────── */
const R_EARTH = 6371000 // metres

export function haversineMeters([lat1, lng1], [lat2, lng2]) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.sqrt(a))
}

export function pathLengthMeters(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += haversineMeters(points[i - 1], points[i])
  return total
}

export function formatDistance(m) {
  if (!m) return '0 m'
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`
}

// Rough walking ETA (5 km/h) — a friendly readout, not a routing claim.
export function formatWalkEta(meters) {
  const mins = Math.round(meters / 1000 / 5 * 60)
  if (mins < 1) return '<1 min'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m`
}

// Rough vehicle ETA (≈24 km/h average through city streets) — for the
// convoy/response routes the auto-router produces.
export function formatDriveEta(meters) {
  const mins = Math.round((meters / 1000 / 24) * 60)
  if (mins < 1) return '<1 min'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m`
}

/**
 * The geometry a route should be drawn/measured with. An auto-generated or
 * overridden route carries a road-following `path`; a plain manual route only
 * has its clicked `points`. Screens call this so a saved route renders the
 * same everywhere it appears.
 */
export function routeGeometry(route) {
  if (!route) return []
  if (Array.isArray(route.path) && route.path.length > 1) return route.path
  return route.points || []
}

// A human label for a road: its OSM name, or a friendly "Unnamed …" fallback
// derived from the highway class (many minor Cabuyao ways carry no name tag).
const HIGHWAY_LABEL = {
  motorway: 'expressway',
  trunk: 'highway',
  primary: 'primary road',
  secondary: 'secondary road',
  tertiary: 'tertiary road',
  unclassified: 'local road',
}
function roadName(tags) {
  if (tags?.name) return tags.name
  const base = (tags?.highway || '').replace(/_link$/, '')
  return `Unnamed ${HIGHWAY_LABEL[base] || 'road'}`
}

/* ── Numbered / lettered waypoint pins (custom divIcon, no marker images) ── */
export function waypointIcon(label, kind = 'mid') {
  return L.divIcon({
    className: 'wp-divicon',
    html: `<span class="wp-pin wp-${kind}">${label}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

/* ── Map click catcher — drops a waypoint wherever the admin clicks ───────── */
export function ClickToAddWaypoint({ onAdd, enabled = true }) {
  useMapEvents({
    click(e) {
      if (enabled) onAdd([e.latlng.lat, e.latlng.lng])
    },
  })
  return null
}

/* ============================================================
   Cabuyao road network (Overpass API)
   ============================================================ */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

// Arterial + collector roads only (motorway → tertiary, links, unclassified).
// Residential alleys are deliberately excluded: they're the bulk of the ~8k
// city ways, aren't the roads CDRRMO routes convoys/evacuations along, and
// would turn the clickable map into an unreadable hairball.
const ROAD_QUERY =
  `[out:json][timeout:30];` +
  `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|` +
  `motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]` +
  `(${CABUYAO_BBOX.s},${CABUYAO_BBOX.w},${CABUYAO_BBOX.n},${CABUYAO_BBOX.e});` +
  `out geom;`

let roadsCache = null
let roadsPromise = null

function overpassToGeoJSON(data) {
  const features = (data?.elements || [])
    .filter((el) => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length > 1)
    .map((el) => ({
      type: 'Feature',
      id: el.id,
      properties: {
        id: el.id,
        name: roadName(el.tags),
        named: Boolean(el.tags?.name),
        highway: el.tags?.highway || 'road',
      },
      geometry: {
        type: 'LineString',
        coordinates: el.geometry.map((g) => [g.lon, g.lat]),
      },
    }))
  return { type: 'FeatureCollection', features }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

// One Overpass attempt, bounded by an AbortController timeout so a slow or
// hanging mirror can never block the whole load. Returns a FeatureCollection
// on success, or null on any failure (timeout, 429/504, bad body…).
async function tryOverpass(endpoint, timeoutMs) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(ROAD_QUERY),
      signal: ctrl.signal,
    })
    if (!res.ok) return null // 429 Too Many Requests / 504 Gateway Timeout / …
    const fc = overpassToGeoJSON(await res.json())
    return fc.features.length ? fc : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch the Cabuyao road network as GeoJSON LineStrings. Cached at module
 * scope so it's pulled once per session and shared by every routing screen.
 *
 * Overpass commonly answers a cold query with a transient 429/504, so the
 * primary endpoint is retried a few times with backoff before falling back to
 * mirrors (each with a hard timeout — a mirror that simply hangs must not stall
 * the screen, which was the original failure mode).
 */
export function fetchCabuyaoRoads() {
  if (roadsCache) return Promise.resolve(roadsCache)
  if (roadsPromise) return roadsPromise

  roadsPromise = (async () => {
    const [primary, ...mirrors] = OVERPASS_ENDPOINTS

    // Primary endpoint: up to 3 attempts with backoff for transient errors.
    for (let attempt = 0; attempt < 3; attempt++) {
      const fc = await tryOverpass(primary, 25000)
      if (fc) {
        roadsCache = fc
        return fc
      }
      if (attempt < 2) await delay(1200 * (attempt + 1))
    }

    // Fallback mirrors: a single bounded attempt each.
    for (const mirror of mirrors) {
      const fc = await tryOverpass(mirror, 15000)
      if (fc) {
        roadsCache = fc
        return fc
      }
    }

    roadsPromise = null
    throw new Error('Overpass unavailable')
  })()

  return roadsPromise
}

// React wrapper around the cached fetch with loading / error / retry state.
export function useCabuyaoRoads() {
  const [roads, setRoads] = useState(roadsCache)
  const [loading, setLoading] = useState(!roadsCache)
  const [error, setError] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (roadsCache) {
      setRoads(roadsCache)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setError(false)
    fetchCabuyaoRoads()
      .then((fc) => active && (setRoads(fc), setLoading(false)))
      .catch(() => active && (setError(true), setLoading(false)))
    return () => {
      active = false
    }
  }, [nonce])

  const retry = useCallback(() => {
    roadsPromise = null
    setNonce((n) => n + 1)
  }, [])

  return { roads, loading, error, retry }
}

/**
 * Imperative GeoJSON road layer. Built once with Leaflet (not re-rendered per
 * React commit) so hovering/clicking hundreds of road segments stays smooth.
 * Status colours are pushed via setStyle when `statusMap` changes.
 *
 *  - interactive=true  → hover highlight + click handler (Road Status painting)
 *  - interactive=false → static hazard overlay (Override Routes context)
 */
export function RoadNetworkLayer({ roads, statusMap = {}, onPick, interactive = true, base = 'open' }) {
  const map = useMap()
  const layerRef = useRef(null)
  const statusRef = useRef(statusMap)
  const onPickRef = useRef(onPick)
  statusRef.current = statusMap
  onPickRef.current = onPick

  const styleFor = useCallback(
    (id) => {
      const st = statusRef.current[id] || base
      const meta = ROAD_STATUS[st] || ROAD_STATUS.open
      return { color: meta.line, weight: meta.weight, opacity: meta.opacity, lineCap: 'round' }
    },
    [base],
  )

  useEffect(() => {
    if (!roads) return undefined

    // Canvas renderer: draws the whole road network in a single pass and
    // hit-tests hover/click against it, so hundreds of segments stay smooth
    // (an SVG path-per-segment would lock the main thread). `tolerance` widens
    // the clickable/hover band well beyond the hairline stroke so roads are
    // easy to hit — the difference between a chore and a game.
    const renderer = L.canvas({ padding: 0.5, tolerance: 10 })
    const layer = L.geoJSON(roads, {
      interactive,
      renderer,
      style: (f) => styleFor(f.properties.id),
      onEachFeature: (f, lyr) => {
        if (!interactive) return
        const id = f.properties.id
        lyr.bindTooltip(f.properties.name, {
          sticky: true,
          direction: 'top',
          className: 'road-tip',
          opacity: 1,
        })
        lyr.on('mouseover', () => {
          const s = styleFor(id)
          lyr.setStyle({ weight: s.weight + 5, opacity: 1 })
          map.getContainer().style.cursor = 'pointer'
        })
        lyr.on('mouseout', () => {
          lyr.setStyle(styleFor(id))
          map.getContainer().style.cursor = ''
        })
        lyr.on('click', (e) => {
          L.DomEvent.stop(e)
          onPickRef.current?.(f.properties)
        })
      },
    }).addTo(map)

    layerRef.current = layer
    return () => {
      map.removeLayer(layer)
      if (map.hasLayer(renderer)) map.removeLayer(renderer)
      layerRef.current = null
      map.getContainer().style.cursor = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roads, map, interactive])

  // Recolour in place whenever a road's status changes.
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.eachLayer((lyr) => {
      const id = lyr.feature?.properties?.id
      if (id != null) lyr.setStyle(styleFor(id))
    })
  }, [statusMap, styleFor])

  return null
}

/* ============================================================
   Client-side stores (localStorage) for the admin's manual edits.
   These stand in for the backend save endpoints until the API is
   wired in, and let edits flow between the three routing screens.
   ============================================================ */
const ROUTES_KEY = 'cdrrmo_routes'
const ROAD_STATUS_KEY = 'cdrrmo_road_status'

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key))
    return v ?? fallback
  } catch {
    return fallback
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
  // Notify same-tab listeners (the native `storage` event only fires cross-tab).
  window.dispatchEvent(new CustomEvent('cdrrmo-store', { detail: { key } }))
}

/* ── Saved routes ────────────────────────────────────────────────────────── */
export function loadRoutes() {
  return readJSON(ROUTES_KEY, [])
}

/** Subscribe to the saved-routes list; returns [routes, helpers]. */
export function useRoutes() {
  const [routes, setRoutes] = useState(loadRoutes)

  useEffect(() => {
    const sync = (e) => {
      if (!e.detail || e.detail.key === ROUTES_KEY) setRoutes(loadRoutes())
    }
    const syncStorage = (e) => {
      if (e.key === ROUTES_KEY) setRoutes(loadRoutes())
    }
    window.addEventListener('cdrrmo-store', sync)
    window.addEventListener('storage', syncStorage)
    return () => {
      window.removeEventListener('cdrrmo-store', sync)
      window.removeEventListener('storage', syncStorage)
    }
  }, [])

  const addRoute = useCallback((route) => {
    const list = loadRoutes()
    const saved = { id: `r${Date.now()}`, createdAt: Date.now(), ...route }
    writeJSON(ROUTES_KEY, [saved, ...list])
    return saved
  }, [])

  const updateRoute = useCallback((id, patch) => {
    const list = loadRoutes().map((r) => (r.id === id ? { ...r, ...patch } : r))
    writeJSON(ROUTES_KEY, list)
  }, [])

  const removeRoute = useCallback((id) => {
    writeJSON(ROUTES_KEY, loadRoutes().filter((r) => r.id !== id))
  }, [])

  return [routes, { addRoute, updateRoute, removeRoute }]
}

/* ── Road condition map ({ [wayId]: 'flooded' | 'blocked' }) ─────────────── */
export function loadRoadStatus() {
  return readJSON(ROAD_STATUS_KEY, {})
}

export function useRoadStatus() {
  const [statusMap, setStatusMap] = useState(loadRoadStatus)

  useEffect(() => {
    const sync = (e) => {
      if (!e.detail || e.detail.key === ROAD_STATUS_KEY) setStatusMap(loadRoadStatus())
    }
    window.addEventListener('cdrrmo-store', sync)
    return () => window.removeEventListener('cdrrmo-store', sync)
  }, [])

  const setStatus = useCallback((id, status) => {
    setStatusMap((prev) => {
      const next = { ...prev }
      if (!status || status === 'open') delete next[id]
      else next[id] = status
      writeJSON(ROAD_STATUS_KEY, next)
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setStatusMap({})
    writeJSON(ROAD_STATUS_KEY, {})
  }, [])

  return [statusMap, { setStatus, clearAll }]
}
