/* ============================================================
   Flood-risk field for the Cabuyao auto-routing engine.

   This module fuses three real feeds into a single spatial risk surface
   the router can sample anywhere in the city:

     • Open-Meteo Flood API — flood-inundation driver. Live river discharge
       (GloFAS / Copernicus model) blended with topographic susceptibility
       from the Open-Meteo Elevation API (water pools in the low ground).
     • Open-Meteo Forecast API — live weather: rainfall intensity + wind
       that raise the wetness of the field as a storm arrives.
     • OpenStreetMap        — the road network itself (see routeEngine.js).

   All keyless by default; an Open-Meteo API key (Integrations screen) only
   buys higher rate limits. Nothing here is mocked or hard-coded.

   The field is a GRID_N × GRID_N lattice of risk values in [0, 1] over
   the Cabuyao bounding box. `riskAt(lat, lng)` bilinearly interpolates
   it so the router gets a smooth weight at every road-segment midpoint,
   and the Auto Route screen renders the same cells as a heat overlay.

   Everything is fail-soft and keyless: if a feed is unreachable the
   field degrades gracefully (elevation-only, then a neutral baseline)
   and flags which sources are live, so routing still works offline by
   leaning on the admin's manually-flagged road hazards.
   ============================================================ */

import { useCallback, useEffect, useState } from 'react'
import { DEPTH_THRESHOLDS, levelFromDepth } from './mapHelpers.jsx'
import { fetchWeather, reloadWeather } from '../../services/weather.js'
import { BARANGAY_CENTROIDS, CABUYAO_LAND_BBOX, isOnLand } from '../../data/cabuyaoBarangays.js'
import TERRAIN from '../../data/cabuyaoElevation.json'

// Refresh cadence for the hazard surface — matches the weather feed so the
// inundation colours always reflect the most recent rainfall and discharge
// reading rather than freezing at page-load.
export const FIELD_REFRESH_MS = 5 * 60 * 1000

/* Terrain is bundled, not fetched. Elevation is STATIC, so the susceptibility
   base is precomputed from the Open-Meteo Elevation API once (scripts/
   fetch-elevation.mjs) and shipped with the app — the hazard surface is then
   instant, offline-safe, and can never silently collapse to a flat/uniform
   field because the live API rate-limited (a real risk for a life-safety map).
   The lattice geometry travels WITH the elevations so we always sample the same
   grid they were measured on. Only weather + discharge stay live. */
export const GRID_N = TERRAIN.gridN
const { s: S, w: W, n: N, e: E } = TERRAIN.bbox

/* Reference scales used to normalise the live drivers into [0, 1].
   Tuned for a lowland Laguna city beside Laguna de Bay. */
const RAIN_REF_MMH = 20 // ~20 mm/h is already torrential
const WIND_REF_KMH = 80 // tropical-storm-force gusts
const DISCHARGE_REF = 140 // m³/s — basin discharge that floods the plain

/* ── Grid geometry ───────────────────────────────────────────────────────── */
// Cell-centre coordinate for lattice cell (row r, col c). Rows run S→N,
// columns run W→E, both 0…GRID_N-1.
function cellCenter(r, c) {
  const lat = S + ((r + 0.5) / GRID_N) * (N - S)
  const lng = W + ((c + 0.5) / GRID_N) * (E - W)
  return [lat, lng]
}

// The lat/lng bounds of cell (r, c) — used to draw the heat-overlay rectangles.
function cellBounds(r, c) {
  const lat0 = S + (r / GRID_N) * (N - S)
  const lat1 = S + ((r + 1) / GRID_N) * (N - S)
  const lng0 = W + (c / GRID_N) * (E - W)
  const lng1 = W + ((c + 1) / GRID_N) * (E - W)
  return [
    [lat0, lng0],
    [lat1, lng1],
  ]
}

/* ── Risk model ──────────────────────────────────────────────────────────── */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)

