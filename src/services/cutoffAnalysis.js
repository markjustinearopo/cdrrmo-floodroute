import { getGraph, nearestNode, planRoute } from '../components/admin/routeEngine.js'
import { susceptibilityAt } from '../components/admin/floodRisk.js'
import { BARANGAY_CENTROIDS } from '../data/cabuyaoBarangays.js'

/* ============================================================
   Cutoff analysis — at what water level does a barangay lose every road out?

   Pure computation over data already in memory: the 4,853-way OSM road graph,
   the bundled terrain grid, the real evacuation centres. No new feed.

   THE MODEL, stated plainly so the number can be argued with:

   A "water level" L is a city-wide rise in metres. It does not land evenly —
   low ground takes more of it — so the depth over a given road is
   L × susceptibility(road), where susceptibility comes from the same
   height-above-lake terrain grid the hazard map uses. A road stops being
   drivable once that depth reaches IMPASSABLE_M.

   Sweeping L upward, each barangay eventually has no surviving path from its
   centroid to any evacuation centre. That L is its CUTOFF DEPTH. The roads
   that failed on the last surviving route are its CRITICAL ROADS — lose those
   and the barangay is on its own.

   WHAT THIS IS NOT: a hydraulic simulation. There is no flow routing, no
   drainage, no culverts, no bridge deck heights. It answers one narrow
   question — "as water rises uniformly, in what order do barangays lose their
   last way out, and which road is it?" — and the ORDER is far more trustworthy
   than any individual depth figure. Read it as a ranking, not a prediction.
   ============================================================ */

/** Local depth (m) over a road once it stops being drivable. */
export const IMPASSABLE_M = 0.3

/** Ceiling on the sweep, in metres of city-wide rise. */
export const MAX_LEVEL_M = 2.5

/* The sweep does NOT walk fixed 0.1 m ticks. Connectivity can only change at a
   level where some road actually drops out, and the terrain grid yields ~48
   distinct such levels across the city. Stepping through those instead is both
   finer (0.1 m steps put ten barangays on the same tied value, which is not a
   ranking) and cheaper (~48 sweeps rather than 125). Every cutoff reported is
   therefore an exact level at which a real road went under, not a rounded
   bucket. */

/**
 * The water level at which this point's local depth reaches IMPASSABLE_M.
 * Inverting the model per-edge like this means the sweep never has to re-test
 * a road: each one has a single level it drops out at.
 */
function floodLevelFor(lat, lng) {
  const s = susceptibilityAt(lat, lng)
  if (!s || s <= 0) return Infinity // high ground never floods under this model
  return IMPASSABLE_M / s
}

/**
 * Every graph node reachable from any evacuation centre, given a set of
 * impassable ways. One multi-source breadth-first sweep over the whole graph.
 *
 * This is deliberately BFS and not A*. The brief called for planRoute at each
 * step, but "is there ANY way out" is a connectivity question, and answering it
 * with A* would mean 18 barangays × 25 levels × 29 centres ≈ 13,000 searches
 * over a 4,853-way graph — enough to lock the tab. One BFS per level answers it
 * for every barangay at once. planRoute still runs, once per barangay, on the
 * last surviving level, to name the actual roads.
 */
function reachableFromCentres(graph, centreNodes, isWayBlocked) {
  const seen = new Uint8Array(graph.size)
  const queue = []
  for (const n of centreNodes) {
    if (n >= 0 && !seen[n]) { seen[n] = 1; queue.push(n) }
  }
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]
    for (const edge of graph.adj[node]) {
      if (seen[edge.to]) continue
      if (isWayBlocked(edge)) continue
      seen[edge.to] = 1
      queue.push(edge.to)
    }
  }
  return seen
}

/**
 * Run the sweep.
 *
 * @param roads      the OSM FeatureCollection
 * @param centres    evacuation centres [{ id, name, coords, status }]
 * @param statusMap  operator-flagged road conditions, honoured at every level
 * @returns { rows, levels, generatedAt } — rows sorted most-fragile first
 */
