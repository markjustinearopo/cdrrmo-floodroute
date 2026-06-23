/* Sanity-check the bundled road network: graph connectivity + a few test
   routes, using the SAME node-merging rule as routeEngine.buildGraph.
   Run: node scripts/validate-roads.mjs */

import { readFileSync } from 'node:fs'

const data = JSON.parse(readFileSync(new URL('../src/data/cabuyaoRoads.json', import.meta.url), 'utf8'))

const idByKey = new Map()
const lat = []
const lng = []
const adj = []
const keyOf = (la, lo) => `${la.toFixed(6)},${lo.toFixed(6)}`
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

let edges = 0
for (const w of data.ways) {
  let prev = nodeAt(w.g[0], w.g[1])
  for (let i = 2; i < w.g.length; i += 2) {
    const cur = nodeAt(w.g[i], w.g[i + 1])
    if (cur === prev) continue
    adj[prev].push(cur)
    adj[cur].push(prev)
    edges++
    prev = cur
  }
}

// Connected components
const comp = new Int32Array(lat.length).fill(-1)
const queue = new Int32Array(lat.length)
const sizes = []
for (let s = 0; s < lat.length; s++) {
  if (comp[s] !== -1) continue
  const label = sizes.length
  let head = 0, tail = 0, count = 0
  queue[tail++] = s
  comp[s] = label
  while (head < tail) {
    const c = queue[head++]
    count++
    for (const t of adj[c]) if (comp[t] === -1) { comp[t] = label; queue[tail++] = t }
  }
  sizes.push(count)
}
const mainSize = Math.max(...sizes)
const mainComp = sizes.indexOf(mainSize)
console.log(`ways: ${data.ways.length}  nodes: ${lat.length}  segments: ${edges}`)
console.log(`components: ${sizes.length}  main: ${mainSize} nodes (${((mainSize / lat.length) * 100).toFixed(1)}%)`)

// Snap helper restricted to main component
function nearest(la, lo) {
  let best = -1, bd = Infinity
  const kx = Math.cos((la * Math.PI) / 180)
  for (let i = 0; i < lat.length; i++) {
    if (comp[i] !== mainComp) continue
    const dla = lat[i] - la
    const dlo = (lng[i] - lo) * kx
    const d = dla * dla + dlo * dlo
    if (d < bd) { bd = d; best = i }
  }
  return best
}

// BFS reachability between snapped pairs across the city
const tests = [
  ['City Hall → Mamatid', [14.2766, 121.1245], [14.2389, 121.1556]],
  ['Marinig → Casile (upland)', [14.2632, 121.1583], [14.2120, 121.1050]],
  ['Banlic → Pulo', [14.2705, 121.1470], [14.2567, 121.1430]],
  ['Sala → Bigaa', [14.2520, 121.1220], [14.2880, 121.1130]],
]
for (const [label, a, b] of tests) {
  const na = nearest(a[0], a[1])
  const nb = nearest(b[0], b[1])
  const ok = comp[na] === comp[nb] && na >= 0
  const snapA = Math.round(Math.hypot((lat[na] - a[0]) * 110570, (lng[na] - a[1]) * 107880))
  const snapB = Math.round(Math.hypot((lat[nb] - b[0]) * 110570, (lng[nb] - b[1]) * 107880))
  console.log(`${ok ? 'OK ' : 'FAIL'} ${label}  (snap ${snapA} m / ${snapB} m)`)
}

// Named-road coverage
const named = data.ways.filter((w) => w.n).length
console.log(`named ways: ${named} (${((named / data.ways.length) * 100).toFixed(0)}%)`)

// What are the non-main components? Top 8 by size with sample way names.
const order = sizes.map((n, i) => [i, n]).sort((a, b) => b[1] - a[1]).slice(0, 9)
// node → a way that touches it (first wins)
const wayAtNode = new Array(lat.length)
for (const w of data.ways) {
  const id = idByKey.get(keyOf(w.g[0], w.g[1]))
  if (id !== undefined && wayAtNode[id] === undefined) wayAtNode[id] = w
}
for (const [label, n] of order) {
  if (label === mainComp) { console.log(`comp ${label}: ${n} nodes  <-- MAIN`); continue }
  const samples = new Map()
  let cla = 0, clo = 0
  for (let i = 0; i < lat.length; i++) {
    if (comp[i] !== label) continue
    cla += lat[i]
    clo += lng[i]
    if (samples.size < 4) {
      const w = wayAtNode[i]
      if (w) samples.set(w.n ? `${w.n} (${w.h})` : `unnamed ${w.h}`, true)
    }
  }
  cla /= n
  clo /= n
  // Minimum gap from this component to the main one (metres).
  let gap = Infinity
  for (let i = 0; i < lat.length; i++) {
    if (comp[i] !== label) continue
    for (let j = 0; j < lat.length; j++) {
      if (comp[j] !== mainComp) continue
      const d = Math.hypot((lat[i] - lat[j]) * 110570, (lng[i] - lng[j]) * 107880)
      if (d < gap) gap = d
    }
  }
  console.log(
    `comp ${label}: ${n} nodes @ ${cla.toFixed(4)},${clo.toFixed(4)}  gap→main ${Math.round(gap)} m — ${[...samples.keys()].join(' · ') || '?'}`,
  )
}
