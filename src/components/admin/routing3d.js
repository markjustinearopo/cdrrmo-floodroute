/* ============================================================
   Shared Mapbox-GL helpers for the ROUTING screens' 3D view
   (Auto Route · Route Planning · Road Status · Override Routes,
   plus the barangay/resident routing pages).

   The Mapbox-GL twin of routingHelpers.jsx: the SAME bundled road
   network (every street in Cabuyao), the same class-based line
   weights, the same status vocabulary (Passable / Flooded / Closed)
   and the same route-line language (halo + core + flowing dash) —
   as native Mapbox sources/layers so everything is draped onto the
   3D terrain and stays glued to the ground through any camera move.

   2D ⇄ 3D is a VIEW PREFERENCE only: both views render the exact
   same GeoJSON, the same statusMap and the same route geometry, so
   toggling can never change what the data says.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { ROAD_STATUS, ROAD_CLASS_META, roadClassMeta, haversineMeters } from './routingHelpers.jsx'
import { CABUYAO_3D_VIEW } from './Map3D.jsx'
import { addCityBoundary, lockMapToBarangay } from './mapbox3dHelpers.js'
import { isOnLand } from '../../data/cabuyaoBarangays.js'

/* ── Generic page wiring ─────────────────────────────────────────────────────
   Tiny hook every routing 3D view uses: run `setup(map)` once when the style
   + terrain are ready, expose { onMapLoad, mapRef, ready } so the page's
   effects can push live updates afterwards. */
export function useMap3DSetup(setup) {
  const mapRef = useRef(null)
  const [ready, setReady] = useState(false)
  const setupRef = useRef(setup)
  setupRef.current = setup

  const onMapLoad = useCallback((map) => {
    mapRef.current = map
    setupRef.current?.(map)
    setReady(true)
  }, [])

  // The map itself is torn down by Map3D's unmount; just drop the ref.
  useEffect(
    () => () => {
      mapRef.current = null
    },
    [],
  )

  return { onMapLoad, mapRef, ready }
}

/* ── Coordinate conversions ([lat,lng] app order ⇄ [lng,lat] Mapbox) ──────── */
export const toLngLat = ([lat, lng]) => [lng, lat]

export function lineFC(latlngs) {
  if (!Array.isArray(latlngs) || latlngs.length < 2) {
    return { type: 'FeatureCollection', features: [] }
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: latlngs.map(toLngLat) },
        properties: {},
      },
    ],
  }
}

/** Fly the camera to frame a [lat,lng] path, keeping the pitched 3D look. */
export function fitToCoords3D(map, latlngs, { padding = 70, maxZoom = 16, duration = 900 } = {}) {
  if (!latlngs || latlngs.length < 2) return
  const bounds = new mapboxgl.LngLatBounds()
  for (const p of latlngs) bounds.extend(toLngLat(p))
  map.fitBounds(bounds, {
    padding,
    maxZoom,
    duration,
    pitch: CABUYAO_3D_VIEW.pitch,
    bearing: CABUYAO_3D_VIEW.bearing,
  })
}

/* ── Full road network (the 2D RoadNetworkLayer, as a native layer) ────────── */

// Class-keyed match expressions so the 3D network reads exactly like the 2D
// canvas layer: expressways heavy, residential fine, flagged roads loud.
function classWidthExpr() {
  const expr = ['match', ['get', 'highway']]
  for (const [cls, meta] of Object.entries(ROAD_CLASS_META)) expr.push(cls, meta.weight)
  expr.push(2) // DEFAULT_CLASS_META.weight
  return expr
}

function classOpacityExpr() {
  const byRank = (rank) => (rank <= 1 ? 0.6 : rank === 2 ? 0.45 : 0.35)
  const expr = ['match', ['get', 'highway']]
  for (const [cls, meta] of Object.entries(ROAD_CLASS_META)) expr.push(cls, byRank(meta.rank))
  expr.push(0.45)
  return expr
}

const statusExpr = ['coalesce', ['feature-state', 'status'], 'open']
const hoverExpr = ['boolean', ['feature-state', 'hover'], false]

// First symbol (label) layer of the basemap — fills/lines insert beneath it
// so place and street names stay legible above our layers.
function firstSymbolLayerId(map) {
  const layers = map.getStyle()?.layers || []
  return layers.find((l) => l.type === 'symbol')?.id
}

