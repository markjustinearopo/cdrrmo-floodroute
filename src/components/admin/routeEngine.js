/* ============================================================
   Flood-aware route engine.

   Turns the OpenStreetMap road network (fetched from Overpass in
   routingHelpers) into a routable graph and finds the safest practical
   path across it, weighting every road segment by the flood-risk field
   (floodRisk.js) and the admin's manually-flagged road conditions.

   This is the automatic, flood-aware route suggestion the rest of the
   admin previously left as a "coming soon" control. The three feeds the
   Conceptual Framework names meet here:
     • OpenStreetMap     → the graph (nodes & edges)
     • Google Flood Hub  → per-segment inundation risk  (floodRisk)
     • Windy.com         → rainfall/wind driving that risk (floodRisk)

   Pure functions, no React (a thin memo hook lives at the bottom). The
   search is a binary-heap A* with a straight-line-distance heuristic,
   which is admissible and consistent for the distance-scaled cost below,
   so the first path it settles is optimal.
   ============================================================ */

import { useMemo } from 'react'
import { haversineMeters } from './routingHelpers.jsx'

/* How hard to steer away from flood risk. The cost of a segment is its
   length multiplied by (1 + ALPHA · risk), with risk in [0, 1]; a fully
   flooded segment therefore costs (1 + ALPHA)× its length, so the search
   will happily take a detour up to that factor longer to stay dry. */
export const DEFAULT_ALPHA = 8

// Coordinates are merged into shared graph nodes at ~0.1 m precision.
// Overpass returns the endpoints of connecting ways with identical
// coordinates (they are the same OSM node), so rounding here stitches the
// separate way geometries into one connected network at intersections.
const COORD_PRECISION = 6

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
 *   adj[i]              → array of edges { to, d, wayId, mlat, mlng }
 * Edges are undirected (each segment is pushed both ways): evacuation and
 * relief convoys may run against one-way tags in an emergency, so the demo
 * deliberately ignores `oneway`.
 */
export function buildGraph(roads) {
  const idByKey = new Map()
  const lat = []
  const lng = []
  const adj = []

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
    let prev = nodeAt(coords[0][1], coords[0][0])
    for (let i = 1; i < coords.length; i++) {
      const cur = nodeAt(coords[i][1], coords[i][0])
      if (cur === prev) continue
      const d = haversineMeters([lat[prev], lng[prev]], [lat[cur], lng[cur]])
      const mlat = (lat[prev] + lat[cur]) / 2
      const mlng = (lng[prev] + lng[cur]) / 2
      adj[prev].push({ to: cur, d, wayId, mlat, mlng })
      adj[cur].push({ to: prev, d, wayId, mlat, mlng })
      prev = cur
    }
  }

  return { lat, lng, adj, size: lat.length }
}

/* ── Nearest-node snapping ───────────────────────────────────────────────── */
// Nearest graph node to a free coordinate (where the admin clicked / an
// evacuation centre sits). Planar squared distance is enough at city scale.
export function nearestNode(graph, [lat, lng]) {
  let best = -1
  let bestD = Infinity
  const { lat: las, lng: lns, size } = graph
  // Latitude correction so the longitude axis isn't over-weighted.
  const kx = Math.cos((lat * Math.PI) / 180)
  for (let i = 0; i < size; i++) {
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

function findEdge(edges, to) {
  for (let i = 0; i < edges.length; i++) if (edges[i].to === to) return edges[i]
  return null
}

/* ── Risk + cost model ───────────────────────────────────────────────────── */
/**
 * Per-edge flood risk in [0, 1], fusing the live field with the admin's
 * manual road conditions. Manual flags are authoritative: a "blocked" road
 * is impassable, a "flooded" road is treated as near-certain risk regardless
 * of what the model says.
 */
export function edgeRisk(edge, { riskAt, statusMap }) {
  const status = statusMap?.[edge.wayId]
  if (status === 'blocked') return Infinity
  let risk = riskAt ? riskAt(edge.mlat, edge.mlng) : 0
  if (status === 'flooded') risk = Math.max(risk, 0.9)
  return risk
}

function makeCost(opts, alpha) {
  return (edge) => {
    const risk = edgeRisk(edge, opts)
    if (!isFinite(risk)) return Infinity
    return edge.d * (1 + alpha * risk)
  }
}

/* ── Path → friendly result ──────────────────────────────────────────────── */
function decorate(graph, result, opts) {
  const { lat, lng, adj } = graph
  const coords = result.nodes.map((id) => [lat[id], lng[id]])

  // Count how many traversed segments sit on manually-flooded/blocked roads.
  let floodedSegments = 0
  const flooded = new Set()
  for (let i = 1; i < result.nodes.length; i++) {
    const edge = findEdge(adj[result.nodes[i - 1]], result.nodes[i])
    const st = edge && opts.statusMap?.[edge.wayId]
    if (st === 'flooded' || st === 'blocked') {
      floodedSegments++
      flooded.add(edge.wayId)
    }
  }

  const meanRisk = result.distanceM > 0 ? result.exposure / result.distanceM : 0
  return {
    coords,
    distanceM: result.distanceM,
    exposure: result.exposure,
    meanRisk, // average risk along the path, 0–1
    floodedSegments,
    floodedWays: [...flooded],
    nodeCount: result.nodes.length,
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
  const riskOf = (edge) => {
    const r = edgeRisk(edge, opts)
    return isFinite(r) ? r : 1
  }

  const sNode = nearestNode(graph, start)
  const gNode = nearestNode(graph, goal)
  if (sNode < 0 || gNode < 0) return { ok: false, reason: 'no-network' }
  if (sNode === gNode) return { ok: false, reason: 'too-close' }

  const safeRaw = aStar(graph, sNode, gNode, makeCost(opts, alpha), riskOf)
  if (!safeRaw) return { ok: false, reason: 'no-path' }

  // Pure-distance path for comparison (alpha = 0 ⇒ cost = length), still
  // forbidding blocked roads so the "shortest" option stays drivable.
  const fastCost = (edge) => {
    const r = edgeRisk(edge, opts)
    return isFinite(r) ? edge.d : Infinity
  }
  const fastRaw = aStar(graph, sNode, gNode, fastCost, riskOf)

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
