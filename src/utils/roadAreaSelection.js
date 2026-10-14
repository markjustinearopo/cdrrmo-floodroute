import { geometryError } from './mapGeometry.js'
import { projectOnWay, wayLatLngs } from '../components/admin/roadBlocks.js'

const EPS = 1e-12
function cross(a, b, c) {
  return (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1])
}
function onSegment(p, a, b) {
  return Math.abs(cross(a, b, p)) < EPS && p.every((v, i) => v >= Math.min(a[i], b[i]) - EPS && v <= Math.max(a[i], b[i]) + EPS)
}
function segmentsMeet(a, b, c, d) {
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
    || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)
}
export function insideBoundary(point, boundary) {
  let inside = false
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const a = boundary[i], b = boundary[j]
    if (onSegment(point, a, b)) return true
    if ((a[0] > point[0]) !== (b[0] > point[0])
      && point[1] < (b[1] - a[1]) * (point[0] - a[0]) / (b[0] - a[0]) + a[1]) inside = !inside
  }
  return inside
}
export function roadTouchesBoundary(line, boundary) {
  if (line.some(p => insideBoundary(p, boundary))) return true
  return line.some((a, i) => i > 0 && boundary.some((b, j) => segmentsMeet(line[i - 1], a, b, boundary[(j + 1) % boundary.length])))
}

/** Selection only: callers must review the entire ways before changing status. */
export function selectAreaRoads(features, points, mode, allowed = () => true) {
  if (geometryError(points, mode)) return { roads: [], missed: 0 }
  const candidates = features.filter(f => f.geometry?.type === 'LineString' && f.properties?.id != null && allowed(f))
  const selected = new Map()
  let missed = 0
  if (mode === 'area') {
    for (const f of candidates) if (roadTouchesBoundary(wayLatLngs(f), points)) selected.set(String(f.properties.id), f)
  } else {
    for (const point of points) {
      let nearest = null, distance = 40
      for (const f of candidates) {
        const hit = projectOnWay(wayLatLngs(f), point)
        if (hit && hit.offsetM <= distance) { nearest = f; distance = hit.offsetM }
      }
      if (nearest) selected.set(String(nearest.properties.id), nearest)
      else missed++
    }
  }
  return { roads: [...selected.values()], missed }
}
