import test from 'node:test'
import assert from 'node:assert/strict'
import { selectAreaRoads, roadTouchesBoundary } from '../src/utils/roadAreaSelection.js'
import { projectOnWay, sliceWay } from '../src/components/admin/roadBlocks.js'

const road = (id, line) => ({ type: 'Feature', properties: { id, name: 'Road ' + id }, geometry: { type: 'LineString', coordinates: line.map(([lat, lng]) => [lng, lat]) } })
const roads = [road(1, [[14.276,121.14],[14.276,121.142]]),road(2, [[14.277,121.14],[14.277,121.142]]),road(3, [[14.28,121.14],[14.28,121.142]])]
const boundary = [[14.2755,121.1405],[14.2775,121.1405],[14.2775,121.1415],[14.2755,121.1415]]

test('multiple road points select several ways without duplicates', () => {
  const result = selectAreaRoads(roads,[[14.276,121.141],[14.277,121.141],[14.276,121.1412]],'points')
  assert.deepEqual(result.roads.map(r=>r.properties.id).sort(),[1,2])
  assert.equal(result.missed,0)
})
test('an off-road point does not silently mark a distant road', () => {
  const result=selectAreaRoads(roads,[[14.29,121.15]],'points')
  assert.equal(result.missed,1);assert.equal(result.roads.length,0)
})
test('a compound boundary catches roads crossing it with both endpoints outside', () => {
  const result=selectAreaRoads(roads,boundary,'area')
  assert.deepEqual(result.roads.map(r=>r.properties.id),[1,2])
  assert(roadTouchesBoundary([[14.276,121.14],[14.276,121.142]],boundary))
})
test('roads outside the boundary are left untouched', () => {
  assert(!roadTouchesBoundary([[14.28,121.14],[14.28,121.142]],boundary))
})
test('invalid compound shapes select no roads', () => {
  assert.equal(selectAreaRoads(roads,[boundary[0],boundary[2],boundary[1],boundary[3]],'area').roads.length,0)
  assert.equal(selectAreaRoads(roads,boundary.slice(0,2),'area').roads.length,0)
})
test('barangay scope is applied before selecting nearby roads', () => {
  const result=selectAreaRoads(roads,boundary,'area',f=>f.properties.id===2)
  assert.deepEqual(result.roads.map(r=>r.properties.id),[2])
})
test('the existing start/end section selection still cuts only the chosen span', () => {
  const line=[[14.276,121.14],[14.276,121.141],[14.276,121.142]]
  const start=projectOnWay(line,[14.276,121.1405]),end=projectOnWay(line,[14.276,121.1415])
  const section=sliceWay(line,start,end)
  assert.deepEqual(section[0],start.point);assert.deepEqual(section.at(-1),end.point)
  assert.equal(section.length,3)
  assert.notDeepEqual(section[0],line[0]);assert.notDeepEqual(section.at(-1),line.at(-1))
})
