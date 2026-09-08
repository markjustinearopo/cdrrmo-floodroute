/* ============================================================
   Route safety verdict — "is there a safe way out, or is there none?"

   THE PROBLEM THIS SOLVES
   routeEngine.js answers "what is the SAFEST path from A to B". That is not
   the same question as "is that path SAFE", and the difference is the whole
   of this file. A* returns the cheapest route it can find; when every route
   wades, the cheapest one still wades, and the resident screen presented it
   as the recommendation with a caution banner attached. The system was, in
   its own words, telling somebody to walk through water it had already
   flagged as impassable, because it had no vocabulary for refusing.

   It now has one. The verdict is decided by THREE searches, and the order
   matters because each one rules out a different reason for failure:

     1. STRICT   — every impassable road removed from the graph outright
                   (see impassableStatusMap below). A route found here is a
                   genuinely safe route: it is shown, and nothing else happens.

     2. LENIENT  — the engine's existing behaviour: hazards are expensive but
                   passable. Run ONLY when strict fails, and never shown to
                   anyone. Its job is evidence — it names the flooded and
                   closed roads the strict search had to refuse, which is what
                   the rescue request and the resident popup report.

     3. TOPOLOGY — no hazards at all: alpha 0, no status map, nothing avoided.
                   This is the control. If even THIS fails, the destination is
                   unreachable for a reason that has nothing to do with water
                   (an unmapped area, a pin dropped in the lake, a shelter with
                   no road to it), and raising a rescue would be wrong. The
                   screen falls back to the message it always showed.

   A rescue request is raised only when 1 fails AND 3 succeeds — that is the
   precise statement of "every possible route is blocked or unsafe", and it is
   why one closed road can never trigger it: A* will have found its way around
   a single closure in step 1, and around ten of them, and it only gives up
   when the water genuinely encircles the person.

   Pure functions, no React. Used by the resident routing screen; safe for the
   admin/barangay screens to adopt unchanged.
   ============================================================ */

import { planToNearestSafe, DEFAULT_ALPHA } from './routeEngine.js'
import { estDepthFromRisk } from './floodRisk.js'

/* ── What "impassable" means, in metres of standing water ──────────────────
   0.6 m is the top of the knee-deep band in services/depth.js — the line
   where an adult on foot stops wading and starts being carried by the
   current, and well past where a child is already in danger. Below it the
   engine's existing soft penalty is the right behaviour (expensive, still
   walkable, warned about on screen); at or above it there is no honest way to
   call a road a route.

   Deliberately a SEPARATE constant from DEPTH_THRESHOLDS.high (0.5 m), which
   grades the colour of a badge. This one decides whether the system tells a
   person to stay put, and it should not move because somebody retuned a
   legend. */
export const IMPASSABLE_DEPTH_M = 0.6

/* Operator flags that mean "do not route anyone along this". `blocked` was
   already impassable to the engine; `flooded` is an official standing on the
   road telling the city it is under water, which the engine treated as merely
   expensive. For the safety verdict both are refusals. */
const UNSAFE_STATUS = new Set(['blocked', 'flooded'])

/**
 * The status map for the STRICT search: every road the system will not send a
 * person down, keyed by OSM way id, valued 'blocked' so the existing
 * `edgeRisk` returns Infinity and A* removes the edge from the graph entirely.
 *
 * Three sources, all of them already in the system:
 *   • the operator's own flags        (statusMap: 'blocked' | 'flooded')
 *   • the live flood model            (estDepthFromRisk ≥ IMPASSABLE_DEPTH_M)
 *   • nothing else — no new feed, no new judgement call
 *
 * The model term is the reason a road nobody has visited yet can still be
 * refused, which matters at 2 a.m. when there is no official on that street
 * to flag it. It is sampled at each road's midpoint, exactly as
 * floodRisk.projectedRoadStatus does, so the two agree about which roads the
 * model says are under water.
 */
