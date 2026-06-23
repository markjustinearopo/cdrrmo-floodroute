/* ============================================================
   Shared Mapbox-GL helpers for the 3D map pages (Flood Map, Hazard Layer).

   The Mapbox-GL twin of BarangayRiskLayer.jsx: the same 18 REAL barangay
   polygons and risk vocabulary, but as native Mapbox sources/layers so the
   pages can drive them imperatively — per-level fill layers (so high-risk
   barangays can PULSE via setPaintProperty), ripple risk markers driven by
   feature-state, the NOAH-style banded inundation surface, the flagged
   road segments + open evacuation centres, and the Cabuyao city boundary.

   EVERYTHING here is a native Mapbox source/layer on purpose: native
   layers are draped onto the 3D terrain by the renderer itself, so the
   hazard colours stay glued to the ground through any camera movement —
   a screen-space overlay (the old Deck.gl path) drew at sea level and
   slid off the exaggerated terrain whenever the map moved.

   Presentation only; risk numbers still come from floodRisk.js, and the
   2D Leaflet views render the same data through BarangayRiskLayer.jsx /
   mapHelpers.jsx — toggling 2D ⇄ 3D never changes what the data says.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BARANGAY_FEATURES,
  CABUYAO_LAND_BBOX,
  barangayBounds,
  barangayOuterRings,
  barangayAt,
} from '../../data/cabuyaoBarangays.js'
import { buildFloodHexes, BAND_FILL } from './floodRisk.js'
import { RISK_META, loadCabuyaoRings } from './mapHelpers.jsx'
import { ROAD_STATUS } from './routingHelpers.jsx'
import { CABUYAO_3D_VIEW } from './Map3D.jsx'

/* Per-class fill opacity factors — same balance the Leaflet layer uses. */
const LEVEL_FILL = { high: 0.7, moderate: 0.64, low: 0.6, safe: 0.5 }

export const BARANGAY_FILL_LAYERS = [
  'barangay-fill-high',
  'barangay-fill-moderate',
  'barangay-fill-low',
  'barangay-fill-safe',
]
const MARKER_LAYERS = ['barangay-marker-ripple', 'barangay-markers']

/* ── Inundation surface (NOAH-style banded heat field) ───────────────────── */

// Band → legend colour, resolved per cell at build time so the fill expression
// stays a simple match on the precomputed band.
const bandColorExpr = [
  'match',
  ['get', 'band'],
  'high', RISK_META.high.color,
  'moderate', RISK_META.moderate.color,
  'low', RISK_META.low.color,
  RISK_META.safe.color,
]

// Per-band fill strength × the page's opacity slider (data-driven, so one
// paint property drives the whole surface).
const inundationOpacityExpr = (base) => [
  '*',
  base,
  [
    'match',
    ['get', 'band'],
    'high', BAND_FILL.high,
    'moderate', BAND_FILL.moderate,
    'low', BAND_FILL.low,
    BAND_FILL.safe,
  ],
]

// The SAME honeycomb the Leaflet InundationGrid draws (buildFloodHexes —
// land-clipped ~100 m hexes banded by depth class), as GeoJSON polygons —
// the 2D and 3D surfaces can never disagree. When `only` is a barangay name the
// surface is clipped to that barangay (jurisdiction view).
function inundationFC(field, only = null) {
  const hexes = only
    ? buildFloodHexes(field).filter((h) => barangayAt(h.center[0], h.center[1]) === only)
    : buildFloodHexes(field)
  return {
    type: 'FeatureCollection',
    features: hexes.map((hex) => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [...hex.ring.map(([lat, lng]) => [lng, lat]), [hex.ring[0][1], hex.ring[0][0]]],
        ],
      },
      properties: { band: hex.band },
    })),
  }
}

/**
 * Adds the flood-inundation honeycomb as a native fill layer (terrain-draped,
 * inserted beneath the barangay fills + basemap labels).
 */
