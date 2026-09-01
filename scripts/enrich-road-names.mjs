/* Give the map's streets their names back.

   The bundled network (scripts/fetch-roads.mjs) kept only `tags.name`, so
   4,006 of 4,853 ways — 82.5% — rendered as "Unnamed road". That is not a map
   you can read, and it is not what OSM actually knows about Cabuyao: plenty of
   those ways carry a `ref` or an `alt_name`, and the houses along them are
   tagged with the street they front onto.

   This pass adds names WITHOUT touching geometry. The routing graph stays the
   validated one; only `n` is filled in, and a new `ns` field records WHERE
   each name came from so the UI can be honest about an inferred label:

     (absent)     the way's own OSM name tag             — authoritative
     ref          route number / designation, e.g. "N1"  — authoritative
     addr         majority vote of addr:street on the buildings fronting it
     continuation carried along from a named way it continues
     area         "<subdivision> road" — a context label, not a street name

   Run: node scripts/enrich-road-names.mjs
   Output: src/data/cabuyaoRoads.json (rewritten in place)
*/

import { readFileSync, writeFileSync } from 'node:fs'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

const ROADS_URL = new URL('../src/data/cabuyaoRoads.json', import.meta.url)
const roads = JSON.parse(readFileSync(ROADS_URL, 'utf8'))
const bbox = roads.bbox

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function overpass(query, label) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.error(`[${label}] ${endpoint} (try ${attempt + 1})`)
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'CDRRMO-FloodRoute/1.0 (street-name enrichment; academic project)',
            Accept: 'application/json',
          },
          body: 'data=' + encodeURIComponent(query),
        })
        if (!res.ok) {
          console.error(`  -> HTTP ${res.status}`)
          await sleep(6000 * (attempt + 1))
          continue
        }
        const data = await res.json()
        if (Array.isArray(data.elements)) return data.elements
        console.error('  -> no elements')
      } catch (err) {
        console.error(`  -> ${err.message}`)
        await sleep(6000 * (attempt + 1))
      }
    }
  }
  throw new Error(`all Overpass endpoints failed for ${label}`)
}

/* ── Geometry helpers ─────────────────────────────────────────────────────── */
const EARTH_R = 6371000
const toRad = (d) => (d * Math.PI) / 180

function metres(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng) * Math.cos(toRad((aLat + bLat) / 2))
  return Math.sqrt(dLat * dLat + dLng * dLng) * EARTH_R
}

/** Perpendicular distance in metres from a point to a segment. */
function distToSegment(pLat, pLng, aLat, aLng, bLat, bLng) {
  const kx = Math.cos(toRad(pLat))
  const ax = (aLng - pLng) * kx
  const ay = aLat - pLat
  const bx = (bLng - pLng) * kx
  const by = bLat - pLat
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.sqrt(cx * cx + cy * cy) * toRad(1) * EARTH_R
}

function bearing(aLat, aLng, bLat, bLng) {
  const y = Math.sin(toRad(bLng - aLng)) * Math.cos(toRad(bLat))
  const x = Math.cos(toRad(aLat)) * Math.sin(toRad(bLat))
    - Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLng - aLng))
  return (Math.atan2(y, x) * 180) / Math.PI
}

function angleGap(a, b) {
  let d = Math.abs(a - b) % 360
  if (d > 180) d = 360 - d
  return d
}

/* ── Decode the bundled ways into [lat,lng] pairs ─────────────────────────── */
/* `ns` is read back, not assumed. Running this a second time over its own
   output used to re-stamp every inferred label as `osm`, quietly promoting a
   subdivision context label to an authoritative street name — which the
   router reads as "this is a real street" and turn-by-turn then trusts. */
const ways = roads.ways.map((w) => {
  const pts = []
  for (let i = 0; i < w.g.length; i += 2) pts.push([w.g[i], w.g[i + 1]])
  return { ref: w, pts, name: w.n || 0, src: w.n ? (w.ns || 'osm') : null }
})
const byOsmId = new Map()
for (const w of ways) if (w.ref.i > 0) byOsmId.set(w.ref.i, w)

const before = ways.filter((w) => !w.name).length
console.error(`Loaded ${ways.length} ways — ${before} unnamed (${((before / ways.length) * 100).toFixed(1)}%)`)

