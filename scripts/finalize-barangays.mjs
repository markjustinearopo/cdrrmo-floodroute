/* Finalize step: stamp each Cabuyao barangay feature with a guaranteed-interior
   label point (pole of inaccessibility) so markers + risk sampling sit well
   inside even concave barangays (e.g. Banay-Banay). Stored as
   properties.center = [lat, lng]. Idempotent — safe to re-run. */

import { readFileSync, writeFileSync } from 'node:fs'

const PATH = new URL('../src/data/cabuyaoBarangays.geo.json', import.meta.url)

/* ── polylabel (Mapbox) — pole of inaccessibility, planar lng/lat ─────────── */
function polylabel(polygon, precision = 0.00003) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of polygon[0]) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const width = maxX - minX
  const height = maxY - minY
  const cellSize = Math.max(Math.min(width, height) / 2, 1e-9)

  const cells = []
  const cell = (x, y, h) => {
    const d = pointToPolygonDist(x, y, polygon)
    return { x, y, h, d, max: d + h * Math.SQRT2 }
  }

  for (let x = minX; x < maxX; x += cellSize)
    for (let y = minY; y < maxY; y += cellSize)
      cells.push(cell(x + cellSize / 2, y + cellSize / 2, cellSize / 2))

  let best = cell(minX + width / 2, minY + height / 2, 0)
  const centroidCell = getCentroidCell(polygon)
  if (centroidCell.d > best.d) best = centroidCell

  cells.sort((a, b) => b.max - a.max)
  while (cells.length) {
    const c = cells.shift()
    if (c.d > best.d) best = c
    if (c.max - best.d <= precision) continue
    const h = c.h / 2
    cells.push(cell(c.x - h, c.y - h, h), cell(c.x + h, c.y - h, h), cell(c.x - h, c.y + h, h), cell(c.x + h, c.y + h, h))
  }
  return [best.x, best.y]
}

function pointToPolygonDist(x, y, polygon) {
  let inside = false
  let minDistSq = Infinity
  for (const ring of polygon) {
    for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
      const a = ring[i], b = ring[j]
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
      minDistSq = Math.min(minDistSq, getSegDistSq(x, y, a, b))
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(minDistSq)
}

function getSegDistSq(px, py, a, b) {
  let x = a[0], y = a[1]
  let dx = b[0] - x, dy = b[1] - y
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy)
    if (t > 1) { x = b[0]; y = b[1] } else if (t > 0) { x += dx * t; y += dy * t }
  }
  dx = px - x; dy = py - y
  return dx * dx + dy * dy
}

function getCentroidCell(polygon) {
  let area = 0, x = 0, y = 0
  const ring = polygon[0]
  for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
    const a = ring[i], b = ring[j]
    const f = a[0] * b[1] - b[0] * a[1]
    x += (a[0] + b[0]) * f
    y += (a[1] + b[1]) * f
    area += f * 3
  }
  if (area === 0) return { x: ring[0][0], y: ring[0][1], h: 0, d: 0, max: 0 }
  return { x: x / area, y: y / area, h: 0, d: 0, max: 0 }
}

// Largest outer ring of a feature (handles MultiPolygon).
function largestPolygon(geom) {
  if (geom.type === 'Polygon') return geom.coordinates
  let best = null, bestArea = -1
  for (const poly of geom.coordinates) {
    const r = poly[0]
    let a = 0
    for (let i = 0, n = r.length; i < n; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % n]; a += x1 * y2 - x2 * y1 }
    a = Math.abs(a)
    if (a > bestArea) { bestArea = a; best = poly }
  }
  return best
}

const fc = JSON.parse(readFileSync(PATH, 'utf8'))
for (const f of fc.features) {
  const poly = largestPolygon(f.geometry)
  const [lng, lat] = polylabel(poly)
  f.properties.center = [+lat.toFixed(6), +lng.toFixed(6)]
}
fc.features.sort((a, b) => a.properties.name.localeCompare(b.properties.name))
writeFileSync(PATH, JSON.stringify(fc))
console.error('Stamped interior label points:')
for (const f of fc.features) console.error(`  ${f.properties.name.padEnd(15)} ${f.properties.center.join(', ')}  (${f.properties.source})`)
console.error(`\nFinal: ${fc.features.length} barangays, ${(readFileSync(PATH).length / 1024).toFixed(0)} KB`)