export function impassableStatusMap({ roads, riskAt, statusMap = {}, thresholdM = IMPASSABLE_DEPTH_M }) {
  const out = {}

  // 1. The live model. Skipped entirely when there is no field — an offline
  //    weather feed must not silently start closing roads, nor silently stop:
  //    with no riskAt the verdict falls back to the operator's flags alone,
  //    which is the honest degraded answer.
  if (riskAt && roads?.features) {
    for (const f of roads.features) {
      const coords = f.geometry?.coordinates
      if (!Array.isArray(coords) || coords.length === 0) continue
      const [lng, lat] = coords[Math.floor(coords.length / 2)] || []
      if (lat == null || lng == null) continue
      if (estDepthFromRisk(riskAt(lat, lng)) >= thresholdM) out[f.properties.id] = 'blocked'
    }
  }

  // 2. The operator's flags, applied last so a human's judgement always wins
  //    over the model — including the case where an official has REOPENED a
  //    road the model still thinks is wet.
  for (const [wayId, status] of Object.entries(statusMap)) {
    if (UNSAFE_STATUS.has(status)) out[wayId] = 'blocked'
    else delete out[wayId]
  }

  return out
}

/**
 * Why a particular route is not safe: the named roads on it that are under
 * water or closed, plus how deep the worst of it is. Read off the LENIENT
 * plan — the one the system refuses to recommend — so the request CDRRMO
 * receives names the actual obstacles rather than saying "somewhere".
 */
export function hazardEvidence(plan, { statusMap = {}, riskAt } = {}) {
  const roads = new Map() // name (or way id) → { name, wayId, status, depthM }
  const segments = plan?.safe?.segments || []
  /* segments[i] describes the leg coords[i] → coords[i+1] (see routeEngine's
     decorate), so the leg's own midpoint is where to sample the model — no
     graph scan, and it is the same point the search itself weighted. */
  const coords = plan?.safe?.coords || []
  let maxDepthM = 0

  segments.forEach((seg, i) => {
    const a = coords[i]
    const b = coords[i + 1]
    const risk = riskAt && a && b ? riskAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) : 0
    const modeled = estDepthFromRisk(risk)
    if (modeled > maxDepthM) maxDepthM = modeled

    const status = statusMap[seg.wayId]
    if (!UNSAFE_STATUS.has(status) && modeled < IMPASSABLE_DEPTH_M) return

    const key = seg.name || `way-${seg.wayId}`
    const prev = roads.get(key)
    roads.set(key, {
      name: seg.name || 'Unnamed road',
      wayId: seg.wayId,
      // An operator's flag is the more authoritative statement, so it is what
      // the row reports; the model only fills in where nobody has been.
      status: status === 'blocked' ? 'closed' : status === 'flooded' ? 'flooded' : 'flooded (modeled)',
      depthM: Math.max(prev?.depthM ?? 0, modeled),
    })
  })

  return {
    roads: [...roads.values()],
    maxDepthM,
    meanRisk: plan?.safe?.meanRisk ?? null,
  }
}

/**
 * THE HEADLINE CALL. Plan a route the system is willing to stand behind.
 *
 * @param graph       the routable network (useRouteGraph)
 * @param origin      [lat, lng] the resident is standing at
 * @param candidates  destinations to try, each { ...meta, coords: [lat,lng] }
 * @param opts        everything planRoute takes (riskAt, statusMap, alpha,
 *                    profileFor(...)), plus `roads` (the GeoJSON network) so
 *                    the model term of the strict map can be built.
 *
 * @returns one of
 *   { verdict: 'safe',          centre, plan, strict: true }
 *   { verdict: 'no-safe-route', evidence, attempted, unsafePlan }
 *   { verdict: 'unreachable',   reason }   ← not a flood problem; no rescue
 */