/* Absolute height-above-lake susceptibility for the Laguna de Bay floodplain.
   Cabuyao's lakeshore barangays sit at 4–8 m, the town centre at 11–16 m, and
   the western Tagaytay-ridge barangays climb to 70–160 m. Flood susceptibility
   is a function of that ABSOLUTE height — not the city's relative min/max, which
   a single mountain peak would otherwise flatten (making every lowland barangay
   look identical). Fully susceptible at/below the floodplain line, safe at/above
   high ground, smoothly interpolated between. */
const FLOODPLAIN_M = 3 // ≈ lake level — anything this low is fully flood-prone
const SAFE_GROUND_M = 50 // at/above this the ground drains; inherent risk ≈ 0

function floodSusceptibility(elev) {
  if (elev == null || Number.isNaN(elev)) return 0.5
  return clamp01((SAFE_GROUND_M - elev) / (SAFE_GROUND_M - FLOODPLAIN_M))
}

/**
 * Build the GRID_N × GRID_N risk lattice from the three feeds.
 *
 * Per cell:
 *   susceptibility = floodSusceptibility(elevation)  (absolute height-above-lake)
 *   wetness        = 0.6·rain + 0.4·discharge        (how much water is arriving)
 *   risk = susceptibility·(0.50 + 0.50·wetness) + 0.08·wind
 *
 * This reads as a flood-hazard SUSCEPTIBILITY surface (Project-NOAH style):
 * the low-lying lakeshore barangays show as flood-prone even on a dry day —
 * an inherent, terrain-driven fact confirmed by the live elevation feed —
 * and the colours intensify toward red as rain and river discharge climb,
 * while the high western ground stays green. Wind is a minor hazard nudge.
 */
function buildField({ elevation, weather, discharge }) {
  const liveElevation = Array.isArray(elevation)

  // Elevation range across the city (informational — surfaced in meta).
  let minEl = Infinity
  let maxEl = -Infinity
  if (liveElevation) {
    for (const v of elevation) {
      if (v < minEl) minEl = v
      if (v > maxEl) maxEl = v
    }
  }

  const rainNorm = weather ? clamp01(weather.precip / RAIN_REF_MMH) : 0
  const windNorm = weather ? clamp01(weather.wind / WIND_REF_KMH) : 0
  const dischNorm = discharge != null ? clamp01(discharge / DISCHARGE_REF) : 0
  const wetness = clamp01(0.6 * rainNorm + 0.4 * dischNorm)

  const grid = []
  for (let r = 0; r < GRID_N; r++) {
    const row = []
    for (let c = 0; c < GRID_N; c++) {
      const idx = r * GRID_N + c
      // Topographic susceptibility. Without live elevation, assume a flat,
      // moderately-susceptible plain so wetness still shapes the field.
      const susceptibility = liveElevation ? floodSusceptibility(elevation[idx]) : 0.5
      const risk = clamp01(susceptibility * (0.5 + 0.5 * wetness) + 0.08 * windNorm)
      row.push(risk)
    }
    grid.push(row)
  }

  return {
    grid,
    meta: {
      precip: weather ? weather.precip : null,
      wind: weather ? weather.wind : null,
      discharge: discharge ?? null,
      minElev: liveElevation ? minEl : null,
      maxElev: liveElevation ? maxEl : null,
      wetness,
      sources: {
        // Bundled terrain (always on) blended with live Open-Meteo Flood discharge.
        floodHub: true,
        windy: Boolean(weather),
        osm: true, // the road graph is always OSM
      },
      live: Boolean(weather) || discharge != null,
    },
  }
}

/* ── Sampling + rendering helpers ────────────────────────────────────────── */

