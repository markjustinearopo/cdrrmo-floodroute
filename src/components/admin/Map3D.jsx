/* ============================================================
   Map3D — shared Mapbox GL JS 3D map.

   The 3D command-center renderer behind the Flood Map, Hazard Layer and
   the routing screens. Two basemaps (see BASEMAPS):

     • 'navigation' — the FRESH / MODERN routing look: Mapbox STANDARD
       style (v3) — photoreal, fully-built 3D buildings city-wide (not just
       OSM's exposed footprints), realistic lighting + ambient shadows, a
       bright "day" preset. This is the engaging, memorable map.
     • 'dark'       — the command-center hazard look: classic dark-v11 with
       exaggerated 3D terrain (the Laguna de Bay basin vs. the western ridge
       barangays read physically) and the layered hazard fills.

   Every hazard layer (inundation surface, barangay risk fills, roads,
   markers, city boundary — see mapbox3dHelpers.js) is a NATIVE Mapbox
   source/layer draped onto the terrain by the renderer, so the hazard
   colours stay glued to the ground through any pan / pitch / rotate.

   Raw `mapboxgl` via useRef + useEffect — not react-map-gl — so the pages
   keep full imperative control (sources, layers, paint pulses, camera).

   Token comes from VITE_MAPBOX_TOKEN; pages gate on hasMapboxToken() and
   keep their Leaflet map when it's absent, so a missing key never blanks
   the hazard picture.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { CABUYAO_LAND_BBOX } from '../../data/cabuyaoBarangays.js'
import WindParticleLayer from './WindParticleLayer.jsx'
import RainfallRadar from './RainfallRadar.jsx'
import './Map3D.css'

export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''

/* The two looks. 'navigation' = Mapbox Standard (3D buildings + lighting are
   built into the style, so no custom extrusion layer is needed and coverage is
   complete). 'dark' = classic style + exaggerated DEM terrain. */
const BASEMAPS = {
  navigation: {
    style: 'mapbox://styles/mapbox/standard',
    standard: true, // configured via setConfigProperty after load
    lightPreset: 'day',
    terrain: 0, // Standard renders its own 3D city — keep it flat + crisp
  },
  dark: {
    style: 'mapbox://styles/mapbox/dark-v11',
    standard: false,
    terrain: 2.5, // exaggeration — dramatize the basin vs. ridge
  },
}

let warnedNoToken = false

/** True when a Mapbox token is configured; warns once when it isn't. */
export function hasMapboxToken() {
  if (!MAPBOX_TOKEN && !warnedNoToken) {
    warnedNoToken = true
    console.warn('[Map3D] No Mapbox token — falling back to Leaflet')
  }
  return Boolean(MAPBOX_TOKEN)
}

/* ── 2D / 3D view preference ─────────────────────────────────────────────── */
/* The 3D map is a user CHOICE, not a replacement: pages default to the
   classic Leaflet map and remember the switch per browser. */
const VIEW_PREF_KEY = 'cdrrmo-map-3d'

export function use3DPreference() {
  const [on, setOn] = useState(
    () => hasMapboxToken() && localStorage.getItem(VIEW_PREF_KEY) === '1',
  )
  const set = useCallback((v) => {
    setOn(v)
    try {
      localStorage.setItem(VIEW_PREF_KEY, v ? '1' : '0')
    } catch {
      /* private mode */
    }
  }, [])
  return [on, set]
}

/** Small 2D/3D segmented switch for the page toolbars. Hidden without a token. */
export function MapViewToggle({ value, onChange, className = '' }) {
  if (!hasMapboxToken()) return null
  return (
    <div className={`map3d-viewtoggle ${className}`} role="group" aria-label="Map view">
      <button type="button" className={value ? '' : 'active'} onClick={() => onChange(false)}>
        2D
      </button>
      <button type="button" className={value ? 'active' : ''} onClick={() => onChange(true)}>
        3D
      </button>
    </div>
  )
}

/* Weather-FX gates: the wind particles / radar sweep are LIVE indicators, not
   permanent decoration — calm or dry conditions render a clean map. */
const WIND_FX_MIN_MS = 5 // ≥ fresh breeze (~18 km/h) before particles show
const RAIN_FX_MIN_MM = 0.5 // ≥ real rain (mm/h) before the radar sweep shows

/* Pitched bird's-eye view of Cabuyao — the default command-center camera. */
export const CABUYAO_3D_VIEW = {
  center: [121.1269, 14.2728],
  zoom: 12,
  pitch: 52,
  bearing: -15,
}

/* Pan/zoom lock around the REAL city footprint (from the barangay polygons —
   the Casile/Pittland uplands reach well southwest of the nominal city box),
   padded so the pitched camera can still frame the edges. */
