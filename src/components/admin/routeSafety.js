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

   A rescue request is raised only when 1 fails AND 3 succeeds. This describes
   the assessed road network and candidate shelters, not proof that a person
   is physically surrounded or that an unflagged path is safe in the field.

   Pure functions, no React. Used by the resident routing screen; safe for the
   admin/barangay screens to adopt unchanged.
   ============================================================ */

import { planToNearestSafe, DEFAULT_ALPHA } from './routeEngine.js'
import { estDepthFromRisk } from '../../services/modeledDepth.js'

// Existing modeled exclusion threshold; not proof that lesser depths are safe.
// Operational validation is required before changing this policy.
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
 * Whole-road operator flags only. Partial closures and modeled exclusions
 * are applied separately at actual graph segments by strictBlockedEdges.
 */
export function impassableStatusMap({ statusMap = {} }) {
  const out = {}
  for (const [wayId, status] of Object.entries(statusMap)) {
    if (UNSAFE_STATUS.has(status)) out[wayId] = 'blocked'
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
    if (!UNSAFE_STATUS.has(status) && !seg.flooded && modeled < IMPASSABLE_DEPTH_M) return

    const key = seg.name || `way-${seg.wayId}`
    const prev = roads.get(key)
    roads.set(key, {
      name: seg.name || 'Unnamed road',
      wayId: seg.wayId,
      // An operator's flag is the more authoritative statement, so it is what
      // the row reports; the model only fills in where nobody has been.
      status: status === 'blocked' ? 'closed' : status === 'flooded' || seg.flooded ? 'flooded' : 'flooded (modeled)',
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

  if (opts.dataReady === false) return { verdict: 'unavailable', reason: 'stale-safety-data' }
  const { roads, ...planOpts } = opts
  const alpha = planOpts.alpha ?? DEFAULT_ALPHA

  /* ── 1. STRICT ── */
  const strictStatus = impassableStatusMap({
    statusMap: planOpts.statusMap || {},
  })
  const blockedEdges = strictBlockedEdges(graph, planOpts)
  const safe = planToNearestSafe(graph, origin, list, { ...planOpts, blockedEdges, statusMap: strictStatus, alpha })
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

/** Apply the same exclusions to planning and live rerouting, segment by segment. */
export function strictBlockedEdges(graph, { blockedEdges, floodedEdges, riskAt, statusMap = {} } = {}) {
  const blocked = new Set([...(blockedEdges || []), ...(floodedEdges || [])])
  if (!riskAt) return blocked
  for (const edges of graph?.adj || []) {
    for (const edge of edges) {
      // Explicit operator assessments override modeled conditions, not closures.
      if (Object.prototype.hasOwnProperty.call(statusMap, edge.wayId)) continue
      if (estDepthFromRisk(riskAt(edge.mlat, edge.mlng)) >= IMPASSABLE_DEPTH_M) blocked.add(edge)
    }
  }
  return blocked
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
    return 'No route to the available destinations meets the current road and flood restrictions.'
  }
  const named = roads.filter((r) => r.name && r.name !== 'Unnamed road')
  const head = named.slice(0, 3).map((r) => r.name)
  const rest = roads.length - head.length
  const where = head.length
    ? `${head.join(', ')}${rest > 0 ? ` and ${rest} more road${rest > 1 ? 's' : ''}` : ''}`
    : `${roads.length} road${roads.length > 1 ? 's' : ''} around this location`
  return `${where} ${roads.length === 1 ? 'is' : 'are'} flooded or closed on the assessed routes.`
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