// Bilinear interpolation of the risk grid at an arbitrary point. Returns a
// value in [0, 1]; clamps to the lattice so off-grid midpoints stay valid.
function makeRiskAt(grid) {
  return function riskAt(lat, lng) {
    if (!grid) return 0
    // Fractional cell-centre coordinates.
    let fx = ((lng - W) / (E - W)) * GRID_N - 0.5
    let fy = ((lat - S) / (N - S)) * GRID_N - 0.5
    fx = Math.max(0, Math.min(GRID_N - 1, fx))
    fy = Math.max(0, Math.min(GRID_N - 1, fy))
    const c0 = Math.floor(fx)
    const r0 = Math.floor(fy)
    const c1 = Math.min(GRID_N - 1, c0 + 1)
    const r1 = Math.min(GRID_N - 1, r0 + 1)
    const dx = fx - c0
    const dy = fy - r0
    const top = grid[r0][c0] * (1 - dx) + grid[r0][c1] * dx
    const bot = grid[r1][c0] * (1 - dx) + grid[r1][c1] * dx
    return top * (1 - dy) + bot * dy
  }
}

/**
 * Ground elevation (metres) at a point, bilinearly sampled from the bundled
 * terrain grid. Exposed so the barangay detail card can show the height that
 * drives a barangay's inherent flood susceptibility.
 */
export function elevationAt(lat, lng) {
  const el = TERRAIN.elevation
  let fx = ((lng - W) / (E - W)) * GRID_N - 0.5
  let fy = ((lat - S) / (N - S)) * GRID_N - 0.5
  fx = Math.max(0, Math.min(GRID_N - 1, fx))
  fy = Math.max(0, Math.min(GRID_N - 1, fy))
  const c0 = Math.floor(fx), r0 = Math.floor(fy)
  const c1 = Math.min(GRID_N - 1, c0 + 1), r1 = Math.min(GRID_N - 1, r0 + 1)
  const dx = fx - c0, dy = fy - r0
  const at = (r, c) => el[r * GRID_N + c]
  const top = at(r0, c0) * (1 - dx) + at(r0, c1) * dx
  const bot = at(r1, c0) * (1 - dx) + at(r1, c1) * dx
  return Math.round(top * (1 - dy) + bot * dy)
}

// The lattice as render-ready cells: { bounds, risk, onLand, interior } for the
// heat overlay. `onLand` = cell centre is on Cabuyao land; `interior` = the
// whole cell sits on land (centre + 4 corners), so an interior-only render
// never spills a single pixel into the lake.
function fieldCells(grid) {
  const cells = []
  for (let r = 0; r < GRID_N; r++) {
    for (let c = 0; c < GRID_N; c++) {
      const [lat, lng] = cellCenter(r, c)
      const [[lat0, lng0], [lat1, lng1]] = cellBounds(r, c)
      const onLand = isOnLand(lat, lng)
      const interior =
        onLand &&
        isOnLand(lat0, lng0) &&
        isOnLand(lat0, lng1) &&
        isOnLand(lat1, lng0) &&
        isOnLand(lat1, lng1)
      cells.push({ key: `${r}-${c}`, bounds: cellBounds(r, c), risk: grid[r][c], onLand, interior })
    }
  }
  return cells
}

/* ── Risk vocabulary (shared with the routing UI) ────────────────────────── */
export const RISK_BANDS = { low: 0.34, moderate: 0.62 }

export function riskLevel(risk) {
  if (risk >= RISK_BANDS.moderate) return 'high'
  if (risk >= RISK_BANDS.low) return 'moderate'
  return 'low'
}

export const RISK_LEVEL_META = {
  high: { label: 'High', color: '#EF4444' },
  moderate: { label: 'Moderate', color: '#F97316' },
  low: { label: 'Low', color: '#22C55E' },
}

// Continuous green→yellow→orange→red ramp for the heat overlay.
const RAMP = [
  { t: 0.0, c: [34, 197, 94] }, // green
  { t: 0.34, c: [234, 179, 8] }, // yellow
  { t: 0.62, c: [249, 115, 22] }, // orange
  { t: 1.0, c: [239, 68, 68] }, // red
]