export function findSafeRoute(graph, origin, candidates, opts = {}) {
  const list = (candidates || []).filter((c) => Array.isArray(c.coords))
  if (!graph || graph.size === 0) return { verdict: 'unreachable', reason: 'no-network' }
  if (!origin) return { verdict: 'unreachable', reason: 'no-origin' }
  if (list.length === 0) return { verdict: 'unreachable', reason: 'no-destination' }

  const { roads, ...planOpts } = opts
  const alpha = planOpts.alpha ?? DEFAULT_ALPHA

  /* ── 1. STRICT ── */
  const strictStatus = impassableStatusMap({
    roads,
    riskAt: planOpts.riskAt,
    statusMap: planOpts.statusMap || {},
  })
  const safe = planToNearestSafe(graph, origin, list, { ...planOpts, statusMap: strictStatus, alpha })
  if (safe) return { verdict: 'safe', centre: safe.centre, plan: safe.plan, strict: true }

  /* ── 3. TOPOLOGY (run before 2: it decides whether 2's answer means
         anything at all) ──
     No status map, no risk weighting. The only question is whether roads
     physically connect the resident to any candidate. `compare: false` keeps
     it to one A* per candidate — this is a reachability test, and nobody is
     going to read a detour figure from it. */
  const reachable = planToNearestSafe(graph, origin, list, {
    ...planOpts,
    statusMap: {},
    /* Selective closures are cleared here too. This search asks ONLY whether
       roads physically connect the resident to a shelter; leaving a partial
       closure in would let a 200 m closure answer "unreachable", and a rescue
       would not be raised for somebody the water really has cut off. */
    blockedEdges: undefined,
    floodedEdges: undefined,
    riskAt: undefined,
    alpha: 0,
    beta: 0,
    compare: false,
  })
  if (!reachable) return { verdict: 'unreachable', reason: 'no-path' }

  /* ── 2. LENIENT — evidence only, never displayed as a route ── */
  const unsafe = planToNearestSafe(graph, origin, list, planOpts)
  const evidencePlan = unsafe?.plan || reachable.plan
  const evidence = hazardEvidence(evidencePlan, {
    statusMap: planOpts.statusMap || {},
    riskAt: planOpts.riskAt,
  })

  return {
    verdict: 'no-safe-route',
    evidence,
    // What the system tried to reach, so the request CDRRMO reads shows the
    // search was exhaustive rather than asserting it.
    attempted: list.map((c) => c.name || c.barangay || `#${c.id}`),
    unsafePlan: evidencePlan,
    nearest: (unsafe || reachable).centre,
  }
}

/**
 * The same verdict for a route to ONE known destination — the "Start guided
 * navigation" path, where the resident has already chosen where they are
 * going. Same three searches, same rules.
 */
export function checkRouteSafety(graph, origin, destination, opts = {}) {
  return findSafeRoute(graph, origin, [{ id: 'dest', name: destination?.name, coords: destination?.coords || destination }], opts)
}

/**
 * One line a person can act on, assembled from the evidence. Used as the
 * rescue request's summary and as the resident popup's hazard sentence, so
 * the responder and the resident are reading the same words about the same
 * event.
 */
export function describeBlockage(evidence) {
  const roads = evidence?.roads || []
  if (roads.length === 0) {
    return 'Flooding on every available route out of this location.'
  }
  const named = roads.filter((r) => r.name && r.name !== 'Unnamed road')
  const head = named.slice(0, 3).map((r) => r.name)
  const rest = roads.length - head.length
  const where = head.length
    ? `${head.join(', ')}${rest > 0 ? ` and ${rest} more road${rest > 1 ? 's' : ''}` : ''}`
    : `${roads.length} road${roads.length > 1 ? 's' : ''} around this location`
  return `${where} ${roads.length === 1 ? 'is' : 'are'} flooded or closed — every route out passes through them.`
}

/* Small helper shared by the resident popup and the admin request card: the
   plain-language flood level of a blockage, in the vocabulary already used by
   the rest of the product. */
export function blockageLevel(evidence) {
  const d = evidence?.maxDepthM ?? 0
  if (d >= 1.0) return 'severe'
  if (d >= IMPASSABLE_DEPTH_M) return 'impassable'
  return 'blocked'
}