/**
 * Hides the basemap's own road LINE layers (roads, bridges, tunnels). The
 * full-network views draw every Cabuyao street themselves — leaving the
 * dark-v11 road casings underneath doubles every line inside the city and
 * litters the picture with roads far outside the boundary. Street-name
 * labels are symbol layers and stay on.
 */
export function hideBasemapRoads(map) {
  for (const layer of map.getStyle()?.layers || []) {
    if (layer.type === 'line' && layer['source-layer'] === 'road') {
      map.setLayoutProperty(layer.id, 'visibility', 'none')
    }
  }
}

/* ── Clip the bundled network to the REAL city footprint ─────────────────────
   The bundled roads are cut to the city BOUNDING BOX, which sweeps in whole
   subdivisions south/west of the actual boundary (Nuvali, Southern Plains,
   Canlubang). The 2D Leaflet view hides those under the grey CabuyaoLock mask
   + maxBounds, so they never read as part of the system. The 3D view has no
   such mask, so a way outside the barangay polygons would draw — and stay
   clickable to flag. We drop any way that doesn't touch real city land: a way
   is kept when ANY of its vertices is inside a barangay polygon (isOnLand,
   which bbox-rejects first), so the national highway / expressway that thread
   across the boundary stay connected while the off-city estates disappear.
   Memoised on the roads object — this runs once per session. */
let cityRoadsCache = { src: null, clipped: null }
export function clipRoadsToCity(roads) {
  if (!roads?.features) return roads
  if (cityRoadsCache.src === roads) return cityRoadsCache.clipped
  const features = roads.features.filter((f) => {
    const coords = f.geometry?.coordinates
    if (!Array.isArray(coords)) return false
    for (let i = 0; i < coords.length; i++) {
      if (isOnLand(coords[i][1], coords[i][0])) return true // [lng,lat] → lat,lng
    }
    return false
  })
  const clipped = { type: 'FeatureCollection', features }
  cityRoadsCache = { src: roads, clipped }
  return clipped
}

/**
 * Adds the COMPLETE Cabuyao road network as a native line layer.
 *   interactive → hover highlight + name tooltip + click-to-pick
 *                 (the 3D version of Road Status painting)
 * Status colours ride on feature-state — see applyRoadStatus3D().
 * The basemap's own road lines are hidden and the bundled network is clipped
 * to the real barangay polygons: ONLY streets inside the city boundary draw,
 * nothing outside — matching what the 2D mask leaves visible.
 */
export function addRoadNetwork3D(map, roads, { interactive = false, onPick, visible = true } = {}) {
  if (!roads || map.getSource('roads-net')) return
  hideBasemapRoads(map)
  map.addSource('roads-net', { type: 'geojson', data: clipRoadsToCity(roads), promoteId: 'id' })

  const flaggedWidth = ROAD_STATUS.flooded.weight // 5 — same loud style as 2D
  const baseWidth = [
    'match', statusExpr,
    'flooded', flaggedWidth,
    'blocked', flaggedWidth,
    classWidthExpr(),
  ]

  map.addLayer(
    {
      id: 'roads-net',
      type: 'line',
      source: 'roads-net',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        visibility: visible ? 'visible' : 'none',
      },
      paint: {
        'line-color': [
          'match', statusExpr,
          'flooded', ROAD_STATUS.flooded.line,
          'blocked', ROAD_STATUS.blocked.line,
          '#8b9cb6', // passable: a lighter slate than 2D so it reads on dark-v11
        ],
        'line-width': ['case', hoverExpr, ['+', baseWidth, 3], baseWidth],
        'line-opacity': [
          'case', hoverExpr, 1,
          ['match', statusExpr, 'flooded', 0.95, 'blocked', 0.95, classOpacityExpr()],
        ],
      },
    },
    firstSymbolLayerId(map), // street/place names stay readable on top
  )

  if (interactive) wireRoadInteraction(map, onPick)
}

// Hover tooltip (name + class, like the 2D road-tip) and click-to-pick.
// Hit-testing queries a small box around the cursor instead of the exact
// pixel — the 3D twin of the 2D canvas renderer's `tolerance: 10`, so thin
// residential streets are as easy to hit as they are in 2D.
const ROAD_HIT_PX = 7

