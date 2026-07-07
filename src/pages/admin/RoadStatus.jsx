import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../../components/admin/mapHelpers.jsx'
import {
  ROAD_STATUS,
  TRAFFIC_STATUS,
  RoadNetworkLayer,
  useCabuyaoRoads,
  useRoadStatus,
  useTrafficStatus,
} from '../../components/admin/routingHelpers.jsx'
import { MapViewToggle, use3DPreference } from '../../components/admin/Map3D.jsx'
import RoadNetwork3DView from '../../components/admin/RoadNetwork3DView.jsx'
import RoadConditionModal from '../../components/admin/RoadConditionModal.jsx'
import { useRoadRequests, useRoadReports } from '../../context/AdminDataContext.jsx'
import { barangayForPoint } from '../../data/cabuyaoBarangays.js'
import './Manage.css'
import './RoadStatus.css'

/**
 * CDRRMO Admin — Road Status.
 *
 * The COMPLETE Cabuyao road network (every street in the city, from
 * OpenStreetMap/Overpass, bundled by scripts/fetch-roads.mjs) is rendered as
 * clickable segments. The admin picks a "brush" — Flooded or Closed — then
 * clicks roads to tag their condition; clicking a road with the active brush
 * again clears it. This is the MANUAL road-condition board; an automatic
 * classifier from the flood model is a later study.
 *
 * Conditions persist client-side (localStorage via routingHelpers) so they
 * survive a refresh and feed the Override Routes screen as a hazard overlay.
 */
const BRUSHES = [
  { key: 'flooded', label: 'Flooded', hint: 'Passable with caution / rising water' },
  { key: 'blocked', label: 'Closed', hint: 'Impassable — do not route here' },
]

// Traffic brushes — the congestion board. Levels & order mirror TRAFFIC_STATUS.
const TRAFFIC_BRUSHES = Object.entries(TRAFFIC_STATUS).map(([key, m]) => ({
  key,
  label: m.label,
  hint: m.hint,
}))