export function addInundationLayer(map, field, baseOpacity = 0.85, visible = true, only = null) {
  map.addSource('inundation', { type: 'geojson', data: inundationFC(field, only) })
  map.addLayer(
    {
      id: 'inundation-fill',
      type: 'fill',
      source: 'inundation',
      layout: { visibility: visible ? 'visible' : 'none' },
      paint: {
        'fill-color': bandColorExpr,
        'fill-opacity': inundationOpacityExpr(baseOpacity),
      },
    },
    firstSymbolLayerId(map),
  )
}

/** Re-feeds the surface when a fresh risk field lands. */
export function updateInundationData(map, field, only = null) {
  map.getSource('inundation')?.setData(inundationFC(field, only))
}

/** Applies the page's opacity slider to the surface. */
export function applyInundationOpacity(map, baseOpacity) {
  if (!map.getLayer('inundation-fill')) return
  map.setPaintProperty('inundation-fill', 'fill-opacity', inundationOpacityExpr(baseOpacity))
}

/* ── Barangay GeoJSON with live risk properties ──────────────────────────── */

function barangayFillFC(samples, only = null) {
  const byName = new Map(samples.map((s) => [s.name, s]))
  const feats = only
    ? BARANGAY_FEATURES.features.filter((f) => f.properties.name === only)
    : BARANGAY_FEATURES.features
  return {
    type: 'FeatureCollection',
    features: feats.map((f) => {
      const s = byName.get(f.properties.name)
      return {
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          name: f.properties.name,
          level: s?.level || 'safe',
          risk: s?.risk ?? 0,
          depth: s?.floodDepth ?? 0,
        },
      }
    }),
  }
}

function barangayMarkerFC(samples, only = null) {
  return {
    type: 'FeatureCollection',
    features: (only ? samples.filter((s) => s.name === only) : samples).map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.coords[1], s.coords[0]] },
      properties: { name: s.name, level: s.level, depth: s.floodDepth },
    })),
  }
}

/* ── Layer management ────────────────────────────────────────────────────── */

// Insert fills beneath the basemap's labels so street/place names stay legible.
function firstSymbolLayerId(map) {
  const layers = map.getStyle()?.layers || []
  return layers.find((l) => l.type === 'symbol')?.id
}

const levelColorExpr = [
  'match',
  ['get', 'level'],
  'high', RISK_META.high.color,
  'moderate', RISK_META.moderate.color,
  'low', RISK_META.low.color,
  RISK_META.safe.color,
]

/**
 * Adds the barangay risk sources + layers to a loaded Mapbox map:
 *   • one fill layer per risk level (so high/moderate can pulse independently)
 *   • white boundary outline + a bright highlight outline for the selection
 *   • risk markers at each polygon's interior point, with a feature-state
 *     ripple ring under the high/moderate ones
 * `baseOpacity` is the 0…1 value from the page's intensity/opacity slider.
 */