function roadAtPoint(map, point) {
  if (!map.getLayer('roads-net')) return null
  const feats = map.queryRenderedFeatures(
    [
      [point.x - ROAD_HIT_PX, point.y - ROAD_HIT_PX],
      [point.x + ROAD_HIT_PX, point.y + ROAD_HIT_PX],
    ],
    { layers: ['roads-net'] },
  )
  return feats[0] || null
}

function wireRoadInteraction(map, onPick) {
  const popup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'road-tip3d',
    offset: 10,
  })
  let hoverId = null
  const canvas = map.getCanvas()
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

  const clearHover = () => {
    if (hoverId !== null) {
      map.setFeatureState({ source: 'roads-net', id: hoverId }, { hover: false })
      hoverId = null
    }
    canvas.style.cursor = ''
    popup.remove()
  }

  map.on('mousemove', (e) => {
    const f = roadAtPoint(map, e.point)
    if (!f) return clearHover()
    if (hoverId !== null && hoverId !== f.id) {
      map.setFeatureState({ source: 'roads-net', id: hoverId }, { hover: false })
    }
    hoverId = f.id
    map.setFeatureState({ source: 'roads-net', id: hoverId }, { hover: true })
    canvas.style.cursor = 'pointer'
    popup
      .setLngLat(e.lngLat)
      .setHTML(
        `<b>${esc(f.properties.name)}</b><span class="road-tip-class">${roadClassMeta(f.properties.highway).label}</span>`,
      )
      .addTo(map)
  })
  map.on('mouseout', clearHover)
  map.on('click', (e) => {
    const f = roadAtPoint(map, e.point)
    if (f) onPick?.({ ...f.properties })
  })
}

/**
 * Pushes the shared statusMap ({ wayId: 'flooded' | 'blocked' }) onto the
 * network via feature-state, clearing roads that went back to passable.
 * Tracks the previously-flagged ids on the map instance so each update only
 * touches the roads that changed.
 */
export function applyRoadStatus3D(map, statusMap = {}) {
  if (!map.getSource('roads-net')) return
  const prev = map.__roadStatusIds || new Set()
  const next = new Set(Object.keys(statusMap))
  for (const id of prev) {
    if (!next.has(id)) map.setFeatureState({ source: 'roads-net', id }, { status: null })
  }
  for (const [id, status] of Object.entries(statusMap)) {
    map.setFeatureState({ source: 'roads-net', id }, { status })
  }
  map.__roadStatusIds = next
}

/**
 * One-call wiring for a 3D view built around the road network: adds the
 * full network + the city boundary on load, then keeps the shared statusMap
 * synced via feature-state. `onReady(map)` lets a page stack its own layers
 * (routes, centres, risk context) into the same load callback.
 */
export function useRoadNetwork3D({ roads, statusMap = {}, interactive = false, onPick, onReady, jurisdiction = null } = {}) {
  const onPickRef = useRef(onPick)
  const onReadyRef = useRef(onReady)
  const statusRef = useRef(statusMap)
  const jurisdictionRef = useRef(jurisdiction)
  onPickRef.current = onPick
  onReadyRef.current = onReady
  statusRef.current = statusMap
  jurisdictionRef.current = jurisdiction

  const wired = useMap3DSetup((map) => {
    addRoadNetwork3D(map, roads, {
      interactive,
      onPick: (props) => onPickRef.current?.(props),
    })
    applyRoadStatus3D(map, statusRef.current)
    // Lock to the official's barangay in jurisdiction view; otherwise the same
    // OSM city border + outside-city dim as the 2D lock.
    if (jurisdictionRef.current) lockMapToBarangay(map, jurisdictionRef.current)
    else addCityBoundary(map)
    onReadyRef.current?.(map)
  })

  const { mapRef, ready } = wired
  useEffect(() => {
    if (ready && mapRef.current) applyRoadStatus3D(mapRef.current, statusMap)
  }, [statusMap, ready, mapRef])

  return wired
}

/* ── Route lines (halo + core + flowing direction dash) ──────────────────── */

/**
 * Adds an empty route-line group `id` (halo under core, optional white flow
 * dash on top). Feed geometry with setRouteLine3D(); restyle with
 * setRouteLineStyle().
 */
