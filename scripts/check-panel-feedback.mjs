import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCoordinates,
  geometryError,
  geometryFromPoints,
  pointsFromGeometry,
  inDateRange,
} from '../src/utils/mapGeometry.js'
test('coordinate entry preserves latitude/longitude and rejects invalid ranges', () => {
  assert.deepEqual(parseCoordinates('14.2476, 121.1367'), [14.2476, 121.1367])
  assert.equal(parseCoordinates('121.1367, 14.2476'), null)
  assert.equal(parseCoordinates('14.2, 181'), null)
  assert.equal(parseCoordinates('NIA Road'), null)
})
test('multi-point and boundary reports round-trip in GeoJSON longitude/latitude order', () => {
  const points = [
    [14.24, 121.13],
    [14.24, 121.14],
    [14.25, 121.14],
    [14.25, 121.13],
  ]
  for (const mode of ['points', 'area']) {
    const g = geometryFromPoints(points, mode)
    assert.deepEqual(pointsFromGeometry(g), points)
    if (mode === 'area') assert.deepEqual(g.coordinates[0].at(-1), g.coordinates[0][0])
  }
})
test('crossed, flat, duplicate and excessive boundary points cannot be submitted', () => {
  assert.match(
    geometryError(
      [
        [0, 0],
        [1, 1],
        [0, 1],
        [1, 0],
      ],
      'area',
    ),
    /cross/,
  )
  assert.match(
    geometryError(
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      'area',
    ),
    /enclose/,
  )
  assert.match(
    geometryError(
      [
        [0, 0],
        [0, 0],
      ],
      'points',
    ),
    /duplicate/,
  )
  assert.match(
    geometryError(
      Array.from({ length: 31 }, (_, i) => [0, i]),
      'points',
    ),
    /30/,
  )
  assert.equal(
    geometryFromPoints(
      [
        [0, 0],
        [1, 1],
      ],
      'area',
    ),
    null,
  )
})
test('date filters include the complete Philippine day and exclude undated records', () => {
  const from = '2026-10-12',
    to = from
  assert.equal(inDateRange(Date.parse('2026-10-11T16:00:00Z'), from, to), true)
  assert.equal(inDateRange(Date.parse('2026-10-12T15:59:59Z'), from, to), true)
  assert.equal(inDateRange(Date.parse('2026-10-12T16:00:00Z'), from, to), false)
  assert.equal(inDateRange(null, from, to), false)
  assert.equal(inDateRange(null, '', ''), true)
})

test('old preferences cannot enable more than three map layers', async () => {
  const { limitMapLayers } = await import('../src/utils/mapLayers.js')
  const stored = { noah: true, evac: true, roads: true, reports: true, inundation: true }
  const limited = limitMapLayers(stored)
  assert.equal(Object.values(limited).filter(Boolean).length, 3)
  assert.equal(limited.reports, false)
  assert.deepEqual(limitMapLayers(null, ['noah']), { noah: false })
})
test('a fourth layer is rejected until another layer is turned off', async () => {
  const { updateMapLayers } = await import('../src/utils/mapLayers.js')
  const keys = ['noah', 'evac', 'roads', 'reports'],
    original = { noah: true, evac: true, roads: true, reports: false }
  const rejected = updateMapLayers(original, (v) => ({ ...v, reports: true }), keys)
  assert.deepEqual(rejected, original)
  const reduced = updateMapLayers(rejected, (v) => ({ ...v, noah: false }), keys)
  const selected = updateMapLayers(reduced, (v) => ({ ...v, reports: true }), keys)
  assert.equal(selected.reports, true)
  assert.equal(Object.values(selected).filter(Boolean).length, 3)
})

test('risk distance includes partial closures without double-counting whole-road flags', async () => {
  const { riskDistanceByBarangay } = await import('../src/utils/riskDistance.js')
  const a = { to: 1, d: 100, wayId: 1, mlat: 14, mlng: 121 },
    b = { to: 0, d: 100, wayId: 1, mlat: 14, mlng: 121 },
    c = { to: 2, d: 150, wayId: 2, mlat: 14, mlng: 122 },
    d = { to: 1, d: 150, wayId: 2, mlat: 14, mlng: 122 }
  const graph = { adj: [[a], [b, c], [d]] },
    blocks = { blockedEdges: new Set([a, b, c, d]) }
  assert.deepEqual(
    riskDistanceByBarangay(graph, { 1: 'blocked' }, blocks, (lat, lng) =>
      lng === 121 ? 'Marinig' : 'Sala',
    ),
    { Marinig: 0.1, Sala: 0.15 },
  )
  assert.deepEqual(
    riskDistanceByBarangay(graph, {}, {}, () => 'Marinig'),
    {},
  )
})
