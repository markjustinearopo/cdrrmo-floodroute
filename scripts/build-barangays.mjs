/* Build the final, complete Cabuyao barangay boundary set the app ships.

   Sources (both authoritative, both open):
     • OpenStreetMap admin_level=10  — 15 detailed, current barangay polygons
       (already fetched to src/data/cabuyaoBarangays.geo.json by
       scripts/fetch-barangays.mjs). The critical lakeshore barangays come
       from here, traced against satellite imagery — so nothing sits in the
       water.
     • PSA-derived GADM (faeldon/philippines-json-maps) — supplies the three
       central Poblacion barangays (Uno/Dos/Tres) that OSM has not split out.

   Output: src/data/cabuyaoBarangays.geo.json  (18 features, canonical names),
   plus a printed cross-source centroid comparison so we can sanity-check that
   the two sources agree on where each barangay sits. */

import { readFileSync, writeFileSync } from 'node:fs'

const here = (p) => new URL(p, import.meta.url)
const OSM_PATH = here('../src/data/cabuyaoBarangays.geo.json')

const PSA_URL =
  'https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/' +
  '2011/geojson/barangays/hires/barangays-municity-759-cabuyao.0.1.json'

// PSA "Barangay Uno/Dos/Tres" → the city's Poblacion barangay names.
const POBLACION_MAP = {
  'Barangay Uno': 'Poblacion Uno',
  'Barangay Dos': 'Poblacion Dos',
  'Barangay Tres': 'Poblacion Tres',
}

/* ── Geometry helpers (centroid for the comparison report) ───────────────── */
function* eachRing(geom) {
  if (!geom) return
  if (geom.type === 'Polygon') yield geom.coordinates[0]
  else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates) yield poly[0]
}

// Area-weighted centroid over the outer rings (good enough for the report).
function centroid(geom) {
  let cx = 0, cy = 0, area = 0
  for (const ring of eachRing(geom)) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const [x1, y1] = ring[i]
      const [x2, y2] = ring[(i + 1) % n]
      const cross = x1 * y2 - x2 * y1
      area += cross
      cx += (x1 + x2) * cross
      cy += (y1 + y2) * cross
    }
  }
  if (Math.abs(area) < 1e-12) {
    // Degenerate — fall back to mean of first ring's vertices.
    const ring = [...eachRing(geom)][0] || [[121.12, 14.27]]
    const mx = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const my = ring.reduce((s, p) => s + p[1], 0) / ring.length
    return [my, mx]
  }
  area *= 0.5
  return [cy / (6 * area), cx / (6 * area)] // [lat, lng]
}

const dist = (a, b) => {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

async function main() {
  const osm = JSON.parse(readFileSync(OSM_PATH, 'utf8'))
  console.error(`OSM source: ${osm.features.length} barangays`)

  console.error('Fetching PSA Cabuyao boundaries…')
  const res = await fetch(PSA_URL, { headers: { 'User-Agent': 'CDRRMO-FloodRoute/1.0' } })
  const psa = await res.json()
  const psaByName = new Map(psa.features.map((f) => [f.properties.NAME_3, f]))

  // Cross-source centroid comparison for the 15 shared barangays.
  const osmByName = new Map(osm.features.map((f) => [f.properties.name, f]))
  const psaNameFor = (osmName) => (osmName === 'Banay-Banay' ? 'Banaybanay' : osmName)
  console.error('\nCross-source centroid agreement (15 shared barangays):')
  let maxOff = 0
  for (const f of osm.features) {
    const pf = psaByName.get(psaNameFor(f.properties.name))
    if (!pf) { console.error(`  ${f.properties.name}: no PSA match`); continue }
    const d = dist(centroid(f.geometry), centroid(pf.geometry))
    maxOff = Math.max(maxOff, d)
    console.error(`  ${f.properties.name.padEnd(14)} Δ ${(d).toFixed(0).padStart(5)} m`)
  }
  console.error(`  → max offset ${maxOff.toFixed(0)} m`)

  // Final feature list: OSM 15 (tagged source=osm) + PSA 3 poblacions.
  const out = []
  for (const f of osm.features) {
    out.push({
      type: 'Feature',
      properties: { name: f.properties.name, source: 'osm', osm_id: f.properties.osm_id },
      geometry: f.geometry,
    })
  }
  for (const [psaName, appName] of Object.entries(POBLACION_MAP)) {
    const pf = psaByName.get(psaName)
    if (!pf) throw new Error(`PSA missing ${psaName}`)
    out.push({
      type: 'Feature',
      properties: { name: appName, source: 'psa' },
      geometry: pf.geometry,
    })
  }

  out.sort((a, b) => a.properties.name.localeCompare(b.properties.name))
  const fc = { type: 'FeatureCollection', features: out }
  writeFileSync(OSM_PATH, JSON.stringify(fc))
  console.error(`\nWrote ${out.length} barangays -> src/data/cabuyaoBarangays.geo.json`)
  console.error('Names: ' + out.map((f) => f.properties.name).join(', '))

  // Report each barangay centroid + how far east it reaches (lake sanity check).
  console.error('\nCentroid + east-extent check:')
  for (const f of out) {
    const c = centroid(f.geometry)
    let maxLng = -Infinity
    for (const ring of eachRing(f.geometry)) for (const [lng] of ring) maxLng = Math.max(maxLng, lng)
    console.error(`  ${f.properties.name.padEnd(15)} centroid ${c[0].toFixed(4)},${c[1].toFixed(4)}  E-edge ${maxLng.toFixed(4)}`)
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
