/* ============================================================
   Partial road blocks — the geometry.

   A road in this system is one OSM way: a polyline of anywhere from two to
   several hundred vertices, sometimes kilometres long. `road_status` can only
   say "this way is closed", so flooding at one underpass closed the whole
   National Highway to the router. This module is what lets an operator close
   200 m of it instead.

   THE ONE IDEA
   The routable graph (routeEngine.buildGraph) turns each way into one edge per
   consecutive pair of vertices. So a section of road IS a run of graph edges,
   and blocking a section means excluding exactly those edges from the search —
   not the way. Everything here exists to get from "two points an operator
   clicked" to "this specific set of edges".

     click ─► projectOnWay ─► a position (segment index + t) along the way
     two positions ─► sliceWay      ─► the geometry to draw in red
     two positions ─► blockIndex    ─► the Set of graph edges to exclude

   WHY THE INDEX HOLDS EDGE OBJECTS, NOT KEYS
   The obvious implementation keys edges by "wayId + rounded midpoint". It is
   also wrong in a way that would be very hard to find: buildGraph snaps
   coincident vertices to a shared node at COORD_PRECISION, so a graph node's
   stored coordinate is whichever way reached that junction first — not
   necessarily the coordinate in the way we are slicing. Midpoints computed
   from the GeoJSON can then differ from the graph's own in the last decimal,
   and a rounded key straddling a boundary silently fails to block a segment.
   A router that quietly leaves a flooded segment open is the exact failure
   this feature exists to prevent.

   So the index is built by walking the GRAPH, and it stores the edge objects
   themselves in a Set. The adjacency arrays hold those objects for the
   graph's lifetime and hand the same references to the cost function, so
   membership is an identity check: exact, and O(1) with no string building in
   the hot loop.

   ROUNDING IS OUTWARD, ON PURPOSE
   Graph nodes sit at the way's vertices, so a section can only be excluded at
   vertex granularity. A segment that is PARTLY inside the operator's selection
   is blocked whole. Blocking a few metres more than was drawn is a detour;
   leaving a few metres of flooded road open is someone driving into it.

   Pure functions, no React (a memo hook lives at the bottom).
   ============================================================ */

import { useMemo } from 'react'
import { haversineMeters } from './geo.js'

/* ── Coordinates ─────────────────────────────────────────────────────────── */

/** A road feature's centreline as [lat, lng] pairs (GeoJSON stores [lng, lat]). */
export function wayLatLngs(feature) {
  const coords = feature?.geometry?.coordinates
  if (!Array.isArray(coords)) return []
  return coords.map(([lng, lat]) => [lat, lng])
}

/* Local planar scale factor for longitude at this latitude. Over a single road
   in one city this is exact enough for projection and far cheaper than doing
   spherical maths per vertex. */
const kxAt = (lat) => Math.cos((lat * Math.PI) / 180)

/**
 * Project a free point (where the operator clicked) onto a way's centreline.
 *
 * @returns {{ segIndex: number, t: number, point: [number, number],
 *             alongM: number, offsetM: number }}
 *   segIndex  the segment the point falls on (vertex i → i+1)
 *   t         0…1 position within that segment
 *   point     the snapped coordinate ON the road — never the raw click
 *   alongM    metres from the way's start, for ordering two picks
 *   offsetM   how far the click was from the road, so a caller can reject a
 *             pick that did not really land on it
 */
export function projectOnWay(latlngs, [lat, lng]) {
  if (!Array.isArray(latlngs) || latlngs.length < 2) return null
  const kx = kxAt(lat)
  let best = null
  let along = 0

  for (let i = 0; i + 1 < latlngs.length; i++) {
    const [aLat, aLng] = latlngs[i]
    const [bLat, bLng] = latlngs[i + 1]
    const segM = haversineMeters(latlngs[i], latlngs[i + 1])

    // Planar projection in degrees, longitude scaled so the axes are comparable.
    const ax = aLng * kx
    const ay = aLat
    const bx = bLng * kx
    const by = bLat
    const px = lng * kx
    const py = lat
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
    const sLat = aLat + (bLat - aLat) * t
    const sLng = aLng + (bLng - aLng) * t
    const offsetM = haversineMeters([lat, lng], [sLat, sLng])

    if (!best || offsetM < best.offsetM) {
      best = { segIndex: i, t, point: [sLat, sLng], alongM: along + segM * t, offsetM }
    }
    along += segM
  }
  return best
}

/** Total centreline length of a way, in metres. */
export function wayLengthM(latlngs) {
  let m = 0
  for (let i = 0; i + 1 < (latlngs?.length || 0); i++) m += haversineMeters(latlngs[i], latlngs[i + 1])
  return m
}

/**
 * The geometry between two projections, as [lat, lng] pairs — what gets drawn
 * in red on the map and stored as the block's `geometry`.
 *
 * The two picks are ordered by their position along the road, so it does not
 * matter which end the operator clicked first.
 */
