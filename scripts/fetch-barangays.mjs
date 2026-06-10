/* One-off data build: pull the real Cabuyao City barangay boundaries from
   OpenStreetMap (admin_level=10) and bundle them as a GeoJSON FeatureCollection
   the app can ship offline. Run with: node scripts/fetch-barangays.mjs

   Everything is fetched in a SINGLE Overpass `out geom` request (one round-trip,
   friendly to rate limits); member ways are stitched into closed rings locally
   so we depend on no external polygon-assembly service. */

import { writeFileSync } from 'node:fs'

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function overpass(query) {
  for (let attempt = 0; attempt < 9; attempt++) {
    const ep = OVERPASS[attempt % OVERPASS.length]
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'CDRRMO-FloodRoute/1.0 (Cabuyao barangay boundary data build)',
        },
        body: 'data=' + encodeURIComponent(query),
      })
      const text = await res.text()
      if (res.ok && text.trim().startsWith('{')) return JSON.parse(text)
      console.error(`  ${ep} -> ${res.status}; backing off…`)
    } catch (e) {
      console.error(`  ${ep} failed: ${e.message}`)
    }
    await sleep(4000 * (attempt + 1))
  }
  throw new Error('Overpass unavailable after retries')
}

/* ── Ring assembly ──────────────────────────────────────────────────────── */
const key = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`

function assembleRings(ways) {
  const segs = ways
    .filter((w) => Array.isArray(w.geometry) && w.geometry.length > 1)
    .map((w) => w.geometry.slice())
  const rings = []

  while (segs.length) {
    let ring = segs.shift()
    let guard = 0
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 100000) {
      let extended = false
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i]
        const head = ring[0]
        const tail = ring[ring.length - 1]
        if (key(tail) === key(s[0])) { ring = ring.concat(s.slice(1)); segs.splice(i, 1); extended = true; break }
        if (key(tail) === key(s[s.length - 1])) { ring = ring.concat(s.slice().reverse().slice(1)); segs.splice(i, 1); extended = true; break }
        if (key(head) === key(s[s.length - 1])) { ring = s.slice().concat(ring.slice(1)); segs.splice(i, 1); extended = true; break }
        if (key(head) === key(s[0])) { ring = s.slice().reverse().concat(ring.slice(1)); segs.splice(i, 1); extended = true; break }
      }
      if (!extended) break // open ring (shouldn't happen for admin areas)
    }
    rings.push(ring.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)])) // GeoJSON [lng,lat]
  }
  return rings
}

function ringArea(ring) {
  let a = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

function ringsToGeometry(outerRings, innerRings) {
  const outers = outerRings
    .filter((r) => r.length >= 4)
    .sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))
  const inners = innerRings.filter((r) => r.length >= 4)
  if (outers.length === 1) return { type: 'Polygon', coordinates: [outers[0], ...inners] }
  return { type: 'MultiPolygon', coordinates: outers.map((o) => [o]) }
}

function relationToGeometry(rel) {
  const outerWays = rel.members.filter((m) => m.type === 'way' && m.role !== 'inner')
  const innerWays = rel.members.filter((m) => m.type === 'way' && m.role === 'inner')
  return ringsToGeometry(assembleRings(outerWays), assembleRings(innerWays))
}

async function main() {
  console.error('Fetching ALL Cabuyao barangay boundaries in one request…')
  const data = await overpass(
    '[out:json][timeout:90];area["name"="Cabuyao"]["admin_level"="6"]->.a;' +
      'rel(area.a)["admin_level"="10"];out geom;',
  )
  const rels = data.elements.filter((e) => e.type === 'relation')
  rels.sort((a, b) => (a.tags?.name || '').localeCompare(b.tags?.name || ''))
  console.error(`Got ${rels.length} relations: ${rels.map((r) => r.tags?.name).join(', ')}`)

  const features = rels.map((rel) => {
    const geometry = relationToGeometry(rel)
    const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()
    console.error(`  ${rel.tags?.name}: ${geometry.type}, outer ${rings[0]?.length || 0} pts`)
    return {
      type: 'Feature',
      properties: {
        name: rel.tags?.name,
        osm_id: rel.id,
        ...(rel.tags?.alt_name ? { alt_name: rel.tags.alt_name } : {}),
      },
      geometry,
    }
  })

  const fc = { type: 'FeatureCollection', features }
  const out = new URL('../src/data/cabuyaoBarangays.geo.json', import.meta.url)
  writeFileSync(out, JSON.stringify(fc))
  console.error(`\nWrote ${features.length} features -> src/data/cabuyaoBarangays.geo.json`)
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
