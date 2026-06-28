import { useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { BARANGAYS } from '../../data/cabuyao.js'
import { RISK_META, levelFromDepth } from '../../components/admin/mapHelpers.jsx'
import { useFloodRisk, barangayRiskSamples } from '../../components/admin/floodRisk.js'
import { getCabuyaoRoads, useRoadStatus, ROAD_STATUS } from '../../components/admin/routingHelpers.jsx'
import {
  useFloodAreas, useEvacCenters, useAlerts, useIncidents, useRoadReports, nowLabel,
} from '../../context/AdminDataContext.jsx'
import {
  BARANGAY_FEATURES, CABUYAO_LAND_BBOX, barangayBounds, barangayOuterRings,
} from '../../data/cabuyaoBarangays.js'
import {
  FLOOD_SEVERITY_META, FLOOD_TYPE_LABEL, floodSeverity, formatFloodDepth,
} from '../../data/floodAreas.js'
import './Reports.css'

/**
 * CDRRMO Admin — Reports.
 *
 * A full report-generation studio. The officer customises a clean, printable
 * flood & road-conditions report — pick the barangay scope (whole city or
 * specific "bordered" barangays), choose which sections appear, and toggle the
 * map overlays — then exports it to PDF (the browser's print-to-PDF). The map
 * is a crisp VECTOR rendering of the real Cabuyao barangay boundaries with the
 * flood-prone areas, road conditions and evacuation centres drawn on top, so it
 * prints sharp at any size. The CDRRMO logo heads every page.
 */

const SECTIONS = [
  { key: 'summary', label: 'Executive Summary' },
  { key: 'map', label: 'Situation Map' },
  { key: 'floodAreas', label: 'Flood-Prone Areas' },
  { key: 'roads', label: 'Road Conditions' },
  { key: 'evac', label: 'Evacuation Centres' },
  { key: 'alerts', label: 'Active Alerts' },
  { key: 'incidents', label: 'Open Incidents' },
  { key: 'barangays', label: 'Barangay Risk Table' },
]

const MAP_OPTS = [
  { key: 'boundaries', label: 'Barangay boundaries' },
  { key: 'barangayRisk', label: 'Barangay risk shading' },
  { key: 'floodAreas', label: 'Flood-prone areas' },
  { key: 'roads', label: 'Road conditions' },
  { key: 'evac', label: 'Evacuation centres' },
]

export default function Reports() {
  const { field } = useFloodRisk()
  const { floodAreas } = useFloodAreas()
  const { evacuationCenters } = useEvacCenters()
  const { alerts } = useAlerts()
  const { incidents } = useIncidents()
  const { roadReports } = useRoadReports()
  const [roadStatus] = useRoadStatus()
  const roadNetwork = useMemo(() => getCabuyaoRoads(), [])

  const samples = useMemo(() => barangayRiskSamples(field), [field])

  // ── Report configuration ──
  const [title, setTitle] = useState('Flood & Road Conditions Report')
  const [preparedBy, setPreparedBy] = useState('CDRRMO Cabuyao City')
  const [preparedFor, setPreparedFor] = useState('Office of the City Mayor')
  const [scope, setScope] = useState([]) // [] = whole city; else list of barangay names
  const [sections, setSections] = useState(
    Object.fromEntries(SECTIONS.map((s) => [s.key, true])),
  )
  const [mapOpts, setMapOpts] = useState(
    Object.fromEntries(MAP_OPTS.map((o) => [o.key, true])),
  )

  const toggleSection = (k) => setSections((v) => ({ ...v, [k]: !v[k] }))
  const toggleMapOpt = (k) => setMapOpts((v) => ({ ...v, [k]: !v[k] }))
  const toggleScope = (name) =>
    setScope((v) => (v.includes(name) ? v.filter((n) => n !== name) : [...v, name]))

  const inScope = (b) => scope.length === 0 || scope.includes(b)
  const scopeLabel = scope.length === 0
    ? 'Whole City — all 18 barangays'
    : `${scope.length} barangay${scope.length > 1 ? 's' : ''}: ${scope.join(', ')}`

  // ── Scoped datasets ──
  const fAreas = useMemo(
    () => floodAreas.filter((a) => inScope(a.barangay)),
    [floodAreas, scope],
  )
  const evac = useMemo(
    () => evacuationCenters.filter((c) => inScope(c.barangay)),
    [evacuationCenters, scope],
  )
  const activeAlerts = useMemo(
    () => alerts.filter((a) => a.status === 'active' && (scope.length === 0 || inScope(a.barangay) || a.barangay === 'All')),
    [alerts, scope],
  )
  const openIncidents = useMemo(
    () => incidents.filter((i) => i.status !== 'resolved' && inScope(i.barangay)),
    [incidents, scope],
  )
  const scopedSamples = useMemo(
    () => samples.filter((b) => inScope(b.name)),
    [samples, scope],
  )

  // Flagged roads → drawable lines + table rows (depth from road reports).
  const roadLines = useMemo(() => {
    if (!roadNetwork) return []
    const byId = new Map(roadNetwork.features.map((f) => [String(f.properties.id), f]))
    const reportByWay = new Map(roadReports.filter((r) => r.wayId != null).map((r) => [String(r.wayId), r]))
    return Object.entries(roadStatus)
      .map(([id, status]) => {
        const f = byId.get(String(id))
        if (!f) return null
        const report = reportByWay.get(String(id))
        return {
          id, status,
          name: report?.name || f.properties.name,
          depthFt: report?.depthFt,
          latlngs: f.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        }
      })
      .filter(Boolean)
  }, [roadNetwork, roadStatus, roadReports])

  const generatedAt = nowLabel()

  return (
    <AdminLayout>
      <div className="reports">
        {/* ── Builder (hidden in print) ── */}
        <aside className="report-builder">
          <div className="rb-head">
            <h2>Report Builder</h2>
            <p>Customise, preview, then export to PDF.</p>
          </div>

          <div className="rb-group">
            <label className="rb-label">Report Title</label>
            <input className="rb-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="rb-row">
            <div className="rb-group">
              <label className="rb-label">Prepared by</label>
              <input className="rb-input" value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} />
            </div>
            <div className="rb-group">
              <label className="rb-label">Prepared for</label>
              <input className="rb-input" value={preparedFor} onChange={(e) => setPreparedFor(e.target.value)} />
            </div>
          </div>

          <div className="rb-group">
            <label className="rb-label">Barangay Scope</label>
            <div className="rb-hint">No selection = whole city. Pick barangays to focus the map on those borders only.</div>
            <div className="rb-chips">
              <button
                type="button"
                className={`rb-chip ${scope.length === 0 ? 'on' : ''}`}
                onClick={() => setScope([])}
              >
                Whole City
              </button>
              {BARANGAYS.map((b) => (
                <button
                  type="button"
                  key={b}
                  className={`rb-chip ${scope.includes(b) ? 'on' : ''}`}
                  onClick={() => toggleScope(b)}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          <div className="rb-group">
            <label className="rb-label">Sections</label>
            <div className="rb-checks">
              {SECTIONS.map((s) => (
                <label key={s.key} className="rb-check">
                  <input type="checkbox" checked={sections[s.key]} onChange={() => toggleSection(s.key)} />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="rb-group">
            <label className="rb-label">Map Overlays</label>
            <div className="rb-checks">
              {MAP_OPTS.map((o) => (
                <label key={o.key} className="rb-check">
                  <input type="checkbox" checked={mapOpts[o.key]} onChange={() => toggleMapOpt(o.key)} />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          </div>

          <button type="button" className="rb-generate" onClick={() => window.print()}>
            <PrintIcon /> Generate PDF
          </button>
          <div className="rb-foot">Tip: in the print dialog choose “Save as PDF”. Set margins to Default and enable “Background graphics”.</div>
        </aside>

        {/* ── Live document preview (this is what prints) ── */}
        <div className="report-stage">
          <div className="report-doc" id="report-doc">
            {/* Letterhead */}
            <header className="rd-header">
              <img className="rd-logo" src="/cdrrmo-logo.png" alt="CDRRMO logo" />
              <div className="rd-org">
                <div className="rd-org-name">City Disaster Risk Reduction &amp; Management Office</div>
                <div className="rd-org-sub">City of Cabuyao, Province of Laguna · FloodRoute Command Center</div>
              </div>
              <div className="rd-seal">CDRRMO</div>
            </header>
            <div className="rd-rule" />

            {/* Title block */}
            <div className="rd-titleblock">
              <h1 className="rd-title">{title}</h1>
              <div className="rd-meta">
                <span><b>Scope:</b> {scopeLabel}</span>
                <span><b>Generated:</b> {generatedAt} PHT</span>
                <span><b>Prepared by:</b> {preparedBy}</span>
                <span><b>Prepared for:</b> {preparedFor}</span>
              </div>
            </div>

            {/* Executive summary */}
            {sections.summary && (
              <ReportSection title="Executive Summary">
                <div className="rd-stats">
                  <Stat n={fAreas.length} l="Flood-prone areas" />
                  <Stat n={roadLines.filter((r) => r.status === 'blocked').length} l="Roads closed" />
                  <Stat n={roadLines.filter((r) => r.status === 'flooded').length} l="Roads flooded" />
                  <Stat n={evac.filter((c) => c.status !== 'closed').length} l="Evac centres open" />
                  <Stat n={activeAlerts.length} l="Active alerts" />
                  <Stat n={openIncidents.length} l="Open incidents" />
                </div>
                <p className="rd-para">
                  This report consolidates the current flood and road situation for{' '}
                  {scope.length === 0 ? 'the entire City of Cabuyao' : scope.join(', ')}. It documents{' '}
                  {fAreas.length} known flood-prone {fAreas.length === 1 ? 'area' : 'areas'} (depths recorded in feet),
                  {' '}{roadLines.length} flagged road {roadLines.length === 1 ? 'segment' : 'segments'}, and{' '}
                  {evac.length} registered evacuation {evac.length === 1 ? 'centre' : 'centres'}. Deepest documented
                  flooding on record:{' '}
                  <b>{Math.max(0, ...fAreas.map((a) => Number(a.depthFt) || 0)) || '—'} ft</b>.
                </p>
              </ReportSection>
            )}

            {/* Situation map */}
            {sections.map && (
              <ReportSection title="Situation Map">
                <ReportMap
                  scope={scope}
                  opts={mapOpts}
                  samples={scopedSamples}
                  floodAreas={fAreas}
                  evac={evac}
                  roadLines={roadLines}
                />
                <div className="rd-maplegend">
                  {mapOpts.floodAreas && ['high', 'moderate', 'low'].map((k) => (
                    <span key={k} className="rd-leg"><i style={{ background: FLOOD_SEVERITY_META[k].color }} />Flood {FLOOD_SEVERITY_META[k].label}</span>
                  ))}
                  {mapOpts.roads && <><span className="rd-leg"><i style={{ background: ROAD_STATUS.blocked.swatch }} />Road closed</span><span className="rd-leg"><i style={{ background: ROAD_STATUS.flooded.swatch }} />Road flooded</span></>}
                  {mapOpts.evac && <span className="rd-leg"><i style={{ background: '#16a34a' }} />Evacuation centre</span>}
                </div>
              </ReportSection>
            )}

            {/* Flood-prone areas */}
            {sections.floodAreas && (
              <ReportSection title={`Flood-Prone Areas (${fAreas.length})`}>
                {fAreas.length === 0 ? <Empty /> : (
                  <table className="rd-table">
                    <thead>
                      <tr><th>Area / Road</th><th>Barangay</th><th>Depth</th><th>Type</th><th>Cause</th><th>Recorded under</th></tr>
                    </thead>
                    <tbody>
                      {[...fAreas].sort((a, b) => (Number(b.depthFt) || 0) - (Number(a.depthFt) || 0)).map((a) => {
                        const meta = FLOOD_SEVERITY_META[floodSeverity(a)]
                        return (
                          <tr key={a.id}>
                            <td className="rd-strong">{a.name}</td>
                            <td>{a.barangay}</td>
                            <td><span className="rd-depth" style={{ color: meta.color }}>{formatFloodDepth(a)}</span></td>
                            <td>{FLOOD_TYPE_LABEL[a.type]}</td>
                            <td>{(a.causes || []).join(', ') || '—'}</td>
                            <td>{a.sourceStorms || '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </ReportSection>
            )}

            {/* Road conditions */}
            {sections.roads && (
              <ReportSection title={`Road Conditions (${roadLines.length})`}>
                {roadLines.length === 0 ? <Empty msg="No roads currently flagged flooded or closed." /> : (
                  <table className="rd-table">
                    <thead><tr><th>Road</th><th>Condition</th><th>Flood depth</th></tr></thead>
                    <tbody>
                      {[...roadLines].sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
                        <tr key={r.id}>
                          <td className="rd-strong">{r.name}</td>
                          <td><span className="rd-badge" style={{ background: ROAD_STATUS[r.status]?.swatch }}>{ROAD_STATUS[r.status]?.label}</span></td>
                          <td>{r.depthFt != null ? `${r.depthFt} ft` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ReportSection>
            )}

            {/* Evacuation centres */}
            {sections.evac && (
              <ReportSection title={`Evacuation Centres (${evac.length})`}>
                {evac.length === 0 ? <Empty /> : (
                  <table className="rd-table">
                    <thead><tr><th>Centre</th><th>Barangay</th><th>Capacity</th><th>Occupancy</th><th>Status</th></tr></thead>
                    <tbody>
                      {[...evac].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                        <tr key={c.id}>
                          <td className="rd-strong">{c.name}</td>
                          <td>{c.barangay}</td>
                          <td>{(c.capacity || 0).toLocaleString()}</td>
                          <td>{(c.occupancy || 0).toLocaleString()}</td>
                          <td><span className={`rd-status ${c.status}`}>{c.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ReportSection>
            )}

            {/* Active alerts */}
            {sections.alerts && (
              <ReportSection title={`Active Alerts (${activeAlerts.length})`}>
                {activeAlerts.length === 0 ? <Empty msg="No active flood alerts." /> : (
                  <table className="rd-table">
                    <thead><tr><th>Level</th><th>Title</th><th>Barangay</th><th>Issued</th></tr></thead>
                    <tbody>
                      {activeAlerts.map((a) => (
                        <tr key={a.id}>
                          <td><span className={`rd-lvl ${a.level}`}>{a.level}</span></td>
                          <td className="rd-strong">{a.title}</td>
                          <td>{a.barangay}</td>
                          <td>{a.issued}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ReportSection>
            )}

            {/* Open incidents */}
            {sections.incidents && (
              <ReportSection title={`Open Incidents (${openIncidents.length})`}>
                {openIncidents.length === 0 ? <Empty msg="No open incidents." /> : (
                  <table className="rd-table">
                    <thead><tr><th>Type</th><th>Barangay</th><th>Priority</th><th>Status</th><th>Team</th></tr></thead>
                    <tbody>
                      {openIncidents.map((i) => (
                        <tr key={i.id}>
                          <td className="rd-strong">{i.type}</td>
                          <td>{i.barangay}</td>
                          <td><span className={`rd-lvl ${i.priority === 'critical' || i.priority === 'high' ? 'high' : 'moderate'}`}>{i.priority}</span></td>
                          <td>{i.status}</td>
                          <td>{i.team || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ReportSection>
            )}

            {/* Barangay risk table */}
            {sections.barangays && (
              <ReportSection title="Barangay Flood-Risk Summary">
                <table className="rd-table">
                  <thead><tr><th>Barangay</th><th>Risk level</th><th>Modelled depth</th></tr></thead>
                  <tbody>
                    {[...scopedSamples].sort((a, b) => b.floodDepth - a.floodDepth).map((b) => {
                      const lvl = levelFromDepth(b.floodDepth)
                      return (
                        <tr key={b.name}>
                          <td className="rd-strong">{b.name}</td>
                          <td><span className={`rd-lvl ${lvl}`}>{RISK_META[lvl].label}</span></td>
                          <td>{b.floodDepth.toFixed(2)} m</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </ReportSection>
            )}

            <footer className="rd-footer">
              <span>CDRRMO Cabuyao City · FloodRoute · Generated {generatedAt} PHT</span>
              <span>This is a system-generated situational report. Conditions change rapidly — verify on the ground.</span>
            </footer>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

/* ============================================================
   Vector situation map — real Cabuyao barangay boundaries (SVG), so it
   prints sharp. Flood-prone areas, road conditions and evac centres are
   projected onto the same canvas.
   ============================================================ */
const MAP_W = 820
const MAP_H = 560
const MAP_PAD = 16

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
  // pad ~8%
  const padLat = (n - s) * 0.08 || 0.005
  const padLng = (e - w) * 0.08 || 0.005
  return { s: s - padLat, w: w - padLng, n: n + padLat, e: e + padLng }
}

function ReportMap({ scope, opts, samples, floodAreas, evac, roadLines }) {
  const bbox = useMemo(() => unionBounds(scope), [scope])

  const project = useMemo(() => {
    const latMid = (bbox.s + bbox.n) / 2
    const kx = Math.cos((latMid * Math.PI) / 180)
    const geoW = (bbox.e - bbox.w) * kx
    const geoH = bbox.n - bbox.s
    const sc = Math.min((MAP_W - 2 * MAP_PAD) / geoW, (MAP_H - 2 * MAP_PAD) / geoH)
    const offX = MAP_PAD + ((MAP_W - 2 * MAP_PAD) - geoW * sc) / 2
    const offY = MAP_PAD + ((MAP_H - 2 * MAP_PAD) - geoH * sc) / 2
    return ([lat, lng]) => [
      offX + (lng - bbox.w) * kx * sc,
      offY + (bbox.n - lat) * sc,
    ]
  }, [bbox])

  const ringToPath = (ring) => `M${ring.map((pt) => project(pt).map((n) => n.toFixed(1)).join(',')).join('L')}Z`

  // Risk colour per barangay name (for shading).
  const levelByName = useMemo(() => {
    const m = {}
    samples.forEach((b) => { m[b.name] = levelFromDepth(b.floodDepth) })
    return m
  }, [samples])

  const inScope = (name) => scope.length === 0 || scope.includes(name)

  return (
    <svg className="rd-map" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="Cabuyao situation map">
      <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="#f4f1ea" />

      {/* Barangay polygons */}
      {opts.boundaries && BARANGAY_FEATURES.features.map((f) => {
        const name = f.properties.name
        const focus = inScope(name)
        const rings = barangayOuterRings(name)
        const fill = opts.barangayRisk && focus
          ? RISK_META[levelByName[name] || 'safe'].color
          : '#ffffff'
        const fillOpacity = opts.barangayRisk && focus ? 0.35 : (focus ? 0.9 : 0.25)
        return (
          <g key={name}>
            {rings.map((ring, i) => (
              <path
                key={i}
                d={ringToPath(ring)}
                fill={fill}
                fillOpacity={fillOpacity}
                stroke={focus ? '#1a2a4a' : '#c9c3b8'}
                strokeWidth={focus ? 1.1 : 0.5}
              />
            ))}
          </g>
        )
      })}

      {/* Barangay labels (scope only, to avoid clutter) */}
      {opts.boundaries && BARANGAY_FEATURES.features.filter((f) => inScope(f.properties.name)).map((f) => {
        const [x, y] = project(f.properties.center)
        return (
          <text key={f.properties.name} x={x} y={y} className="rd-map-lbl" textAnchor="middle">
            {f.properties.name}
          </text>
        )
      })}

      {/* Road conditions */}
      {opts.roads && roadLines.map((r) => (
        <polyline
          key={r.id}
          points={r.latlngs.map((pt) => project(pt).join(',')).join(' ')}
          fill="none"
          stroke={ROAD_STATUS[r.status]?.swatch || '#f97316'}
          strokeWidth={r.status === 'blocked' ? 2.6 : 2.2}
          strokeLinecap="round"
          strokeDasharray={r.status === 'blocked' ? 'none' : '5 4'}
          opacity="0.95"
        />
      ))}

      {/* Evacuation centres */}
      {opts.evac && evac.filter((c) => Array.isArray(c.coords)).map((c) => {
        const [x, y] = project(c.coords)
        const color = c.status === 'closed' ? '#dc2626' : c.status === 'full' ? '#f97316' : '#16a34a'
        return <rect key={c.id} x={x - 3.5} y={y - 3.5} width="7" height="7" rx="1.5" fill={color} stroke="#fff" strokeWidth="1" />
      })}

      {/* Flood-prone areas */}
      {opts.floodAreas && floodAreas.filter((a) => Array.isArray(a.coords)).map((a) => {
        const [x, y] = project(a.coords)
        const meta = FLOOD_SEVERITY_META[floodSeverity(a)]
        const r = { high: 6, moderate: 5, low: 4 }[floodSeverity(a)]
        return <circle key={a.id} cx={x} cy={y} r={r} fill={meta.color} fillOpacity="0.9" stroke="#fff" strokeWidth="1.2" />
      })}
    </svg>
  )
}

/* ── Small building blocks ───────────────────────────────────────────────── */
function ReportSection({ title, children }) {
  return (
    <section className="rd-section">
      <h2 className="rd-sec-title">{title}</h2>
      {children}
    </section>
  )
}
function Stat({ n, l }) {
  return (
    <div className="rd-stat">
      <div className="rd-stat-n">{n}</div>
      <div className="rd-stat-l">{l}</div>
    </div>
  )
}
function Empty({ msg = 'No records for this scope.' }) {
  return <div className="rd-empty">{msg}</div>
}
function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}
