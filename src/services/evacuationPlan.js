import { getGraph, planRoute } from '../components/admin/routeEngine.js'
import { haversineMeters } from '../components/admin/routingHelpers.jsx'
import { BARANGAY_CENTROIDS } from '../data/cabuyaoBarangays.js'

/* ============================================================
   Evacuation capacity matching — which barangay goes where.

   Turns "here is a map of 29 centres" into "here is the plan": for each
   barangay, the nearest centre by FLOOD-AWARE ROAD DISTANCE that still has
   room, the route to it, and where the overflow goes when it fills.

   Distance is the router's answer, not a straight line. That matters here more
   than anywhere: the nearest centre as the crow flies is frequently not the
   nearest one you can actually reach when the lakeshore roads are under water,
   and a plan built on straight lines would send people toward a centre across
   a flooded road.

   ON POPULATIONS — the honest part. The system holds no census data, and this
   file does not invent any. Demand comes from a `population` an administrator
   enters per barangay (Settings → Barangays). With it, the plan allocates real
   numbers and reports genuine overflow. Without it, the plan still assigns each
   barangay its nearest reachable centre and route — that part needs no
   population at all — and says plainly that demand is unknown rather than
   filling the gap with a plausible-looking figure.
   ============================================================ */

/* Only the nearest few centres are worth routing to. 18 barangays × 29 centres
   would be 522 A* searches; pre-ranking by straight-line distance and routing
   to the closest handful gives the same answer for a fraction of the work. */
const CANDIDATES_PER_BARANGAY = 4

/**
 * @param roads       OSM FeatureCollection
 * @param centres     [{ id, name, coords, capacity, occupancy, status }]
 * @param assignments barangayAssignments blob — read for `population`
 * @param statusMap   operator-flagged road conditions, honoured by the router
 * @param field       live flood field, so routing avoids the water
 */
export function computeEvacuationPlan({
  roads, centres = [], assignments = {}, statusMap = {}, field = null,
}) {
  const graph = getGraph(roads)
  const open = centres.filter((c) => Array.isArray(c.coords) && c.status !== 'closed')
  if (!graph || open.length === 0) {
    return { rows: [], unassigned: [], totals: null, hasPopulations: false }
  }

  // Remaining headroom per centre, consumed as barangays are assigned.
  const room = new Map(
    open.map((c) => [
      c.id,
      Math.max(0, (Number(c.capacity) || 0) - (Number(c.occupancy) || 0)),
    ]),
  )

  // `compare: false` skips the shortest-path A* inside planRoute. This runs
  // ~72 searches and only ever reads the safe route's distance, so computing a
  // comparison path for each one doubled the work for nothing.
  const opts = { riskAt: field?.riskAt, statusMap, alpha: 8, beta: 0, compare: false }

  // Biggest demand first: when capacity runs short, the barangay that needs the
  // most should get the nearest centre rather than whichever came first
  // alphabetically.
  const brgys = BARANGAY_CENTROIDS.map(({ name, coords }) => ({
    name,
    coords,
    population: Number(assignments[name]?.population) || null,
  })).sort((a, b) => (b.population || 0) - (a.population || 0))

  const hasPopulations = brgys.some((b) => b.population)
  const rows = []
  const unassigned = []

  for (const b of brgys) {
    // Straight-line shortlist, then route to each for the real distance.
    const shortlist = [...open]
      .map((c) => ({ c, crow: haversineMeters(b.coords, c.coords) }))
      .sort((x, y) => x.crow - y.crow)
      .slice(0, CANDIDATES_PER_BARANGAY)

    const reachable = []
    for (const { c } of shortlist) {
      const plan = planRoute(graph, b.coords, c.coords, opts)
      if (!plan.ok) continue
      reachable.push({
        centre: c,
        distanceM: Math.round(plan.safe.distanceM),
        meanRisk: plan.safe.meanRisk,
        viaRoads: plan.safe.viaRoads.slice(0, 2).map((v) => v.name),
      })
    }
    reachable.sort((x, y) => x.distanceM - y.distanceM)

    if (reachable.length === 0) {
      unassigned.push({ ...b, reason: 'No route to any open centre' })
      continue
    }

    // Fill the nearest that still has room, spilling into the next.
    const allocations = []
    let remaining = b.population
    for (const r of reachable) {
      if (remaining != null && remaining <= 0) break
      const free = room.get(r.centre.id) || 0
      if (free <= 0) continue
      const take = remaining == null ? null : Math.min(free, remaining)
      allocations.push({ ...r, people: take })
      if (take != null) {
        room.set(r.centre.id, free - take)
        remaining -= take
      }
      // With no population figure there is nothing to spill, so the nearest
      // reachable centre with room IS the plan.
      if (remaining == null) break
    }

    if (allocations.length === 0) {
      // Everything nearby is full — still name the nearest so a dispatcher has
      // somewhere to start.
      unassigned.push({ ...b, reason: 'All nearby centres full', nearest: reachable[0] })
      continue
    }

    rows.push({
      barangay: b.name,
      population: b.population,
      primary: allocations[0],
      overflow: allocations.slice(1),
      shortfall: remaining != null && remaining > 0 ? remaining : 0,
    })
  }

  rows.sort((a, b) => (b.population || 0) - (a.population || 0) || a.barangay.localeCompare(b.barangay))

  const totals = {
    capacity: open.reduce((n, c) => n + (Number(c.capacity) || 0), 0),
    occupied: open.reduce((n, c) => n + (Number(c.occupancy) || 0), 0),
    demand: hasPopulations ? brgys.reduce((n, b) => n + (b.population || 0), 0) : null,
    shortfall: rows.reduce((n, r) => n + r.shortfall, 0),
    centres: open.length,
  }

  return { rows, unassigned, totals, hasPopulations }
}