export function analyzeCutoffs({ roads, centres = [], statusMap = {} }) {
  const graph = getGraph(roads)
  if (!graph || graph.size === 0) return { rows: [], levels: [], generatedAt: Date.now() }

  const open = centres.filter((c) => Array.isArray(c.coords) && c.status !== 'closed')
  const centreNodes = open.map((c) => nearestNode(graph, c.coords)).filter((n) => n >= 0)
  if (centreNodes.length === 0) return { rows: [], levels: [], generatedAt: Date.now() }

  // Per-way flood level, computed once. A way is blocked at level L if L has
  // reached its level — or if an operator has already closed it, at any level.
  const wayLevel = new Map()
  for (const node of graph.adj) {
    for (const edge of node) {
      if (wayLevel.has(edge.wayId)) continue
      wayLevel.set(edge.wayId, floodLevelFor(edge.mlat, edge.mlng))
    }
  }
  const hardBlocked = new Set(
    Object.entries(statusMap).filter(([, v]) => v === 'blocked').map(([k]) => String(k)),
  )

  const brgys = BARANGAY_CENTROIDS
    .map(({ name, coords }) => ({ name, coords, node: nearestNode(graph, coords) }))
    .filter((b) => b.node >= 0)

  // The levels at which the road network actually changes.
  const sweepLevels = [...new Set([...wayLevel.values()])]
    .filter((v) => Number.isFinite(v) && v <= MAX_LEVEL_M)
    .sort((a, b) => a - b)

  // Sweep upward; the first level at which a barangay is unreachable is its
  // cutoff. One pass answers it for every barangay at once.
  const pending = new Map(brgys.map((b) => [b.name, b]))
  const result = new Map()
  const levels = []
  let prevLevel = 0

  for (const raw of sweepLevels) {
    if (pending.size === 0) break
    const level = +raw.toFixed(3)
    const blocked = (edge) => hardBlocked.has(String(edge.wayId)) || wayLevel.get(edge.wayId) <= level
    const seen = reachableFromCentres(graph, centreNodes, blocked)
    let cutOffHere = 0
    for (const [name, b] of pending) {
      if (!seen[b.node]) {
        result.set(name, { ...b, cutoffM: level, lastSafeM: prevLevel })
        pending.delete(name)
        cutOffHere++
      }
    }
    levels.push({ level, cutOffCumulative: result.size, cutOffHere })
    prevLevel = level
  }

  // Anything still connected at the ceiling has no cutoff in range.
  for (const [name, b] of pending) result.set(name, { ...b, cutoffM: null })

  // Name the roads: re-solve each barangay one step BELOW its cutoff — the
  // last level where a way out still existed — and report which of that
  // route's roads drown at the cutoff itself.
  const rows = [...result.values()].map((b) => {
    const row = {
      barangay: b.name,
      coords: b.coords,
      cutoffM: b.cutoffM,
      lastSafeM: b.lastSafeM ?? null,
      criticalRoads: [],
      lastRouteM: null,
      centre: null,
    }
    if (b.cutoffM == null || b.cutoffM <= 0) return row

    // The last level at which a way out still existed.
    const lastLevel = b.lastSafeM ?? 0
    const survives = (id) => !hardBlocked.has(String(id)) && wayLevel.get(id) > lastLevel
    const sweepStatus = {}
    for (const [id, lvl] of wayLevel) {
      if (!survives(id)) sweepStatus[id] = 'blocked'
    }

    let best = null
    for (const c of open) {
      const plan = planRoute(graph, b.coords, c.coords, { statusMap: sweepStatus, alpha: 0, beta: 0 })
      if (!plan.ok) continue
      if (!best || plan.safe.distanceM < best.plan.safe.distanceM) best = { centre: c, plan }
    }
    if (!best) return row

    row.lastRouteM = Math.round(best.plan.safe.distanceM)
    row.centre = best.centre.name
    // The roads on that last route that go under at the cutoff level.
    row.criticalRoads = best.plan.safe.viaRoads
      .filter((v) => (v.wayIds || []).some((id) => wayLevel.get(id) <= b.cutoffM))
      .sort((a, z) => z.m - a.m)
      .slice(0, 3)
      .map((v) => ({ name: v.name, m: Math.round(v.m) }))
    return row
  })

  // Most fragile first; barangays that never cut off sink to the bottom.
  rows.sort((a, b) => {
    if (a.cutoffM == null) return 1
    if (b.cutoffM == null) return -1
    return a.cutoffM - b.cutoffM
  })

  return { rows, levels, generatedAt: Date.now() }
}

/* ── Cache ────────────────────────────────────────────────────────────────
   The graph and the terrain are static, so the only thing that can change the
   answer is an operator closing or reopening a road. Key on exactly that. */
let cache = { key: null, value: null }

function statusKey(statusMap) {
  return Object.entries(statusMap || {})
    .filter(([, v]) => v === 'blocked')
    .map(([k]) => k)
    .sort()
    .join(',')
}

export function getCutoffAnalysis({ roads, centres, statusMap }) {
  const key = `${roads?.features?.length || 0}|${centres?.length || 0}|${statusKey(statusMap)}`
  if (cache.key === key && cache.value) return cache.value
  const value = analyzeCutoffs({ roads, centres, statusMap })
  cache = { key, value }
  return value
}

export function clearCutoffCache() {
  cache = { key: null, value: null }
}

/* ── Blind spots ──────────────────────────────────────────────────────────
   The same computation asked spatially: at a given water level, which parts of
   the city have no surviving route to any centre? Returns the graph nodes that
   are cut off, which the map layer clusters into shaded regions. */
export function blindSpotNodes({ roads, centres = [], statusMap = {}, level = 0 }) {
  const graph = getGraph(roads)
  if (!graph || graph.size === 0) return { points: [], total: 0, level }

  const open = centres.filter((c) => Array.isArray(c.coords) && c.status !== 'closed')
  const centreNodes = open.map((c) => nearestNode(graph, c.coords)).filter((n) => n >= 0)
  if (centreNodes.length === 0) return { points: [], total: graph.size, level }

  const hardBlocked = new Set(
    Object.entries(statusMap).filter(([, v]) => v === 'blocked').map(([k]) => String(k)),
  )
  const blocked = (edge) =>
    hardBlocked.has(String(edge.wayId)) || floodLevelFor(edge.mlat, edge.mlng) <= level

  const seen = reachableFromCentres(graph, centreNodes, blocked)
  const points = []
  for (let i = 0; i < graph.size; i++) {
    if (!seen[i]) points.push([graph.lat[i], graph.lng[i]])
  }
  return { points, total: graph.size, level }
}
