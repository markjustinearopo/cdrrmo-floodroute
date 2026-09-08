/* ============================================================
   Flood-aware route engine.

   Turns the complete Cabuyao road network (every street in the city,
   OpenStreetMap data bundled via routingHelpers) into a routable graph
   and finds the safest practical path across it, weighting every road
   segment by the flood-risk field (floodRisk.js) and the admin's
   manually-flagged road conditions.

   This is the automatic, flood-aware route suggestion the rest of the
   admin previously left as a "coming soon" control. Three real feeds
   meet here:
     • OpenStreetMap        → the graph (nodes & edges)
     • Open-Meteo Flood API → per-segment inundation risk  (floodRisk)
     • Open-Meteo Forecast  → rainfall/wind driving that risk (floodRisk)

   Pure functions, no React (a thin memo hook lives at the bottom). The
   search is a binary-heap A* with a straight-line-distance heuristic,
   which is admissible and consistent for the distance-scaled cost below,
   so the first path it settles is optimal.
   ============================================================ */

import { useMemo } from 'react'
import { haversineMeters } from './geo.js'

/* How hard to steer away from flood risk. The cost of a segment is its
   length multiplied by (1 + ALPHA · risk), with risk in [0, 1]; a fully
   flooded segment therefore costs (1 + ALPHA)× its length, so the search
   will happily take a detour up to that factor longer to stay dry. */
export const DEFAULT_ALPHA = 8

/* ── Traffic congestion model — the second hazard, orthogonal to flooding ──
   A road can be both flooded AND congested; the two are kept in separate maps
   and both feed the same cost. Each level carries two numbers:

     • penalty ∈ [0, 1] — added to the cost multiplier exactly like flood risk,
       so the search detours around congestion (scaled by DEFAULT_BETA below).
     • factor  ∈ (0, 1] — the fraction of free-flow speed the road still moves
       at, so the ETA is honest about time lost crawling through a jam.

   "Clear" is simply the ABSENCE of an entry — no penalty, full speed — exactly
   how an un-flagged road has no flood condition. This is the property that
   makes the whole feature additive: with an empty trafficMap every route is
   identical to the flood-only engine. */
export const TRAFFIC_LEVELS = {
  light:    { penalty: 0.15, factor: 0.85 },
  moderate: { penalty: 0.40, factor: 0.65 },
  heavy:    { penalty: 0.75, factor: 0.40 },
  gridlock: { penalty: 1.00, factor: 0.15 },
}
const CLEAR_TRAFFIC = { penalty: 0, factor: 1 }
// Severity order, worst last — used to surface the worst jam along a route.
const TRAFFIC_RANK = { light: 1, moderate: 2, heavy: 3, gridlock: 4 }

/* How hard to steer away from congestion, relative to plain distance. Flood
   risk (DEFAULT_ALPHA = 8) deliberately outranks it: getting out of the water
   comes before time lost to traffic, so a gridlocked-but-dry road (cost ×5)
   still beats a flooded one (cost ×9). */
export const DEFAULT_BETA = 4

/**
 * Routing options implied by a route's type. One place, because the same
 * decision was being re-made at nine call sites and the second half of it
 * (one-way) would otherwise have been forgotten at some of them.
 *
 *   evacuation      residents leaving on foot
 *   relief/response a vehicle — supply truck, responder
 *
 * Two things follow from being on foot, and they pull in opposite directions
 * from what you might expect:
 *
 *   beta = 0    a walker does not sit in traffic, so congestion must not
 *               push them onto a longer route.
 *   onFoot      one-way restrictions do NOT apply — a pedestrian may walk
 *               either way along a one-way street, and enforcing the sign
 *               would add distance in rising water for no legal reason.
 *               See the ONE-WAY STREETS block below.
 *
 * Callers can still override either explicitly; this is the default, not a
 * ceiling.
 */
export function profileFor(routeType) {
  const onFoot = routeType === 'evacuation'
  return { onFoot, beta: onFoot ? 0 : DEFAULT_BETA }
}

