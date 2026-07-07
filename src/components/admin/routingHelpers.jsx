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
import ROADS_BUNDLE from '../../data/cabuyaoRoads.json'
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
  // Proposed-but-not-yet-approved barangay edit — drawn dashed/purple so it
  // reads as "awaiting CDRRMO approval", clearly distinct from a live condition.
  pending: { label: 'Pending Approval', line: '#7C3AED', weight: 5, opacity: 0.95, swatch: '#7C3AED', dashArray: '7 7' },
}

/* ── Traffic congestion vocabulary (the rendering side of TRAFFIC_LEVELS) ────
   Orthogonal to ROAD_STATUS — a road can be both flooded and congested — so it
   lives in its own map and is only ever drawn on the dedicated "Traffic" view,
   never mixed with the flood colours. The ramp is the familiar navigation-app
   green→amber→orange→maroon so severity reads instantly, and is deliberately
   kept clear of the flood orange/red. Levels & order mirror TRAFFIC_LEVELS in
   routeEngine.js (penalty + speed factor live there; colours live here). */
export const TRAFFIC_STATUS = {
  light:    { label: 'Light',    hint: 'Slow but flowing',        line: '#A3E635', weight: 4, opacity: 0.9,  swatch: '#A3E635' },
  moderate: { label: 'Moderate', hint: 'Heavy but moving',         line: '#FACC15', weight: 5, opacity: 0.95, swatch: '#FACC15' },
  heavy:    { label: 'Heavy',    hint: 'Crawling — long delays',   line: '#FB923C', weight: 6, opacity: 0.96, swatch: '#FB923C' },
  gridlock: { label: 'Gridlock', hint: 'At a standstill',          line: '#991B1B', weight: 6, opacity: 0.98, swatch: '#991B1B' },
}

export const ROAD_CLASS_META = {
  motorway:        { weight: 8, rank: 0, label: 'Expressway' },
  trunk:           { weight: 6, rank: 1, label: 'Highway' },
  primary:         { weight: 5, rank: 1, label: 'Primary Road' },
  secondary:       { weight: 4, rank: 2, label: 'Secondary Road' },
  tertiary:        { weight: 3, rank: 2, label: 'Tertiary Road' },
  unclassified:    { weight: 2, rank: 3, label: 'Local Road' },
  motorway_link:   { weight: 6, rank: 0, label: 'Expressway Ramp' },
  trunk_link:      { weight: 5, rank: 1, label: 'Highway Ramp' },
  primary_link:    { weight: 4, rank: 1, label: 'Primary Road Link' },
  secondary_link:  { weight: 3, rank: 2, label: 'Secondary Road Link' },
  tertiary_link:   { weight: 2, rank: 2, label: 'Tertiary Road Link' },
}