export function addBarangayLayers(map, samples, baseOpacity = 0.85, only = null) {
  const beforeId = firstSymbolLayerId(map)

  map.addSource('brgy-fills', { type: 'geojson', data: barangayFillFC(samples, only) })
  map.addSource('brgy-markers', {
    type: 'geojson',
    data: barangayMarkerFC(samples, only),
    promoteId: 'name', // feature-state ids = barangay names
  })

  for (const level of ['safe', 'low', 'moderate', 'high']) {
    map.addLayer(
      {
        id: `barangay-fill-${level}`,
        type: 'fill',
        source: 'brgy-fills',
        filter: ['==', ['get', 'level'], level],
        paint: {
          'fill-color': RISK_META[level].color,
          'fill-opacity': baseOpacity * LEVEL_FILL[level],
        },
      },
      beforeId,
    )
  }

  map.addLayer(
    {
      id: 'barangay-outline',
      type: 'line',
      source: 'brgy-fills',
      paint: { 'line-color': '#ffffff', 'line-width': 1.2, 'line-opacity': 0.85 },
    },
    beforeId,
  )

  // Selection highlight — filter swapped in via setSelectedBarangay().
  map.addLayer({
    id: 'barangay-selected',
    type: 'line',
    source: 'brgy-fills',
    filter: ['==', ['get', 'name'], ''],
    paint: { 'line-color': '#38bdf8', 'line-width': 3, 'line-opacity': 1 },
  })

  map.addLayer({
    id: 'barangay-marker-ripple',
    type: 'circle',
    source: 'brgy-markers',
    filter: ['match', ['get', 'level'], ['high', 'moderate'], true, false],
    paint: {
      'circle-radius': ['+', 6, ['*', 22, ['coalesce', ['feature-state', 'pulse'], 0]]],
      'circle-color': levelColorExpr,
      'circle-opacity': ['*', 0.45, ['-', 1, ['coalesce', ['feature-state', 'pulse'], 0]]],
      'circle-pitch-alignment': 'map',
    },
  })

  map.addLayer({
    id: 'barangay-markers',
    type: 'circle',
    source: 'brgy-markers',
    paint: {
      'circle-radius': 5.5,
      'circle-color': levelColorExpr,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  })
}

/** Re-feeds both sources when a fresh risk field lands. */
export function updateBarangayData(map, samples, only = null) {
  map.getSource('brgy-fills')?.setData(barangayFillFC(samples, only))
  map.getSource('brgy-markers')?.setData(barangayMarkerFC(samples, only))
}

/** Applies the opacity slider to the non-pulsing fills (pulse covers the rest). */
export function applyBarangayOpacity(map, baseOpacity) {
  if (!map.getLayer('barangay-fill-low')) return
  map.setPaintProperty('barangay-fill-low', 'fill-opacity', baseOpacity * LEVEL_FILL.low)
  map.setPaintProperty('barangay-fill-safe', 'fill-opacity', baseOpacity * LEVEL_FILL.safe)
}

/** Show/hide the fill + marker layer groups (page layer toggles). */
export function setBarangayVisibility(map, { fills = true, markers = true } = {}) {
  const vis = (on) => (on ? 'visible' : 'none')
  for (const id of [...BARANGAY_FILL_LAYERS, 'barangay-outline', 'barangay-selected']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis(fills))
  }
  for (const id of MARKER_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis(markers))
  }
}

/** Moves the bright highlight outline onto `name` (or clears it with null). */
export function setSelectedBarangay(map, name) {
  if (!map.getLayer('barangay-selected')) return
  map.setFilter('barangay-selected', ['==', ['get', 'name'], name || ''])
}

/**
 * Click-to-select + pointer cursor across the barangay fills and markers.
 * Listener cleanup rides on map.remove() in Map3D's unmount.
 */
export function onBarangayClick(map, handler) {
  const ids = [...BARANGAY_FILL_LAYERS, 'barangay-markers']
  const canvas = map.getCanvas()
  for (const id of ids) {
    map.on('click', id, (e) => {
      const f = e.features?.[0]
      if (f) handler(f.properties.name, e)
    })
    map.on('mouseenter', id, () => (canvas.style.cursor = 'pointer'))
    map.on('mouseleave', id, () => (canvas.style.cursor = ''))
  }
}

/* ── Generic layer visibility (page toggles) ─────────────────────────────── */
export function setMapLayerVisible(map, ids, on) {
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  }
}

/* ── Cabuyao city boundary (always visible, matches the 2D CabuyaoLock) ──── */

/**
 * Draws the official city border on the 3D map: the SAME OSM/Nominatim rings
 * the Leaflet CabuyaoLock uses, as a red boundary line (white halo so it reads
 * on the dark basemap) plus a dimming mask over everything outside the city.
 * Async (the rings fetch once per session) and fail-soft: if the map is torn
 * down before the rings arrive, nothing happens.
 */
