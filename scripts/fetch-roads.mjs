/* One-off data build: download the COMPLETE Cabuyao road network from
   OpenStreetMap (Overpass) and bundle it with the app, exactly like the
   terrain grid (fetch-elevation.mjs). Every drivable way — expressway down
   to the last residential street and barangay alley — is included, clipped
   to the city's REAL barangay polygons, so the routing graph covers the
   whole city and never depends on Overpass being awake during a demo.

   The clip alone would leave islands: upland estates (Casile ridge,
   Jerusalem Road) reach the rest of the city through roads that run OUTSIDE
   the boundary (Canlubang/Silang side), and a few OSM junctions are mapped
   without a shared node. So after clipping, a connectivity pass:
     1. multi-source BFS over the FULL bbox network (including footpaths)
        pulls in the real connector ways each kept island needs, and
     2. any residual island still < 60 m from the network is stitched with a
        short synthetic service-road bridge (a gate / unshared-node junction).
   Result: one routable city-wide graph, verified by scripts/validate-roads.mjs.

   Output: src/data/cabuyaoRoads.json
     { generated, count, bbox:{s,w,n,e}, ways:[{ i, n, h, g:[lat,lng,…] }] }
       i = OSM way id (negative = synthetic stitch)
       n = name (0 when unnamed)   h = highway class
       g = flattened [lat,lng,…] polyline, 6 dp
   Run: node scripts/fetch-roads.mjs */

import { readFileSync, writeFileSync } from 'node:fs'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

/* Every drivable / walkable-street class. Parking aisles and private
   driveways are filtered below — plot furniture, not streets. */
const DRIVABLE_RE =
  /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road|track|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$/
const WALKABLE_RE = /^(footway|path|pedestrian|cycleway|bridleway|steps)$/
const SERVICE_SKIP = new Set(['parking_aisle', 'driveway', 'drive-through', 'emergency_access'])

const MIN_ISLAND = 12 // stitch islands at least this big; tiny stubs stay cosmetic
const SYNTH_GAP_M = 60 // max length of a synthetic bridge (gate / missing node)

/* ── City footprint (the same authoritative polygons the app ships) ──────── */
const geo = JSON.parse(
  readFileSync(new URL('../src/data/cabuyaoBarangays.geo.json', import.meta.url), 'utf8'),
)

let S = Infinity, W = Infinity, N = -Infinity, E = -Infinity
for (const f of geo.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  for (const poly of polys)
    for (const ring of poly)
      for (const [lng, lat] of ring) {
        if (lat < S) S = lat
        if (lat > N) N = lat
        if (lng < W) W = lng
        if (lng > E) E = lng
      }
}
const PAD = 0.004 // ≈ 450 m so boundary roads aren't clipped mid-block
const bbox = { s: S - PAD, w: W - PAD, n: N + PAD, e: E + PAD }

/* Point-in-polygon (ray casting), holes + MultiPolygon aware — mirrors
   src/data/cabuyaoBarangays.js. ring is [[lng,lat],…], pt is [lat,lng]. */
function pointInRing([lat, lng], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    const hit = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (hit) inside = !inside
  }
  return inside
}
function pointInGeometry(pt, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  return polys.some((poly) => pointInRing(pt, poly[0]) && !poly.slice(1).some((h) => pointInRing(pt, h)))
}

/* A dilated land raster makes the millions of vertex tests cheap AND keeps
   boundary roads whose centreline sits a few metres outside the polygons. */
const RAST = 700 // ~16 m cells over the padded bbox
const DILATE = 6 // ~100 m tolerance around the boundary
const land = new Uint8Array(RAST * RAST)
for (let r = 0; r < RAST; r++) {
  const lat = bbox.s + ((r + 0.5) / RAST) * (bbox.n - bbox.s)
  for (let c = 0; c < RAST; c++) {
    const lng = bbox.w + ((c + 0.5) / RAST) * (bbox.e - bbox.w)
    if (geo.features.some((f) => pointInGeometry([lat, lng], f.geometry))) land[r * RAST + c] = 1
  }
}
const dilated = new Uint8Array(land)
for (let r = 0; r < RAST; r++)
  for (let c = 0; c < RAST; c++) {
    if (!land[r * RAST + c]) continue
    for (let dr = -DILATE; dr <= DILATE; dr++)
      for (let dc = -DILATE; dc <= DILATE; dc++) {
        const rr = r + dr, cc = c + dc
        if (rr >= 0 && rr < RAST && cc >= 0 && cc < RAST) dilated[rr * RAST + cc] = 1
      }
  }