// Coordinates are merged into shared graph nodes at ~0.1 m precision.
// Overpass returns the endpoints of connecting ways with identical
// coordinates (they are the same OSM node), so rounding here stitches the
// separate way geometries into one connected network at intersections.
const COORD_PRECISION = 6

/* Realistic urban driving speed (km/h) per OSM highway class — drives the
   per-route ETA, so a route that threads barangay alleys is honest about
   being slower than one that stays on the national highway. */
const CLASS_KMH = {
  motorway: 80, motorway_link: 40,
  trunk: 60, trunk_link: 40,
  primary: 45, primary_link: 35,
  secondary: 40, secondary_link: 30,
  tertiary: 35, tertiary_link: 30,
  unclassified: 30,
  residential: 25,
  living_street: 15,
  service: 15,
  track: 12,
  road: 25,
  // Walk-only connectors bridging gated estates to the network — crawl pace
  // so the router only threads them when there is no drivable alternative.
  footway: 5,
  path: 5,
  pedestrian: 8,
  steps: 3,
  cycleway: 10,
  bridleway: 8,
}
const DEFAULT_KMH = 25

/* ── Binary min-heap keyed by priority (f-score) ─────────────────────────── */
class MinHeap {
  constructor() {
    this.ids = []
    this.pri = []
  }
  get size() {
    return this.ids.length
  }
  push(id, priority) {
    this.ids.push(id)
    this.pri.push(priority)
    let i = this.ids.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.pri[p] <= this.pri[i]) break
      this._swap(i, p)
      i = p
    }
  }
  pop() {
    const n = this.ids.length
    if (n === 0) return -1
    const top = this.ids[0]
    const lastId = this.ids.pop()
    const lastPri = this.pri.pop()
    if (n > 1) {
      this.ids[0] = lastId
      this.pri[0] = lastPri
      let i = 0
      const len = this.ids.length
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let smallest = i
        if (l < len && this.pri[l] < this.pri[smallest]) smallest = l
        if (r < len && this.pri[r] < this.pri[smallest]) smallest = r
        if (smallest === i) break
        this._swap(i, smallest)
        i = smallest
      }
    }
    return top
  }
  _swap(a, b) {
    ;[this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]]
    ;[this.pri[a], this.pri[b]] = [this.pri[b], this.pri[a]]
  }
}

/* ── Graph construction ──────────────────────────────────────────────────── */
const keyOf = (lat, lng) => `${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}`

/**
 * Build a routable graph from a road FeatureCollection (OSM LineStrings).
 *
 * Returns flat, index-aligned arrays for cache-friendly traversal:
 *   lat[i], lng[i]      → coordinates of node i
 *   adj[i]              → array of edges { to, d, wayId, mlat, mlng, kmh, fwd }
 *   comp[i] / mainComp  → connected-component label per node + the label of
 *                         the city-wide network (largest component)
 *   wayInfo             → Map(wayId → { name, named, highway, oneway,
 *                         onewayFoot }) for readouts and the one-way rule
 *
 * Both directions of every segment are present in `adj`, including on one-way
 * streets; `fwd` says which traversal follows the stored geometry. Whether a
 * traversal is ALLOWED is decided per profile in edgeAllowed() — see the
 * ONE-WAY STREETS block below for why the edge is not simply omitted.
 */