export function addCityBoundary(map) {
  loadCabuyaoRings().then((rings) => {
    try {
      if (!rings?.length || !map.getStyle() || map.getSource('cabuyao-boundary')) return

      // [lat,lng] rings → closed GeoJSON [lng,lat] rings.
      const lngLatRings = rings.map((ring) => {
        const r = ring.map(([lat, lng]) => [lng, lat])
        const [x0, y0] = r[0]
        const [xn, yn] = r[r.length - 1]
        if (x0 !== xn || y0 !== yn) r.push([x0, y0])
        return r
      })

      // Dim everything outside the city (world polygon with Cabuyao cut out),
      // under the labels so place names stay readable.
      const world = [
        [-180, -85],
        [180, -85],
        [180, 85],
        [-180, 85],
        [-180, -85],
      ]
      map.addSource('cabuyao-mask', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [world, ...lngLatRings] },
          properties: {},
        },
      })
      map.addLayer(
        {
          id: 'cabuyao-mask',
          type: 'fill',
          source: 'cabuyao-mask',
          paint: { 'fill-color': '#020617', 'fill-opacity': 0.45 },
        },
        firstSymbolLayerId(map),
      )

      map.addSource('cabuyao-boundary', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'MultiLineString', coordinates: lngLatRings },
          properties: {},
        },
      })
      // Keep the border beneath the risk markers so they stay clickable.
      const beforeId = map.getLayer('barangay-marker-ripple') ? 'barangay-marker-ripple' : undefined
      map.addLayer(
        {
          id: 'cabuyao-boundary-halo',
          type: 'line',
          source: 'cabuyao-boundary',
          paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.28, 'line-blur': 2 },
        },
        beforeId,
      )
      map.addLayer(
        {
          id: 'cabuyao-boundary',
          type: 'line',
          source: 'cabuyao-boundary',
          paint: { 'line-color': '#ef4444', 'line-width': 2.2, 'line-opacity': 0.95 },
        },
        beforeId,
      )
    } catch {
      /* map removed while the rings were in flight */
    }
  })
}

/* ── Barangay jurisdiction lock (3D twin of the 2D BarangayLock) ─────────── */

/**
 * Confines the 3D map to a SINGLE barangay: a dark mask over everything outside
 * the barangay border, a bright border line, and a pan/zoom clamp to the
 * barangay bounds. The 3D counterpart of mapHelpers' BarangayLock and the
 * drop-in replacement for addCityBoundary in "My Barangay" view. Fail-soft and
 * synchronous (the polygon is bundled).
 */
export function lockMapToBarangay(map, name) {
  try {
    const rings = barangayOuterRings(name)
    if (!rings.length || !map.getStyle()) return

    // [lat,lng] rings → closed GeoJSON [lng,lat] rings.
    const lngLatRings = rings.map((ring) => {
      const r = ring.map(([lat, lng]) => [lng, lat])
      const [x0, y0] = r[0]
      const [xn, yn] = r[r.length - 1]
      if (x0 !== xn || y0 !== yn) r.push([x0, y0])
      return r
    })

    const world = [
      [-180, -85],
      [180, -85],
      [180, 85],
      [-180, 85],
      [-180, -85],
    ]
    if (!map.getSource('brgy-juris-mask')) {
      map.addSource('brgy-juris-mask', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [world, ...lngLatRings] },
          properties: {},
        },
      })
      map.addLayer(
        {
          id: 'brgy-juris-mask',
          type: 'fill',
          source: 'brgy-juris-mask',
          paint: { 'fill-color': '#020617', 'fill-opacity': 0.62 },
        },
        firstSymbolLayerId(map),
      )
    }
    if (!map.getSource('brgy-juris-border')) {
      map.addSource('brgy-juris-border', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'MultiLineString', coordinates: lngLatRings },
          properties: {},
        },
      })
      map.addLayer({
        id: 'brgy-juris-border',
        type: 'line',
        source: 'brgy-juris-border',
        paint: { 'line-color': '#38bdf8', 'line-width': 2.5, 'line-opacity': 0.95 },
      })
    }

    // Clamp + frame the barangay ([[w,s],[e,n]] arrays — no mapboxgl import needed).
    const bounds = lngLatBoundsForBarangay(name)
    if (bounds) {
      const pad = 0.012
      const padded = [
        [bounds[0][0] - pad, bounds[0][1] - pad],
        [bounds[1][0] + pad, bounds[1][1] + pad],
      ]
      map.setMaxBounds(null)
      map.fitBounds(bounds, {
        padding: 50,
        pitch: CABUYAO_3D_VIEW.pitch,
        bearing: CABUYAO_3D_VIEW.bearing,
        duration: 0,
        maxZoom: 16,
      })
      map.setMaxBounds(padded)
    }
  } catch {
    /* map removed mid-setup */
  }
}