export function addRouteLine3D(
  map,
  id,
  { color = '#C0181B', halo = true, flow = false, width = 4.5, dash = null, opacity = 0.97, beforeId } = {},
) {
  if (map.getSource(id)) return
  map.addSource(id, { type: 'geojson', data: lineFC(null) })
  const layout = { 'line-cap': 'round', 'line-join': 'round' }
  if (halo) {
    map.addLayer(
      {
        id: `${id}-halo`,
        type: 'line',
        source: id,
        layout,
        paint: { 'line-color': color, 'line-width': width + 8, 'line-opacity': 0.22 },
      },
      beforeId,
    )
  }
  map.addLayer(
    {
      id: `${id}-core`,
      type: 'line',
      source: id,
      layout,
      paint: {
        'line-color': color,
        'line-width': width,
        'line-opacity': opacity,
        ...(dash ? { 'line-dasharray': dash } : {}),
      },
    },
    beforeId,
  )
  if (flow) {
    map.addLayer(
      {
        id: `${id}-flow`,
        type: 'line',
        source: id,
        layout,
        paint: {
          'line-color': '#ffffff',
          'line-width': 2,
          'line-opacity': 0.9,
          'line-dasharray': [0, 4, 3],
        },
      },
      beforeId,
    )
  }
}

/** Feeds [lat,lng] geometry into a route-line group (empty array clears it). */
export function setRouteLine3D(map, id, latlngs) {
  map.getSource(id)?.setData(lineFC(latlngs))
}

/** Restyles a route-line group in place (active/ghost switching). */
export function setRouteLineStyle(map, id, { color, opacity, width } = {}) {
  if (!map.getLayer(`${id}-core`)) return
  if (color != null) {
    map.setPaintProperty(`${id}-core`, 'line-color', color)
    if (map.getLayer(`${id}-halo`)) map.setPaintProperty(`${id}-halo`, 'line-color', color)
  }
  if (opacity != null) map.setPaintProperty(`${id}-core`, 'line-opacity', opacity)
  if (width != null) map.setPaintProperty(`${id}-core`, 'line-width', width)
}

/**
 * The animated "direction of travel" dash (the 3D twin of the 2D .ar-flow
 * CSS animation): steps the flow layer's dasharray so the white ticks march
 * A→B. Returns stop(). (The dash-array step trick is the documented Mapbox
 * way to animate a line — dasharray itself doesn't transition.)
 */
const FLOW_SEQUENCE = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
]

export function startFlowDash3D(map, layerId) {
  let step = 0
  const id = setInterval(() => {
    try {
      if (!map.getLayer(layerId)) return
      step = (step + 1) % FLOW_SEQUENCE.length
      map.setPaintProperty(layerId, 'line-dasharray', FLOW_SEQUENCE[step])
    } catch {
      /* map tearing down — skip the tick */
    }
  }, 80)
  return () => clearInterval(id)
}

/* ── Waypoint pins (the SAME .wp-pin chips the Leaflet views use) ─────────── */

/**
 * Drops a numbered/lettered waypoint pin as a mapboxgl.Marker reusing the
 * global .wp-pin CSS, so A/B/stops look identical in 2D and 3D.
 * Returns the Marker (caller removes it on cleanup).
 */
export function createWaypoint3D(map, latlng, { label, kind = 'mid', draggable = false, onDragEnd } = {}) {
  const el = document.createElement('span')
  el.className = `wp-pin wp-${kind}`
  el.textContent = label
  const marker = new mapboxgl.Marker({ element: el, anchor: 'center', draggable })
    .setLngLat(toLngLat(latlng))
    .addTo(map)
  if (draggable && onDragEnd) {
    marker.on('dragend', () => {
      const ll = marker.getLngLat()
      onDragEnd([ll.lat, ll.lng])
    })
  }
  return marker
}

/**
 * Declarative bridge for pin sets: reconciles a list of pin descriptors
 * ({ key, latlng, label, kind, draggable, onDragEnd }) against the markers
 * currently on the map. Pages call this from an effect whenever their
 * waypoints change; pass [] to clear.
 */