export function sliceWay(latlngs, a, b) {
  if (!latlngs?.length || !a || !b) return []
  const [from, to] = a.alongM <= b.alongM ? [a, b] : [b, a]
  const out = [from.point]
  // Every whole vertex strictly inside the span.
  for (let i = from.segIndex + 1; i <= to.segIndex; i++) out.push(latlngs[i])
  out.push(to.point)

  // A pick pair inside one segment produces two nearly identical points; keep
  // the line drawable rather than emitting a zero-length "section".
  return out.filter((p, i) => i === 0 || haversineMeters(out[i - 1], p) > 0.2)
}

/**
 * Indices of the way's segments the span covers, rounded OUTWARD (see the
 * header). Segment i is the leg from vertex i to vertex i+1.
 */
export function blockedSegmentIndices(a, b) {
  if (!a || !b) return []
  const [from, to] = a.alongM <= b.alongM ? [a, b] : [b, a]
  const out = []
  for (let i = from.segIndex; i <= to.segIndex; i++) out.push(i)
  return out
}

/* ── Graph index ─────────────────────────────────────────────────────────── */

/** Is this [lat,lng] within `tolM` metres of any segment of the span? */
function nearSpan(span, point, tolM) {
  for (let i = 0; i + 1 < span.length; i++) {
    const p = projectOnWay([span[i], span[i + 1]], point)
    if (p && p.offsetM <= tolM) return true
  }
  return false
}

/**
 * Turn the active road-block records into something the router can consult in
 * its inner loop.
 *
 * @param graph   a routeEngine graph (its `adj` holds the edge objects)
 * @param blocks  road-block records; only `status: 'active'` ones are applied
 * @returns {{ ways: Set, blockedEdges: Set, floodedEdges: Set,
 *             byWay: Map, count: number }}
 *
 * `blockedEdges` / `floodedEdges` hold EDGE OBJECTS from `graph.adj`. Both
 * directions of a blocked segment are included — a closed road is closed both
 * ways round.
 */
export function buildBlockIndex(graph, blocks = []) {
  const ways = new Set()
  const blockedEdges = new Set()
  const floodedEdges = new Set()
  const byWay = new Map()

  const active = blocks.filter((b) => b && b.status !== 'resolved' && b.wayId != null)
  if (!graph || active.length === 0) {
    return { ways, blockedEdges, floodedEdges, byWay, count: 0 }
  }

  for (const b of active) {
    ways.add(b.wayId)
    const list = byWay.get(b.wayId) || []
    list.push(b)
    byWay.set(b.wayId, list)
  }

  /* One pass over the adjacency. An edge is inside a block when its MIDPOINT
     lies on the block's stored geometry — the midpoint is the point of the
     segment furthest from either end, so this is the test least likely to
     catch a neighbouring segment that merely touches the span's endpoint.
     The 12 m tolerance absorbs the vertex-snapping difference described in the
     header; Cabuyao's road vertices are tens of metres apart, so it cannot
     reach past the adjacent segment. */
  const TOL_M = 12

  for (let n = 0; n < graph.size; n++) {
    const edges = graph.adj[n]
    if (!edges) continue
    for (const edge of edges) {
      if (!ways.has(edge.wayId)) continue
      for (const b of byWay.get(edge.wayId)) {
        // A 'full' block is the whole way — no geometry test needed, and this
        // is what keeps the historical behaviour expressible here.
        const inside = b.scope === 'full'
          || (Array.isArray(b.geometry) && b.geometry.length > 1
            && nearSpan(b.geometry, [edge.mlat, edge.mlng], TOL_M))
        if (!inside) continue
        if (b.effect === 'flooded') floodedEdges.add(edge)
        else blockedEdges.add(edge)
        break
      }
    }
  }

  return { ways, blockedEdges, floodedEdges, byWay, count: active.length }
}

/**
 * Memoised index. Rebuilt only when the graph or the blocks actually change —
 * the 6 s poll hands back an equal-but-new array on every tick, so the
 * dependency is a cheap signature rather than the array itself.
 */
export function useRoadBlockIndex(graph, blocks) {
  const signature = (blocks || [])
    .filter((b) => b.status !== 'resolved')
    .map((b) => `${b.id}:${b.wayId}:${b.effect}:${b.scope}:${b.updatedAt || 0}`)
    .join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildBlockIndex(graph, blocks), [graph, signature])
}

/* ── Presentation helpers ────────────────────────────────────────────────── */

/** Active blocks only — what the map draws and the router applies. */
export function activeBlocks(blocks = []) {
  return blocks.filter((b) => b.status !== 'resolved')
}

/**
 * The nearest active road block to a route, if the route runs into one.
 * Used for the resident's "Road Block Ahead" warning: a closure two barangays
 * away is not something to warn a walker about, one on their path is.
 */
export function blocksOnRoute(coords = [], blocks = [], tolM = 25) {
  if (!Array.isArray(coords) || coords.length < 2) return []
  return activeBlocks(blocks).filter((b) => {
    const span = b.geometry
    if (!Array.isArray(span) || span.length < 2) return false
    return coords.some((p) => nearSpan(span, p, tolM))
  })
}

/** "Rizal Avenue · 180 m closed" — one line for a list row or a popup. */
export function describeBlock(b) {
  const name = b?.roadName || `Road #${b?.wayId}`
  if (b?.scope === 'full') return `${name} · entire road closed`
  const m = b?.lengthM
  return m ? `${name} · ${m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`} closed` : name
}