/* ── Project NOAH 100-yr flood hazard zones (3D terrain-draped) ─────────── */

const NOAH_FILL_COLOR = [
  'match', ['get', 'Var'],
  1, '#FEF9C3',
  2, '#FED7AA',
  3, '#FCA5A5',
  '#FEF9C3',
]
const NOAH_LINE_COLOR = [
  'match', ['get', 'Var'],
  1, '#FBBF24',
  2, '#F97316',
  3, '#C0181B',
  '#FBBF24',
]
const NOAH_FILL_OPACITY = [
  'match', ['get', 'Var'],
  1, 0.45,
  2, 0.52,
  3, 0.58,
  0.45,
]

/**
 * Fetches the bundled NOAH 100-yr flood hazard GeoJSON and adds two terrain-
 * draped layers: a semi-transparent fill (Low/Moderate/High banded by Var)
 * and a matching outline. Inserted beneath the barangay fills so risk
 * overlays stay visible above the static hazard zones.
 * Fail-soft: if the fetch fails or the map is torn down, nothing breaks.
 */
export function addNoahHazardLayer(map) {
  fetch('/noah_cabuyao_flood_100yr.geojson')
    .then((r) => r.json())
    .then((data) => {
      try {
        if (!map.getStyle() || map.getSource('noah-hazard')) return
        map.addSource('noah-hazard', { type: 'geojson', data })
        const before = firstSymbolLayerId(map)
        map.addLayer(
          {
            id: 'noah-hazard-fill',
            type: 'fill',
            source: 'noah-hazard',
            paint: {
              'fill-color': NOAH_FILL_COLOR,
              'fill-opacity': NOAH_FILL_OPACITY,
            },
          },
          before,
        )
        map.addLayer(
          {
            id: 'noah-hazard-line',
            type: 'line',
            source: 'noah-hazard',
            paint: {
              'line-color': NOAH_LINE_COLOR,
              'line-width': 0.8,
              'line-opacity': 0.7,
            },
          },
          before,
        )
      } catch {
        /* map removed while fetch was in flight */
      }
    })
    .catch(() => {})
}

/* ── Flagged roads + evacuation centres (Hazard Layer 3D) ────────────────── */

// Road network features narrowed to the admin's flagged segments, each
// carrying its status so the line colour matches the 2D RoadNetworkLayer.
function hazardRoadsFC(roads, statusMap = {}) {
  if (!roads?.features) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: roads.features
      .filter((f) => statusMap[String(f.properties.id)])
      .map((f) => ({
        ...f,
        properties: { ...f.properties, status: statusMap[String(f.properties.id)] },
      })),
  }
}

export function addHazardRoadsLayer(map, roads, statusMap, visible = true) {
  map.addSource('hazard-roads', { type: 'geojson', data: hazardRoadsFC(roads, statusMap) })
  map.addLayer(
    {
      id: 'hazard-roads',
      type: 'line',
      source: 'hazard-roads',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        visibility: visible ? 'visible' : 'none',
      },
      paint: {
        'line-color': [
          'match',
          ['get', 'status'],
          'flooded', ROAD_STATUS.flooded.line,
          'blocked', ROAD_STATUS.blocked.line,
          ROAD_STATUS.open.line,
        ],
        'line-width': 3.5,
        'line-opacity': 0.95,
      },
    },
    map.getLayer('barangay-marker-ripple') ? 'barangay-marker-ripple' : undefined,
  )
}