export function syncWaypoints3D(map, store, pins) {
  const seen = new Set()
  for (const pin of pins) {
    seen.add(pin.key)
    const existing = store.get(pin.key)
    if (existing) {
      existing.marker.setLngLat(toLngLat(pin.latlng))
      // Label/kind changes (e.g. a mid pin becoming B) re-skin the element.
      if (existing.label !== pin.label || existing.kind !== pin.kind) {
        existing.marker.getElement().textContent = pin.label
        existing.marker.getElement().className = `wp-pin wp-${pin.kind}`
        existing.label = pin.label
        existing.kind = pin.kind
      }
    } else {
      const marker = createWaypoint3D(map, pin.latlng, pin)
      store.set(pin.key, { marker, label: pin.label, kind: pin.kind })
    }
  }
  for (const [key, entry] of store) {
    if (!seen.has(key)) {
      entry.marker.remove()
      store.delete(key)
    }
  }
}

/* ── Route reveal (3D-only generation animation) ─────────────────────────── */

const REVEAL_SPEED_MPS = 320 // camera ground speed along the line
const REVEAL_MIN_MS = 2200
const REVEAL_MAX_MS = 6500
const REVEAL_INTRO_MS = 850 // fly to the route start before drawing

const lerpAngle = (a, b, t) => {
  const diff = ((b - a + 540) % 360) - 180
  return (a + diff * t + 360) % 360
}

function segBearing([lat1, lng1], [lat2, lng2]) {
  const toRad = (d) => (d * Math.PI) / 180
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/**
 * The "watch the route draw itself" animation: the line extends from A to B
 * while the camera rides its tip, then pulls back to frame the whole route.
 * Purely presentational — the route data is final before this plays; it is
 * the 3D twin of the 2D flowing-dash cue, not a navigation simulation.
 *
 * A user drag/rotate cancels the flight and snaps the full line in place.
 * Returns cancel() — call it on unmount or before starting a new reveal.
 */
export function playRouteReveal3D(map, lineId, latlngs, { pitch = 60, zoom = 15.6, onDone } = {}) {
  if (!map?.getSource(lineId) || !Array.isArray(latlngs) || latlngs.length < 2) return () => {}

  // Cumulative metres along the path, for distance-true tip placement.
  const cum = new Float64Array(latlngs.length)
  for (let i = 1; i < latlngs.length; i++) {
    cum[i] = cum[i - 1] + haversineMeters(latlngs[i - 1], latlngs[i])
  }
  const total = cum[latlngs.length - 1]
  if (total <= 0) return () => {}
  const duration = Math.max(REVEAL_MIN_MS, Math.min(REVEAL_MAX_MS, (total / REVEAL_SPEED_MPS) * 1000))

  let raf = 0
  let timer = null
  let t0 = 0
  let lastStep = 0
  let finished = false
  let bearing = segBearing(latlngs[0], latlngs[1])

  const finish = (flyOut) => {
    if (finished) return
    finished = true
    cancelAnimationFrame(raf)
    if (timer) clearInterval(timer)
    map.off('dragstart', interrupt)
    map.off('rotatestart', interrupt)
    try {
      setRouteLine3D(map, lineId, latlngs) // always end with the full line
      if (flyOut) fitToCoords3D(map, latlngs)
      onDone?.()
    } catch {
      /* map tearing down */
    }
  }
  const interrupt = () => finish(false)

  const step = () => {
    if (finished) return
    lastStep = performance.now()
    const t = Math.min((lastStep - t0) / duration, 1)
    if (t >= 1) return finish(true)
    // Smoothstep easing: gentle start, gentle arrival.
    const eased = t * t * (3 - 2 * t)
    const d = eased * total

    // Tip of the drawn line at d metres.
    let i = 1
    while (i < latlngs.length - 1 && cum[i] < d) i++
    const span = cum[i] - cum[i - 1] || 1
    const k = (d - cum[i - 1]) / span
    const a = latlngs[i - 1]
    const b = latlngs[i]
    const tip = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]

    try {
      map.getSource(lineId)?.setData(lineFC([...latlngs.slice(0, i), tip]))
      bearing = lerpAngle(bearing, segBearing(a, b), 0.07)
      map.jumpTo({ center: toLngLat(tip), bearing, pitch, zoom })
    } catch {
      finish(false)
    }
  }

  // Intro: clear the line and fly the camera to the route start…
  try {
    setRouteLine3D(map, lineId, null)
    map.easeTo({
      center: toLngLat(latlngs[0]),
      bearing,
      pitch,
      zoom,
      duration: REVEAL_INTRO_MS,
    })
  } catch {
    /* map tearing down */
  }
  map.on('dragstart', interrupt)
  map.on('rotatestart', interrupt)

  // …then draw, RAF-driven with an interval watchdog (throttled tabs).
  const begin = setTimeout(() => {
    if (finished) return
    t0 = performance.now()
    const loop = () => {
      step()
      if (!finished) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    timer = setInterval(() => {
      if (!finished && performance.now() - lastStep > 200) step()
    }, 250)
  }, REVEAL_INTRO_MS + 60)

  return () => {
    clearTimeout(begin)
    finish(false)
  }
}

/* ── Evacuation centres (hoverable, with the chosen one highlighted) ──────── */

function centresFC(centres) {
  return {
    type: 'FeatureCollection',
    features: (centres || [])
      .filter((c) => c.coords)
      .map((c) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.coords[1], c.coords[0]] },
        properties: { id: c.id, name: c.name, barangay: c.barangay || '', capacity: c.capacity ?? '' },
      })),
  }
}

