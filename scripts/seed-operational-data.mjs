/* ============================================================================
   seed-operational-data.mjs — realistic OPERATIONAL dataset for Supabase.

   Populates the live-event tables the three portals render, so the system
   demonstrates as a fully-loaded command centre instead of an empty shell:

     alerts              issued warnings (emergency → all-clear, incl. scheduled)
     incidents           field reports with map coordinates + response teams
     incident_updates    the per-incident activity timeline
     evacuation_centers  occupancy set to a realistic mix (FULL / available / closed)
     road_status         many flooded + closed road segments, on real OSM ways
     flood_reports       resident-submitted reports (approved / pending / rejected)
     flood_report_logs   the verification trail behind each one
     flood_readings      per-barangay rainfall / water-level history
     barangay_officials  the 18 punong barangay + BDRRMC focal persons
     residents           a sample resident registry with vulnerability flags
     app_settings        the shared traffic-congestion paint

   SCENARIO — the one story every table tells:
     Southwest monsoon (Habagat) enhanced by Tropical Depression "Ferdie",
     three days of rain over the Laguna de Bay lakeshore. The lakeshore and
     low-lying barangays (Baclaran, Bigaa, Butong, Marinig, Gulod, Mamatid,
     Niugan, Banlic, Sala) are inundated; the upland west (Casile, Pittland,
     Diezmo) is dry and hosts the receiving evacuation centres.

   Timestamps are generated RELATIVE TO NOW, so the data always reads as a
   live, ongoing event whenever the script is run.

   WHAT IT DOES NOT TOUCH: accounts, barangays, roles, integrations, system
   config — the real reference data. Evacuation centres are UPDATED in place
   (occupancy/status/contact), never deleted.

   Idempotent: each operational table is cleared and rewritten, so re-running
   restores exactly this dataset.

   Run:  node scripts/seed-operational-data.mjs
   ========================================================================= */

import { readFileSync } from 'node:fs'

/* ── Supabase REST client (no dependencies — reads .env) ─────────────────── */
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const BASE = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
if (!BASE || !KEY) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env')

