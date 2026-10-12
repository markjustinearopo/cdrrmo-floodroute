export function parseCoordinates(text) {
  const match = String(text)
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) return null
  const lat = Number(match[1]),
    lng = Number(match[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null
}
export function validPoint(p) {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    p.every(Number.isFinite) &&
    Math.abs(p[0]) <= 90 &&
    Math.abs(p[1]) <= 180
  )
}
function orientation(a, b, c) {
  return (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1])
}
function intersects(a, b, c, d) {
  const cross1 = orientation(a, b, c),
    cross2 = orientation(a, b, d),
    cross3 = orientation(c, d, a),
    cross4 = orientation(c, d, b)
  const between = (x, a, b) => x >= Math.min(a, b) && x <= Math.max(a, b)
  const on = (p, a, b) => between(p[0], a[0], b[0]) && between(p[1], a[1], b[1])
  return (
    (cross1 * cross2 < 0 && cross3 * cross4 < 0) ||
    (cross1 === 0 && on(c, a, b)) ||
    (cross2 === 0 && on(d, a, b)) ||
    (cross3 === 0 && on(a, c, d)) ||
    (cross4 === 0 && on(b, c, d))
  )
}
export function geometryError(points, mode) {
  if (!Array.isArray(points) || !points.length) return 'Select a location first.'
  if (points.length > 30) return 'Use no more than 30 points.'
  if (!points.every(validPoint)) return 'Enter valid latitude and longitude.'
  if (new Set(points.map((p) => p.join(','))).size !== points.length)
    return 'Remove duplicate points.'
  if (mode === 'area') {
    if (points.length < 3) return 'Plot at least 3 boundary points in order.'
    let area = 0
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length]
      area += a[1] * b[0] - b[1] * a[0]
      for (let j = i + 1; j < points.length; j++) {
        if (j === i + 1 || (i === 0 && j === points.length - 1)) continue
        if (intersects(a, b, points[j], points[(j + 1) % points.length]))
          return 'Boundary lines cross. Undo and plot around the area in order.'
      }
    }
    if (Math.abs(area) < 1e-10) return 'Boundary points must enclose an area.'
  }
  return ''
}
export function geometryFromPoints(points, mode = 'point') {
  if (geometryError(points, mode)) return null
  const coordinates = points.map(([lat, lng]) => [lng, lat])
  if (mode === 'area') return { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] }
  return mode === 'points'
    ? { type: 'MultiPoint', coordinates }
    : { type: 'Point', coordinates: coordinates[0] }
}
export function pointsFromGeometry(geometry, fallback) {
  const coords =
    geometry?.type === 'Polygon'
      ? geometry.coordinates?.[0]?.slice(0, -1)
      : geometry?.type === 'MultiPoint'
        ? geometry.coordinates
        : geometry?.type === 'Point'
          ? [geometry.coordinates]
          : null
  return coords
    ? coords.map(([lng, lat]) => [lat, lng]).filter(validPoint)
    : validPoint(fallback)
      ? [fallback]
      : []
}
export function inDateRange(epoch, from, to) {
  if (!from && !to) return true
  const ms = Number(epoch)
  if (!Number.isFinite(ms) || ms <= 0) return false
  return (
    (!from || ms >= Date.parse(from + 'T00:00:00+08:00')) &&
    (!to || ms < Date.parse(to + 'T00:00:00+08:00') + 86400000)
  )
}