/* ── Pass 1 — every name-bearing tag OSM has on these ways ────────────────── */
const TAG_ORDER = [
  ['name', 'osm'],
  ['name:en', 'osm'],
  ['official_name', 'osm'],
  ['alt_name', 'osm'],
  ['short_name', 'osm'],
  ['loc_name', 'osm'],
  ['nat_name', 'osm'],
  ['reg_name', 'osm'],
  ['bridge:name', 'osm'],
  ['tunnel:name', 'osm'],
  ['ref', 'ref'],
  ['destination:street', 'ref'],
]

/* Deliberately NOT name sources: `destination` and `junction:ref`. On a
   motorway link `destination=Manila` means "this ramp goes to Manila" — it is
   a sign, not a street, and reading it as one put "Manila" and "Batangas" on
   the map as Cabuyao road names. */

/* The barangay names, so a place label that is really just the barangay can be
   rejected: "Bigaa road" reads like a street and is not one, and the barangay
   is already named everywhere else on these screens. */
const BARANGAY_WORDS = new Set(
  JSON.parse(readFileSync(new URL('../src/data/cabuyaoBarangays.geo.json', import.meta.url), 'utf8'))
    .features.map((f) => String(f.properties.name || '').toLowerCase().trim())
    .filter(Boolean),
)
const NOT_A_STREET = new Set([...BARANGAY_WORDS, 'cabuyao', 'laguna', 'philippines', 'calabarzon'])

/* Corporate boilerplate that adds length and no information once the name is
   sitting on a map pin. */
const CORP_TAIL = [
  ' incorporated', ' inc.', ' inc', ' corporation', ' corp.', ' corp',
  ' philippines', ' (philippines)', ' company', ' co.', ' ltd.', ' ltd',
]

/** Tidy a place name into something that fits on a map label. */
function cleanPlaceName(raw) {
  let s = String(raw).split(',')[0].trim() // "X, Gulod, Cabuyao, Laguna" -> "X"
  s = s.split(' - ')[0].trim() // "NYK Auto Logistics Inc. - Cabuyao" -> "NYK ..."
  let changed = true
  while (changed) {
    changed = false
    const lower = s.toLowerCase()
    for (const tail of CORP_TAIL) {
      if (lower.endsWith(tail)) {
        s = s.slice(0, s.length - tail.length).trim()
        changed = true
        break
      }
    }
  }
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length > 34) {
    const cut = s.slice(0, 34)
    const sp = cut.lastIndexOf(' ')
    s = (sp > 14 ? cut.slice(0, sp) : cut).trim()
  }
  return s
}

const tagQuery = `[out:json][timeout:180];way["highway"](${bbox.s},${bbox.w},${bbox.n},${bbox.e});out tags;`

const tagged = await overpass(tagQuery, 'way tags')
let fromTags = 0
for (const el of tagged) {
  if (el.type !== 'way') continue
  const w = byOsmId.get(el.id)
  if (!w || w.name) continue
  const tags = el.tags || {}
  for (const [key, src] of TAG_ORDER) {
    const v = tags[key]
    if (typeof v === 'string' && v.trim() && v.trim() !== 'yes') {
      w.name = v.split(';')[0].trim()
      w.src = src
      fromTags++
      break
    }
  }
}
console.error(`Pass 1 (OSM tags): +${fromTags}`)

/* ── Pass 2 — the addresses that front onto the street ────────────────────── */
/* Houses in Cabuyao's subdivisions carry addr:street even where the street way
   itself has no name tag. Snapping each address to its nearest way and taking
   a majority vote recovers the real, locally-used street name. */
const addrQuery = `[out:json][timeout:180];(`
  + `node["addr:street"](${bbox.s},${bbox.w},${bbox.n},${bbox.e});`
  + `way["addr:street"](${bbox.s},${bbox.w},${bbox.n},${bbox.e});`
  + `relation["addr:street"](${bbox.s},${bbox.w},${bbox.n},${bbox.e});`
  + `);out center tags;`

const addrPoints = []
try {
  const addrs = await overpass(addrQuery, 'addr:street')
  for (const el of addrs) {
    const street = el.tags && el.tags['addr:street']
    if (!street || typeof street !== 'string' || !street.trim()) continue
    const lat = el.lat != null ? el.lat : el.center && el.center.lat
    const lon = el.lon != null ? el.lon : el.center && el.center.lon
    if (lat == null || lon == null) continue
    addrPoints.push({ lat, lng: lon, street: street.trim() })
  }
} catch (err) {
  console.error(`  addr:street pass skipped — ${err.message}`)
}
console.error(`  ${addrPoints.length} address points`)