const PAD = 0.05
const CABUYAO_MAX_BOUNDS = [
  [CABUYAO_LAND_BBOX.w - PAD, CABUYAO_LAND_BBOX.s - PAD],
  [CABUYAO_LAND_BBOX.e + PAD, CABUYAO_LAND_BBOX.n + PAD],
]

/**
 * props:
 *   onMapLoad    — (map) => void, fired once style + terrain are ready
 *   onMapClick   — (lngLat, event) => void
 *   onViewChange — ({ lat, lng, zoom }) => void (for the coords readout)
 *   wind         — { speed (m/s), deg } → animated wind particle overlay
 *   rain         — rainfall mm/h → rotating radar sweep overlay
 *   children     — overlay UI rendered inside the map container
 */
export default function Map3D({
  onMapLoad,
  onMapClick,
  onViewChange,
  wind,
  rain,
  children,
  className = '',
  basemap = 'navigation',
}) {
  const wrapRef = useRef(null)
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  // Keep callbacks in refs so the map is initialised exactly once.
  const onMapLoadRef = useRef(onMapLoad)
  const onMapClickRef = useRef(onMapClick)
  const onViewChangeRef = useRef(onViewChange)
  onMapLoadRef.current = onMapLoad
  onMapClickRef.current = onMapClick
  onViewChangeRef.current = onViewChange

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current) return undefined
    mapboxgl.accessToken = MAPBOX_TOKEN
    const cfg = BASEMAPS[basemap] || BASEMAPS.navigation

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: cfg.style,
      ...CABUYAO_3D_VIEW,
      maxBounds: CABUYAO_MAX_BOUNDS,
      minZoom: 10.5,
      maxPitch: 75, // allow the dramatic, immersive follow-camera tilt
      antialias: true,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right')

    map.on('load', () => {
      // Dev console handle for debugging layer/render state.
      if (import.meta.env.DEV) window.__cdrrmoMap3d = map

      if (cfg.standard) {
        // Mapbox Standard style — drive its built-in 3D city + lighting.
        try {
          map.setConfigProperty('basemap', 'lightPreset', cfg.lightPreset || 'day')
          map.setConfigProperty('basemap', 'show3dObjects', true) // full 3D buildings
          map.setConfigProperty('basemap', 'showPointOfInterestLabels', true)
        } catch {
          /* config is style polish — never block the map on it */
        }
      }

      // 3D terrain — Laguna de Bay basin vs. the Tagaytay-ridge barangays —
      // only on the classic 'dark' command-center basemap.
      if (cfg.terrain > 0) {
        if (!map.getSource('mapbox-dem')) {
          map.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14,
          })
        }
        try {
          map.setTerrain({ source: 'mapbox-dem', exaggeration: cfg.terrain })
          map.setFog({ range: [0.5, 10], color: 'hsl(220, 30%, 10%)', 'horizon-blend': 0.1 })
        } catch {
          /* terrain/fog are additive eye-candy — never block the map on them */
        }
      }

      onMapLoadRef.current?.(map)
    })

    map.on('click', (e) => onMapClickRef.current?.(e.lngLat, e))

    // Surface tile/style/source failures instead of hanging silently.
    map.on('error', (e) => {
      if (import.meta.env.DEV) console.warn('[Map3D] Mapbox error:', e?.error?.message || e?.error || e)
    })

    // Throttled: camera animations (route reveal) jump the map every frame,
    // and each jump fires moveend — don't re-render the page 60×/s for a
    // coordinate readout.
    let lastReport = 0
    const reportView = () => {
      const now = performance.now()
      if (now - lastReport < 200) return
      lastReport = now
      const c = map.getCenter()
      onViewChangeRef.current?.({ lat: c.lat, lng: c.lng, zoom: Math.round(map.getZoom()) })
    }
    map.on('moveend', reportView)
    map.on('zoomend', reportView)
    map.once('load', reportView)

    return () => {
      mapRef.current = null
      map.remove()
    }
    // Re-create the map if the basemap choice changes (dark ⇄ navigation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap])

  // Track the container size for the canvas overlays (Mapbox itself resizes
  // via its own trackResize observer).
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const measure = () =>
      setSize({ width: Math.round(el.clientWidth), height: Math.round(el.clientHeight) })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className={`map3d ${className}`} ref={wrapRef}>
      <div className="map3d-canvas" ref={containerRef} />
      {wind && wind.speed >= WIND_FX_MIN_MS && size.width > 0 && (
        <WindParticleLayer
          windSpeed={wind.speed}
          windDeg={wind.deg}
          width={size.width}
          height={size.height}
        />
      )}
      {rain != null && rain >= RAIN_FX_MIN_MM && size.width > 0 && (
        <RainfallRadar rainfall={rain} width={size.width} height={size.height} />
      )}
      {children}
    </div>
  )
}