export function riskColor(risk, alpha = 1) {
  const x = clamp01(risk)
  let lo = RAMP[0]
  let hi = RAMP[RAMP.length - 1]
  for (let i = 1; i < RAMP.length; i++) {
    if (x <= RAMP[i].t) {
      lo = RAMP[i - 1]
      hi = RAMP[i]
      break
    }
  }
  const span = hi.t - lo.t || 1
  const k = (x - lo.t) / span
  const ch = (i) => Math.round(lo.c[i] + (hi.c[i] - lo.c[i]) * k)
  return `rgba(${ch(0)}, ${ch(1)}, ${ch(2)}, ${alpha})`
}

/* ── Module-cached fetch ─────────────────────────────────────────────────── */
let fieldCache = null
let fieldPromise = null

async function loadField() {
  // Terrain susceptibility comes from the bundled elevation grid (static +
  // reliable). Only the live-weather snapshot (rainfall, wind + Open-Meteo
  // Flood discharge) is fetched, so a throttled weather feed degrades to the
  // terrain-only hazard base rather than disappearing.
  const wx = await fetchWeather().catch(() => null)

  const weather = wx
    ? { precip: wx.current.rain ?? 0, wind: wx.current.gustKmh ?? wx.current.windKmh ?? 0 }
    : null

  const { grid, meta } = buildField({ elevation: TERRAIN.elevation, weather, discharge: wx?.discharge ?? null })
  return {
    grid,
    cells: fieldCells(grid),
    riskAt: makeRiskAt(grid),
    meta,
  }
}

export function fetchFloodField() {
  if (fieldCache) return Promise.resolve(fieldCache)
  if (fieldPromise) return fieldPromise
  fieldPromise = loadField()
    .then((f) => {
      fieldCache = f
      return f
    })
    .catch((err) => {
      fieldPromise = null
      throw err
    })
  return fieldPromise
}

/**
 * React hook around the cached flood field. While it loads, callers get a
 * neutral zero-risk field so routing still runs (leaning on manual hazards);
 * once the feeds answer, the live field swaps in. `refresh` re-pulls the feeds.
 *
 * Auto-refreshes every FIELD_REFRESH_MS so the inundation colours track live
 * rainfall and river discharge — the field does NOT freeze at page load.
 */