/* Grid index over the unnamed ways so the snap is not O(addresses x ways). */
const CELL = 0.0025 // roughly 275 m
const cellKey = (la, lo) => `${Math.floor(la / CELL)}:${Math.floor(lo / CELL)}`
const grid = new Map()
for (const w of ways) {
  if (w.name) continue
  const seen = new Set()
  for (const [la, lo] of w.pts) {
    const k = cellKey(la, lo)
    if (seen.has(k)) continue
    seen.add(k)
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push(w)
  }
}

const SNAP_M = 45
const votes = new Map() // way -> Map(name -> count)
for (const a of addrPoints) {
  const ci = Math.floor(a.lat / CELL)
  const cj = Math.floor(a.lng / CELL)
  let best = null
  let bestD = SNAP_M
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const bucket = grid.get(`${ci + di}:${cj + dj}`)
      if (!bucket) continue
      for (const w of bucket) {
        for (let i = 1; i < w.pts.length; i++) {
          const d = distToSegment(
            a.lat, a.lng,
            w.pts[i - 1][0], w.pts[i - 1][1],
            w.pts[i][0], w.pts[i][1],
          )
          if (d < bestD) {
            bestD = d
            best = w
          }
        }
      }
    }
  }
  if (!best) continue
  if (!votes.has(best)) votes.set(best, new Map())
  const m = votes.get(best)
  m.set(a.street, (m.get(a.street) || 0) + 1)
}

let fromAddr = 0
for (const [w, m] of votes) {
  if (w.name) continue
  let top = null
  let topN = 0
  let total = 0
  for (const [name, n] of m) {
    total += n
    if (n > topN) {
      topN = n
      top = name
    }
  }
  /* A single stray address near a corner is not evidence. Two that agree, or a
     clear majority, is. Anything ambiguous stays unnamed rather than guessed.
     addr:street is also where people file the barangay or the whole postal
     address, so a value that is really a place name is thrown out. */
  const plausible = top
    && !top.includes(',')
    && !NOT_A_STREET.has(top.toLowerCase().trim())
  if (plausible && (topN >= 2 || total === 1) && topN / total >= 0.6) {
    w.name = top
    w.src = 'addr'
    fromAddr++
  }
}
console.error(`Pass 2 (addr:street): +${fromAddr}`)

/* ── Pass 3 — carry a name along a street that continues ──────────────────── */
/* A named way that ends at a junction where exactly one unnamed way of the same
   class carries straight on is, in almost every case, the same street with a
   split OSM way. Repeat until it stops spreading. */
const nodeKey = (la, lo) => `${la.toFixed(6)},${lo.toFixed(6)}`
const endpoints = new Map() // nodeKey -> [{ w, end }]
for (const w of ways) {
  for (const end of [0, 1]) {
    const p = end === 0 ? w.pts[0] : w.pts[w.pts.length - 1]
    const k = nodeKey(p[0], p[1])
    if (!endpoints.has(k)) endpoints.set(k, [])
    endpoints.get(k).push({ w, end })
  }
}

/** Bearing pointing OUT of the way at the given end. */
function endBearing(w, end) {
  if (end === 0) {
    const a = w.pts[0]
    const b = w.pts[1]
    return bearing(b[0], b[1], a[0], a[1])
  }
  const n = w.pts.length
  const a = w.pts[n - 2]
  const b = w.pts[n - 1]
  return bearing(a[0], a[1], b[0], b[1])
}

let fromCont = 0
for (let round = 0; round < 6; round++) {
  let spread = 0
  for (const list of endpoints.values()) {
    if (list.length < 2) continue
    for (const from of list) {
      if (!from.w.name) continue
      const candidates = list.filter((o) => o.w !== from.w && !o.w.name && o.w.ref.h === from.w.ref.h)
      if (candidates.length !== 1) continue
      const to = candidates[0]
      const out = endBearing(from.w, from.end)
      const back = endBearing(to.w, to.end)
      /* Both bearings point out of their own way, so a street carrying
         straight on has them roughly 180 degrees apart. */
      if (angleGap(angleGap(out, back), 180) > 35) continue
      to.w.name = from.w.name
      to.w.src = 'continuation'
      spread++
      fromCont++
    }
  }
  if (!spread) break
  console.error(`  continuation round ${round + 1}: +${spread}`)
}
console.error(`Pass 3 (continuation): +${fromCont}`)