export function updateHazardRoadsData(map, roads, statusMap) {
  map.getSource('hazard-roads')?.setData(hazardRoadsFC(roads, statusMap))
}

function evacCentresFC(centres) {
  return {
    type: 'FeatureCollection',
    features: (centres || [])
      .filter((c) => Array.isArray(c.coords))
      .map((c) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.coords[1], c.coords[0]] },
        properties: { name: c.name },
      })),
  }
}

export function addEvacCentersLayer(map, centres, visible = true) {
  map.addSource('evac-centres', { type: 'geojson', data: evacCentresFC(centres) })
  map.addLayer({
    id: 'evac-centres',
    type: 'circle',
    source: 'evac-centres',
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'circle-radius': 6,
      'circle-color': '#1A7A4A',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })
}

/** Re-feed the evac-centres source after an add / edit / remove. */
export function updateEvacCentersData(map, centres) {
  map.getSource('evac-centres')?.setData(evacCentresFC(centres))
}

/* ── Pulse animation (Phase-4 living-threat effect) ──────────────────────── */

/**
 * Starts the ~25 fps pulse: high-risk fills breathe between semi-transparent
 * and solid red (moderate dimmer/slower), while the ripple rings under the
 * elevated markers expand on a sawtooth via feature-state. Returns stop().
 *   getBase       — () => current slider opacity 0…1 (read live each tick)
 *   getRippleNames— () => names of the high/moderate barangays to ripple
 */
export function startBarangayPulse(map, { getBase = () => 0.85, getRippleNames = () => [] } = {}) {
  let pulse = 0
  let direction = 1
  let ripple = 0
  const id = setInterval(() => {
    try {
      if (!map.getLayer('barangay-fill-high')) return
      pulse += direction * 0.018
      if (pulse > 1) { pulse = 1; direction = -1 }
      if (pulse < 0) { pulse = 0; direction = 1 }
      ripple = (ripple + 0.022) % 1

      const base = getBase()
      map.setPaintProperty(
        'barangay-fill-high',
        'fill-opacity',
        Math.min(0.95, base * LEVEL_FILL.high + pulse * 0.3),
      )
      map.setPaintProperty(
        'barangay-fill-moderate',
        'fill-opacity',
        Math.min(0.95, base * LEVEL_FILL.moderate + pulse * 0.15),
      )
      for (const name of getRippleNames()) {
        map.setFeatureState({ source: 'brgy-markers', id: name }, { pulse: ripple })
      }
    } catch {
      /* map tearing down or style mid-reload — skip the tick */
    }
  }, 40)
  return () => clearInterval(id)
}

/* ── Bounds (lng/lat order for Mapbox) ───────────────────────────────────── */

export const CABUYAO_CITY_LNGLAT_BOUNDS = [
  [CABUYAO_LAND_BBOX.w, CABUYAO_LAND_BBOX.s],
  [CABUYAO_LAND_BBOX.e, CABUYAO_LAND_BBOX.n],
]

export function lngLatBoundsForBarangay(name) {
  const b = barangayBounds(name)
  if (!b) return null
  return [
    [b[0][1], b[0][0]],
    [b[1][1], b[1][0]],
  ]
}

/* ── One-call page wiring ────────────────────────────────────────────────── */

/**
 * Everything a 3D map page needs for the hazard picture, as a hook: pass the
 * returned `onMapLoad` to <Map3D>, and the layers, pulse, toggles, live-data
 * refresh and selection focus all stay in sync with the props. The city
 * boundary + outside-city dim are always on, matching the 2D CabuyaoLock.
 *
 *   samples     — barangayRiskSamples(field)
 *   field       — the flood-risk field for the inundation honeycomb (optional)
 *   inundation  — show the inundation surface (page layer toggle)
 *   fills       — show the risk polygons (page layer toggle)
 *   markers     — show the risk markers
 *   baseOpacity — 0…1 from the page's opacity/intensity slider
 *   selected    — focused barangay name (highlight + fly-to) or null
 *   onSelect    — (name) => void on barangay click
 */
