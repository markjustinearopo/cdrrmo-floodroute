import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../../components/admin/mapHelpers.jsx'
import {
  ROAD_STATUS,
  RoadNetworkLayer,
  useCabuyaoRoads,
  useRoadStatus,
} from '../../components/admin/routingHelpers.jsx'
import { MapViewToggle, use3DPreference } from '../../components/admin/Map3D.jsx'
import RoadNetwork3DView from '../../components/admin/RoadNetwork3DView.jsx'
import { useRoadRequests } from '../../context/AdminDataContext.jsx'
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

export default function RoadStatus() {
  const { roads } = useCabuyaoRoads()
  const [statusMap, { setStatus, clearAll }] = useRoadStatus()
  const { roadChangeRequests, approveRoadRequest, rejectRoadRequest } = useRoadRequests()
  const [brush, setBrush] = useState('flooded')
  const [coords, setCoords] = useState(null)
  const [use3D, setUse3D] = use3DPreference()
  const [rejectId, setRejectId] = useState(null)
  const [rejectNote, setRejectNote] = useState('')

  // Barangay-submitted requests awaiting a decision (oldest first — first in, first reviewed).
  const pendingReqs = useMemo(
    () => roadChangeRequests
      .filter((r) => r.status === 'pending')
      .sort((a, b) => (a.requestedAt || 0) - (b.requestedAt || 0)),
    [roadChangeRequests],
  )

  // Toggle: clicking a road already set to the active brush clears it.
  function paint(props) {
    const current = statusMap[props.id]
    setStatus(props.id, current === brush ? 'open' : brush)
  }

  const counts = useMemo(() => {
    const c = { flooded: 0, blocked: 0 }
    Object.values(statusMap).forEach((s) => {
      if (c[s] != null) c[s]++
    })
    const total = roads?.features.length || 0
    return { ...c, total, open: Math.max(total - c.flooded - c.blocked, 0) }
  }, [statusMap, roads])

  // Flagged roads (non-passable), resolved to their names for the side list.
  const flagged = useMemo(() => {
    if (!roads) return []
    const byId = new Map(roads.features.map((f) => [String(f.properties.id), f.properties]))
    return Object.entries(statusMap)
      .map(([id, status]) => ({ id, status, name: byId.get(String(id))?.name || `Road #${id}` }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [statusMap, roads])

  return (
    <AdminLayout mainClassName="main--flush">
      <div className="road-status">
        {/* ── Toolbar ── */}
        <div className="rs-toolbar">
          <div className="rs-title">
            <RoadIcon />
            <span>Road Status</span>
          </div>

          <div className="rs-brushes">
            <span className="rs-brush-label">Tag roads as</span>
            {BRUSHES.map((b) => (
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

          <MapViewToggle value={use3D} onChange={setUse3D} />
        </div>

        {/* ── Body: map + panel ── */}
        <div className="rs-body">
          <div className="rs-map-area">
            {use3D ? (
              /* Same network, same statusMap, same click-to-paint — on terrain. */
              <RoadNetwork3DView
                statusMap={statusMap}
                interactive
                onPick={paint}
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
              {roads && <RoadNetworkLayer roads={roads} statusMap={statusMap} onPick={paint} />}
              <CoordReadout onChange={setCoords} />
            </MapContainer>
            )}

            {roads && (
              <div className="rs-paint-hint">
                <BrushIcon />
                Click a road to mark it <b style={{ color: ROAD_STATUS[brush].swatch }}>{ROAD_STATUS[brush].label}</b>
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
            {/* Barangay road-change requests — approve to paint the live map. */}
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

            {/* Summary */}
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

            {/* Legend */}
            <section className="rs-section">
              <h3 className="rs-section-title">Legend</h3>
              <div className="rs-legend">
                {Object.entries(ROAD_STATUS).map(([key, m]) => (
                  <div className="rs-legend-row" key={key}>
                    <span className="rs-legend-line" style={{ background: m.line, opacity: key === 'open' ? 0.6 : 1 }} />
                    <span className="rs-legend-name">{m.label}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Flagged roads */}
            <section className="rs-section rs-section--grow">
              <div className="rs-flagged-head">
                <h3 className="rs-section-title">
                  Flagged Roads
                  {flagged.length > 0 && <span className="rs-pill">{flagged.length}</span>}
                </h3>
                {flagged.length > 0 && (
                  <button type="button" className="rs-clear" onClick={clearAll}>
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
                      <span className="rs-flagged-name" title={r.name}>{r.name}</span>
                      <span className={`rs-badge ${r.status}`}>{ROAD_STATUS[r.status].label}</span>
                      <button
                        type="button"
                        className="rs-flagged-x"
                        title="Set passable"
                        onClick={() => setStatus(r.id, 'open')}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rs-section rs-note">
              <SparkIcon />
              <span>
                Conditions are set manually. Automatic flood-aware classification from
                the hazard model is a planned study.
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