export function useFloodRisk() {
  const [field, setField] = useState(fieldCache)
  const [loading, setLoading] = useState(!fieldCache)
  const [error, setError] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (fieldCache) {
      setField(fieldCache)
      setLoading(false)
      return undefined
    }
    let active = true
    setLoading(true)
    setError(false)
    fetchFloodField()
      .then((f) => active && (setField(f), setLoading(false)))
      .catch(() => active && (setError(true), setLoading(false)))
    return () => {
      active = false
    }
  }, [nonce])

  // Periodic auto-refresh: clear both caches and re-pull on the same cadence
  // as the weather feed so the hazard surface stays live as rainfall changes.
  useEffect(() => {
    const id = setInterval(() => {
      reloadWeather()
      fieldCache = null
      fieldPromise = null
      setNonce((n) => n + 1)
    }, FIELD_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const refresh = useCallback(() => {
    // Force a fresh weather pull so the rebuilt field reflects current rain/wind,
    // not the potentially 5-min-old cached snapshot.
    reloadWeather()
    fieldCache = null
    fieldPromise = null
    setNonce((n) => n + 1)
  }, [])

  return { field, loading, error, refresh }
}

// A safe no-op field so callers can always destructure `riskAt`.
export const NEUTRAL_FIELD = {
  grid: null,
  cells: [],
  riskAt: () => 0,
  meta: { live: false, sources: { floodHub: false, windy: false, osm: true } },
}

/* ── Live barangay risk + hazard roll-up (derived from the field) ─────────── */

/**
 * Estimated standing-water depth (m) implied by a risk value, calibrated so the
 * risk bands line up with the depth thresholds the dashboards already use
 * (≈0.5 m at high risk). A live, model-derived estimate — not a sensor reading.
 */
const DEPTH_PER_RISK = 0.83

export function estDepthFromRisk(risk) {
  return Math.max(0, risk * DEPTH_PER_RISK)
}

/* ── NOAH-style hazard bands (shared by the 2D + 3D inundation surfaces) ──── */

/**
 * Risk-field values where the modeled depth crosses the system's depth
 * thresholds — i.e. where the hazard surface changes band. Keeping the surface
 * quantised to these stops means the painted colours mean EXACTLY what the
 * Risk Classification legend says, in both the Leaflet and Mapbox views.
 */
export const RISK_BAND_STOPS = {
  low: DEPTH_THRESHOLDS.low / DEPTH_PER_RISK, // ≈ 0.12 — Safe → Low
  moderate: DEPTH_THRESHOLDS.moderate / DEPTH_PER_RISK, // ≈ 0.36 — Low → Moderate
  high: DEPTH_THRESHOLDS.high / DEPTH_PER_RISK, // ≈ 0.60 — Moderate → High
}

/** Depth-band level ('safe' | 'low' | 'moderate' | 'high') for a risk value. */
export function riskBand(risk) {
  return levelFromDepth(estDepthFromRisk(risk))
}

/* Per-band fill strength (× the page opacity slider). Crisp, Project-NOAH-style
   bands: even the safe green reads clearly without drowning the streets. */
export const BAND_FILL = { safe: 0.4, low: 0.55, moderate: 0.65, high: 0.75 }

/* ── Honeycomb hazard surface (shared by the 2D + 3D inundation layers) ──── */

/* Hexagon circumradius in metres. ~100 m cells read as a fine beehive at city
   zoom while staying cheap to build (≈2k hexes) and render (one canvas). */
const HEX_RADIUS_M = 100
/* Each hex is drawn slightly shrunk so thin seams show between cells — the
   honeycomb structure stays visible even across same-band areas. */
const HEX_SEAM = 0.93
const M_PER_DEG_LAT = 111_320

/**
 * The live risk field as a dense pointy-top hexagon lattice over Cabuyao's
 * land: [{ key, center:[lat,lng], ring:[[lat,lng]×6], risk, band }]. Every hex
 * is sampled from field.riskAt at its centre (bilinear, so the honeycomb picks
 * up far finer detail than the raw lattice) and banded by depth class.
 *
 * The land test probes the centre plus 4 half-spacing neighbours: adjacent
 * barangay polygons meet along roads/rivers and OSM leaves thin unclaimed
 * slivers there — a strict centre-point test punches hex-shaped holes in the
 * surface, while genuine lake hexes (no polygon anywhere near) stay out.
 *
 * Cached per field (WeakMap), so the Leaflet and Mapbox views share one build.
 */
const hexCache = new WeakMap()

export function buildFloodHexes(field) {
  if (!field?.grid || !field.riskAt) return []
  const cached = hexCache.get(field)
  if (cached) return cached

  const { s, w, n, e } = CABUYAO_LAND_BBOX
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((((s + n) / 2) * Math.PI) / 180)
  const dxM = Math.sqrt(3) * HEX_RADIUS_M // horizontal spacing
  const dyM = 1.5 * HEX_RADIUS_M // row spacing
  const rows = Math.ceil(((n - s) * M_PER_DEG_LAT) / dyM)
  const cols = Math.ceil(((e - w) * mPerDegLng) / dxM)

  // Pointy-top unit vertices (metres), shrunk for the seams.
  const verts = Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i + 30) * Math.PI) / 180
    return [Math.cos(a) * HEX_RADIUS_M * HEX_SEAM, Math.sin(a) * HEX_RADIUS_M * HEX_SEAM]
  })

  const halfDyLat = (0.5 * dyM) / M_PER_DEG_LAT
  const halfDxLng = (0.5 * dxM) / mPerDegLng
  const hexes = []
  for (let r = 0; r <= rows; r++) {
    const lat = s + (r * dyM) / M_PER_DEG_LAT
    const xOffM = r % 2 ? dxM / 2 : 0
    for (let c = 0; c <= cols; c++) {
      const lng = w + (c * dxM + xOffM) / mPerDegLng
      const onLand =
        isOnLand(lat, lng) ||
        isOnLand(lat + halfDyLat, lng) ||
        isOnLand(lat - halfDyLat, lng) ||
        isOnLand(lat, lng + halfDxLng) ||
        isOnLand(lat, lng - halfDxLng)
      if (!onLand) continue
      const risk = field.riskAt(lat, lng)
      hexes.push({
        key: `${r}-${c}`,
        center: [lat, lng],
        ring: verts.map(([vx, vy]) => [lat + vy / M_PER_DEG_LAT, lng + vx / mPerDegLng]),
        risk,
        band: riskBand(risk),
      })
    }
  }
  hexCache.set(field, hexes)
  return hexes
}

