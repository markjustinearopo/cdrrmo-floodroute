import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet'
import BarangayLayout from '../../components/barangay/BarangayLayout.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import {
  CABUYAO_CENTER,
  CABUYAO_ZOOM,
  CabuyaoLock,
  BarangayLock,
  JurisdictionToggle,
  CoordReadout,
} from '../../components/admin/mapHelpers.jsx'
import {
  ROAD_STATUS,
  RoadNetworkLayer,
  useCabuyaoRoads,
  useRoadStatus,
} from '../../components/admin/routingHelpers.jsx'
import { MapViewToggle, use3DPreference } from '../../components/admin/Map3D.jsx'
import RoadNetwork3DView from '../../components/admin/RoadNetwork3DView.jsx'
import { useRoadRequests } from '../../context/AdminDataContext.jsx'
import { officialBarangayLabel, getOfficialBarangay, useJurisdictionView } from '../../data/barangay.js'
import '../admin/RoadStatus.css'

/**
 * CDRRMO Barangay — Road Status (Routing).
 *
 * SAFETY MODEL: a barangay official can NOT change the live shared road map
 * directly. They PROPOSE changes — pick a brush (Flooded / Closed), click roads
 * to stage proposed edits (drawn dashed-purple = "pending"), then SUBMIT the
 * batch to CDRRMO. The command center reviews and approves each request before
 * it paints the live map that every portal reads. The live conditions shown
 * here are read-only.
 */
const BRUSHES = [
  { key: 'flooded', label: 'Flooded', hint: 'Passable with caution / rising water' },
  { key: 'blocked', label: 'Closed', hint: 'Impassable — do not route here' },
]

const REQ_BADGE = { pending: 'Pending', approved: 'Approved', rejected: 'Declined' }

