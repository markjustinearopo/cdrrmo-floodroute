/* Add one-way direction to the bundled road network.
   Run: node scripts/fetch-oneway.mjs

   WHY THIS IS A SEPARATE SCRIPT AND NOT PART OF fetch-roads.mjs
   fetch-roads.mjs rebuilds the whole bundle: it re-clips to the barangay
   polygons, re-runs the connectivity BFS and re-generates the synthetic
   stitch ways. Its output is then enriched in place by enrich-road-names.mjs,
   which is where 3,832 of the current names come from. Re-running the fetch
   to pick up one extra tag would throw all of that away and require the whole
   pipeline to be re-run and re-validated.

   OSM way ids are stable, so this asks Overpass only for the tags of the ways
   already in the bundle and merges one field in. Everything else in the file
   is left byte-identical.

   WHAT IT WRITES
     o : +1  one-way, in the same direction the geometry is stored
         -1  one-way, against the stored geometry ("oneway=-1" in OSM)
         absent — two-way. The overwhelming majority; storing nothing keeps
         the bundle small.
     of: 1   pedestrians are ALSO restricted here (oneway:foot=yes).
             Vanishingly rare, and it exists because the default is the
             opposite: a one-way street is one-way for VEHICLES. Pedestrians
             may walk either way along it, which matters enormously in this
             app — see the note in routeEngine.js.

   WHAT COUNTS AS ONE-WAY
     oneway = yes | true | 1        → +1
     oneway = -1 | reverse          → -1
     junction = roundabout|circular → +1 implicitly, even with no oneway tag.
                                      This is the OSM convention and skipping
                                      it lets a router drive the wrong way
                                      round every rotunda in the city.
     oneway = no | false | 0        → two-way, explicitly. Wins over the
                                      roundabout default (some OSM circles
                                      really are two-way).
     oneway = reversible | alternating
                                    → two-way HERE, deliberately. The
                                      direction depends on the time of day and
                                      nothing in this bundle knows what time
                                      it is; refusing the road outright would
                                      be worse than letting the driver read
                                      the sign. Counted and reported so the
                                      number is never silently zero.

   Synthetic stitch ways (negative ids) are two-way by construction — they are
   our own connectors, not real streets — and are not queried.
*/

import { readFileSync, writeFileSync } from 'node:fs'

const ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]

const BUNDLE = new URL('../src/data/cabuyaoRoads.json', import.meta.url)
const CHUNK = 400 // way ids per request — keeps each URL and each response sane

const bundle = JSON.parse(readFileSync(BUNDLE, 'utf8'))
const ways = bundle.ways || []
const realIds = ways.map((w) => w.i).filter((id) => id > 0)

console.log(`bundle: ${ways.length} ways (${realIds.length} real OSM, ${ways.length - realIds.length} synthetic)`)

async function overpass(query) {
  let lastErr = null
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      })
      if (!res.ok) { lastErr = new Error(`${ep} → HTTP ${res.status}`); continue }
      const text = await res.text()
      // A dispatcher error comes back as HTML with a 200, which JSON.parse
      // would report as a syntax error and hide which endpoint failed.
      if (!text.trimStart().startsWith('{')) { lastErr = new Error(`${ep} → not JSON: ${text.slice(0, 120)}`); continue }
      return JSON.parse(text)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('every Overpass endpoint failed')
}

const tagsById = new Map()
for (let i = 0; i < realIds.length; i += CHUNK) {
  const slice = realIds.slice(i, i + CHUNK)
  const query = `[out:json][timeout:120];way(id:${slice.join(',')});out tags;`
  process.stdout.write(`  fetching ${i + 1}–${i + slice.length} of ${realIds.length}… `)
  const data = await overpass(query)
  for (const el of data.elements || []) {
    if (el.type === 'way') tagsById.set(el.id, el.tags || {})
  }
  console.log(`ok (${data.elements?.length ?? 0} back)`)
}

console.log(`\ntags received for ${tagsById.size} / ${realIds.length} ways`)

const YES = new Set(['yes', 'true', '1'])
const REVERSE = new Set(['-1', 'reverse'])
const NO = new Set(['no', 'false', '0'])
const TIME_DEPENDENT = new Set(['reversible', 'alternating'])

const stats = {
  forward: 0, backward: 0, roundabout: 0, footRestricted: 0,
  timeDependent: 0, explicitTwoWay: 0, missing: 0,
}

for (const w of ways) {
  const tags = tagsById.get(w.i)
  if (!tags) {
    if (w.i > 0) stats.missing++
    delete w.o
    delete w.of
    continue
  }

  const oneway = String(tags.oneway ?? '').toLowerCase().trim()
  const junction = String(tags.junction ?? '').toLowerCase().trim()

  let dir = 0
  if (YES.has(oneway)) dir = 1
  else if (REVERSE.has(oneway)) dir = -1
  else if (TIME_DEPENDENT.has(oneway)) { stats.timeDependent++; dir = 0 }
  else if (NO.has(oneway)) { stats.explicitTwoWay++; dir = 0 }
  else if (junction === 'roundabout' || junction === 'circular') { dir = 1; stats.roundabout++ }

  if (dir === 1) stats.forward++
  else if (dir === -1) stats.backward++

  if (dir) w.o = dir
  else delete w.o

  // Pedestrians are exempt from one-way UNLESS OSM says otherwise.
  const onewayFoot = String(tags['oneway:foot'] ?? '').toLowerCase().trim()
  if (dir && YES.has(onewayFoot)) { w.of = 1; stats.footRestricted++ } else delete w.of
}

bundle.onewayFetched = new Date().toISOString()

/* One way object per line, so a diff of this file is readable rather than a
   single 4 MB line. Built by hand instead of JSON.stringify(bundle, null, 2)
   because pretty-printing every coordinate would triple the file. */
const { ways: _ways, ...meta } = bundle
const metaPairs = Object.entries(meta).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
const body = ways.map((w) => JSON.stringify(w)).join(',\n')
const text = `{${metaPairs.join(',')},"ways":[\n${body}\n]}\n`

// Never write a file the app cannot read: parse it back before it lands.
const reparsed = JSON.parse(text)
if (reparsed.ways.length !== ways.length) {
  throw new Error(`round-trip lost ways: ${reparsed.ways.length} vs ${ways.length}`)
}
writeFileSync(BUNDLE, text)

const oneWayTotal = stats.forward + stats.backward
console.log(`
one-way ways found : ${oneWayTotal}  (${(oneWayTotal / ways.length * 100).toFixed(1)}% of the network)
  forward (o=+1)   : ${stats.forward}
  backward (o=-1)  : ${stats.backward}
  of which roundabouts, implicit : ${stats.roundabout}
  pedestrians also restricted    : ${stats.footRestricted}
explicitly two-way : ${stats.explicitTwoWay}
time-dependent (reversible/alternating, kept two-way) : ${stats.timeDependent}
ways OSM no longer has : ${stats.missing}${stats.missing ? '  ← deleted or merged upstream; left two-way' : ''}

written: src/data/cabuyaoRoads.json`)