export function buildGraph(roads) {
  const idByKey = new Map()
  const lat = []
  const lng = []
  const adj = []
  const wayInfo = new Map()

  function nodeAt(la, lo) {
    const k = keyOf(la, lo)
    let id = idByKey.get(k)
    if (id === undefined) {
      id = lat.length
      idByKey.set(k, id)
      lat.push(la)
      lng.push(lo)
      adj.push([])
    }
    return id
  }

  for (const f of roads.features || []) {
    const coords = f.geometry?.coordinates // [lng, lat] pairs
    if (!Array.isArray(coords) || coords.length < 2) continue
    const wayId = f.properties?.id
    const kmh = CLASS_KMH[f.properties?.highway] || DEFAULT_KMH
    const oneway = f.properties?.oneway || 0
    wayInfo.set(wayId, {
      name: f.properties?.name,
      named: Boolean(f.properties?.named),
      highway: f.properties?.highway,
      oneway,
      onewayFoot: Boolean(f.properties?.onewayFoot),
    })
    let prev = nodeAt(coords[0][1], coords[0][0])
    for (let i = 1; i < coords.length; i++) {
      const cur = nodeAt(coords[i][1], coords[i][0])
      if (cur === prev) continue
      const d = haversineMeters([lat[prev], lng[prev]], [lat[cur], lng[cur]])
      const mlat = (lat[prev] + lat[cur]) / 2
      const mlng = (lng[prev] + lng[cur]) / 2
      /* BOTH directions are always added to the graph, even on a one-way
         street. Legality is decided per traversal in edgeAllowed(), not by
         leaving the edge out, for two reasons:

           1. a pedestrian may walk either way along a one-way street, and
              this same graph serves both profiles;
           2. the component labelling below, and nearestNode's snapping, ask
              "is this road physically connected?" — which does not change
              because traffic runs one way along it. Dropping the edge would
              strand every address on a one-way street in its own island.

         `fwd` records whether this traversal runs along the geometry as
         stored, which is the direction OSM's oneway tag is relative to. */
      adj[prev].push({ to: cur, d, wayId, mlat, mlng, kmh, fwd: true })
      adj[cur].push({ to: prev, d, wayId, mlat, mlng, kmh, fwd: false })
      prev = cur
    }
  }

  /* Label connected components (iterative BFS). A full city network always
     contains islands — gated compounds, disconnected service loops — and a
     click that snaps onto one would otherwise strand the search. Snapping is
     restricted to the LARGEST component, the real city-wide road network. */
  const size = lat.length
  const comp = new Int32Array(size).fill(-1)
  let mainComp = -1
  let mainSize = 0
  let nComps = 0
  const queue = new Int32Array(size)
  for (let seed = 0; seed < size; seed++) {
    if (comp[seed] !== -1) continue
    const label = nComps++
    let head = 0
    let tail = 0
    queue[tail++] = seed
    comp[seed] = label
    let count = 0
    while (head < tail) {
      const cur = queue[head++]
      count++
      const edges = adj[cur]
      for (let e = 0; e < edges.length; e++) {
        const to = edges[e].to
        if (comp[to] === -1) {
          comp[to] = label
          queue[tail++] = to
        }
      }
    }
    if (count > mainSize) {
      mainSize = count
      mainComp = label
    }
  }

  return { lat, lng, adj, size, comp, mainComp, wayInfo }
}