export function useBarangayLayers({
  samples,
  field = null,
  inundation = false,
  fills = true,
  markers = true,
  baseOpacity = 0.85,
  selected = null,
  onSelect,
  jurisdiction = null,
}) {
  const mapRef = useRef(null)
  const [ready, setReady] = useState(false)
  const stopPulseRef = useRef(null)
  const firstSelection = useRef(true)

  // Live values for the load callback + pulse interval (created once).
  const samplesRef = useRef(samples)
  const fieldRef = useRef(field)
  const inundationRef = useRef(inundation)
  const opacityRef = useRef(baseOpacity)
  const onSelectRef = useRef(onSelect)
  const jurisdictionRef = useRef(jurisdiction)
  samplesRef.current = samples
  fieldRef.current = field
  inundationRef.current = inundation
  opacityRef.current = baseOpacity
  onSelectRef.current = onSelect
  jurisdictionRef.current = jurisdiction

  const onMapLoad = useCallback((map) => {
    mapRef.current = map
    const juris = jurisdictionRef.current
    addNoahHazardLayer(map)
    addInundationLayer(map, fieldRef.current, opacityRef.current, inundationRef.current, juris)
    addBarangayLayers(map, samplesRef.current, opacityRef.current, juris)
    // "My Barangay" view locks to the own border; "City" keeps the city boundary.
    if (juris) lockMapToBarangay(map, juris)
    else addCityBoundary(map)
    onBarangayClick(map, (name) => onSelectRef.current?.(name))
    stopPulseRef.current = startBarangayPulse(map, {
      getBase: () => opacityRef.current,
      getRippleNames: () =>
        samplesRef.current
          .filter((s) => s.level === 'high' || s.level === 'moderate')
          .map((s) => s.name),
    })
    setReady(true)
  }, [])

  useEffect(
    () => () => {
      stopPulseRef.current?.()
      stopPulseRef.current = null
    },
    [],
  )

  // Fresh risk field → re-feed the sources (keeping the jurisdiction clip).
  useEffect(() => {
    if (ready && mapRef.current) updateBarangayData(mapRef.current, samples, jurisdictionRef.current)
  }, [samples, ready])
  useEffect(() => {
    if (ready && mapRef.current) updateInundationData(mapRef.current, field, jurisdictionRef.current)
  }, [field, ready])

  // Page layer toggles + opacity slider.
  useEffect(() => {
    if (ready && mapRef.current) setBarangayVisibility(mapRef.current, { fills, markers })
  }, [fills, markers, ready])
  useEffect(() => {
    if (ready && mapRef.current) setMapLayerVisible(mapRef.current, 'inundation-fill', inundation)
  }, [inundation, ready])
  useEffect(() => {
    if (ready && mapRef.current) {
      applyBarangayOpacity(mapRef.current, baseOpacity)
      applyInundationOpacity(mapRef.current, baseOpacity)
    }
  }, [baseOpacity, ready])

  // Selection → highlight outline + fly to the barangay (keeping the pitched
  // command-center camera); clearing flies back to the whole-city frame.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    setSelectedBarangay(map, selected)
    // In jurisdiction view the camera is already locked to the barangay — don't
    // let a selection fly the camera out to the whole-city frame.
    if (jurisdictionRef.current) return
    if (firstSelection.current) {
      firstSelection.current = false
      if (!selected) return // keep the initial camera on first mount
    }
    const bounds = selected ? lngLatBoundsForBarangay(selected) : CABUYAO_CITY_LNGLAT_BOUNDS
    if (bounds) {
      map.fitBounds(bounds, {
        padding: 60,
        pitch: CABUYAO_3D_VIEW.pitch,
        bearing: CABUYAO_3D_VIEW.bearing,
        maxZoom: 15,
        duration: 900,
      })
    }
  }, [selected, ready])

  return { onMapLoad, mapRef, ready }
}
