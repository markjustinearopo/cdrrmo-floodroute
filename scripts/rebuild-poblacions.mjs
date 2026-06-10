/* Rebuild the 3 central Poblacion barangays CLEANLY + EXACTLY.

   OSM has no admin_level=10 boundary for Poblacion Uno/Dos/Tres, and the raw PSA
   polygons we first used overlap each other and the OSM neighbours (the messy
   centre you saw). Instead we derive the poblacions from the authoritative
   geometry already in hand:

     gap  = Cabuyao city boundary  −  union(15 OSM barangays)
          = exactly the land no surveyed barangay covers = the Poblacion core
     then Voronoi-split that gap among the 3 PSA poblacion centroids.

   The result tiles perfectly: no overlap, no gap, each piece bounded by the real
   OSM neighbour edges + a straight internal divider. Run after fetch/build:
     node scripts/rebuild-poblacions.mjs   (then node scripts/finalize-barangays.mjs) */

import { readFileSync, writeFileSync } from 'node:fs'
import pc from 'polygon-clipping'

const PATH = new URL('../src/data/cabuyaoBarangays.geo.json', import.meta.url)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const toMP = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates)
const ringArea = (r) => {
  let a = 0
  for (let i = 0, n = r.length; i < n; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % n]; a += x1 * y2 - x2 * y1 }
  return Math.abs(a / 2)
}
const mpArea = (mp) => mp.reduce((s, poly) => s + ringArea(poly[0]) - poly.slice(1).reduce((h, r) => h + ringArea(r), 0), 0)

function pointInRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/* ── Cabuyao city boundary (OSM admin_level=6 via Nominatim) ──────────────── */
async function fetchCityPolygon() {
  const url =
    'https://nominatim.openstreetmap.org/search?q=Cabuyao,Laguna,Philippines' +
    '&format=json&polygon_geojson=1&limit=1'
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'CDRRMO-FloodRoute/1.0 (poblacion rebuild)' } })
      const data = await res.json()
      const geo = data?.[0]?.geojson
      if (geo?.type === 'Polygon') return [geo.coordinates]
      if (geo?.type === 'MultiPolygon') return geo.coordinates
      console.error(`  nominatim attempt ${attempt}: no polygon`)
    } catch (e) {
      console.error(`  nominatim failed: ${e.message}`)
    }
    await sleep(3000)
  }
  throw new Error('could not fetch Cabuyao city boundary')
}

/* ── Convex half-plane clip (Sutherland–Hodgman) for Voronoi cells ───────── */
function clipHalfPlane(poly, A, B) {
  // Keep the side of the A|B bisector that is closer to A.
  const nx = A[0] - B[0], ny = A[1] - B[1]
  const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2
  const side = (p) => (p[0] - mx) * nx + (p[1] - my) * ny
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length]
    const dc = side(cur), dp = side(prev)
    const cross = () => {
      const t = dp / (dp - dc)
      return [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]
    }
    if (dc >= 0) { if (dp < 0) out.push(cross()); out.push(cur) }
    else if (dp >= 0) out.push(cross())
  }
  return out
}

function voronoiCell(sites, i, bbox) {
  const [minX, minY, maxX, maxY] = bbox
  let cell = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]
  for (let j = 0; j < sites.length; j++) if (j !== i) cell = clipHalfPlane(cell, sites[i], sites[j])
  return cell
}

async function main() {
  const fc = JSON.parse(readFileSync(PATH, 'utf8'))
  // Poblacions are identified by name so this is safe to re-run (their source
  // flips 'psa' → 'derived' after the first pass); everything else is OSM.
  const isPob = (f) => f.properties.name.startsWith('Poblacion')
  const osm = fc.features.filter((f) => !isPob(f))
  const pobFeatures = fc.features.filter(isPob)
  console.error(`OSM barangays: ${osm.length}, poblacions to rebuild: ${pobFeatures.length}`)

  console.error('Fetching Cabuyao city boundary…')
  const cityMP = await fetchCityPolygon()
  console.error(`  city pieces: ${cityMP.length}, area ${mpArea(cityMP).toExponential(2)}`)

  // union(OSM 15)
  let osmUnion = toMP(osm[0].geometry)
  for (let i = 1; i < osm.length; i++) osmUnion = pc.union(osmUnion, toMP(osm[i].geometry))

  // gap = city − osmUnion
  const gap = pc.difference(cityMP, osmUnion)
  console.error(`  gap pieces: ${gap.length}`)

  // Poblacion centroids drive the split + pick which gap piece is the core.
  const sites = pobFeatures.map((f) => [f.properties.center[1], f.properties.center[0]]) // [lng,lat]

  // Keep gap polygons that contain a poblacion centroid (drop coastal slivers).
  const core = gap.filter((poly) => sites.some((s) => pointInRing(s, poly[0]) && !poly.slice(1).some((h) => pointInRing(s, h))))
  console.error(`  core gap pieces (contain a poblacion): ${core.length}, area ${mpArea(core).toExponential(2)}`)
  if (!core.length) throw new Error('no central gap piece found — poblacion centroids may be off')

  // bbox for the Voronoi square (padded well beyond the core).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of core) for (const [x, y] of poly[0]) {
    if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y
  }
  const bbox = [minX - 0.02, minY - 0.02, maxX + 0.02, maxY + 0.02]

  // Drop slivers below this so the split stays tidy (the Voronoi cut across a
  // concave gap can shave off ~2000 m² flecks).
  const MIN_PIECE = 0.005 / 11944 // ≈ 0.005 km² in deg²

  // poblacion_i = core ∩ voronoiCell(i), de-slivered.
  const rebuilt = pobFeatures.map((f, i) => {
    const cell = voronoiCell(sites, i, bbox)
    const piece = pc.intersection(core, [[cell]]).filter((poly) => ringArea(poly[0]) >= MIN_PIECE)
    if (!piece.length) throw new Error(`empty poblacion for ${f.properties.name}`)
    const geometry = piece.length === 1
      ? { type: 'Polygon', coordinates: piece[0] }
      : { type: 'MultiPolygon', coordinates: piece }
    console.error(`  ${f.properties.name}: ${geometry.type}, area ${(mpArea(piece) * 11944).toFixed(3)} km²`)
    return { type: 'Feature', properties: { name: f.properties.name, source: 'derived' }, geometry }
  })

  const out = [...osm.map((f) => ({ type: 'Feature', properties: f.properties, geometry: f.geometry })), ...rebuilt]
  out.sort((a, b) => a.properties.name.localeCompare(b.properties.name))
  writeFileSync(PATH, JSON.stringify({ type: 'FeatureCollection', features: out }))
  console.error(`\nWrote ${out.length} barangays — poblacions rebuilt from the real city gap.`)
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
