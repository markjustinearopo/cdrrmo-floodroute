/* One-off data build: precompute the Cabuyao terrain-elevation grid the flood
   model samples, and bundle it so the hazard surface is reliable + instant and
   NEVER silently degrades to a flat/uniform field when the live Open-Meteo
   Elevation API rate-limits. Terrain is static, so caching it is exact.

   Output: src/data/cabuyaoElevation.json
     { gridN, pad, bbox:{s,w,n,e}, elevation:[gridN*gridN metres, row-major S→N] }
   The bbox + gridN travel WITH the data so floodRisk.js samples the identical
   lattice the elevations were measured on. Run: node scripts/fetch-elevation.mjs */

import { readFileSync, writeFileSync } from 'node:fs'

const GRID_N = 24
const PAD = 0.004
const ELEV_BATCH = 100
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const geo = JSON.parse(readFileSync(new URL('../src/data/cabuyaoBarangays.geo.json', import.meta.url), 'utf8'))

// Land bbox from every barangay ring (matches CABUYAO_LAND_BBOX in the app).
let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity
for (const f of geo.features) {
  const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat()
  for (const ring of rings) for (const [lng, lat] of ring) {
    if (lat < s) s = lat
    if (lat > n) n = lat
    if (lng < w) w = lng
    if (lng > e) e = lng
  }
}
const bbox = { s: s - PAD, w: w - PAD, n: n + PAD, e: e + PAD }

// Identical cell-centre formula to floodRisk.cellCenter (rows S→N, cols W→E).
const points = []
for (let r = 0; r < GRID_N; r++)
  for (let c = 0; c < GRID_N; c++)
    points.push([
      bbox.s + ((r + 0.5) / GRID_N) * (bbox.n - bbox.s),
      bbox.w + ((c + 0.5) / GRID_N) * (bbox.e - bbox.w),
    ])

async function batchElevation(batch) {
  const la = batch.map((p) => p[0].toFixed(5)).join(',')
  const lo = batch.map((p) => p[1].toFixed(5)).join(',')
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${la}&longitude=${lo}`
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'CDRRMO-FloodRoute/1.0' } })
      if (res.ok) {
        const d = await res.json()
        if (Array.isArray(d.elevation) && d.elevation.length === batch.length) return d.elevation
      }
      console.error(`  elevation batch -> ${res.status}, retry…`)
    } catch (err) {
      console.error(`  elevation batch failed: ${err.message}`)
    }
    await sleep(2500 * (attempt + 1))
  }
  throw new Error('elevation batch failed after retries')
}

async function main() {
  console.error(`Fetching ${points.length} terrain elevations (grid ${GRID_N}×${GRID_N})…`)
  const elevation = []
  for (let i = 0; i < points.length; i += ELEV_BATCH) {
    elevation.push(...(await batchElevation(points.slice(i, i + ELEV_BATCH))))
    await sleep(800)
  }
  const out = { gridN: GRID_N, pad: PAD, bbox, elevation }
  writeFileSync(new URL('../src/data/cabuyaoElevation.json', import.meta.url), JSON.stringify(out))
  console.error(`min ${Math.min(...elevation)} m, max ${Math.max(...elevation)} m`)
  console.error(`Wrote src/data/cabuyaoElevation.json (${elevation.length} cells)`)
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1) })