const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function rest(path, opts = {}) {
  const r = await fetch(`${BASE}/rest/v1/${path}`, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) } })
  const txt = await r.text()
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path} → ${r.status} ${txt.slice(0, 400)}`)
  return txt ? JSON.parse(txt) : null
}
const select = (path) => rest(path)
const del = (path) => rest(path, { method: 'DELETE' })
/** Insert in chunks — PostgREST rejects very large single payloads. */
async function insert(table, rows, chunk = 200) {
  const out = []
  for (let i = 0; i < rows.length; i += chunk) {
    const got = await rest(table, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(rows.slice(i, i + chunk)),
    })
    if (Array.isArray(got)) out.push(...got)
  }
  return out
}
const patch = (path, body) =>
  rest(path, { method: 'PATCH', body: JSON.stringify(body) })

/* ── Time helpers — everything is relative to the run, in Asia/Manila ────── */
const NOW = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const ago = (ms) => new Date(NOW - ms).toISOString()
const ahead = (ms) => new Date(NOW + ms).toISOString()

/* Deterministic PRNG, so a re-run reproduces the same "random" dataset. */
let _seed = 20260825
function rnd() {
  _seed = (_seed * 1664525 + 1013904223) % 4294967296
  return _seed / 4294967296
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const between = (a, b) => a + rnd() * (b - a)
const round = (v, d = 2) => Number(v.toFixed(d))

/* ── Bundled geodata (the same files the app renders from) ───────────────── */
const roadsFile = JSON.parse(readFileSync(new URL('../src/data/cabuyaoRoads.json', import.meta.url), 'utf8'))
const brgyGeo = JSON.parse(readFileSync(new URL('../src/data/cabuyaoBarangays.geo.json', import.meta.url), 'utf8'))
const terrain = JSON.parse(readFileSync(new URL('../src/data/cabuyaoElevation.json', import.meta.url), 'utf8'))

const GN = terrain.gridN
const { s: S, w: W, n: N, e: E } = terrain.bbox

/** Ground elevation (m) — bilinear sample of the bundled terrain grid.
 *  Mirrors floodRisk.elevationAt so the seed agrees with the live model. */
function elevationAt(lat, lng) {
  const el = terrain.elevation
  let fx = ((lng - W) / (E - W)) * GN - 0.5
  let fy = ((lat - S) / (N - S)) * GN - 0.5
  fx = Math.max(0, Math.min(GN - 1, fx))
  fy = Math.max(0, Math.min(GN - 1, fy))
  const c0 = Math.floor(fx), r0 = Math.floor(fy)
  const c1 = Math.min(GN - 1, c0 + 1), r1 = Math.min(GN - 1, r0 + 1)
  const dx = fx - c0, dy = fy - r0
  const at = (r, c) => el[r * GN + c]
  const top = at(r0, c0) * (1 - dx) + at(r0, c1) * dx
  const bot = at(r1, c0) * (1 - dx) + at(r1, c1) * dx
  return Math.round(top * (1 - dy) + bot * dy)
}

function pointInRing([lat, lng], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function inGeom(pt, g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return polys.some((p) => pointInRing(pt, p[0]) && !p.slice(1).some((h) => pointInRing(pt, h)))
}
function barangayAt(lat, lng) {
  for (const f of brgyGeo.features) if (inGeom([lat, lng], f.geometry)) return f.properties.name
  return null
}
const CENTROID = Object.fromEntries(brgyGeo.features.map((f) => [f.properties.name, f.properties.center]))

/** A point a short way off the barangay's interior point, still inside it. */
function nearCentroid(name, spreadDeg = 0.006) {
  const c = CENTROID[name]
  if (!c) return [14.2726, 121.1256]
  for (let i = 0; i < 40; i++) {
    const p = [c[0] + between(-spreadDeg, spreadDeg), c[1] + between(-spreadDeg, spreadDeg)]
    if (barangayAt(p[0], p[1]) === name) return [round(p[0], 6), round(p[1], 6)]
  }
  return [round(c[0], 6), round(c[1], 6)]
}

/* ============================================================================
   1. ROAD NETWORK — attribute every bundled OSM way to a barangay + elevation
   ========================================================================= */
const WAYS = []
for (const w of roadsFile.ways) {
  const g = w.g
  const m = Math.floor(g.length / 4) * 2 // a node about a quarter along the way
  const lat = g[m], lng = g[m + 1]
  const brgy = barangayAt(lat, lng)
  if (!brgy) continue
  WAYS.push({
    id: w.i,
    name: w.n || null,
    cls: w.h,
    brgy,
    lat: round(lat, 6),
    lng: round(lng, 6),
    elev: elevationAt(lat, lng),
  })
}

/* ── The event's flood footprint ─────────────────────────────────────────────
   Per-barangay peak water for this scenario, in FEET (the unit CDRRMO records
   and every UI displays). Lakeshore first, upland dry. `share` is how much of
   the barangay's road network is affected. */
const FLOOD_PROFILE = {
  Baclaran:        { peakFt: 4.6, share: 0.18 },
  Bigaa:           { peakFt: 4.0, share: 0.13 },
  Butong:          { peakFt: 3.8, share: 0.12 },
  Marinig:         { peakFt: 4.2, share: 0.13 },
  Gulod:           { peakFt: 3.6, share: 0.11 },
  Mamatid:         { peakFt: 3.2, share: 0.045 },
  Niugan:          { peakFt: 2.6, share: 0.06 },
  Banlic:          { peakFt: 2.4, share: 0.07 },
  Sala:            { peakFt: 2.2, share: 0.045 },
  'Banay-Banay':   { peakFt: 2.0, share: 0.03 },
  'Poblacion Uno': { peakFt: 1.6, share: 0.15 },
  'Poblacion Dos': { peakFt: 1.5, share: 0.15 },
  'Poblacion Tres':{ peakFt: 1.4, share: 0.10 },
  'San Isidro':    { peakFt: 1.4, share: 0.025 },
  Pulo:            { peakFt: 1.2, share: 0.02 },
  Diezmo:          { peakFt: 0.8, share: 0.015 },
  Pittland:        { peakFt: 0.6, share: 0.01 },
  Casile:          { peakFt: 0.5, share: 0.01 },
}

/* Deliberately capped at ~15% of the road network in the worst barangay and a
   couple of percent in the upland west. Painting every low-lying way red would
   look dramatic and demonstrate nothing: the A* router still has to find a
   surviving path to an open evacuation centre. */

/* Blocked (impassable) at knee height and above — the CDRRMO rule of thumb for
   light vehicles; below that it is flooded-but-passable. Only the worst-hit
   lakeshore barangays reach it, so closures stay a minority of the flagged
   network and concentrate where the story says they should. */
const BLOCK_FT = 2.5

const FLOOD_REASONS = [
  'Lake backflow — Laguna de Bay above critical level',
  'Habagat rains, drainage canal overflowing',
  'Creek overflow, water still rising',
  'Clogged drainage — water not receding',
  'Continuous rainfall since 3:00 AM, knee-deep',
  'Sustained heavy rain, road surface submerged',
]
const BLOCK_REASONS = [
  'IMPASSABLE — chest-deep, road closed to all vehicles',
  'Road closed — strong current, unsafe to cross',
  'Closed by CDRRMO — waist-deep, barricades in place',
  'Fallen electric post + flooding — closed both lanes',
  'Landslide debris on carriageway — closed',
  'Bridge approach submerged — closed pending inspection',
  'Uprooted tree blocking both lanes',
]

const REPORTERS = [
  'EOC Duty Operator', 'Rescue Team Alpha', 'Rescue Team Bravo',
  'BDRRMC Volunteers', 'Engineering / Public Works', 'CDRRMO Field Unit',
]

function buildRoadStatus() {
  const rows = []
  const seen = new Set()
  for (const [brgy, profile] of Object.entries(FLOOD_PROFILE)) {
    const pool = WAYS.filter((w) => w.brgy === brgy && w.cls !== 'footway' && w.cls !== 'path')
    if (!pool.length) continue
    // Lowest ground floods first: rank by elevation, then take the share of the
    // network the scenario says is under water. Named ways are nudged up the
    // list so the operator's screens show recognisable street names.
    const ranked = [...pool].sort((a, b) => (a.elev - b.elev) || (b.name ? 1 : 0) - (a.name ? 1 : 0))
    const take = Math.max(2, Math.round(pool.length * profile.share))
    const slice = ranked.slice(0, take)
    slice.forEach((w, i) => {
      if (seen.has(w.id)) return
      seen.add(w.id)
      // Depth falls off across the flooded slice — deepest on the lowest ground,
      // tailing to ankle depth at the edge of the footprint. Ranking within the
      // SLICE (not the whole barangay) is what puts the gradient inside the
      // flooded area instead of squashing every pick to the same peak depth.
      const rel = slice.length > 1 ? i / (slice.length - 1) : 0
      const depthFt = round(Math.max(0.5, profile.peakFt * (1 - 0.8 * rel) * between(0.82, 1.1)), 1)
      const blocked = depthFt >= BLOCK_FT
      rows.push({
        osm_way_id: w.id,
        status: blocked ? 'blocked' : 'flooded',
        name: w.name || `Unnamed ${w.cls === 'service' ? 'service road' : 'road'} · ${brgy}`,
        barangay: brgy,
        flood_depth_ft: depthFt,
        flood_depth_m: round(depthFt * 0.3048, 2),
        reason: blocked ? pick(BLOCK_REASONS) : pick(FLOOD_REASONS),
        reported_by: pick(REPORTERS),
        reported_at: ago(between(10 * MIN, 20 * HOUR)),
        verified: rnd() < 0.82, // the rest are still awaiting a field confirmation
        expected_clear: ahead(between(2 * HOUR, 30 * HOUR)),
      })
    })
  }
  return rows
}

/* ============================================================================
   2. ALERTS — the warning record for this event
   ========================================================================= */
const CITY_WIDE = 'All Barangays'
const ISSUERS = [
  'COLIN B. GARCIA', 'VINCENT PAUL L. BUOT', 'JOHN APRIL K. TERRENAL',
  'CHRISTOPHER JOHN M. SAYSON', 'LYKA D. INVENTOR', 'ERICA M. DELOS SANTOS',
]
const CHANNELS = ['SMS', 'Email', 'In-App']

/** level, title, message, barangay, status, depth (m), age (ms) or scheduled (ms ahead) */
const ALERTS = [
  // ── Active: emergency ──
  ['emergency', 'FORCED EVACUATION — Baclaran Lakeshore',
    '🚨 EMERGENCY: Laguna de Bay has breached the Baclaran lakeshore. Water is chest-deep and still rising along Purok 1–3. FORCED EVACUATION is now in effect. Proceed immediately to Baclaran Elementary School or PAGCOR Multi-Purpose Evacuation Center. Rescue boats are staged at the barangay hall. Do NOT attempt to cross flooded roads.',
    'Baclaran', 'active', 1.4, 42 * MIN],

  // ── Active: high ──
  ['high', 'RED WARNING — Marinig riverside waist-deep',
    '🔴 RED WARNING for Brgy. Marinig. Waist-deep flooding (approx. 1.2 m) along the riverside puroks and Marinig Road. Residents in low-lying areas must evacuate now to Marinig National High School. Avoid all riverbanks — the current is strong.',
    'Marinig', 'active', 1.25, 1 * HOUR + 20 * MIN],
  ['high', 'RED WARNING — Bigaa lakeshore rising fast',
    '🔴 RED WARNING for Brgy. Bigaa. Lake backflow has flooded the lakeshore puroks to approx. 1.1 m and is rising about 10 cm per hour. Evacuate to Bigaa Integrated National High School. Bring medicines, IDs and drinking water only.',
    'Bigaa', 'active', 1.1, 2 * HOUR + 5 * MIN],
  ['high', 'RED WARNING — Butong low-lying puroks',
    '🔴 RED WARNING for Brgy. Butong. Flood depth approx. 1.05 m in the low-lying puroks; several roads are already impassable to light vehicles. Move to higher ground and proceed to Butong-area evacuation centres. Coordinate with your purok leader before moving.',
    'Butong', 'active', 1.05, 2 * HOUR + 40 * MIN],
  ['high', 'RED WARNING — Gulod, roads impassable',
    '🔴 RED WARNING for Brgy. Gulod. Gulod National High School is receiving evacuees. Multiple barangay roads are closed to traffic. Do not drive through flood water — 30 cm is enough to stall a vehicle and 60 cm will float it.',
    'Gulod', 'active', 0.95, 3 * HOUR + 15 * MIN],
  ['high', 'RED WARNING — Mamatid–Banlic Road impassable',
    '🔴 RED WARNING for Brgy. Mamatid. Mamatid–Banlic Road is CLOSED — knee-to-waist deep with a strong current at the creek crossing. Use the Pulo–Diezmo Road detour. Residents along the creek should evacuate to Mamatid National High School.',
    'Mamatid', 'active', 0.9, 4 * HOUR + 10 * MIN],

  // ── Active: moderate ──
  ['moderate', 'ORANGE WARNING — Habagat rains to persist through tomorrow',
    '🟠 CITY-WIDE ORANGE WARNING. PAGASA reports the southwest monsoon enhanced by Tropical Depression "Ferdie" will bring moderate to heavy rains over Cabuyao through tomorrow afternoon. All barangays: activate your BDRRMC, pre-position rescue equipment, and keep evacuation centres on standby. Classes and government work are suspended.',
    CITY_WIDE, 'active', 0.6, 5 * HOUR + 30 * MIN],
  ['moderate', 'ORANGE WARNING — Banlic, Alimagno Compound',
    '🟠 ORANGE WARNING for Brgy. Banlic. Knee-deep flooding (approx. 0.55 m) around the Alimagno Compound and adjoining streets. Prepare to evacuate; keep children and senior citizens away from flooded streets and open canals.',
    'Banlic', 'active', 0.55, 3 * HOUR + 50 * MIN],
  ['moderate', 'ORANGE WARNING — Niugan drainage overflow',
    '🟠 ORANGE WARNING for Brgy. Niugan. The main drainage canal is overflowing; street flooding of approx. 0.5 m is expected to persist while the rain continues. Southville National High School is open for evacuees.',
    'Niugan', 'active', 0.5, 6 * HOUR],
  ['moderate', 'ORANGE WARNING — Sala, NIA Road',
    '🟠 ORANGE WARNING for Brgy. Sala. NIA Road is gutter-to-knee deep and slow-moving. Motorcycles and tricycles should avoid the stretch. Sala Elementary School is on standby as an evacuation centre.',
    'Sala', 'active', 0.45, 7 * HOUR + 25 * MIN],
  ['moderate', 'ORANGE WARNING — Banay-Banay low-lying streets',
    '🟠 ORANGE WARNING for Brgy. Banay-Banay. Approx. 0.4 m of street flooding in the low-lying blocks. PAGCOR Multi-Purpose Evacuation Center is open and receiving families from the affected puroks.',
    'Banay-Banay', 'active', 0.4, 8 * HOUR + 15 * MIN],

  // ── Active: low / advisory ──
  ['low', 'YELLOW ADVISORY — Poblacion Uno street flooding',
    '🟡 YELLOW ADVISORY for Brgy. Poblacion Uno. Minor street flooding (approx. 0.25 m) reported along the market area. Passable to vehicles with care. Clear your drainage outlets and report blockages to the barangay hall.',
    'Poblacion Uno', 'active', 0.25, 9 * HOUR],
  ['low', 'YELLOW ADVISORY — Poblacion Dos, monitor canals',
    '🟡 YELLOW ADVISORY for Brgy. Poblacion Dos. Shallow street flooding around the central district. Residents are advised to monitor canal levels and secure belongings at ground-floor level.',
    'Poblacion Dos', 'active', 0.2, 10 * HOUR + 30 * MIN],
  ['low', 'YELLOW ADVISORY — Pulo, keep drainage clear',
    '🟡 YELLOW ADVISORY for Brgy. Pulo. Gutter-deep flooding in isolated spots after the morning downpour. No evacuation needed at this time; keep drainage outlets clear and stay tuned for updates.',
    'Pulo', 'active', 0.18, 11 * HOUR + 45 * MIN],

  // ── Scheduled (pre-emptive, not yet issued) ──
  ['high', 'PRE-EMPTIVE EVACUATION — lakeshore barangays (high tide window)',
    '🔴 SCHEDULED ADVISORY: High tide coincides with the forecast rainfall peak tonight. Lakeshore barangays (Baclaran, Bigaa, Butong, Marinig, Gulod) must complete pre-emptive evacuation of low-lying puroks before the window. Barangay officials: submit your headcount to the EOC.',
    CITY_WIDE, 'scheduled', 1.0, -(5 * HOUR + 30 * MIN)],
  ['moderate', 'ADVISORY — Overnight rainfall outlook',
    '🟠 SCHEDULED ADVISORY: PAGASA overnight outlook for Cabuyao. Moderate to at times heavy rains continuing. Evacuation centres remain open; hot meals will be served at 6:00 AM. Keep phones charged and monitor official CDRRMO channels only.',
    CITY_WIDE, 'scheduled', null, -(13 * HOUR)],

  // ── Resolved (the record of the last 3 days) ──
  ['safe', 'ALL CLEAR — Casile',
    '✅ ALL CLEAR for Brgy. Casile. Flood water in the low sections has fully receded and all barangay roads are passable. Remain alert for landslides on the upland slopes after prolonged rain.',
    'Casile', 'resolved', null, 14 * HOUR],
  ['safe', 'ALL CLEAR — Diezmo',
    '✅ ALL CLEAR for Brgy. Diezmo. Street flooding has receded and Pulo–Diezmo Road is open to all vehicles. Thank you for your cooperation.',
    'Diezmo', 'resolved', null, 20 * HOUR],
  ['moderate', 'ORANGE WARNING — San Isidro (superseded)',
    '🟠 ORANGE WARNING for Brgy. San Isidro. Street flooding of approx. 0.35 m. — SUPERSEDED: water receded overnight; see the all-clear advisory.',
    'San Isidro', 'resolved', 0.35, 1 * DAY + 4 * HOUR],
  ['high', 'RED WARNING — Pittland (superseded)',
    '🔴 RED WARNING for Brgy. Pittland issued during the first rain band. — SUPERSEDED: the upland barangay drained quickly and is no longer at risk.',
    'Pittland', 'resolved', 0.5, 1 * DAY + 16 * HOUR],
  ['safe', 'ALL CLEAR — city-wide (first rain band)',
    '✅ ALL CLEAR city-wide after the first monsoon band. All roads passable, all evacuation centres stood down. CDRRMO continues to monitor the incoming weather system.',
    CITY_WIDE, 'resolved', null, 2 * DAY + 6 * HOUR],
]

/* The live `alerts_level_check` constraint may predate the emergency tier (see
   migrations/20260821120000_alerts_emergency_level.sql). Probe it once rather
   than have the whole seed die on one row, and tell the operator exactly what
   to run — a database that rejects 'emergency' also silently drops every
   emergency alert the Alerts screen issues, which is worth knowing about. */
let LEVELS_OK = { emergency: true, low: true }
async function probeAlertLevels() {
  for (const level of ['emergency', 'low']) {
    try {
      const [row] = await rest('alerts', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{ level, title: '__probe__', message: '__probe__', barangays: ['Marinig'], status: 'active' }]),
      })
      await del(`alerts?id=eq.${row.id}`)
    } catch {
      LEVELS_OK[level] = false
    }
  }
}
/** Fall back to the nearest level the live constraint accepts. */
const safeLevel = (l) => (LEVELS_OK[l] === false ? (l === 'emergency' ? 'high' : 'moderate') : l)

function buildAlerts() {
  return ALERTS.map(([level, title, message, barangay, status, depth, age]) => ({
    level: safeLevel(level),
    title,
    message,
    barangays: [barangay],
    status,
    depth_m: depth,
    issued_by: pick(ISSUERS),
    channels: CHANNELS,
    // A scheduled alert has not been issued yet — it carries only a future
    // scheduled_for, exactly as the Alerts screen writes one.
    issued_at: status === 'scheduled' ? null : ago(age),
    scheduled_for: status === 'scheduled' ? ahead(-age) : null,
  }))
}

/* ============================================================================
   3. INCIDENTS — field reports, with map coordinates
   ========================================================================= */
/** type, barangay, location, description, priority, status, team, age (ms) */
const INCIDENTS = [
  ['Stranded Residents', 'Baclaran', 'Purok 2, Baclaran Lakeshore',
    'Family of six trapped on the roof of a one-storey house. Water at gutter level and rising. Two children and one bedridden senior citizen included.',
    'critical', 'in-progress', 'Rescue Team Alpha', 35 * MIN],
  ['Stranded Residents', 'Marinig', 'Riverside Purok 4, Marinig',
    'Twelve residents stranded on the second floor of a compound. Access road impassable to trucks — rubber boat required.',
    'critical', 'in-progress', 'Rescue Team Bravo', 55 * MIN],
  ['Medical Emergency', 'Bigaa', 'Purok 3, Bigaa lakeshore',
    'Pregnant woman in labour, cannot reach the district hospital — the access road is chest-deep. Ambulance staged at the barangay hall awaiting a boat transfer.',
    'critical', 'assigned', 'Medical Unit', 1 * HOUR + 25 * MIN],
  ['Flooding', 'Butong', 'Butong lakeshore access road',
    'Chest-deep flooding across the full width of the access road. Barangay tanods have placed barricades at both ends.',
    'high', 'in-progress', 'BDRRMC Volunteers', 2 * HOUR],
  ['Road Blockage', 'Mamatid', 'Mamatid–Banlic Road, creek crossing',
    'Road closed — strong current at the creek crossing washed out one shoulder. Detour signage installed toward Pulo–Diezmo Road.',
    'high', 'assigned', 'Engineering / Public Works', 2 * HOUR + 30 * MIN],
  ['Infrastructure Damage', 'Gulod', 'Gulod National Highway junction',
    'Electric post leaning over the carriageway after the embankment softened. MERALCO notified; lane closed as a precaution.',
    'high', 'assigned', 'Engineering / Public Works', 3 * HOUR + 10 * MIN],
  ['Flooding', 'Banlic', 'Alimagno Compound, Banlic',
    'Knee-deep flooding across the compound. Eight households already moved to the covered court on their own initiative.',
    'high', 'in-progress', 'BDRRMC Volunteers', 3 * HOUR + 45 * MIN],
  ['Power Outage', 'Niugan', 'Southville subdivision, Niugan',
    'Barangay-wide power interruption after MERALCO isolated the flooded distribution line. Estimated restoration once water recedes.',
    'medium', 'assigned', 'Engineering / Public Works', 4 * HOUR + 20 * MIN],
  ['Stranded Residents', 'Gulod', 'Purok 5, Gulod',
    'Three senior citizens unable to walk out through waist-deep water. Requesting a rescue vehicle with a high chassis.',
    'high', 'new', null, 25 * MIN],
  ['Flooding', 'Baclaran', 'Baclaran Elementary School frontage',
    'Water entering the school perimeter. Evacuees moved from the ground-floor classrooms to the second floor.',
    'high', 'in-progress', 'Rescue Team Alpha', 1 * HOUR + 50 * MIN],
  ['Road Blockage', 'Sala', 'NIA Road, Sala',
    'Uprooted acacia blocking both lanes. Chainsaw team requested.',
    'medium', 'assigned', 'Engineering / Public Works', 5 * HOUR],
  ['Medical Emergency', 'Mamatid', 'Purok 7, Mamatid',
    'Elderly resident with chest pains. Ambulance en route via the alternate route generated by the routing module.',
    'critical', 'in-progress', 'Medical Unit', 40 * MIN],
  ['Flooding', 'Marinig', 'Marinig Road near the covered court',
    'Waist-deep and rising about 10 cm/hr. Twenty-two families already at the evacuation centre.',
    'high', 'in-progress', 'BDRRMC Volunteers', 2 * HOUR + 15 * MIN],
  ['Infrastructure Damage', 'Banay-Banay', 'Perimeter wall, Banay-Banay',
    'Section of a subdivision perimeter wall collapsed into the drainage canal, worsening the backup.',
    'medium', 'new', null, 1 * HOUR + 5 * MIN],
  ['Other', 'Poblacion Uno', 'Cabuyao public market',
    'Market stalls flooded to ankle depth; vendors requesting assistance to move goods to higher racks.',
    'low', 'assigned', 'BDRRMC Volunteers', 6 * HOUR + 30 * MIN],
  ['Flooding', 'Poblacion Dos', 'Cabuyao Central School frontage',
    'Ankle-deep street flooding at the school gate. Passable; monitoring only.',
    'low', 'new', null, 7 * HOUR + 10 * MIN],
  ['Road Blockage', 'Bigaa', 'Bigaa–National Highway link',
    'Closed to light vehicles. Only 6-wheelers and rescue trucks are getting through.',
    'high', 'assigned', 'CDRRMO Field Unit', 4 * HOUR + 55 * MIN],
  ['Stranded Residents', 'Butong', 'Purok 1, Butong',
    'Four residents on the roof of a sari-sari store. Boat dispatched.',
    'critical', 'assigned', 'Rescue Team Bravo', 1 * HOUR + 10 * MIN],
  ['Power Outage', 'Baclaran', 'Baclaran barangay hall area',
    'Generator running at the barangay hall; the wider grid is down while the line is isolated.',
    'medium', 'in-progress', 'Engineering / Public Works', 5 * HOUR + 40 * MIN],
  ['Flooding', 'San Isidro', 'San Isidro low block',
    'Shallow street flooding, roughly 0.3 m. No evacuation required.',
    'low', 'resolved', 'BDRRMC Volunteers', 9 * HOUR],
  ['Road Blockage', 'Pulo', 'Pulo–Diezmo Road, Pulo end',
    'Debris cleared and the lane reopened at 4:10 AM. Road now passable.',
    'medium', 'resolved', 'Engineering / Public Works', 11 * HOUR],
  ['Flooding', 'Diezmo', 'Diezmo Elementary School area',
    'Water fully receded; the school stood down as an evacuation centre.',
    'low', 'resolved', 'BDRRMC Volunteers', 14 * HOUR],
  ['Medical Emergency', 'Pittland', 'Pittland upland road',
    'Motorcycle slip on the wet upland road. Rider treated on site and released.',
    'medium', 'resolved', 'Medical Unit', 18 * HOUR],
  ['Other', 'Casile', 'Casile upland slope',
    'Residents reported soil cracking on the slope above the road. Inspected — no movement; advised to monitor.',
    'low', 'resolved', 'CDRRMO Field Unit', 21 * HOUR],
]

/* The activity timeline the Incidents screen renders under each record. */
function timelineFor(status, reportedAt) {
  const t = new Date(reportedAt).getTime()
  const at = (ms) => new Date(t + ms).toISOString()
  const steps = [{ label: 'Reported to the EOC hotline', created_at: at(0) }]
  if (status !== 'new') steps.push({ label: 'Verified and assigned to a response team', created_at: at(8 * MIN) })
  if (status === 'in-progress' || status === 'resolved')
    steps.push({ label: 'Team dispatched — en route to the location', created_at: at(17 * MIN) })
  if (status === 'resolved') {
    steps.push({ label: 'On scene — response underway', created_at: at(34 * MIN) })
    steps.push({ label: 'Incident resolved and stood down', created_at: at(96 * MIN) })
  }
  return steps
}

function buildIncidents() {
  return INCIDENTS.map(([type, brgy, location, description, priority, status, team, age]) => {
    const [lat, lng] = nearCentroid(brgy, 0.0055)
    const reported_at = ago(age)
    return {
      row: {
        incident_type: type,
        barangay: brgy,
        location,
        description,
        priority,
        status,
        assigned_team: team,
        reported_by: pick(['EOC Hotline', 'Barangay Hall', 'Resident (mobile app)', 'CDRRMO Field Unit', 'PNP Cabuyao']),
        lat,
        lng,
        reported_at,
        resolved_at: status === 'resolved' ? new Date(new Date(reported_at).getTime() + 96 * MIN).toISOString() : null,
      },
      timeline: timelineFor(status, reported_at),
    }
  })
}

/* ============================================================================
   4. EVACUATION CENTRES — a realistic occupancy mix (FULL / available / closed)
   ========================================================================= */
/** name → [occupancy, status, facility_type, manager, contact] */
const EVAC_STATE = {
  // ── FULL: at or over capacity, no longer accepting families ──
  'PAGCOR Multi-Purpose Evacuation Center': [1500, 'full', 'Multi-Purpose Center', 'Ma. Teresa R. Amante', '(049) 531-2101'],
  'Baclaran Elementary School':             [ 500, 'full', 'School',   'Oliver P. Galang',        '0917-812-4455'],
  'Marinig National High School':           [ 850, 'full', 'School',   'Conrado B. Hain, Jr.',    '0917-844-2210'],
  'Mamatid National High School':           [ 900, 'full', 'School',   'Ernani G. Himpisao',      '0918-330-7712'],
  'Bigaa Integrated National High School':  [ 900, 'full', 'School',   'Rose Ann V. Cantalejo',   '0917-655-1180'],

  // ── Open, filling fast ──
  'Gulod National High School':             [ 742, 'open', 'School',   'Dominador V. Maniclang',  '0917-771-6620'],
  'Butong Elementary School':               [ 448, 'open', 'School',   'Charie P. Barrio',        '0919-224-8830'],
  'North Marinig Elementary School':        [ 461, 'open', 'School',   'Lorna B. Sarmiento',      '0917-402-3355'],
  'Marinig South Elementary School':        [ 437, 'open', 'School',   'Rodel M. Villamor',       '0917-402-3356'],
  'Banlic Elementary School':               [ 388, 'open', 'School',   'Elizabeth L. Austria',    '0916-558-2244'],
  'Bigaa Elementary School':                [ 402, 'open', 'School',   'Marilou C. Enriquez',     '0917-655-1181'],
  'Southville National High School':        [ 515, 'open', 'School',   'John Cyril C. Hain',      '0918-771-9042'],
  'Niugan Elementary School':               [ 296, 'open', 'School',   'Ricardo A. Fajardo',      '0918-771-9043'],
  'Mamatid Elementary School':              [ 371, 'open', 'School',   'Grace P. Delos Reyes',    '0918-330-7713'],
  'Gulod Elementary School':                [ 289, 'open', 'School',   'Aurora M. Sandoval',      '0917-771-6621'],

  // ── Open, plenty of room ──
  'Cabuyao Integrated National High School':[ 318, 'open', 'School',   'Antonette M. Hain',       '(049) 531-1188'],
  'Cabuyao Central School':                 [ 214, 'open', 'School',   'Melvin R. Calandria',     '(049) 531-1190'],
  'Banay-Banay Elementary School':          [ 186, 'open', 'School',   'Eric E. Barron',          '0917-330-4412'],
  'Sala Elementary School':                 [ 143, 'open', 'School',   'Francisco D. Alimagno',   '0917-228-6611'],
  'Pulo National High School':              [ 122, 'open', 'School',   'Armando H. Amoranto',     '0917-990-2233'],
  'Pulo Elementary School':                 [  87, 'open', 'School',   'Susan T. Rivera',         '0917-990-2234'],
  'San Isidro Elementary School':           [  64, 'open', 'School',   'Richard L. Algire',       '0918-445-7788'],
  'Southville Elementary School':           [ 158, 'open', 'School',   'Carmela V. Ocampo',       '0918-771-9044'],

  // ── Open but empty — the upland receiving centres on standby ──
  'Pulo National High School – Diezmo Annex': [ 41, 'open', 'School',  'Alfredo M. Malabanan',    '0917-556-3390'],
  'Diezmo Elementary School':               [  26, 'open', 'School',   'Teresita R. Nolasco',     '0917-556-3391'],
  'Pittland Elementary School':             [  18, 'open', 'School',   'Teodoro N. Enriquez',     '0916-773-2200'],
  'Casile Integrated National High School': [   9, 'open', 'School',   'Orlando P. De Sagun',     '0916-773-2201'],
  'Casile Elementary School':               [   0, 'open', 'School',   'Nenita B. Aguilar',       '0916-773-2202'],

  // ── Closed ──
  'Guinting Elementary School':             [   0, 'closed', 'School', 'Melchor D. Rana',         '0916-773-2203'],
}

/* ============================================================================
   5. FLOOD REPORTS — resident submissions + the verification trail
   ========================================================================= */
/** barangay, level, depthFt, description, reporter, status, notes, verifier, age */
const FLOOD_REPORTS = [
  ['Baclaran', 'impassable', 4.5, 'Chest-deep na po dito sa Purok 2, hindi na madaanan kahit ng tricycle. Marami pong nakaakyat na sa bubong.', 'Gab Ubales', 'approved', 'Confirmed by Rescue Team Alpha on site. Forced evacuation ordered.', 'COLIN B. GARCIA', 50 * MIN],
  ['Marinig', 'severe', 3.8, 'Hanggang baywang na ang tubig sa Marinig Road malapit sa covered court. Tumataas pa rin.', 'Test Resident', 'approved', 'Verified against the field team report. Matches the sensor trend.', 'VINCENT PAUL L. BUOT', 1 * HOUR + 15 * MIN],
  ['Bigaa', 'severe', 3.4, 'Umapaw na po ang lawa dito sa lakeshore. Papasok na sa mga bahay.', 'Maricel Doblada', 'approved', 'Confirmed — lake backflow. Red warning already issued for Bigaa.', 'JOHN APRIL K. TERRENAL', 2 * HOUR + 10 * MIN],
  ['Butong', 'severe', 3.1, 'Baha po sa access road ng Butong, hindi na kayang daanan ng motor.', 'Ronnie Alcantara', 'approved', 'Verified. Road segment flagged as closed on the road-status map.', 'CHRISTOPHER JOHN M. SAYSON', 2 * HOUR + 45 * MIN],
  ['Gulod', 'severe', 2.9, 'Waist-deep sa Purok 5. May mga matatanda na hindi makalabas.', 'Josefina Ramos', 'approved', 'Confirmed; a rescue request was logged as an incident from this report.', 'LYKA D. INVENTOR', 3 * HOUR + 5 * MIN],
  ['Banlic', 'moderate', 1.8, 'Tuhod ang lalim ng baha dito sa Alimagno Compound.', 'Dennis Villar', 'approved', 'Verified by the barangay official on duty.', 'ERICA M. DELOS SANTOS', 3 * HOUR + 40 * MIN],
  ['Mamatid', 'moderate', 1.6, 'Hindi na madaanan ang Mamatid–Banlic Road, malakas ang agos sa creek.', 'Arnel Bautista', 'approved', 'Confirmed. Closure and detour published.', 'COLIN B. GARCIA', 4 * HOUR + 20 * MIN],
  ['Sala', 'low', 0.9, 'Gutter-deep lang po sa NIA Road pero madulas.', 'Liza Mercado', 'approved', 'Verified — advisory level, no evacuation needed.', 'VINCENT PAUL L. BUOT', 6 * HOUR],
  ['Niugan', 'moderate', 1.5, 'Umaapaw ang kanal sa Southville, papasok na sa garahe.', 'Rowena Castillo', 'pending', null, null, 22 * MIN],
  ['Poblacion Uno', 'low', 0.7, 'Konting baha lang sa palengke, pero tumataas kapag umuulan nang malakas.', 'Test Resident', 'pending', null, null, 48 * MIN],
  ['Banay-Banay', 'moderate', 1.3, 'Baha po sa may subdivision entrance, hanggang hita.', 'Michael Ocampo', 'pending', null, null, 1 * HOUR + 30 * MIN],
  ['Pulo', 'low', 0.5, 'Basa lang po ang kalsada, hindi naman baha.', 'Angelo Ferrer', 'pending', null, null, 2 * HOUR + 20 * MIN],
  ['Casile', 'severe', 3.0, 'Baha daw po dito sa Casile.', 'Anonymous Resident', 'rejected', 'Could not be verified — Casile sits 280 m above the lake and the field team found no flooding. Possible mistaken location.', 'JOHN APRIL K. TERRENAL', 8 * HOUR],
  ['Pittland', 'moderate', 2.0, 'May baha po sa Pittland.', 'Anonymous Resident', 'rejected', 'Duplicate of an earlier report that was already resolved. No action needed.', 'CHRISTOPHER JOHN M. SAYSON', 12 * HOUR],
]

/* ============================================================================
   6. FLOOD READINGS — per-barangay rainfall / water-level history
   ========================================================================= */
function buildReadings() {
  const rows = []
  // Rain intensity profile over the last 24 hours (mm/hr), newest last.
  const RAIN = [3, 5, 8, 11, 14, 18, 22, 26, 24, 20, 17, 21, 25, 28, 24, 19, 15, 12, 14, 17, 20, 23, 26, 22]
  for (const [brgy, profile] of Object.entries(FLOOD_PROFILE)) {
    const peakM = profile.peakFt * 0.3048
    for (let h = 23; h >= 0; h--) {
      // Every 3rd hour — a plausible telemetry cadence, not a wall of rows.
      if (h % 3 !== 0) continue
      const t = 23 - h
      const ramp = Math.min(1, (t + 1) / 22)
      const depth = round(peakM * ramp * between(0.88, 1.04), 2)
      const rain = round(RAIN[t] * between(0.75, 1.2), 1)
      rows.push({
        barangay: brgy,
        recorded_at: ago(h * HOUR),
        rainfall_mmh: rain,
        water_level_m: round(depth + between(0.25, 0.6), 2),
        flood_depth_m: depth,
        risk_level: depth >= 0.5 ? 'high' : depth >= 0.3 ? 'moderate' : depth >= 0.1 ? 'low' : 'safe',
      })
    }
  }
  return rows
}

/* ============================================================================
   7. BARANGAY OFFICIALS — the punong barangay + BDRRMC focal person each
   ========================================================================= */
const CAPTAINS = [
  ['Baclaran', 'OLIVER P. GALANG', 'Ver', '(049) 531-0181'],
  ['Banay-Banay', 'ERIC E. BARRON', 'Eric', '(049) 531-0182'],
  ['Banlic', 'ELIZABETH L. AUSTRIA', 'Beth', '(049) 531-0183'],
  ['Bigaa', 'ROSE ANN V. CANTALEJO', 'Rose', '(049) 531-0184'],
  ['Butong', 'CHARIE P. BARRIO', 'Charie', '(049) 531-0185'],
  ['Casile', 'ORLANDO P. DE SAGUN', 'Lando', '(049) 531-0186'],
  ['Diezmo', 'ALFREDO M. MALABANAN', 'Fred', '(049) 531-0187'],
  ['Gulod', 'DOMINADOR V. MANICLANG', 'Domeng', '(049) 531-0188'],
  ['Mamatid', 'ERNANI G. HIMPISAO', 'Nani', '(049) 531-0189'],
  ['Marinig', 'CONRADO B. HAIN, JR.', 'Jun', '(049) 531-0190'],
  ['Niugan', 'JOHN CYRIL C. HAIN', 'Cyril', '(049) 531-0191'],
  ['Pittland', 'TEODORO N. ENRIQUEZ', 'Doro', '(049) 531-0192'],
  ['Poblacion Dos', 'MELVIN R. CALANDRIA', 'Melvin', '(049) 531-0193'],
  ['Poblacion Tres', 'ANTONETTE M. HAIN', 'Nette', '(049) 531-0194'],
  ['Poblacion Uno', 'RAYMONTE D. BIENES', 'Monte', '(049) 531-0195'],
  ['Pulo', 'ARMANDO H. AMORANTO', 'Mando', '(049) 531-0196'],
  ['Sala', 'FRANCISCO D. ALIMAGNO', 'Kiko', '(049) 531-0197'],
  ['San Isidro', 'RICHARD L. ALGIRE', 'Richard', '(049) 531-0198'],
]
const BDRRMC = [
  'Rolando M. Sarmiento', 'Editha P. Lorenzo', 'Nestor V. Cabral', 'Girlie A. Manalo',
  'Ferdinand R. Espino', 'Mylene C. Bautista', 'Danilo T. Reyes', 'Josephine M. Cruz',
  'Alberto S. Panganiban', 'Rosalinda V. Diaz', 'Marlon B. Ilagan', 'Corazon L. Herrera',
  'Benjamin R. Trinidad', 'Analiza M. Soriano', 'Wilfredo D. Castro', 'Emelita G. Padilla',
  'Ronaldo P. Villanueva', 'Cristina M. Aquino',
]

function buildOfficials() {
  const rows = []
  CAPTAINS.forEach(([brgy, name, nick, phone], i) => {
    rows.push({
      barangay: brgy, full_name: name, nickname: nick,
      position: 'Punong Barangay', committee: 'Barangay Disaster Risk Reduction & Management Committee',
      sex: /(ELIZABETH|ROSE|CHARIE|ANTONETTE)/.test(name) ? 'F' : 'M',
      phone, email: `${brgy.toLowerCase().replace(/[^a-z]/g, '')}.captain@brgy.cabuyao.ph`,
      years_of_service: 3 + Math.floor(rnd() * 12),
      address: `Barangay Hall, Brgy. ${brgy}, City of Cabuyao, Laguna`,
    })
    rows.push({
      barangay: brgy, full_name: BDRRMC[i], nickname: BDRRMC[i].split(' ')[0],
      position: 'BDRRMC Focal Person', committee: 'Disaster Preparedness & Response',
      sex: i % 2 === 0 ? 'M' : 'F',
      phone: `09${17 + (i % 3)}-${String(200 + i).padStart(3, '0')}-${String(1100 + i * 7).slice(0, 4)}`,
      email: `${brgy.toLowerCase().replace(/[^a-z]/g, '')}.bdrrmc@brgy.cabuyao.ph`,
      years_of_service: 1 + Math.floor(rnd() * 8),
      address: `Barangay Hall, Brgy. ${brgy}, City of Cabuyao, Laguna`,
    })
  })
  return rows
}

/* ============================================================================
   8. RESIDENTS — a sample registry with the vulnerability flags the plan uses
   ========================================================================= */
const FIRST = ['Juan', 'Maria', 'Jose', 'Ana', 'Pedro', 'Rosa', 'Mario', 'Elena', 'Ramon', 'Luz',
  'Carlos', 'Teresa', 'Andres', 'Nena', 'Ricardo', 'Divina', 'Alfredo', 'Corazon', 'Nestor', 'Melba']
const LAST = ['Dela Cruz', 'Santos', 'Reyes', 'Bautista', 'Garcia', 'Mendoza', 'Villanueva', 'Ramos',
  'Aquino', 'Castillo', 'Flores', 'Rivera', 'Torres', 'Gonzales', 'Alcantara', 'Marasigan']

function buildResidents(evacByBarangay) {
  const rows = []
  for (const brgy of Object.keys(FLOOD_PROFILE)) {
    const n = FLOOD_PROFILE[brgy].peakFt >= 2.5 ? 8 : 4 // more registered where it floods
    for (let i = 0; i < n; i++) {
      const senior = rnd() < 0.22
      rows.push({
        full_name: `${pick(FIRST)} ${pick(LAST)}`,
        sex: rnd() < 0.5 ? 'M' : 'F',
        birthdate: new Date(Date.UTC(senior ? 1948 + Math.floor(rnd() * 14) : 1970 + Math.floor(rnd() * 35),
          Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27))).toISOString().slice(0, 10),
        barangay: brgy,
        purok: `Purok ${1 + Math.floor(rnd() * 7)}`,
        address: `${10 + Math.floor(rnd() * 300)} Purok ${1 + Math.floor(rnd() * 7)}, Brgy. ${brgy}, Cabuyao, Laguna`,
        phone: `09${String(100000000 + Math.floor(rnd() * 899999999)).slice(0, 9)}`,
        household_size: 2 + Math.floor(rnd() * 7),
        is_senior: senior,
        is_pwd: rnd() < 0.09,
        is_pregnant: rnd() < 0.06,
        assigned_evac_center: evacByBarangay[brgy] || null,
        registered_at: ago(between(1 * DAY, 200 * DAY)),
      })
    }
  }
  return rows
}

/* ============================================================================
   9. TRAFFIC CONGESTION — the manual paint board (app_settings.road_traffic)
   ========================================================================= */
function buildTraffic(roadRows) {
  const flagged = new Set(roadRows.map((r) => r.osm_way_id))
  const traffic = {}
  // Congestion builds on the arterials AROUND the closures — the detour load.
  const arterials = WAYS.filter(
    (w) => ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(w.cls) && !flagged.has(w.id),
  )
  for (const w of arterials) {
    const p = FLOOD_PROFILE[w.brgy]?.share ?? 0.05
    const r = rnd()
    if (r < p * 1.4) traffic[w.id] = 'gridlock'
    else if (r < p * 2.6) traffic[w.id] = 'heavy'
    else if (r < p * 4.0) traffic[w.id] = 'moderate'
    else if (r < p * 5.2) traffic[w.id] = 'light'
  }
  return traffic
}

/* ============================================================================
   RUN
   ========================================================================= */
const step = (msg) => console.log(`  ${msg}`)

async function main() {
  console.log('\nCDRRMO FloodRoute — seeding realistic operational data')
  console.log(`  target: ${BASE}`)
  console.log(`  scenario time: ${new Date(NOW).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} PHT\n`)

  /* ── Alerts ── */
  await probeAlertLevels()
  if (LEVELS_OK.emergency === false || LEVELS_OK.low === false) {
    console.log('  ⚠  This database still carries the OLD alerts_level_check constraint.')
    console.log('     It rejects the levels below, so the app silently drops any alert')
    console.log('     issued at them — including every EMERGENCY takeover alert:')
    console.log(`       ${Object.entries(LEVELS_OK).filter(([, v]) => v === false).map(([k]) => k).join(', ')}`)
    console.log('     Fix (Supabase → SQL Editor, once):')
    console.log('       supabase/migrations/20260821120000_alerts_emergency_level.sql')
    console.log('     Seeding those alerts one tier down for now.\n')
  }
  await del('alerts?id=gte.0')
  const alerts = await insert('alerts', buildAlerts())
  step(`alerts               ${alerts.length} rows  (${ALERTS.filter((a) => a[4] === 'active').length} active · ${ALERTS.filter((a) => a[4] === 'scheduled').length} scheduled · ${ALERTS.filter((a) => a[4] === 'resolved').length} resolved)`)

  /* ── Incidents + their timelines ── */
  await del('incident_updates?id=gte.0')
  await del('incidents?id=gte.0')
  const incidentSpecs = buildIncidents()
  const savedIncidents = await insert('incidents', incidentSpecs.map((i) => i.row))
  const updates = []
  savedIncidents.forEach((row, i) => {
    for (const u of incidentSpecs[i].timeline) updates.push({ incident_id: row.id, ...u })
  })
  await insert('incident_updates', updates)
  step(`incidents            ${savedIncidents.length} rows  (+ ${updates.length} timeline entries)`)

  /* ── Evacuation centres — UPDATE in place, never delete ── */
  const centres = await select('evacuation_centers?select=id,name,barangay,capacity')
  let touched = 0
  for (const c of centres) {
    const s = EVAC_STATE[c.name]
    if (!s) continue
    const [occupancy, status, facility_type, manager, contact] = s
    await patch(`evacuation_centers?id=eq.${c.id}`, {
      occupancy, status, facility_type, manager, contact,
      amenities: status === 'closed' ? null : ['Potable water', 'Comfort rooms', 'Kitchen', 'Generator set'],
    })
    touched++
  }
  const full = Object.values(EVAC_STATE).filter((s) => s[1] === 'full').length
  const closed = Object.values(EVAC_STATE).filter((s) => s[1] === 'closed').length
  step(`evacuation centres   ${touched} updated  (${full} FULL · ${touched - full - closed} open · ${closed} closed)`)

  /* ── Road status ── */
  await del('road_status?id=gte.0')
  const roadRows = buildRoadStatus()
  await insert('road_status', roadRows, 150)
  const blocked = roadRows.filter((r) => r.status === 'blocked').length
  step(`road status          ${roadRows.length} segments  (${blocked} CLOSED · ${roadRows.length - blocked} flooded)`)

  /* ── Flood reports + verification trail ── */
  await del('flood_report_logs?id=gte.0')
  await del('flood_reports?id=gte.0')
  const reportRows = FLOOD_REPORTS.map(([brgy, level, depthFt, description, reporter, status, notes, verifier, age]) => {
    const [lat, lng] = nearCentroid(brgy, 0.005)
    return {
      reporter_name: reporter, barangay: brgy, lat, lng,
      flood_level: level, water_depth_ft: depthFt, description,
      verification_status: status, official_notes: notes, verified_by: verifier,
      verified_at: status === 'pending' ? null : ago(age - 12 * MIN),
      reported_at: ago(age),
    }
  })
  const savedReports = await insert('flood_reports', reportRows)
  // Every row in a PostgREST batch must carry the SAME key set, so `from_status`
  // is spelled out as null on the submission entries rather than omitted.
  const logs = []
  savedReports.forEach((r, i) => {
    logs.push({
      report_id: r.id, action: 'submitted', from_status: null, to_status: 'pending',
      note: 'Report submitted from the resident portal.',
      actor: reportRows[i].reporter_name, created_at: reportRows[i].reported_at,
    })
    if (reportRows[i].verification_status !== 'pending') {
      logs.push({
        report_id: r.id, action: reportRows[i].verification_status,
        from_status: 'pending', to_status: reportRows[i].verification_status,
        note: reportRows[i].official_notes, actor: reportRows[i].verified_by,
        created_at: reportRows[i].verified_at,
      })
    }
  })
  await insert('flood_report_logs', logs)
  const approved = reportRows.filter((r) => r.verification_status === 'approved').length
  const pending = reportRows.filter((r) => r.verification_status === 'pending').length
  step(`flood reports        ${savedReports.length} rows  (${approved} approved · ${pending} pending · ${savedReports.length - approved - pending} rejected)`)

  /* ── Flood readings ── */
  await del('flood_readings?id=gte.0')
  const readings = buildReadings()
  await insert('flood_readings', readings, 250)
  step(`flood readings       ${readings.length} rows  (18 barangays × 24 h)`)

  /* ── Barangay officials ── */
  await del('barangay_officials?id=gte.0')
  const officials = buildOfficials()
  await insert('barangay_officials', officials)
  step(`barangay officials   ${officials.length} rows  (18 captains + 18 BDRRMC focals)`)

  /* ── Residents ── */
  // assigned_evac_center is the centre's integer id, not its name.
  const evacByBarangay = Object.fromEntries(centres.map((c) => [c.barangay, c.id]))
  // Real sign-ups from the Register page carry no purok; every seeded row does,
  // so that column is the marker that keeps genuine registrations safe.
  const kept = (await select('residents?select=id&purok=is.null')).length
  await del('residents?purok=not.is.null')
  const residents = buildResidents(evacByBarangay)
  await insert('residents', residents)
  step(`residents            ${residents.length} rows added (${kept} real registrations preserved)`)

  /* ── Traffic congestion paint ── */
  const traffic = buildTraffic(roadRows)
  await rest('app_settings', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key: 'road_traffic', value: traffic, updated_at: new Date().toISOString() }]),
  })
  step(`traffic congestion   ${Object.keys(traffic).length} arterial segments painted`)

  console.log('\n  Done. Reload the app — every portal reads these rows live.\n')
}

main().catch((e) => {
  console.error('\nSEED FAILED:', e.message, '\n')
  process.exit(1)
})