/* ── Pass 4 — name the subdivision, not the alley ─────────────────────────── */
/* What is left is mostly interior subdivision loops and service spurs that
   genuinely have no name anywhere. A reader still needs to know WHERE they
   are, so they get the enclosing named place as a context label. */
const areaQuery = `[out:json][timeout:180];(`
  + `way["landuse"~"residential|industrial|commercial"]["name"](${bbox.s},${bbox.w},${bbox.n},${bbox.e});`
  + `way["place"~"neighbourhood|quarter|suburb|village"]["name"](${bbox.s},${bbox.w},${bbox.n},${bbox.e});`
  + `node["place"~"neighbourhood|quarter|suburb|village"]["name"](${bbox.s},${bbox.w},${bbox.n},${bbox.e});`
  + `);out geom tags;`

const areas = []
try {
  const els = await overpass(areaQuery, 'named areas')
  for (const el of els) {
    const name = el.tags && el.tags.name
    if (!name) continue
    if (el.type === 'node' && el.lat != null) {
      areas.push({ name, kind: 'point', lat: el.lat, lng: el.lon })
    } else if (Array.isArray(el.geometry) && el.geometry.length > 2) {
      const ring = el.geometry.map((p) => [p.lat, p.lon])
      let s = Infinity
      let w2 = Infinity
      let n2 = -Infinity
      let e2 = -Infinity
      for (const [la, lo] of ring) {
        if (la < s) s = la
        if (la > n2) n2 = la
        if (lo < w2) w2 = lo
        if (lo > e2) e2 = lo
      }
      areas.push({ name, kind: 'poly', ring, s, w: w2, n: n2, e: e2 })
    }
  }
} catch (err) {
  console.error(`  named-area pass skipped — ${err.message}`)
}
console.error(`  ${areas.length} named areas`)

function inRing(la, lo, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0]
    const xi = ring[i][1]
    const yj = ring[j][0]
    const xj = ring[j][1]
    const hit = (yi > la) !== (yj > la) && lo < ((xj - xi) * (la - yi)) / (yj - yi) + xi
    if (hit) inside = !inside
  }
  return inside
}

function areaFor(la, lo) {
  for (const a of areas) {
    if (a.kind !== 'poly') continue
    if (la < a.s || la > a.n || lo < a.w || lo > a.e) continue
    if (inRing(la, lo, a.ring)) return a.name
  }
  let best = null
  let bestD = 350
  for (const a of areas) {
    if (a.kind !== 'point') continue
    const d = metres(la, lo, a.lat, a.lng)
    if (d < bestD) {
      bestD = d
      best = a.name
    }
  }
  return best
}

let fromArea = 0
for (const w of ways) {
  if (w.name) continue
  const mid = w.pts[Math.floor(w.pts.length / 2)]
  const raw = areaFor(mid[0], mid[1])
  if (!raw) continue
  const area = cleanPlaceName(raw)
  // A label that is only the barangay name is worse than none: it reads like a
  // street, and the barangay is already on the screen.
  if (!area || NOT_A_STREET.has(area.toLowerCase())) continue
  const noun = w.ref.h === 'service' ? 'service road' : w.ref.h === 'track' ? 'track' : 'road'
  w.name = `${area} ${noun}`
  w.src = 'area'
  fromArea++
}
console.error(`Pass 4 (area context): +${fromArea}`)

/* ── Pass 5 — the street it hangs off ─────────────────────────────────────── */
/* What survives pass 4 is mostly a service spur or an alley inside no named
   place at all. It still HAS a location a person can describe, and they
   describe it by the street it leaves: "the lane off Caingin Road". Only real
   street names (osm / ref / addr / continuation) are borrowed — chaining off
   an area label would compound a guess onto a guess. */
const REAL_SRC = new Set(['osm', 'ref', 'addr', 'continuation'])
const anchors = ways.filter((w) => w.name && REAL_SRC.has(w.src))

const aGrid = new Map()
for (const w of anchors) {
  const seen = new Set()
  for (const [la, lo] of w.pts) {
    const k = cellKey(la, lo)
    if (seen.has(k)) continue
    seen.add(k)
    if (!aGrid.has(k)) aGrid.set(k, [])
    aGrid.get(k).push(w)
  }
}