function onLand(lat, lng) {
  const r = Math.floor(((lat - bbox.s) / (bbox.n - bbox.s)) * RAST)
  const c = Math.floor(((lng - bbox.w) / (bbox.e - bbox.w)) * RAST)
  if (r < 0 || r >= RAST || c < 0 || c >= RAST) return false
  return dilated[r * RAST + c] === 1
}

/* ── Overpass fetch (bbox query, clipped + stitched locally) ─────────────── */
const QUERY =
  `[out:json][timeout:120];` +
  `way["highway"](${bbox.s},${bbox.w},${bbox.n},${bbox.e});` +
  `out geom;`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchOverpass() {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.error(`Querying ${endpoint} (attempt ${attempt + 1})…`)
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'CDRRMO-FloodRoute/1.0 (road network data build; academic project)',
            Accept: 'application/json',
          },
          body: 'data=' + encodeURIComponent(QUERY),
        })
        if (!res.ok) {
          console.error(`  -> HTTP ${res.status}`)
          await sleep(5000 * (attempt + 1))
          continue
        }
        const data = await res.json()
        if (Array.isArray(data.elements) && data.elements.length) return data
        console.error('  -> empty response')
      } catch (err) {
        console.error(`  -> ${err.message}`)
        await sleep(5000 * (attempt + 1))
      }
    }
  }
  throw new Error('all Overpass endpoints failed')
}

/* ── Graph plumbing (nodes merged at 6 dp, same rule as routeEngine) ─────── */
const keyOf = (la, lo) => `${la.toFixed(6)},${lo.toFixed(6)}`

