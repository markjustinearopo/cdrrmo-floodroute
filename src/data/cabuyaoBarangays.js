/* ============================================================
   Real Cabuyao City barangay boundaries — the single geographic
   source of truth for every map in the system.

   The polygons are AUTHENTIC administrative boundaries, not hand-placed
   guesses (which is why barangays no longer float in Laguna de Bay):

     • 15 barangays  — OpenStreetMap admin_level=10 relations, traced
                        against satellite imagery (current + high detail).
     • 3 Poblacions  — PSA-derived GADM polygons (Uno/Dos/Tres), which OSM
                        does not split out; they fill the central gap OSM
                        leaves, with no overlap.

   The bundled GeoJSON (cabuyaoBarangays.geo.json) was produced + validated
   by scripts/{fetch,build,finalize}-barangays.mjs. Each feature carries:
     properties.name    canonical barangay name (matches BARANGAYS)
     properties.center  [lat, lng] pole-of-inaccessibility — a point
                         GUARANTEED inside the polygon (labels / risk sampling)
     properties.source  'osm' | 'psa'  (data provenance)

   This module derives, once at load, everything the maps need from that file:
   centroids, the city land bounds, a point-in-polygon barangay lookup, and a
   land test used to clip the flood-risk surface to actual ground.
   ============================================================ */

import fc from './cabuyaoBarangays.geo.json'

/** The raw FeatureCollection of all 18 barangay polygons. */
export const BARANGAY_FEATURES = fc

/** Canonical barangay names, alphabetical (matches the rest of the system). */
export const BARANGAY_NAMES = fc.features.map((f) => f.properties.name)

/**
 * Representative interior point per barangay: { name, coords:[lat,lng], source }.
 * `coords` is the precomputed pole-of-inaccessibility, so it always sits well
 * inside the (often concave) polygon — never in the lake, never on a border.
 */
export const BARANGAY_CENTROIDS = fc.features.map((f) => ({
  name: f.properties.name,
  coords: f.properties.center,
  source: f.properties.source,
}))

/* ── City land bounds, computed from every ring ──────────────────────────── */
function computeBounds(features) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity
  for (const f of features) {
    forEachRing(f.geometry, (ring) => {
      for (const [lng, lat] of ring) {
        if (lat < s) s = lat
        if (lat > n) n = lat
        if (lng < w) w = lng
        if (lng > e) e = lng
      }
    })
  }
  return { s, w, n, e }
}

function forEachRing(geom, fn) {
  if (!geom) return
  if (geom.type === 'Polygon') geom.coordinates.forEach(fn)
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach((poly) => poly.forEach(fn))
}

/** Bounding box of the whole city footprint: { s, w, n, e }. */
export const CABUYAO_LAND_BBOX = computeBounds(fc.features)

/** Leaflet-style bounds [[s,w],[n,e]] for fitBounds / maxBounds. */
export const CABUYAO_LAND_BOUNDS = [
  [CABUYAO_LAND_BBOX.s, CABUYAO_LAND_BBOX.w],
  [CABUYAO_LAND_BBOX.n, CABUYAO_LAND_BBOX.e],
]

/* ── Point-in-polygon (ray casting), holes + MultiPolygon aware ──────────── */
// ring is GeoJSON order [[lng,lat], …]; pt is [lat,lng].
function pointInRing([lat, lng], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    const intersect = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// polygonCoords = [outerRing, ...holeRings]
function pointInPolygon(pt, polygonCoords) {
  if (!pointInRing(pt, polygonCoords[0])) return false
  for (let h = 1; h < polygonCoords.length; h++) if (pointInRing(pt, polygonCoords[h])) return false
  return true
}

function pointInGeometry(pt, geom) {
  if (geom.type === 'Polygon') return pointInPolygon(pt, geom.coordinates)
  if (geom.type === 'MultiPolygon') return geom.coordinates.some((poly) => pointInPolygon(pt, poly))
  return false
}

/**
 * The barangay a [lat, lng] point falls in, or null if outside the city.
 * Authoritative: uses the real polygon boundaries, so a point is attributed to
 * the barangay that actually contains it — not merely the nearest centroid.
 */
export function barangayAt(lat, lng) {
  const pt = [lat, lng]
  for (const f of fc.features) if (pointInGeometry(pt, f.geometry)) return f.properties.name
  return null
}

/**
 * True when [lat, lng] is on Cabuyao land (inside any barangay polygon). Used to
 * clip the flood-risk surface so it never bleeds into Laguna de Bay. A cheap
 * bbox reject runs first so the common off-city case skips the polygon tests.
 */
export function isOnLand(lat, lng) {
  const b = CABUYAO_LAND_BBOX
  if (lat < b.s || lat > b.n || lng < b.w || lng > b.e) return false
  return barangayAt(lat, lng) != null
}

/**
 * Nearest barangay centroid to a point — a fallback labeller for things that
 * sit just off the boundary (e.g. a road midpoint on the city edge). Prefer
 * barangayAt() for true containment; this never returns null.
 */
export function nearestBarangayName(lat, lng) {
  let best = BARANGAY_CENTROIDS[0]?.name ?? null
  let bestD = Infinity
  for (const { name, coords } of BARANGAY_CENTROIDS) {
    const dLat = lat - coords[0]
    const dLng = lng - coords[1]
    const d = dLat * dLat + dLng * dLng
    if (d < bestD) { bestD = d; best = name }
  }
  return best
}

/** barangayAt() with a nearest-centroid fallback — always returns a name. */
export function barangayForPoint(lat, lng) {
  return barangayAt(lat, lng) ?? nearestBarangayName(lat, lng)
}

/* ── Per-barangay geometry helpers (focus view + detail card) ────────────── */
const byName = new Map(fc.features.map((f) => [f.properties.name, f]))

/** The GeoJSON feature for a barangay, or null. */
export function barangayFeature(name) {
  return byName.get(name) || null
}

/** Leaflet bounds [[s,w],[n,e]] tightly enclosing a barangay (for fitBounds). */
export function barangayBounds(name) {
  const f = byName.get(name)
  if (!f) return null
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity
  forEachRing(f.geometry, (ring) => {
    for (const [lng, lat] of ring) {
      if (lat < s) s = lat
      if (lat > n) n = lat
      if (lng < w) w = lng
      if (lng > e) e = lng
    }
  })
  return [[s, w], [n, e]]
}

const DEG_LAT_KM = 110.57
/** Land area of a barangay in km² (shoelace, scaled for this latitude). */
export function barangayAreaKm2(name) {
  const f = byName.get(name)
  if (!f) return 0
  const latRad = (f.properties.center[0] * Math.PI) / 180
  const kmPerLng = 111.32 * Math.cos(latRad)
  let deg2 = 0
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  for (const poly of polys) {
    poly.forEach((ring, ri) => {
      let a = 0
      for (let i = 0, m = ring.length; i < m; i++) {
        const [x1, y1] = ring[i]
        const [x2, y2] = ring[(i + 1) % m]
        a += x1 * y2 - x2 * y1
      }
      deg2 += (ri === 0 ? 1 : -1) * Math.abs(a / 2) // subtract holes
    })
  }
  return +(deg2 * DEG_LAT_KM * kmPerLng).toFixed(2)
}