// Sample the field at each barangay's REAL interior point → live risk + depth.
// `coords` is the pole-of-inaccessibility, so the sample is taken inside the
// barangay on actual land (never in the lake, never on a shared border).
export function barangayRiskSamples(field) {
  const f = field || NEUTRAL_FIELD
  return BARANGAY_CENTROIDS.map(({ name, coords }) => {
    const risk = f.riskAt(coords[0], coords[1])
    const floodDepth = estDepthFromRisk(risk)
    return { name, coords, risk, floodDepth, level: levelFromDepth(floodDepth) }
  })
}

// Cabuyao City land area (km²). The lattice spans a padded box larger than the
// city, so the at-risk area is reported as the share of elevated-hazard cells
// applied to the real city footprint rather than the raw box area.
const CABUYAO_AREA_KM2 = 43.4

/**
 * Hazard roll-up for the Hazard Layer / Flood Map summaries, derived live from
 * the field + barangay samples + the admin's flagged roads.
 */
export function hazardSummary(field, samples, statusMap = {}) {
  const f = field || NEUTRAL_FIELD
  // Only land cells count — the at-risk area is a share of the real city
  // footprint, so cells over Laguna de Bay never inflate it.
  const landCells = (f.cells || []).filter((c) => c.onLand)
  const total = landCells.length || 1
  const wetCells = landCells.filter((c) => c.risk >= RISK_BANDS.low).length
  const depths = samples.map((s) => s.floodDepth)
  const avg = depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0
  return {
    inundatedAreaKm2: +((wetCells / total) * CABUYAO_AREA_KM2).toFixed(1),
    avgFloodDepth: +avg.toFixed(2),
    highRiskZones: samples.filter((s) => s.level === 'high').length,
    affectedRoads: Object.keys(statusMap).length,
  }
}

/* ── Per-barangay analytics (detail card) ────────────────────────────────── */

/** Inherent flood susceptibility [0,1] at a point, from the bundled terrain. */
export function susceptibilityAt(lat, lng) {
  return floodSusceptibility(elevationAt(lat, lng))
}

/* Daily rainfall (mm/day) that saturates the ground for the trend model. */
const DAILY_RAIN_SAT = 50

/**
 * Model risk [0,1] for a day with `dailyMm` of rain at a point — reuses the same
 * susceptibility × wetness shape as the live field, so the barangay history
 * trend is consistent with the live hazard classification.
 */
export function riskFromDailyRain(lat, lng, dailyMm) {
  const susceptibility = susceptibilityAt(lat, lng)
  const wetness = clamp01((dailyMm || 0) / DAILY_RAIN_SAT)
  return clamp01(susceptibility * (0.5 + 0.5 * wetness))
}
