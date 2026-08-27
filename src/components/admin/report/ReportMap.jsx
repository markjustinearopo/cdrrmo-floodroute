import { useMemo } from 'react'
import { RISK_META, levelFromDepth } from '../mapHelpers.jsx'
import { ROAD_STATUS } from '../routingHelpers.jsx'
import {
  BARANGAY_FEATURES, CABUYAO_LAND_BBOX, barangayBounds, barangayOuterRings,
} from '../../../data/cabuyaoBarangays.js'
import { FLOOD_SEVERITY_META, floodSeverity } from '../../../data/floodAreas.js'

/* ============================================================
   Situation map — a VECTOR drawing of the real Cabuyao barangay boundaries.

   Deliberately an <svg> and not a tile map: a printed report has to stay sharp
   at any size and must not depend on a tile server answering at print time.
   The projection is a simple equirectangular fit of the coverage bounds, which
   is accurate enough over a single city and keeps the whole thing dependency-
   free.
   ============================================================ */

const MAP_W = 900
const SIZE_H = { short: 420, standard: 580, tall: 760 }
const MAP_PAD = 18

/** Bounding box that contains every barangay in scope (whole city when empty). */
function unionBounds(names) {
  if (!names || names.length === 0) return CABUYAO_LAND_BBOX
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity
  for (const name of names) {
    const b = barangayBounds(name)
    if (!b) continue
    s = Math.min(s, b[0][0]); w = Math.min(w, b[0][1])
    n = Math.max(n, b[1][0]); e = Math.max(e, b[1][1])
  }
  if (!Number.isFinite(s)) return CABUYAO_LAND_BBOX
  const padLat = (n - s) * 0.08 || 0.005
  const padLng = (e - w) * 0.08 || 0.005
  return { s: s - padLat, w: w - padLng, n: n + padLat, e: e + padLng }
}

export default function ReportMap({ scope, opts, samples, floodAreas, evac, roadLines }) {
  const height = SIZE_H[opts.size] || SIZE_H.standard
  const bbox = useMemo(() => unionBounds(scope), [scope])

  const project = useMemo(() => {
    const latMid = (bbox.s + bbox.n) / 2
    const kx = Math.cos((latMid * Math.PI) / 180)
    const geoW = (bbox.e - bbox.w) * kx
    const geoH = bbox.n - bbox.s
    const sc = Math.min((MAP_W - 2 * MAP_PAD) / geoW, (height - 2 * MAP_PAD) / geoH)
    const offX = MAP_PAD + ((MAP_W - 2 * MAP_PAD) - geoW * sc) / 2
    const offY = MAP_PAD + ((height - 2 * MAP_PAD) - geoH * sc) / 2
    return ([lat, lng]) => [
      offX + (lng - bbox.w) * kx * sc,
      offY + (bbox.n - lat) * sc,
    ]
  }, [bbox, height])

  const ringToPath = (ring) =>
    `M${ring.map((pt) => project(pt).map((n) => n.toFixed(1)).join(',')).join('L')}Z`

  const levelByName = useMemo(() => {
    const m = {}
    samples.forEach((b) => { m[b.name] = levelFromDepth(b.floodDepth) })
    return m
  }, [samples])

  const inScope = (name) => scope.length === 0 || scope.includes(name)

  return (
    <svg
      className="rd-map"
      viewBox={`0 0 ${MAP_W} ${height}`}
      role="img"
      aria-label="Situation map of the City of Cabuyao"
    >
      <rect x="0" y="0" width={MAP_W} height={height} fill="#FBFAF7" />

      {/* Barangay polygons — out-of-scope ones stay as a pale context outline
          so the reader can still place the focus area inside the city. */}
      {opts.boundaries && BARANGAY_FEATURES.features.map((f) => {
        const name = f.properties.name
        const focus = inScope(name)
        const fill = opts.barangayRisk && focus
          ? RISK_META[levelByName[name] || 'safe'].color
          : '#FFFFFF'
        const fillOpacity = opts.barangayRisk && focus ? 0.32 : (focus ? 0.95 : 0.3)
        return (
          <g key={name}>
            {barangayOuterRings(name).map((ring, i) => (
              <path
                key={i}
                d={ringToPath(ring)}
                fill={fill}
                fillOpacity={fillOpacity}
                stroke={focus ? '#1A2A4A' : '#CFC9BE'}
                strokeWidth={focus ? 1.1 : 0.5}
              />
            ))}
          </g>
        )
      })}

      {/* Labels for the coverage only — the whole city at 18 labels is a mess. */}
      {opts.boundaries && opts.labels && BARANGAY_FEATURES.features
        .filter((f) => inScope(f.properties.name))
        .map((f) => {
          const [x, y] = project(f.properties.center)
          return (
            <text key={f.properties.name} x={x} y={y} className="rd-map-lbl" textAnchor="middle">
              {f.properties.name}
            </text>
          )
        })}

      {opts.roads && roadLines.map((r) => (
        <polyline
          key={r.id}
          points={r.latlngs.map((pt) => project(pt).join(',')).join(' ')}
          fill="none"
          stroke={ROAD_STATUS[r.status]?.swatch || '#F97316'}
          strokeWidth={r.status === 'blocked' ? 2.8 : 2.2}
          strokeLinecap="round"
          strokeDasharray={r.status === 'blocked' ? 'none' : '5 4'}
          opacity="0.95"
        />
      ))}

      {opts.evac && evac.filter((c) => Array.isArray(c.coords)).map((c) => {
        const [x, y] = project(c.coords)
        const color = c.status === 'closed' ? '#DC2626' : c.status === 'full' ? '#F97316' : '#16A34A'
        return (
          <rect
            key={c.id} x={x - 4} y={y - 4} width="8" height="8" rx="1.5"
            fill={color} stroke="#FFFFFF" strokeWidth="1.2"
          />
        )
      })}

      {opts.floodAreas && floodAreas.filter((a) => Array.isArray(a.coords)).map((a) => {
        const sev = floodSeverity(a)
        const [x, y] = project(a.coords)
        return (
          <circle
            key={a.id} cx={x} cy={y} r={{ high: 6, moderate: 5, low: 4 }[sev]}
            fill={FLOOD_SEVERITY_META[sev].color} fillOpacity="0.9"
            stroke="#FFFFFF" strokeWidth="1.2"
          />
        )
      })}
    </svg>
  )
}