export default function RoadStatus() {
  const { roads } = useCabuyaoRoads()
  const [statusMap, { setStatus, clearAll }] = useRoadStatus()
  const [trafficMap, { setTraffic, clearAllTraffic }] = useTrafficStatus()
  const { roadChangeRequests, approveRoadRequest, rejectRoadRequest } = useRoadRequests()
  const { roadReports, reportRoad, removeRoadReport } = useRoadReports()
  const [mode, setMode] = useState('condition') // 'condition' (flood) | 'traffic'
  const [brush, setBrush] = useState('flooded')
  const [trafficBrush, setTrafficBrush] = useState('moderate')
  const [coords, setCoords] = useState(null)
  const [use3D, setUse3D] = use3DPreference()
  const [rejectId, setRejectId] = useState(null)
  const [rejectNote, setRejectNote] = useState('')
  const [editing, setEditing] = useState(null) // road-condition editor

  const isTraffic = mode === 'traffic'

  // Click a road in Traffic mode → toggle its congestion level. Clicking with
  // the active brush again clears it (same feel as the flood brush).
  function paintTraffic(props) {
    const id = props.id
    setTraffic(id, trafficMap[id] === trafficBrush ? 'clear' : trafficBrush)
  }

  // The map's pick handler depends on the active mode.
  const handlePick = isTraffic ? paintTraffic : openEditor

  // Way-id → feature lookup (barangay attribution from the road midpoint).
  const roadById = useMemo(() => {
    const m = new Map()
    if (roads) roads.features.forEach((f) => m.set(String(f.properties.id), f))
    return m
  }, [roads])

  // Way-id → persisted report (depth in feet + note) for prefill + display.
  const reportByWay = useMemo(() => {
    const m = new Map()
    roadReports.forEach((r) => { if (r.wayId != null) m.set(String(r.wayId), r) })
    return m
  }, [roadReports])

  function barangayForRoad(id) {
    const f = roadById.get(String(id))
    const c = f?.geometry?.coordinates
    if (!c || !c.length) return ''
    const mid = c[Math.floor(c.length / 2)] // [lng, lat]
    return mid ? barangayForPoint(mid[1], mid[0]) : ''
  }

  // Click a road → open the condition editor (status + depth in feet + note).
  function openEditor(props) {
    const existing = reportByWay.get(String(props.id))
    setEditing({
      wayId: props.id,
      name: props.name || existing?.name || `Road #${props.id}`,
      barangay: existing?.barangay || barangayForRoad(props.id),
      status: statusMap[props.id] || brush, // 'flooded' | 'blocked'
      depthFt: existing?.depthFt ?? '',
      reason: existing?.reason || '',
    })
  }

  // Persist a road condition: clear, or paint + store depth/details (Supabase).
  function saveCondition(data) {
    if (data.status === 'open') {
      const existing = reportByWay.get(String(data.wayId))
      if (existing) removeRoadReport(existing.id)
      else setStatus(data.wayId, 'open')
    } else {
      reportRoad({
        wayId: data.wayId,
        name: data.name,
        barangay: data.barangay,
        status: data.status === 'blocked' ? 'closed' : 'caution',
        depthFt: data.depthFt === '' ? undefined : Math.max(0, Number(data.depthFt)),
        reason: data.reason,
        reportedBy: 'CDRRMO',
      })
    }
    setEditing(null)
  }

  // Clear everything: drop the persisted reports too, so the 6s mirror can't
  // repaint them from the database.
  function clearAllConditions() {
    roadReports.filter((r) => r.wayId != null).forEach((r) => removeRoadReport(r.id))
    clearAll()
  }

  // Barangay-submitted requests awaiting a decision (oldest first — first in, first reviewed).
  const pendingReqs = useMemo(
    () => roadChangeRequests
      .filter((r) => r.status === 'pending')
      .sort((a, b) => (a.requestedAt || 0) - (b.requestedAt || 0)),
    [roadChangeRequests],
  )

  const counts = useMemo(() => {
    const c = { flooded: 0, blocked: 0 }
    Object.values(statusMap).forEach((s) => {
      if (c[s] != null) c[s]++
    })
    const total = roads?.features.length || 0
    return { ...c, total, open: Math.max(total - c.flooded - c.blocked, 0) }
  }, [statusMap, roads])

  // Traffic tallies + the congested-roads list (mirrors the flood summary/flagged).
  const trafficCounts = useMemo(() => {
    const c = { light: 0, moderate: 0, heavy: 0, gridlock: 0 }
    Object.values(trafficMap).forEach((s) => { if (c[s] != null) c[s]++ })
    const flagged = c.light + c.moderate + c.heavy + c.gridlock
    const total = roads?.features.length || 0
    return { ...c, flagged, total, clear: Math.max(total - flagged, 0) }
  }, [trafficMap, roads])

  const congested = useMemo(() => {
    if (!roads) return []
    const byId = new Map(roads.features.map((f) => [String(f.properties.id), f.properties]))
    return Object.entries(trafficMap)
      .map(([id, level]) => ({
        id,
        level,
        name: byId.get(String(id))?.name || `Road #${id}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [trafficMap, roads])

  // Flagged roads (non-passable), resolved to their names + recorded depth.
  const flagged = useMemo(() => {
    if (!roads) return []
    const byId = new Map(roads.features.map((f) => [String(f.properties.id), f.properties]))
    return Object.entries(statusMap)
      .map(([id, status]) => {
        const rep = reportByWay.get(String(id))
        return {
          id,
          status,
          name: rep?.name || byId.get(String(id))?.name || `Road #${id}`,
          depthFt: rep?.depthFt,
          reason: rep?.reason,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [statusMap, roads, reportByWay])

  return (
    <AdminLayout mainClassName="main--flush">
      <div className="road-status">
        {/* ── Toolbar ── */}
        <div className="rs-toolbar">
          <div className="rs-title">
            <RoadIcon />
            <span>Road Status</span>
          </div>

          {/* Conditions (flood) ⇄ Traffic (congestion) — two independent boards. */}
          <div className="rs-mode-seg" role="tablist" aria-label="Board">
            <button
              type="button"
              role="tab"
              aria-selected={!isTraffic}
              className={`rs-mode ${!isTraffic ? 'active' : ''}`}
              onClick={() => setMode('condition')}
            >
              Conditions
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isTraffic}
              className={`rs-mode ${isTraffic ? 'active' : ''}`}
              onClick={() => setMode('traffic')}
            >
              Traffic
            </button>
          </div>

          <div className="rs-brushes">
            <span className="rs-brush-label">Tag roads as</span>
            {isTraffic
              ? TRAFFIC_BRUSHES.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    className={`rs-brush ${trafficBrush === b.key ? 'active' : ''}`}
                    style={{ '--c': TRAFFIC_STATUS[b.key].swatch }}
                    onClick={() => setTrafficBrush(b.key)}
                    title={b.hint}
                  >
                    <span className="rs-brush-dot" />
                    {b.label}
                  </button>
                ))
              : BRUSHES.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    className={`rs-brush ${brush === b.key ? 'active' : ''}`}
                    style={{ '--c': ROAD_STATUS[b.key].swatch }}
                    onClick={() => setBrush(b.key)}
                    title={b.hint}
                  >
                    <span className="rs-brush-dot" />
                    {b.label}
                  </button>
                ))}
          </div>

          <div className="rs-source">
            <span className="rs-source-dot" />
            OpenStreetMap · {roads ? `${roads.features.length.toLocaleString()} roads — full city network` : 'Overpass'}
          </div>

          {/* The traffic board is a precise 2D painting surface; the 3D twin
              stays the flood-condition view. */}
          {!isTraffic && <MapViewToggle value={use3D} onChange={setUse3D} />}
        </div>

        {/* ── Body: map + panel ── */}
        <div className="rs-body">
          <div className="rs-map-area">
            {use3D && !isTraffic ? (
              /* Same network, same statusMap, same click-to-paint — on terrain. */
              <RoadNetwork3DView
                statusMap={statusMap}
                interactive
                onPick={openEditor}
                onViewChange={setCoords}
              />
            ) : (
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              className="rs-leaflet"
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.8} />
              <ZoomControl position="bottomright" />
              <CabuyaoLock />
              {roads && (
                <RoadNetworkLayer
                  roads={roads}
                  statusMap={statusMap}
                  trafficMap={trafficMap}
                  view={mode}
                  onPick={handlePick}
                />
              )}
              <CoordReadout onChange={setCoords} />
            </MapContainer>
            )}

            {roads && (
              <div className="rs-paint-hint">
                <BrushIcon />
                {isTraffic ? (
                  <>Click a road to set congestion — defaults to <b style={{ color: TRAFFIC_STATUS[trafficBrush].swatch }}>{TRAFFIC_STATUS[trafficBrush].label}</b></>
                ) : (
                  <>Click a road to set its condition &amp; flood depth — defaults to <b style={{ color: ROAD_STATUS[brush].swatch }}>{ROAD_STATUS[brush].label}</b></>
                )}
              </div>
            )}

            <div className="rs-coords">
              {coords
                ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E | Zoom: ${coords.zoom}`
                : 'No map data'}
            </div>
          </div>

          {/* ── Right panel ── */}
          <aside className="rs-panel">
            {/* Barangay road-change requests — approve to paint the live map.
                Flood/closure requests only; hidden on the traffic board. */}
            {!isTraffic && (
            <section className="rs-section">
              <h3 className="rs-section-title">
                Pending Road Requests
                {pendingReqs.length > 0 && <span className="rs-pill rs-pill--pending">{pendingReqs.length}</span>}
              </h3>
              {pendingReqs.length === 0 ? (
                <div className="rs-empty">No requests awaiting review. Barangay-proposed road changes appear here for approval.</div>
              ) : (
                <ul className="rs-reqlist">
                  {pendingReqs.map((r) => (
                    <li className="rs-req rs-req--pending" key={r.id}>
                      <div className="rs-req-top">
                        <span className="rs-flagged-line" style={{ background: ROAD_STATUS[r.requestedStatus]?.swatch }} />
                        <span className="rs-req-name" title={r.roadName}>{r.roadName || `Road #${r.wayId}`}</span>
                        <span className={`rs-reqbadge ${r.requestedStatus === 'blocked' ? 'rejected' : 'pending'}`}>
                          {ROAD_STATUS[r.requestedStatus]?.label}
                        </span>
                      </div>
                      <div className="rs-req-meta">{r.barangay} · {r.requestedLabel}</div>
                      {r.reason && <div className="rs-req-reason">“{r.reason}”</div>}
                      <div className="rs-req-by">Requested by {r.requestedBy || r.barangay}</div>
                      <div className="rs-req-actions">
                        <button type="button" className="rs-act rs-act--approve" onClick={() => approveRoadRequest(r.id)}>
                          Approve
                        </button>
                        <button type="button" className="rs-act rs-act--reject" onClick={() => { setRejectId(r.id); setRejectNote('') }}>
                          Reject
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            )}

            {/* Summary */}
            {isTraffic ? (
              <section className="rs-section">
                <h3 className="rs-section-title">Traffic Overview</h3>
                <div className="rs-summary rs-summary--traffic">
                  <div className="rs-sum rs-sum--gridlock">
                    <div className="rs-sum-val">{trafficCounts.gridlock + trafficCounts.heavy}</div>
                    <div className="rs-sum-lbl">Heavy+</div>
                  </div>
                  <div className="rs-sum rs-sum--moderate">
                    <div className="rs-sum-val">{trafficCounts.moderate}</div>
                    <div className="rs-sum-lbl">Moderate</div>
                  </div>
                  <div className="rs-sum rs-sum--clear">
                    <div className="rs-sum-val">{trafficCounts.clear}</div>
                    <div className="rs-sum-lbl">Clear</div>
                  </div>
                </div>
                <div className="rs-total">Congestion penalises routes &amp; ETAs — the engine steers convoys around jams.</div>
              </section>
            ) : (
              <section className="rs-section">
                <h3 className="rs-section-title">Network Conditions</h3>
                <div className="rs-summary">
                  <div className="rs-sum rs-sum--blocked">
                    <div className="rs-sum-val">{counts.blocked}</div>
                    <div className="rs-sum-lbl">Closed</div>
                  </div>
                  <div className="rs-sum rs-sum--flooded">
                    <div className="rs-sum-val">{counts.flooded}</div>
                    <div className="rs-sum-lbl">Flooded</div>
                  </div>
                  <div className="rs-sum rs-sum--open">
                    <div className="rs-sum-val">{counts.open}</div>
                    <div className="rs-sum-lbl">Passable</div>
                  </div>
                </div>
                <div className="rs-total">{counts.total.toLocaleString()} road segments mapped — every street in Cabuyao</div>
              </section>
            )}

            {/* Legend */}
            <section className="rs-section">
              <h3 className="rs-section-title">Legend</h3>
              <div className="rs-legend">
                {isTraffic
                  ? Object.entries(TRAFFIC_STATUS).map(([key, m]) => (
                      <div className="rs-legend-row" key={key}>
                        <span className="rs-legend-line" style={{ background: m.line }} />
                        <span className="rs-legend-name">{m.label}</span>
                      </div>
                    ))
                  : Object.entries(ROAD_STATUS).map(([key, m]) => (
                      <div className="rs-legend-row" key={key}>
                        <span className="rs-legend-line" style={{ background: m.line, opacity: key === 'open' ? 0.6 : 1 }} />
                        <span className="rs-legend-name">{m.label}</span>
                      </div>
                    ))}
              </div>
            </section>

            {/* Flagged / congested list — the active board's tagged roads. */}
            {isTraffic ? (
              <section className="rs-section rs-section--grow">
                <div className="rs-flagged-head">
                  <h3 className="rs-section-title">
                    Congested Roads
                    {congested.length > 0 && <span className="rs-pill">{congested.length}</span>}
                  </h3>
                  {congested.length > 0 && (
                    <button type="button" className="rs-clear" onClick={clearAllTraffic}>
                      Clear all
                    </button>
                  )}
                </div>
                {congested.length === 0 ? (
                  <div className="rs-empty">No congestion tagged. Pick a level above and click roads on the map.</div>
                ) : (
                  <ul className="rs-flagged">
                    {congested.map((r) => (
                      <li className="rs-flagged-row" key={r.id}>
                        <span className="rs-flagged-line" style={{ background: TRAFFIC_STATUS[r.level].swatch }} />
                        <span className="rs-flagged-name">{r.name}</span>
                        <span className={`rs-badge rs-badge--traffic ${r.level}`} style={{ '--c': TRAFFIC_STATUS[r.level].swatch }}>
                          {TRAFFIC_STATUS[r.level].label}
                        </span>
                        <button
                          type="button"
                          className="rs-flagged-x"
                          title="Clear congestion"
                          onClick={() => setTraffic(r.id, 'clear')}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : (
              <section className="rs-section rs-section--grow">
                <div className="rs-flagged-head">
                  <h3 className="rs-section-title">
                    Flagged Roads
                    {flagged.length > 0 && <span className="rs-pill">{flagged.length}</span>}
                  </h3>
                  {flagged.length > 0 && (
                    <button type="button" className="rs-clear" onClick={clearAllConditions}>
                      Clear all
                    </button>
                  )}
                </div>
                {flagged.length === 0 ? (
                  <div className="rs-empty">No roads flagged. Pick a brush above and click roads on the map.</div>
                ) : (
                  <ul className="rs-flagged">
                    {flagged.map((r) => (
                      <li className="rs-flagged-row" key={r.id}>
                        <span className="rs-flagged-line" style={{ background: ROAD_STATUS[r.status].swatch }} />
                        <button
                          type="button"
                          className="rs-flagged-name rs-flagged-edit"
                          title="Edit condition &amp; depth"
                          onClick={() => openEditor({ id: r.id, name: r.name })}
                        >
                          {r.name}
                          {r.depthFt != null && <span className="rs-flagged-depth">{r.depthFt} ft</span>}
                        </button>
                        <span className={`rs-badge ${r.status}`}>{ROAD_STATUS[r.status].label}</span>
                        <button
                          type="button"
                          className="rs-flagged-x"
                          title="Set passable"
                          onClick={() => {
                            const rep = reportByWay.get(String(r.id))
                            if (rep) removeRoadReport(rep.id)
                            else setStatus(r.id, 'open')
                          }}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <section className="rs-section rs-note">
              <SparkIcon />
              <span>
                {isTraffic
                  ? 'Traffic is set manually and feeds the route engine — congested roads cost more and slow ETAs. A live Waze feed is a planned integration.'
                  : 'Conditions are set manually. Automatic flood-aware classification from the hazard model is a planned study.'}
              </span>
            </section>
          </aside>
        </div>
      </div>

      {rejectId && (
        <ConfirmDialog
          title="Reject this road request?"
          tone="danger"
          confirmLabel="Reject request"
          cancelLabel="Cancel"
          message={(
            <>
              <p style={{ margin: '0 0 10px' }}>The barangay will see this request was declined. Add a short reason (optional):</p>
              <textarea
                className="rs-reason"
                style={{ marginTop: 0 }}
                rows={3}
                placeholder="e.g. Verified passable on the ground — only minor puddling."
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                autoFocus
              />
            </>
          )}
          onConfirm={() => { rejectRoadRequest(rejectId, rejectNote.trim()); setRejectId(null) }}
          onCancel={() => setRejectId(null)}
        />
      )}

      {editing && (
        <RoadConditionModal
          road={editing}
          onClose={() => setEditing(null)}
          onSave={saveCondition}
        />
      )}
    </AdminLayout>
  )
}

/* ── Icons ──────────────────────────────────────────────────────────────── */
function RoadIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 21L8 3" />
      <path d="M20 21L16 3" />
      <line x1="12" y1="5" x2="12" y2="8" />
      <line x1="12" y1="11" x2="12" y2="14" />
      <line x1="12" y1="17" x2="12" y2="20" />
    </svg>
  )
}
function BrushIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
      <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
    </svg>
  )
}
function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    </svg>
  )
}