/* ── Nearest-node snapping ───────────────────────────────────────────────── */
// Nearest graph node to a free coordinate (where the admin clicked / an
// evacuation centre sits). Planar squared distance is enough at city scale.
// By default only nodes on the main (city-wide) component are considered, so
// a click beside a gated compound's private loop still routes.
export function nearestNode(graph, [lat, lng], { anyComponent = false } = {}) {
  let best = -1
  let bestD = Infinity
  const { lat: las, lng: lns, size, comp, mainComp } = graph
  const restrict = !anyComponent && comp && mainComp >= 0
  // Latitude correction so the longitude axis isn't over-weighted.
  const kx = Math.cos((lat * Math.PI) / 180)
  for (let i = 0; i < size; i++) {
    if (restrict && comp[i] !== mainComp) continue
    const dLat = las[i] - lat
    const dLng = (lns[i] - lng) * kx
    const d = dLat * dLat + dLng * dLng
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/* ── A* search ───────────────────────────────────────────────────────────── */
/**
 * Generic A* over the graph. `edgeCost(edge)` returns the traversal cost of
 * an edge (Infinity ⇒ impassable, skipped). The heuristic is straight-line
 * geographic distance to the goal — admissible because every cost is ≥ the
 * segment's true length.
 *
 * Returns { nodes: [id…], distanceM, exposure } or null when no path exists.
 *   distanceM → true metric length of the path (metres)
 *   exposure  → Σ segmentLength · risk  ("risk-metres", smaller is safer)
 */
function aStar(graph, start, goal, edgeCost, riskOf) {
  const { lat, lng, adj, size } = graph
  if (start < 0 || goal < 0 || start >= size || goal >= size) return null

  const g = new Float64Array(size).fill(Infinity)
  const came = new Int32Array(size).fill(-1)
  const closed = new Uint8Array(size)

  const goalLat = lat[goal]
  const goalLng = lng[goal]
  const h = (id) => haversineMeters([lat[id], lng[id]], [goalLat, goalLng])

  g[start] = 0
  const open = new MinHeap()
  open.push(start, h(start))

  while (open.size) {
    const cur = open.pop()
    if (cur === goal) break
    if (closed[cur]) continue
    closed[cur] = 1
    const edges = adj[cur]
    for (let e = 0; e < edges.length; e++) {
      const edge = edges[e]
      if (closed[edge.to]) continue
      const c = edgeCost(edge)
      if (!isFinite(c)) continue // blocked / impassable
      const ng = g[cur] + c
      if (ng < g[edge.to]) {
        g[edge.to] = ng
        came[edge.to] = cur
        open.push(edge.to, ng + h(edge.to))
      }
    }
  }

  if (!isFinite(g[goal])) return null

  // Walk the predecessor chain back from the goal, summing true distance
  // and flood exposure along the way.
  const nodes = []
  let distanceM = 0
  let exposure = 0
  for (let v = goal; v !== -1; v = came[v]) {
    nodes.push(v)
    const p = came[v]
    if (p !== -1) {
      const edge = findEdge(adj[p], v)
      if (edge) {
        distanceM += edge.d
        exposure += edge.d * (riskOf ? riskOf(edge) : 0)
      }
    }
  }
  nodes.reverse()
  return { nodes, distanceM, exposure }
}

/**
 * The edge from a node to `to`.
 *
 * Two distinct ways can join the same pair of nodes — the short links between
 * the carriageways of a dual carriageway do exactly this. Returning whichever
 * happened to be pushed first was harmless when every edge was two-way; now it
 * decides whether a leg is reported as running the wrong way up a one-way
 * street, so the caller passes `prefer` to pick the traversal the search would
 * actually have used. Falls back to the first match, because a mislabelled
 * direction is still better than losing the segment entirely.
 */
function findEdge(edges, to, prefer) {
  let first = null
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    if (e.to !== to) continue
    if (!prefer) return e
    if (prefer(e)) return e
    if (!first) first = e
  }
  return first
}

/* ── Risk + cost model ───────────────────────────────────────────────────── */
/**
 * Per-edge flood risk in [0, 1], fusing the live field with the admin's
 * manual road conditions. Manual flags are authoritative: a "blocked" road
 * is impassable, a "flooded" road is treated as near-certain risk regardless
 * of what the model says.
 */
export function edgeRisk(edge, { riskAt, statusMap, blockedEdges, floodedEdges }) {
  const status = statusMap?.[edge.wayId]
  if (status === 'blocked') return Infinity
  /* PARTIAL CLOSURES. `statusMap` is keyed by WAY, so it can only ever say
     "all of this road" — which closed kilometres of highway because of one
     flooded underpass. A selective closure is finer than a way, so it arrives
     as a Set of the actual edge objects from this graph's adjacency (see
     roadBlocks.buildBlockIndex, and its header for why identity and not a
     key). An edge inside a closed section is impassable; every other edge of
     the same road is untouched and still routes, which is the entire point.

     Both Sets are checked by SIZE first: with no partial closures this adds
     one integer comparison per edge to the search's inner loop, nothing more. */
  if (blockedEdges?.size && blockedEdges.has(edge)) return Infinity
  let risk = riskAt ? riskAt(edge.mlat, edge.mlng) : 0
  if (status === 'flooded') risk = Math.max(risk, 0.9)
  if (floodedEdges?.size && floodedEdges.has(edge)) risk = Math.max(risk, 0.9)
  return risk
}

/**
 * Per-edge congestion, read from the manual traffic map ({ wayId: level }).
 * Returns the level's { penalty, factor }; an un-flagged road is CLEAR
 * (no penalty, full speed). Pure lookup — no live feed yet (that is Phase 3).
 */
export function edgeTraffic(edge, { trafficMap } = {}) {
  const level = trafficMap?.[edge.wayId]
  return TRAFFIC_LEVELS[level] || CLEAR_TRAFFIC
}

/* ── ONE-WAY STREETS ──────────────────────────────────────────────────────
 *
 * 290 of the 4,853 ways in Cabuyao are one-way (6%), including both SLEX
 * carriageways, every SLEX ramp, stretches of the National Highway, and 21
 * roundabouts where OSM marks the direction with `junction=roundabout` and no
 * oneway tag at all.
 *
 * A ONE-WAY STREET IS ONE-WAY FOR VEHICLES.
 * This is the single most important thing in this file to get right, and the
 * naive reading gets it backwards. A person on foot may walk in either
 * direction along a one-way street — that is true in the Philippines and
 * essentially everywhere, and it is not a technicality:
 *
 *   The evacuation profile is someone WALKING out of a flood. Making them
 *   respect a one-way sign could add hundreds of metres to a route, in rising
 *   water, to obey a rule that does not apply to them. That is not a routing
 *   inaccuracy; it is a longer time in the water.
 *
 * So the constraint binds vehicles (relief and response) and not pedestrians,
 * unless OSM explicitly tags `oneway:foot=yes` (`onewayFoot`), which no way in
 * Cabuyao currently does.
 *
 * A walker still gets TOLD. The direction is carried through to the
 * turn-by-turn segments either way, so the navigator can warn that traffic on
 * this street is coming towards them — which is real safety information for
 * somebody walking against traffic in bad visibility, and is not the same
 * thing as refusing to route them.
 */

/**
 * May this edge be traversed in this direction?
 *
 * @param edge   an adjacency entry; `fwd` says whether it follows the stored geometry
 * @param info   wayInfo for the edge's way ({ oneway, onewayFoot })
 * @param onFoot true for pedestrian profiles (evacuation)
 */
export function edgeAllowed(edge, info, onFoot) {
  const dir = info?.oneway || 0
  if (!dir) return true
  if (onFoot && !info.onewayFoot) return true
  return edge.fwd ? dir === 1 : dir === -1
}

function makeCost(opts, alpha, beta) {
  const { wayInfo, onFoot, ignoreOneway } = opts
  return (edge) => {
    if (!ignoreOneway && !edgeAllowed(edge, wayInfo?.get(edge.wayId), onFoot)) return Infinity
    const risk = edgeRisk(edge, opts)
    if (!isFinite(risk)) return Infinity // blocked road — impassable
    const traffic = edgeTraffic(edge, opts)
    // Cost stays ≥ the segment's true length (every term is ≥ 0), so the
    // straight-line heuristic remains admissible and A* still finds the optimum.
    return edge.d * (1 + alpha * risk + beta * traffic.penalty)
  }
}

/* ── Path → friendly result ──────────────────────────────────────────────── */
function decorate(graph, result, opts) {
  const { lat, lng, adj, wayInfo } = graph
  const coords = result.nodes.map((id) => [lat[id], lng[id]])
  /* Per-segment metadata for the turn-by-turn navigator: segments[i] describes
     the leg coords[i] → coords[i+1]. The via-list below collapses the path into
     named runs, which is right for a summary panel and useless for spoken
     directions — those need to know which road every metre of the line sits on,
     and how many ways meet at the node where the name changes (a rename at a
     two-way node is the same road continuing, not a turn). */
  const segments = []

  // Walk the path start→goal, counting manually-flagged segments, summing a
  // class-aware drive time, and collecting the ordered list of named roads it
  // follows (the "via" turn sheet shown on the Auto Route panel).
  let floodedSegments = 0
  const flooded = new Set()
  let driveMins = 0 // congestion-aware ETA
  let freeFlowMins = 0 // ETA if every road moved at free-flow speed
  let congestedSegments = 0
  const congested = new Set()
  let worstTraffic = null // worst level encountered along the path
  let worstTrafficM = 0 // metres spent at that worst level
  let worstTrafficRoad = null // name of the worst-congested road
  let onewayM = 0 // metres spent on one-way streets (either direction)
  const onewayWays = new Set()
  let wrongWayM = 0 // metres spent AGAINST a one-way
  const wrongWay_ = new Set()
  const wrongWayNames = new Set()
  const via = []
  /* Prefer the traversal the search itself would have taken, so a link
     between the two halves of a dual carriageway is reported as the leg
     actually driven rather than its opposite twin. */
  const legal = (e) => opts.ignoreOneway || edgeAllowed(e, wayInfo?.get(e.wayId), opts.onFoot)
  for (let i = 1; i < result.nodes.length; i++) {
    const edge = findEdge(adj[result.nodes[i - 1]], result.nodes[i], legal)
    if (!edge) continue
    const st = opts.statusMap?.[edge.wayId]
    /* A selective closure flagged 'flooded' makes this SEGMENT wet without the
       rest of its road being wet, so the count has to see it too — otherwise a
       route wading through a partially flooded stretch reports zero flooded
       segments and the warning banner stays silent. (A 'blocked' section never
       reaches here: the search cannot traverse it.) */
    const partialWet = opts.floodedEdges?.size ? opts.floodedEdges.has(edge) : false
    if (st === 'flooded' || st === 'blocked' || partialWet) {
      floodedSegments++
      flooded.add(edge.wayId)
    }
    const info = wayInfo?.get(edge.wayId)
    const oneway = info?.oneway || 0
    /* Against the flow? For a pedestrian this is legal and worth SAYING —
       traffic is coming towards you. For a vehicle it only happens when
       planRoute had to relax the rule to find any route at all, and then it
       is the single most important thing on the screen. */
    const wrongWay = Boolean(oneway) && (edge.fwd ? oneway !== 1 : oneway !== -1)
    if (wrongWay) {
      wrongWayM += edge.d
      wrongWay_.add(edge.wayId)
      if (info?.named && info.name) wrongWayNames.add(info.name)
    }
    segments.push({
      wayId: edge.wayId,
      name: info?.named ? info.name : null,
      highway: info?.highway,
      d: edge.d,
      kmh: edge.kmh,
      // Degree of the node this segment STARTS at — 3+ means a real junction.
      degree: adj[result.nodes[i - 1]]?.length ?? 2,
      flooded: st === 'flooded' || st === 'blocked' || partialWet,
      /* Carried for the turn-by-turn navigator and the voice guidance:
         oneway   0 | +1 | -1 relative to the stored geometry
         wrongWay this leg runs against that direction */
      oneway,
      wrongWay,
    })
    if (oneway) {
      onewayM += edge.d
      onewayWays.add(edge.wayId)
    }
    // Free-flow minutes for this segment, then stretched by the traffic factor
    // so the headline ETA reflects the jam, not the empty-road ideal.
    const ffMins = (edge.d / 1000 / (edge.kmh || 25)) * 60
    const traffic = edgeTraffic(edge, opts)
    freeFlowMins += ffMins
    driveMins += ffMins / traffic.factor
    const level = opts.trafficMap?.[edge.wayId]
    if (level) {
      congestedSegments++
      congested.add(edge.wayId)
      if (!worstTraffic || TRAFFIC_RANK[level] > TRAFFIC_RANK[worstTraffic]) {
        worstTraffic = level
        worstTrafficM = edge.d
        worstTrafficRoad = info?.name || null
      } else if (level === worstTraffic) {
        worstTrafficM += edge.d
      }
    }
    if (info?.named) {
      const last = via[via.length - 1]
      // Carry the way ids of each named run so the result panel can offer
      // "avoid this road" — one named stretch can span several OSM ways.
      if (last && last.name === info.name) {
        last.m += edge.d
        last.wayIds.add(edge.wayId)
      } else {
        via.push({ name: info.name, m: edge.d, wayIds: new Set([edge.wayId]) })
      }
    }
  }
  // Drop sub-40 m brushes past cross-streets — they aren't part of the story.
  const viaRoads = via
    .filter((v) => v.m >= 40)
    .map((v) => ({ name: v.name, m: v.m, wayIds: [...v.wayIds] }))

  const meanRisk = result.distanceM > 0 ? result.exposure / result.distanceM : 0
  return {
    coords,
    distanceM: result.distanceM,
    exposure: result.exposure,
    meanRisk, // average risk along the path, 0–1
    floodedSegments,
    floodedWays: [...flooded],
    nodeCount: result.nodes.length,
    driveMins, // congestion-aware vehicle ETA (expressway fast, alleys/jams slow)
    freeFlowMins, // the same trip with no congestion — baseline for the delay
    trafficDelayMins: Math.max(0, driveMins - freeFlowMins), // minutes lost to jams
    congestedSegments,
    congestedWays: [...congested],
    worstTraffic, // worst level along the path ('light'…'gridlock') or null
    worstTrafficM, // metres spent at that worst level
    worstTrafficRoad, // friendly name of the worst-congested road, if any
    viaRoads, // ordered named roads the path follows: [{ name, m, wayIds }, …]
    segments, // per-leg metadata aligned with coords — drives turn-by-turn
    onewayM, // metres of this route that run along one-way streets
    onewayWays: [...onewayWays],
    wrongWayM, // metres running AGAINST a one-way (see planRoute.onewayRelaxed)
    wrongWayWays: [...wrongWay_],
    wrongWayRoads: [...wrongWayNames],
  }
}

/**
 * The headline call: find both the SAFEST and the SHORTEST path from `start`
 * to `goal` (free [lat, lng] coordinates, snapped to the nearest road nodes).
 *
 *   opts = { riskAt, statusMap, alpha }
 *
 * Returns:
 *   {
 *     ok: true,
 *     safe:  { coords, distanceM, meanRisk, floodedSegments, … },
 *     fast:  { … same shape, ignoring risk … },
 *     start: [lat,lng] snapped, goal: [lat,lng] snapped,
 *     detourM: extra metres the safe route spends to lower risk,
 *     identical: whether safe and fast are the same path,
 *   }
 *   …or { ok: false, reason } when no route exists (disconnected / all blocked).
 */
export function planRoute(graph, start, goal, opts = {}) {
  if (!graph || graph.size === 0) return { ok: false, reason: 'no-network' }
  const alpha = opts.alpha ?? DEFAULT_ALPHA
  const beta = opts.beta ?? DEFAULT_BETA
  const riskOf = (edge) => {
    const r = edgeRisk(edge, opts)
    return isFinite(r) ? r : 1
  }
  // The one-way rule needs each edge's way tags, which live on the graph.
  opts = { ...opts, wayInfo: graph.wayInfo }

  const sNode = nearestNode(graph, start)
  const gNode = nearestNode(graph, goal)
  if (sNode < 0 || gNode < 0) return { ok: false, reason: 'no-network' }
  if (sNode === gNode) return { ok: false, reason: 'too-close' }

  let safeRaw = aStar(graph, sNode, gNode, makeCost(opts, alpha, beta), riskOf)

  /* WORST CASE: no legal route exists.
     One-way turns the network directed, and a directed graph can strand a
     destination that is physically metres away — a depot at the closed end of
     a one-way street, or a site whose only approach became a ramp when the
     road it branches from flooded.
     Refusing to answer is the wrong response during an emergency. Re-plan
     without the restriction and SAY SO: `onewayRelaxed` is carried all the way
     to the result panel, which shows a warning naming the streets involved, so
     the dispatcher sends the vehicle knowing it has to counterflow rather than
     finding out at the junction. The alternative — "no route found" — tells
     them nothing and helps nobody. */
  let onewayRelaxed = false
  if (!safeRaw && !opts.ignoreOneway && !opts.onFoot) {
    opts = { ...opts, ignoreOneway: true }
    safeRaw = aStar(graph, sNode, gNode, makeCost(opts, alpha, beta), riskOf)
    onewayRelaxed = Boolean(safeRaw)
  }
  if (!safeRaw) return { ok: false, reason: 'no-path' }

  /* Pure-distance path for comparison (alpha = 0 ⇒ cost = length), still
     forbidding blocked roads so the "shortest" option stays drivable.

     This is a SECOND full A* on every call, which is right when a human is
     going to read "you detour 300 m to halve your exposure" — and pure waste
     when a batch job only wants the distance. `compare: false` skips it; the
     caller then gets `fast === safe` and a zero detour, which is honest for a
     result that never made the comparison. */
  const fastRaw = opts.compare === false
    ? null
    : aStar(graph, sNode, gNode, (edge) => {
      // The shortest option has to be drivable too: same one-way rule, or it
      // would offer a "300 m shorter" route straight up a one-way street.
      if (!opts.ignoreOneway && !edgeAllowed(edge, graph.wayInfo?.get(edge.wayId), opts.onFoot)) return Infinity
      const r = edgeRisk(edge, opts)
      return isFinite(r) ? edge.d : Infinity
    }, riskOf)

  const safe = decorate(graph, safeRaw, opts)
  const fast = fastRaw ? decorate(graph, fastRaw, opts) : safe

  return {
    ok: true,
    safe,
    fast,
    start: [graph.lat[sNode], graph.lng[sNode]],
    goal: [graph.lat[gNode], graph.lng[gNode]],
    detourM: Math.max(0, safe.distanceM - fast.distanceM),
    identical: safe.coords.length === fast.coords.length && safe.distanceM === fast.distanceM,
    /* True when the ONLY way through was against a one-way street. The panel
       must surface this — a route the driver cannot legally take, presented
       without comment, is worse than no route at all. */
    onewayRelaxed,
    wrongWayWays: onewayRelaxed ? safe.wrongWayWays : [],
    wrongWayRoads: onewayRelaxed ? safe.wrongWayRoads : [],
  }
}

/**
 * Choose the best evacuation destination for a start point: the candidate
 * that is reachable with the lowest-risk route, tie-broken by distance.
 * `centres` is a list of { ...meta, coords:[lat,lng] }.
 * Returns { centre, plan } or null when none are reachable.
 */
export function planToNearestSafe(graph, start, centres, opts = {}) {
  let best = null
  for (const centre of centres) {
    if (!centre.coords) continue
    const plan = planRoute(graph, start, centre.coords, opts)
    if (!plan.ok) continue
    // Rank by flood exposure first, then by distance — the safest centre wins
    // even if it's a little farther.
    const score = plan.safe.exposure + plan.safe.distanceM * 0.15
    if (!best || score < best.score) best = { centre, plan, score }
  }
  return best ? { centre: best.centre, plan: best.plan } : null
}

/* ── Memoised graph hook ─────────────────────────────────────────────────── */
// Building the graph is a single pass over the road network; cache it on the
// roads object so it's built once and reused across every routing screen.
let graphCache = { roads: null, graph: null }

export function getGraph(roads) {
  if (!roads) return null
  if (graphCache.roads === roads && graphCache.graph) return graphCache.graph
  const graph = buildGraph(roads)
  graphCache = { roads, graph }
  return graph
}

export function useRouteGraph(roads) {
  return useMemo(() => getGraph(roads), [roads])
}