export default function RoadStatus() {
  const brgyLabel = officialBarangayLabel()
  const myBrgy = getOfficialBarangay()
  const { roads } = useCabuyaoRoads()
  const [statusMap] = useRoadStatus() // live conditions, READ-ONLY here
  const { roadChangeRequests, submitRoadRequest, removeRoadRequest } = useRoadRequests()
  const [brush, setBrush] = useState('flooded')
  const [drafts, setDrafts] = useState([]) // [{ wayId, name, status }]
  const [reason, setReason] = useState('')
  const [confirmSend, setConfirmSend] = useState(false)
  const [coords, setCoords] = useState(null)
  const [use3D, setUse3D] = use3DPreference()
  const [view, setView] = useJurisdictionView()
  const locked = view === 'mine' && Boolean(myBrgy)

  // Stage/unstage a proposed edit. Clicking a road with the active brush again
  // removes it; clicking with a different brush re-targets it.
  function stage(props) {
    setDrafts((prev) => {
      const existing = prev.find((d) => d.wayId === props.id)
      if (existing && existing.status === brush) return prev.filter((d) => d.wayId !== props.id)
      const without = prev.filter((d) => d.wayId !== props.id)
      return [...without, { wayId: props.id, name: props.name, status: brush }]
    })
  }

  // The map shows live conditions plus the official's pending drafts on top
  // (rendered as the dashed-purple "pending" style so they read as proposals).
  const mapStatus = useMemo(() => {
    const merged = { ...statusMap }
    for (const d of drafts) merged[d.wayId] = 'pending'
    return merged
  }, [statusMap, drafts])

  const counts = useMemo(() => {
    const c = { flooded: 0, blocked: 0 }
    Object.values(statusMap).forEach((s) => { if (c[s] != null) c[s]++ })
    const total = roads?.features.length || 0
    return { ...c, total, open: Math.max(total - c.flooded - c.blocked, 0) }
  }, [statusMap, roads])

  // This official's own submitted requests, newest first.
  const myRequests = useMemo(
    () => roadChangeRequests
      .filter((r) => r.barangay === myBrgy)
      .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0)),
    [roadChangeRequests, myBrgy],
  )
  const pendingCount = useMemo(() => myRequests.filter((r) => r.status === 'pending').length, [myRequests])

  function sendDrafts() {
    drafts.forEach((d) => submitRoadRequest({
      wayId: d.wayId,
      roadName: d.name,
      barangay: myBrgy,
      requestedStatus: d.status,
      reason: reason.trim(),
      requestedBy: `Brgy. ${brgyLabel}`,
    }))
    setDrafts([])
    setReason('')
    setConfirmSend(false)
  }

  return (
    <BarangayLayout mainClassName="main--flush">
      <div className="road-status">
        <div className="rs-toolbar">
          <div className="rs-title">
            <RoadIcon />
            <span>Road Status · Brgy. {brgyLabel}</span>
          </div>

          <div className="rs-brushes">
            <span className="rs-brush-label">Propose</span>
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
            OpenStreetMap · {roads ? `${roads.features.length.toLocaleString()} roads` : 'Overpass'}
          </div>

          <JurisdictionToggle value={view} onChange={setView} brgyLabel={brgyLabel} />
          <MapViewToggle value={use3D} onChange={setUse3D} />
        </div>

        <div className="rs-body">
          <div className="rs-map-area">
            {use3D ? (
              <RoadNetwork3DView
                key={locked ? `b-${myBrgy}` : 'city'}
                statusMap={mapStatus}
                interactive
                onPick={stage}
                jurisdiction={locked ? myBrgy : null}
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
              {locked ? <BarangayLock name={myBrgy} /> : <CabuyaoLock />}
              {roads && <RoadNetworkLayer roads={roads} statusMap={mapStatus} onPick={stage} />}
              <CoordReadout onChange={setCoords} />
            </MapContainer>
            )}

            {roads && (
              <div className="rs-paint-hint">
                <BrushIcon />
                Click a road to propose it <b style={{ color: ROAD_STATUS[brush].swatch }}>{ROAD_STATUS[brush].label}</b>
              </div>
            )}

            <div className="rs-coords">
              {coords
                ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E | Zoom: ${coords.zoom}`
                : 'No map data'}
            </div>
          </div>

          <aside className="rs-panel">
            {/* Proposed edits awaiting submission */}
            <section className="rs-section">
              <div className="rs-flagged-head">
                <h3 className="rs-section-title">
                  Proposed Edits
                  {drafts.length > 0 && <span className="rs-pill rs-pill--pending">{drafts.length}</span>}
                </h3>
                {drafts.length > 0 && (
                  <button type="button" className="rs-clear" onClick={() => setDrafts([])}>Clear</button>
                )}
              </div>
              {drafts.length === 0 ? (
                <div className="rs-empty">Pick Flooded or Closed above, then click roads on the map to propose a change.</div>
              ) : (
                <>
                  <ul className="rs-flagged">
                    {drafts.map((d) => (
                      <li className="rs-flagged-row" key={d.wayId}>
                        <span className="rs-flagged-line" style={{ background: ROAD_STATUS[d.status].swatch }} />
                        <span className="rs-flagged-name" title={d.name}>{d.name || `Road #${d.wayId}`}</span>
                        <span className={`rs-badge ${d.status}`}>{ROAD_STATUS[d.status].label}</span>
                        <button
                          type="button"
                          className="rs-flagged-x"
                          title="Remove from proposal"
                          onClick={() => setDrafts((prev) => prev.filter((x) => x.wayId !== d.wayId))}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  <textarea
                    className="rs-reason"
                    placeholder="Reason / note for CDRRMO (optional) — e.g. waist-deep flooding near the creek"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                  />
                  <button type="button" className="rs-send" onClick={() => setConfirmSend(true)}>
                    Send {drafts.length} request{drafts.length > 1 ? 's' : ''} to CDRRMO
                  </button>
                </>
              )}
            </section>

            {/* This barangay's submitted requests + their decision status */}
            <section className="rs-section rs-section--grow">
              <h3 className="rs-section-title">
                My Requests
                {pendingCount > 0 && <span className="rs-pill rs-pill--pending">{pendingCount} pending</span>}
              </h3>
              {myRequests.length === 0 ? (
                <div className="rs-empty">No requests yet. Proposed changes you send appear here with their approval status.</div>
              ) : (
                <ul className="rs-reqlist">
                  {myRequests.slice(0, 30).map((r) => (
                    <li className={`rs-req rs-req--${r.status}`} key={r.id}>
                      <div className="rs-req-top">
                        <span className="rs-flagged-line" style={{ background: ROAD_STATUS[r.requestedStatus]?.swatch }} />
                        <span className="rs-req-name" title={r.roadName}>{r.roadName || `Road #${r.wayId}`}</span>
                        <span className={`rs-reqbadge ${r.status}`}>{REQ_BADGE[r.status]}</span>
                      </div>
                      <div className="rs-req-meta">
                        Proposed {ROAD_STATUS[r.requestedStatus]?.label} · {r.requestedLabel}
                      </div>
                      {r.reason && <div className="rs-req-reason">“{r.reason}”</div>}
                      {r.status === 'rejected' && r.decisionNote && (
                        <div className="rs-req-note">CDRRMO: {r.decisionNote}</div>
                      )}
                      {r.status !== 'pending' && (
                        <button type="button" className="rs-req-dismiss" onClick={() => removeRoadRequest(r.id)}>
                          Dismiss
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Live conditions (read-only) */}
            <section className="rs-section">
              <h3 className="rs-section-title">Live Conditions</h3>
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
              <div className="rs-total">Approved by CDRRMO — shared across all portals</div>
            </section>

            {/* Legend */}
            <section className="rs-section">
              <h3 className="rs-section-title">Legend</h3>
              <div className="rs-legend">
                {['blocked', 'flooded', 'open', 'pending'].map((key) => (
                  <div className="rs-legend-row" key={key}>
                    <span
                      className="rs-legend-line"
                      style={{ background: ROAD_STATUS[key].line, opacity: key === 'open' ? 0.6 : 1, borderTop: key === 'pending' ? '2px dashed #7C3AED' : undefined, ...(key === 'pending' ? { background: 'transparent', height: 0 } : {}) }}
                    />
                    <span className="rs-legend-name">{key === 'pending' ? 'Your proposal (pending)' : ROAD_STATUS[key].label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rs-section rs-note">
              <SparkIcon />
              <span>
                For everyone's safety, road condition changes you propose take effect only
                after CDRRMO reviews and approves them.
              </span>
            </section>
          </aside>
        </div>
      </div>

      {confirmSend && (
        <ConfirmDialog
          title="Send to CDRRMO?"
          tone="default"
          confirmLabel={`Send ${drafts.length} request${drafts.length > 1 ? 's' : ''}`}
          cancelLabel="Keep editing"
          message={(
            <>
              You're proposing <b>{drafts.length}</b> road condition change{drafts.length > 1 ? 's' : ''} for
              {' '}<b>Brgy. {brgyLabel}</b>. CDRRMO will review {drafts.length > 1 ? 'them' : 'it'} before
              {' '}{drafts.length > 1 ? 'they' : 'it'} appear{drafts.length > 1 ? '' : 's'} on the live map.
            </>
          )}
          onConfirm={sendDrafts}
          onCancel={() => setConfirmSend(false)}
        />
      )}
    </BarangayLayout>
  )
}

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