export function addEvacCentres3D(map, centres, { visible = true } = {}) {
  if (map.getSource('evac-centres-3d')) return
  map.addSource('evac-centres-3d', { type: 'geojson', data: centresFC(centres), promoteId: 'id' })
  map.addLayer({
    id: 'evac-centres-3d',
    type: 'circle',
    source: 'evac-centres-3d',
    layout: { visibility: visible ? 'visible' : 'none' },
    paint: {
      'circle-radius': ['case', ['boolean', ['feature-state', 'chosen'], false], 9, 6],
      'circle-color': ['case', ['boolean', ['feature-state', 'chosen'], false], '#1A7A4A', '#2A9D6A'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })

  const popup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'road-tip3d',
    offset: 10,
  })
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  map.on('mouseenter', 'evac-centres-3d', (e) => {
    const f = e.features?.[0]
    if (!f) return
    map.getCanvas().style.cursor = 'pointer'
    popup
      .setLngLat(f.geometry.coordinates)
      .setHTML(
        `<b>${esc(f.properties.name)}</b><span class="road-tip-class">${esc(f.properties.barangay)}${f.properties.capacity ? ` · cap. ${esc(f.properties.capacity)}` : ''}</span>`,
      )
      .addTo(map)
  })
  map.on('mouseleave', 'evac-centres-3d', () => {
    map.getCanvas().style.cursor = ''
    popup.remove()
  })
}

/** Push a fresh centre list onto the existing 3D source (after add). */
export function updateEvacCentres3D(map, centres) {
  const src = map.getSource('evac-centres-3d')
  if (src) src.setData(centresFC(centres))
}

/**
 * One-liner for any 3D view to show the shared evacuation centres and keep them
 * live: adds the layer once the map is ready, re-feeds the source whenever the
 * centre list changes (add / edit / remove from the shared store), and follows
 * the `visible` toggle. Evacuation centres are city-wide, so every 3D map shows
 * the same set — the 3D twin of the Leaflet markers.
 */
export function useEvacCentres3D(mapRef, ready, centres, visible = true) {
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    addEvacCentres3D(map, centres, { visible })
    updateEvacCentres3D(map, centres)
    if (map.getLayer('evac-centres-3d')) {
      map.setLayoutProperty('evac-centres-3d', 'visibility', visible ? 'visible' : 'none')
    }
  }, [mapRef, ready, centres, visible])
}

export function setChosenCentre3D(map, centres, chosenId) {
  if (!map.getSource('evac-centres-3d')) return
  for (const c of centres || []) {
    if (!c.coords) continue
    map.setFeatureState({ source: 'evac-centres-3d', id: c.id }, { chosen: c.id === chosenId })
  }
}

/** True when a 3D map click landed on an evac-centre dot (skip waypoint drop). */
export function clickedEvacCentre3D(map, event) {
  if (!map.getLayer('evac-centres-3d')) return false
  return map.queryRenderedFeatures(event.point, { layers: ['evac-centres-3d'] }).length > 0
}