function main(data) {
  // 1. Classify every way in the bbox.
  const ways = [] // { id, name, hw, pts:[[lat,lng]…], drivable, kept }
  for (const el of data.elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue
    const tags = el.tags || {}
    const hw = tags.highway || ''
    const drivable = DRIVABLE_RE.test(hw) && !(hw === 'service' && SERVICE_SKIP.has(tags.service))
    const walkable = WALKABLE_RE.test(hw)
    if (!drivable && !walkable) continue
    const pts = []
    let plat = null, plng = null
    for (const p of el.geometry) {
      const la = +p.lat.toFixed(6)
      const lo = +p.lon.toFixed(6)
      if (la === plat && lo === plng) continue
      pts.push([la, lo])
      plat = la
      plng = lo
    }
    if (pts.length < 2) continue
    const kept = drivable && pts.some(([la, lo]) => onLand(la, lo))
    ways.push({ id: el.id, name: tags.name || 0, hw, pts, drivable, kept })
  }

  // 2. One shared node index over every way (kept, outside, walkable).
  const idByKey = new Map()
  const lat = []
  const lng = []
  function nodeAt(la, lo) {
    const k = keyOf(la, lo)
    let id = idByKey.get(k)
    if (id === undefined) {
      id = lat.length
      idByKey.set(k, id)
      lat.push(la)
      lng.push(lo)
    }
    return id
  }
  for (const w of ways) w.nodes = w.pts.map(([la, lo]) => nodeAt(la, lo))

  const size = lat.length
  const fullAdj = Array.from({ length: size }, () => []) // [to, wayIndex]
  const keptAdj = Array.from({ length: size }, () => [])
  ways.forEach((w, wi) => {
    for (let i = 1; i < w.nodes.length; i++) {
      const a = w.nodes[i - 1], b = w.nodes[i]
      if (a === b) continue
      fullAdj[a].push([b, wi])
      fullAdj[b].push([a, wi])
      if (w.kept) {
        keptAdj[a].push([b, wi])
        keptAdj[b].push([a, wi])
      }
    }
  })

  // Component labelling over the KEPT subgraph.
  function keptComponents() {
    const comp = new Int32Array(size).fill(-1)
    const queue = new Int32Array(size)
    const sizes = []
    for (const w of ways) {
      if (!w.kept) continue
      for (const seed of w.nodes) {
        if (comp[seed] !== -1) continue
        const label = sizes.length
        let head = 0, tail = 0, count = 0
        queue[tail++] = seed
        comp[seed] = label
        while (head < tail) {
          const cur = queue[head++]
          count++
          for (const [to] of keptAdj[cur]) {
            if (comp[to] === -1) {
              comp[to] = label
              queue[tail++] = to
            }
          }
        }
        sizes.push(count)
      }
    }
    let mainComp = 0
    sizes.forEach((n, i) => { if (n > sizes[mainComp]) mainComp = i })
    return { comp, sizes, mainComp }
  }

  let { comp, sizes, mainComp } = keptComponents()
  console.error(`clip: ${ways.filter((w) => w.kept).length} kept ways, ${sizes.length} components (main ${sizes[mainComp]} nodes)`)

  // 3. Reconnect islands with REAL roads: multi-source BFS over the full bbox
  //    network (outside roads + footpaths included) starting from the main
  //    component; every island node reached has a parent chain of real ways
  //    leading back to the network — promote those ways into the bundle.
  const parentNode = new Int32Array(size).fill(-1)
  const parentWay = new Int32Array(size).fill(-1)
  const seen = new Uint8Array(size)
  {
    const queue = []
    for (let i = 0; i < size; i++) {
      if (comp[i] === mainComp) {
        seen[i] = 1
        queue.push(i)
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head]
      for (const [to, wi] of fullAdj[cur]) {
        if (seen[to]) continue
        seen[to] = 1
        parentNode[to] = cur
        parentWay[to] = wi
        queue.push(to)
      }
    }
  }

  let bridgedWays = 0
  for (let label = 0; label < sizes.length; label++) {
    if (label === mainComp || sizes[label] < MIN_ISLAND) continue
    // The island's entry point: any reached node walks back to the main comp.
    let entry = -1
    for (let i = 0; i < size; i++) {
      if (comp[i] === label && seen[i]) { entry = i; break }
    }
    if (entry === -1) continue // not reachable by ANY mapped way — leave it
    for (let v = entry; parentWay[v] !== -1 && comp[v] !== mainComp; v = parentNode[v]) {
      const w = ways[parentWay[v]]
      if (!w.kept) {
        w.kept = true
        bridgedWays++
      }
    }
  }
  console.error(`bridged ${bridgedWays} connector ways (real roads/paths outside the clip)`)

  // Rebuild kept adjacency with the promoted connectors.
  for (let i = 0; i < size; i++) keptAdj[i].length = 0
  ways.forEach((w, wi) => {
    if (!w.kept) return
    for (let i = 1; i < w.nodes.length; i++) {
      const a = w.nodes[i - 1], b = w.nodes[i]
      if (a === b) continue
      keptAdj[a].push([b, wi])
      keptAdj[b].push([a, wi])
    }
  })
  ;({ comp, sizes, mainComp } = keptComponents())

  // 4. Stitch what's left: an island that no mapped way reaches but that sits
  //    within SYNTH_GAP_M of the network is a gate / unshared-node junction —
  //    bridge the closest node pair with a synthetic service stub.
  const synth = []
  const mainNodes = []
  for (let i = 0; i < size; i++) if (comp[i] === mainComp) mainNodes.push(i)
  let synthId = -1
  for (let label = 0; label < sizes.length; label++) {
    if (label === mainComp || sizes[label] < MIN_ISLAND) continue
    let bi = -1, bj = -1, bd = Infinity
    for (let i = 0; i < size; i++) {
      if (comp[i] !== label) continue
      for (const j of mainNodes) {
        const d = Math.hypot((lat[i] - lat[j]) * 110570, (lng[i] - lng[j]) * 107880)
        if (d < bd) { bd = d; bi = i; bj = j }
      }
    }
    if (bi >= 0 && bd <= SYNTH_GAP_M) {
      synth.push({ i: synthId--, n: 0, h: 'service', g: [lat[bi], lng[bi], lat[bj], lng[bj]] })
      console.error(`  synthetic stitch (${Math.round(bd)} m) at ${lat[bi].toFixed(5)},${lng[bi].toFixed(5)}`)
    } else if (bi >= 0) {
      console.error(`  island left detached (${sizes[label]} nodes, gap ${Math.round(bd)} m)`)
    }
  }

  // 5. Emit.
  const out = []
  for (const w of ways) {
    if (!w.kept) continue
    const g = []
    for (const [la, lo] of w.pts) g.push(la, lo)
    out.push({ i: w.id, n: w.name, h: w.hw, g })
  }
  out.push(...synth)

  const byClass = {}
  for (const w of out) byClass[w.h] = (byClass[w.h] || 0) + 1
  console.error(`Kept ${out.length} ways:`)
  console.error(Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`).join('\n'))

  const payload = { generated: new Date().toISOString(), count: out.length, bbox, ways: out }
  const json = JSON.stringify(payload)
  writeFileSync(new URL('../src/data/cabuyaoRoads.json', import.meta.url), json)
  console.error(`Wrote src/data/cabuyaoRoads.json (${(json.length / 1024 / 1024).toFixed(2)} MB)`)
}

fetchOverpass()
  .then(main)
  .catch((err) => {
    console.error('FAILED:', err.message)
    process.exit(1)
  })