export function roadClassMeta(highway) {
  return ROAD_CLASS_META[highway] || { weight: 2, rank: 3, label: 'Road' }
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

// Distance readout honours the operator's configured unit (km / miles) from
// System Configuration — see services/systemConfig.js.
export { formatDistance } from '../../services/systemConfig.js'

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

/**
 * The geometry that is currently *active* for dispatch. If the admin set the
 * override as active and it has geometry, return that; otherwise return the
 * planned geometry.
 */
export function activeRouteGeometry(route) {
  if (!route) return []
  if (route.active === 'override' && Array.isArray(route.override) && route.override.length > 1) {
    return route.override
  }
  return routeGeometry(route)
}

export function formatMins(mins) {
  if (!mins || mins < 1) return '<1 min'
  if (mins < 60) return `${Math.round(mins)} min`
  const h = Math.floor(mins / 60)
  return `${h}h ${Math.round(mins % 60)}m`
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
   Cabuyao road network — bundled at build time from cabuyaoRoads.json.
   The bundle format is { ways: [{i, n, h, g: [lat,lng,lat,lng,...]}] }.
   We convert it once at module init to a standard GeoJSON FeatureCollection
   so every consumer (Leaflet layer, routeEngine, routing3d) gets the same
   { id, name, named, highway, geometry.coordinates: [[lng,lat],...] } shape.
   ============================================================ */
function bundleToGeoJSON(bundle) {
  const features = (bundle.ways || []).map((w) => {
    const g = w.g || []
    const coordinates = []
    for (let i = 0; i + 1 < g.length; i += 2) {
      coordinates.push([g[i + 1], g[i]]) // [lng, lat] — GeoJSON order
    }
    return {
      type: 'Feature',
      id: w.i,
      properties: {
        id: w.i,
        name: w.n || `Unnamed ${w.h || 'road'}`,
        named: Boolean(w.n),
        highway: w.h || 'road',
      },
      geometry: { type: 'LineString', coordinates },
    }
  })
  return { type: 'FeatureCollection', features }
}

let roadsCache = bundleToGeoJSON(ROADS_BUNDLE)

/** Synchronous read of the road network — always available immediately. */
export function getCabuyaoRoads() {
  return roadsCache
}

/** React hook — returns the road network; loading is always false. */
export function useCabuyaoRoads() {
  return { roads: roadsCache, loading: false, error: false, retry: () => {} }
}

/**
 * Imperative GeoJSON road layer. Built once with Leaflet (not re-rendered per
 * React commit) so hovering/clicking hundreds of road segments stays smooth.
 * Status colours are pushed via setStyle when `statusMap` changes.
 *
 *  - interactive=true  → hover highlight + click handler (Road Status painting)
 *  - interactive=false → static hazard overlay (Override Routes context)
 */
export function RoadNetworkLayer({ roads, statusMap = {}, trafficMap = {}, view = 'condition', onPick, interactive = true, base = 'open' }) {
  const map = useMap()
  const layerRef = useRef(null)
  const statusRef = useRef(statusMap)
  const trafficRef = useRef(trafficMap)
  const viewRef = useRef(view)
  const onPickRef = useRef(onPick)
  statusRef.current = statusMap
  trafficRef.current = trafficMap
  viewRef.current = view
  onPickRef.current = onPick

  const styleFor = useCallback(
    (id) => {
      // Traffic view: colour by congestion. A closed road still reads as closed
      // (it's impassable however clear the traffic), otherwise paint the
      // congestion level — un-flagged roads fall back to the faint base style.
      if (viewRef.current === 'traffic') {
        if (statusRef.current[id] === 'blocked') {
          const m = ROAD_STATUS.blocked
          return { color: m.line, weight: m.weight, opacity: m.opacity, lineCap: 'round', dashArray: null }
        }
        const lvl = trafficRef.current[id]
        if (lvl && TRAFFIC_STATUS[lvl]) {
          const m = TRAFFIC_STATUS[lvl]
          return { color: m.line, weight: m.weight, opacity: m.opacity, lineCap: 'round', dashArray: null }
        }
        const b = ROAD_STATUS.open
        return { color: b.line, weight: b.weight, opacity: b.opacity, lineCap: 'round', dashArray: null }
      }
      // Condition view (default, unchanged): colour by flood status.
      const st = statusRef.current[id] || base
      const meta = ROAD_STATUS[st] || ROAD_STATUS.open
      return { color: meta.line, weight: meta.weight, opacity: meta.opacity, lineCap: 'round', dashArray: meta.dashArray || null }
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

  // Recolour in place whenever a road's flood status, traffic level, or the
  // active view changes (the refs above already hold the fresh values).
  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.eachLayer((lyr) => {
      const id = lyr.feature?.properties?.id
      if (id != null) lyr.setStyle(styleFor(id))
    })
  }, [statusMap, trafficMap, view, styleFor])

  return null
}

/* ============================================================
   Client-side stores (localStorage) for the admin's manual edits.
   These stand in for the backend save endpoints until the API is
   wired in, and let edits flow between the three routing screens.
   ============================================================ */
const ROUTES_KEY = 'cdrrmo_routes'
const ROAD_STATUS_KEY = 'cdrrmo_road_status'
const ROAD_TRAFFIC_KEY = 'cdrrmo_road_traffic'

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

/* ── Traffic map ({ [wayId]: 'light' | 'moderate' | 'heavy' | 'gridlock' }) ──
   The manual congestion board — a sibling of useRoadStatus, kept in its own
   localStorage key so flood conditions and traffic stay independent and flow
   between the routing screens the same way. Phase 3 swaps the source for a
   live Waze feed; every consumer reads this hook, so only this changes. */
export function loadTrafficStatus() {
  return readJSON(ROAD_TRAFFIC_KEY, {})
}

export function useTrafficStatus() {
  const [trafficMap, setTrafficMap] = useState(loadTrafficStatus)

  useEffect(() => {
    const sync = (e) => {
      if (!e.detail || e.detail.key === ROAD_TRAFFIC_KEY) setTrafficMap(loadTrafficStatus())
    }
    window.addEventListener('cdrrmo-store', sync)
    return () => window.removeEventListener('cdrrmo-store', sync)
  }, [])

  const setTraffic = useCallback((id, level) => {
    setTrafficMap((prev) => {
      const next = { ...prev }
      if (!level || level === 'clear') delete next[id]
      else next[id] = level
      writeJSON(ROAD_TRAFFIC_KEY, next)
      return next
    })
  }, [])

  const clearAllTraffic = useCallback(() => {
    setTrafficMap({})
    writeJSON(ROAD_TRAFFIC_KEY, {})
  }, [])

  return [trafficMap, { setTraffic, clearAllTraffic }]
}
