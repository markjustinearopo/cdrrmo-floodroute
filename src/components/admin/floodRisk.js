/* ============================================================
   Flood-risk field for the Cabuyao auto-routing engine.

   The Conceptual Framework names three external feeds as the basis for
   flood-aware routing. This module fuses them into a single spatial
   risk surface the router can sample anywhere in the city:

     • Google Flood Hub  — flood-inundation model. Implemented keyless
       via the Open-Meteo Flood API (river discharge) blended with
       topographic susceptibility from the Open-Meteo Elevation API
       (water pools in the low ground). The Integrations screen is where
       a Flood Hub API key would be plugged in for the production feed.
     • Windy.com          — live weather. Implemented keyless via the
       Open-Meteo Forecast API (rainfall intensity + wind), standing in
       for the Windy Point-Forecast feed until its key is configured.
     • OpenStreetMap      — the road network itself (see routeEngine.js).

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
import { levelFromDepth } from './mapHelpers.jsx'
import { fetchWeather } from '../../services/weather.js'
import { BARANGAY_CENTROIDS, isOnLand } from '../../data/cabuyaoBarangays.js'
import TERRAIN from '../../data/cabuyaoElevation.json'

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
        // Bundled terrain (always on) blended with the live Flood Hub discharge.
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
  // reliable). Only the live-weather snapshot (rainfall, wind + Flood Hub
  // discharge) is fetched, so a throttled weather feed degrades to the
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

  const refresh = useCallback(() => {
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
export function estDepthFromRisk(risk) {
  return Math.max(0, risk * 0.83)
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