const NEAR_M = 150
let fromNear = 0
for (const w of ways) {
  if (w.name) continue
  const mid = w.pts[Math.floor(w.pts.length / 2)]
  const ci = Math.floor(mid[0] / CELL)
  const cj = Math.floor(mid[1] / CELL)
  let best = null
  let bestD = NEAR_M
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (const a of aGrid.get(`${ci + di}:${cj + dj}`) || []) {
        for (let i = 1; i < a.pts.length; i++) {
          const d = distToSegment(
            mid[0], mid[1],
            a.pts[i - 1][0], a.pts[i - 1][1],
            a.pts[i][0], a.pts[i][1],
          )
          if (d < bestD) {
            bestD = d
            best = a
          }
        }
      }
    }
  }
  if (!best) continue
  w.name = `off ${best.name}`
  w.src = 'near'
  fromNear++
}
console.error(`Pass 5 (off a named street): +${fromNear}`)

/* ── Pass 6 — nothing stays nameless ──────────────────────────────────────── */
/* The brief is that every street is searchable. A way with no name, no
   address, no subdivision and no named neighbour still sits in a barangay,
   and "Brgy. Marinig local road" is both true and findable — which
   "Unnamed road" repeated nine hundred times is not. */
const brgyFeatures = JSON.parse(
  readFileSync(new URL('../src/data/cabuyaoBarangays.geo.json', import.meta.url), 'utf8'),
).features

/* Centroids, for the ways the strict test cannot place. The bundler keeps any
   road whose centreline runs within about 100 m of the city boundary, so a
   boundary street is legitimately IN the network and legitimately OUTSIDE
   every polygon. Those are edge-of-barangay roads, and naming them after the
   barangay they run along is accurate. */
const brgyCentroids = brgyFeatures.map((f) => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  let sLat = 0
  let sLng = 0
  let n = 0
  for (const poly of polys) {
    for (const [x, y] of poly[0]) {
      sLat += y
      sLng += x
      n++
    }
  }
  return { name: f.properties.name, lat: sLat / n, lng: sLng / n }
})

function barangayAt(la, lo) {
  for (const f of brgyFeatures) {
    const geom = f.geometry
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
    for (const poly of polys) {
      // ring is [lng,lat]; inRing takes (lat, lng, [[lat,lng],…])
      const outer = poly[0].map(([x, y]) => [y, x])
      if (!inRing(la, lo, outer)) continue
      const inHole = poly.slice(1).some((h) => inRing(la, lo, h.map(([x, y]) => [y, x])))
      if (!inHole) return f.properties.name
    }
  }
  let best = null
  let bestD = Infinity
  for (const c of brgyCentroids) {
    const d = metres(la, lo, c.lat, c.lng)
    if (d < bestD) {
      bestD = d
      best = c.name
    }
  }
  return best
}

let fromBrgy = 0
for (const w of ways) {
  if (w.name) continue
  const mid = w.pts[Math.floor(w.pts.length / 2)]
  const brgy = barangayAt(mid[0], mid[1])
  if (!brgy) continue
  const noun = w.ref.h === 'service' ? 'service road'
    : w.ref.h === 'track' ? 'track'
      : w.ref.h === 'footway' || w.ref.h === 'path' ? 'footpath'
        : 'local road'
  w.name = `Brgy. ${brgy} ${noun}`
  w.src = 'barangay'
  fromBrgy++
}
console.error(`Pass 6 (barangay fallback): +${fromBrgy}`)

/* ── Write back ───────────────────────────────────────────────────────────── */
for (const w of ways) {
  w.ref.n = w.name || 0
  if (w.name && w.src && w.src !== 'osm') w.ref.ns = w.src
  else delete w.ref.ns
}

const after = ways.filter((w) => !w.name).length
roads.namesEnrichedAt = new Date().toISOString()
roads.nameCoverage = {
  total: ways.length,
  named: ways.length - after,
  unnamed: after,
  osm: ways.filter((w) => w.src === 'osm').length,
  ref: ways.filter((w) => w.src === 'ref').length,
  addr: ways.filter((w) => w.src === 'addr').length,
  continuation: ways.filter((w) => w.src === 'continuation').length,
  area: ways.filter((w) => w.src === 'area').length,
  near: ways.filter((w) => w.src === 'near').length,
  barangay: ways.filter((w) => w.src === 'barangay').length,
}

writeFileSync(ROADS_URL, JSON.stringify(roads))
console.error('')
console.error('================ RESULT ================')
console.error(`unnamed: ${before} -> ${after}`)
console.error(`coverage: ${(((ways.length - after) / ways.length) * 100).toFixed(1)}%`)
console.error(JSON.stringify(roads.nameCoverage, null, 2))
