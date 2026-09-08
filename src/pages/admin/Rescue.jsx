import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, ZoomControl, useMap } from 'react-leaflet'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import RecordList from '../../components/admin/RecordList.jsx'
import DialogOverlay from '../../components/DialogOverlay.jsx'
import { RESPONSE_TEAMS } from '../../data/cabuyao.js'
import { useRescueRequests, useSavedRoutes } from '../../context/AdminDataContext.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock } from '../../components/admin/mapHelpers.jsx'
import {
  getCabuyaoRoads, useRoadStatus, useTrafficStatus, RoadNetworkLayer, formatDistance,
} from '../../components/admin/routingHelpers.jsx'
import { getGraph, planRoute } from '../../components/admin/routeEngine.js'
import { useFloodRisk } from '../../components/admin/floodRisk.js'
import { describeDepth } from '../../services/depth.js'
import { RESCUE_STATUS_LABEL } from '../../services/db.js'
import RescueRequestsLayer from '../../components/admin/RescueRequestsLayer.jsx'
import '../../components/admin/rescueMarker.css'
import './Manage.css'
import './Rescue.css'

/**
 * CDRRMO Admin — Emergency Rescue Requests.
 *
 * The queue of people the routing engine could not get out. Every row here was
 * created by the system, not typed by anyone: a resident asked for a route,
 * every road out of where they are standing was flooded or closed, and the
 * request filed itself (see components/admin/routeSafety.js and
 * hooks/useRescueTrigger.js).
 *
 * What this screen has to answer, in order:
 *   WHERE is the person      → the map, their exact GPS, the accuracy circle
 *   WHY can't they move      → the flood/hazard snapshot and the blocked roads
 *   WHO is going             → team assignment
 *   WHERE ARE WE UP TO       → Pending → Responding → Rescued → Resolved
 *
 * Requests arrive in real time through the shared data layer (Supabase
 * realtime on rescue_requests, with the 6 s poll behind it), so this list and
 * the map update while it is open, without a refresh.
 */

const FILTERS = [
  { key: 'open', label: 'Open', test: (r) => r.status === 'pending' || r.status === 'responding' },
  { key: 'pending', label: 'Pending', test: (r) => r.status === 'pending' },
  { key: 'responding', label: 'Responding', test: (r) => r.status === 'responding' },
  { key: 'rescued', label: 'Rescued', test: (r) => r.status === 'rescued' },
  { key: 'all', label: 'All' },
]

/* Command center → the person. Flood-aware, congestion-aware, and driving:
   the responders take a vehicle even when the resident could not walk. */
function useResponseRouting() {
  const { field } = useFloodRisk()
  const [statusMap] = useRoadStatus()
  const [trafficMap] = useTrafficStatus()
  return { field, statusMap, trafficMap }
}

export default function Rescue() {
  const { rescueRequests, updateRescueRequest, removeRescueRequest } = useRescueRequests()
  const { addRoute } = useSavedRoutes()
  const { field, statusMap, trafficMap } = useResponseRouting()
  const [params, setParams] = useSearchParams()
  const [detailId, setDetailId] = useState(null)
  const [toast, setToast] = useState('')

  /* Deep link from the live alert card ("View on map") and from a map popup,
     so an operator lands on the request itself rather than on a list they then
     have to search. Consumed once, then cleared from the URL. */
  useEffect(() => {
    const id = params.get('id')
    if (!id) return
    const match = rescueRequests.find((r) => String(r.id) === String(id))
    if (match) {
      setDetailId(match.id)
      params.delete('id')
      setParams(params, { replace: true })
    }
  }, [params, rescueRequests, setParams])

  const detail = rescueRequests.find((r) => r.id === detailId) || null

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  function setStatus(id, status) {
    updateRescueRequest(id, { status })
    flash(`Request #${id} → ${RESCUE_STATUS_LABEL[status]}.`)
  }

  function assignTeam(id, team) {
    /* Assigning a team IS the act of responding — leaving the request Pending
       with a team on it would mean the dashboard's "waiting" count includes
       rescues already under way. Only ever advances: a team added to a
       finished request does not drag it back to Responding. */
    const current = rescueRequests.find((r) => r.id === id)
    const patch = { team }
    if (team && current?.status === 'pending') patch.status = 'responding'
    updateRescueRequest(id, patch)
  }

  function addNote(e) {
    e.preventDefault()
    const note = new FormData(e.currentTarget).get('note').trim()
    if (!note || !detail) return
    updateRescueRequest(detail.id, {}, note)
    e.target.reset()
  }

  /** Plan the response route: command center → the person who is cut off. */
  function routeToResident(r) {
    if (!Array.isArray(r.coords)) return flash('This request has no GPS position.')
    const graph = getGraph(getCabuyaoRoads())
    const plan = planRoute(graph, CABUYAO_CENTER, r.coords, {
      riskAt: field?.riskAt,
      statusMap,
      trafficMap,
    })
    /* The roads that stopped the RESIDENT walking out do not necessarily stop
       a rescue truck or a boat, so this is the ordinary response planner —
       and when it cannot find a way either, that is itself the answer the
       dispatcher needs (send a boat), stated plainly rather than hidden. */
    if (!plan.ok) {
      return flash('No drivable route to this location — every approach is closed. Water asset required.')
    }
    addRoute({
      name: `Rescue · ${r.reporter || 'Resident'} — ${r.barangay || 'Cabuyao'}`,
      type: 'response',
      points: [plan.start, plan.goal],
      path: plan.safe.coords,
      source: 'auto',
      destination: r.location || r.barangay,
      meanRisk: Number(plan.safe.meanRisk.toFixed(3)),
      rescueRequestId: r.id,
    })
    updateRescueRequest(r.id, {}, `Response route planned (${formatDistance(plan.safe.distanceM)})`)
    return flash(`Response route saved (${formatDistance(plan.safe.distanceM)}) — see Routing & Flood Map.`)
  }

  function remove(r) {
    removeRescueRequest(r.id)
    if (detailId === r.id) setDetailId(null)
    flash('Rescue request removed.')
  }

  const stats = useMemo(() => [
    { color: 'red', value: rescueRequests.filter((r) => r.status === 'pending').length, label: 'Pending' },
    { color: 'yellow', value: rescueRequests.filter((r) => r.status === 'responding').length, label: 'Responding' },
    { color: 'green', value: rescueRequests.filter((r) => r.status === 'rescued').length, label: 'Rescued' },
    { color: 'red', value: rescueRequests.filter((r) => r.status !== 'resolved').length, label: 'Open' },
  ], [rescueRequests])

  const columns = useMemo(() => [
    {
      key: 'who',
      header: 'Resident',
      render: (r) => (
        <>
          <button type="button" className="mng-cell-link" onClick={() => setDetailId(r.id)}>
            <span className="mng-strong">{r.reporter || 'Resident'}</span>
          </button>
          <div className="mng-muted" style={{ fontSize: '0.75rem' }}>
            {r.barangay ? `Brgy. ${r.barangay}` : 'Cabuyao City'}
          </div>
        </>
      ),
    },
    {
      key: 'coords',
      header: 'GPS Location',
      className: 'mng-num',
      render: (r) => (Array.isArray(r.coords) ? (
        <span className="rsc-coords">
          {r.coords[0].toFixed(5)}, {r.coords[1].toFixed(5)}
          {r.accuracyM != null && <em> ±{Math.round(r.accuracyM)} m</em>}
        </span>
      ) : <span className="mng-muted">No fix</span>),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (r) => (
        <>
          <span className="rsc-reason">
            {r.reason === 'no-safe-route' ? 'No safe route available' : r.reason}
          </span>
          {r.hazard?.maxDepthM ? (
            <div className="mng-muted" style={{ fontSize: '0.75rem' }}>
              {describeDepth(r.hazard.maxDepthM)}
            </div>
          ) : null}
        </>
      ),
    },
    {
      key: 'roads',
      header: 'Blocked Roads',
      render: (r) => (r.blockedRoads?.length
        ? <span className="rsc-roads">{r.blockedRoads.slice(0, 2).join(', ')}{r.blockedRoads.length > 2 ? ` +${r.blockedRoads.length - 2}` : ''}</span>
        : <span className="mng-muted">—</span>),
    },
    { key: 'requested', header: 'Requested', className: 'mng-muted mng-num', render: (r) => r.requested },
    {
      key: 'team',
      header: 'Team',
      render: (r) => (
        <select
          className={`mng-inline-select ${r.team ? '' : 'unset'}`}
          value={r.team || ''}
          onChange={(e) => assignTeam(r.id, e.target.value)}
          disabled={r.status === 'resolved'}
        >
          <option value="">— Assign team —</option>
          {RESPONSE_TEAMS.map((t) => <option key={t}>{t}</option>)}
        </select>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <span className={`rsc-badge ${r.status}`}>{RESCUE_STATUS_LABEL[r.status]}</span>,
    },
  ], [rescueRequests])

  const open = rescueRequests.filter((r) => r.status === 'pending' || r.status === 'responding')

  return (
    <AdminLayout>
      <div className="mng">
        <div className="mng-head">
          <div className="mng-head-titles">
            <div className="mng-head-icon rsc-head-icon">
              <svg viewBox="0 0 24 24">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div>
              <div className="mng-title">Emergency Rescue Requests</div>
              <div className="mng-sub">
                Raised automatically when a resident has no safe route out · live
              </div>
            </div>
          </div>
          {open.length > 0 && (
            <span className="rsc-open-pill">
              {open.length} awaiting rescue
            </span>
          )}
        </div>

        {/* The map first: the only question that matters on arrival is where
            these people are. Every open request is a pulsing marker. */}
        <div className="rsc-map-card">
          <div className="rsc-map-hdr">
            <span>Live rescue map</span>
            <span className="rsc-map-sub">
              {open.length === 0
                ? 'No one is currently awaiting rescue.'
                : 'Click a marker to open the request.'}
            </span>
          </div>
          <MapContainer
            center={CABUYAO_CENTER}
            zoom={CABUYAO_ZOOM}
            zoomControl={false}
            attributionControl={false}
            className="rsc-map"
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.9} />
            <ZoomControl position="bottomright" />
            <CabuyaoLock />
            {/* Live road conditions, so the closures around each marker are
                visible in the same picture as the person they trapped. */}
            <RoadNetworkLayer roads={getCabuyaoRoads()} statusMap={statusMap} interactive={false} />
            <RescueRequestsLayer
              requests={rescueRequests}
              showClosed
              onOpen={(r) => setDetailId(r.id)}
            />
            <FocusOn coords={detail?.coords} />
          </MapContainer>
        </div>

        <RecordList
          rows={rescueRequests}
          rowLabel={(r) => `${r.reporter || 'Resident'} (${r.barangay || 'Cabuyao'})`}
          stats={stats}
          filters={FILTERS}
          searchKeys={(r) => `${r.reporter} ${r.barangay} ${r.team} ${(r.blockedRoads || []).join(' ')}`}
          searchPlaceholder="Search resident, barangay, team or blocked road…"
          columns={columns}
          rowActions={(r) => [
            ...(r.status === 'pending' ? [{ label: 'Respond', onClick: () => setStatus(r.id, 'responding') }] : []),
            ...(r.status === 'responding' ? [{ label: 'Mark rescued', onClick: () => setStatus(r.id, 'rescued') }] : []),
            ...(r.status === 'rescued' ? [{ label: 'Resolve', onClick: () => setStatus(r.id, 'resolved') }] : []),
            ...(r.status === 'resolved' ? [{ label: 'Reopen', onClick: () => setStatus(r.id, 'pending'), subtle: true }] : []),
            { label: 'Route to resident', onClick: () => routeToResident(r), subtle: true },
          ]}
          onDelete={remove}
          deleteConfirm={(r) => ({
            title: 'Delete this rescue request?',
            message: `Delete the rescue request from ${r.reporter || 'a resident'} in Brgy. ${r.barangay || 'Cabuyao'}?`
              + ' It is the record of a person who could not get out. Resolve it instead unless it was a duplicate.'
              + ' This cannot be undone.',
            confirmLabel: 'Delete request',
          })}
          emptyAll={{
            title: 'No rescue requests',
            sub: 'Requests appear here automatically when a resident searches for a route and every road out is flooded or closed.',
          }}
          empty={{ title: 'No requests match this filter', sub: 'Try a different filter or clear your search.' }}
        />

        {/* Detail: the whole picture of one person. */}
        {detail && (
          <DialogOverlay className="mng-overlay" onDismiss={() => setDetailId(null)}>
            <div
              className="mng-modal rsc-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Rescue request details"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="mng-modal-head">
                <div>
                  <div className="mng-modal-title">
                    🚨 Rescue request #{detail.id}
                  </div>
                  <div className="mng-modal-sub">
                    {detail.reporter || 'Resident'} · {detail.barangay ? `Brgy. ${detail.barangay}` : 'Cabuyao City'}
                    {detail.contact ? ` · ${detail.contact}` : ''}
                  </div>
                </div>
                <button type="button" className="mng-modal-close" onClick={() => setDetailId(null)} aria-label="Close">×</button>
              </div>

              <div className="mng-form" style={{ gap: 12 }}>
                <div className="mng-detail-badges">
                  <span className={`rsc-badge ${detail.status}`}>{RESCUE_STATUS_LABEL[detail.status]}</span>
                  <span className="mng-muted" style={{ fontSize: '0.75rem' }}>
                    {detail.team ? `Team: ${detail.team}` : 'Unassigned'} · Requested {detail.requested}
                  </span>
                </div>

                {/* WHERE */}
                <section className="rsc-sect">
                  <div className="mng-detail-heading">Resident's location</div>
                  {Array.isArray(detail.coords) ? (
                    <>
                      <div className="rsc-big-coords">
                        {detail.coords[0].toFixed(5)}, {detail.coords[1].toFixed(5)}
                      </div>
                      <div className="mng-muted" style={{ fontSize: '0.75rem' }}>
                        {detail.accuracyM != null
                          ? `GPS accurate to about ${Math.round(detail.accuracyM)} m`
                          : 'GPS accuracy not reported'}
                        {detail.location ? ` · ${detail.location}` : ''}
                      </div>
                      <div className="rsc-detail-map">
                        <MapContainer
                          center={detail.coords}
                          zoom={17}
                          zoomControl={false}
                          attributionControl={false}
                          className="rsc-map rsc-map--sm"
                        >
                          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                          <ZoomControl position="bottomright" />
                          <RoadNetworkLayer roads={getCabuyaoRoads()} statusMap={statusMap} interactive={false} />
                          <RescueRequestsLayer requests={[detail]} showClosed />
                        </MapContainer>
                      </div>
                    </>
                  ) : (
                    <div className="mng-muted">No GPS position was recorded with this request.</div>
                  )}
                </section>

                {/* WHY */}
                <section className="rsc-sect">
                  <div className="mng-detail-heading">Why there was no route</div>
                  <div className="rsc-reason-line">
                    Reason: <b>{detail.reason === 'no-safe-route' ? 'No safe route available' : detail.reason}</b>
                  </div>
                  {detail.hazard?.summary && <p className="rsc-hazard">{detail.hazard.summary}</p>}
                  <div className="rsc-hazard-facts">
                    {detail.hazard?.maxDepthM != null && (
                      <span><b>Deepest water:</b> {describeDepth(detail.hazard.maxDepthM) || '—'}</span>
                    )}
                    {detail.hazard?.meanRisk != null && (
                      <span><b>Mean route risk:</b> {(detail.hazard.meanRisk * 100).toFixed(0)}%</span>
                    )}
                    {detail.hazard?.attempted?.length > 0 && (
                      <span><b>Shelters attempted:</b> {detail.hazard.attempted.length}</span>
                    )}
                  </div>
                  {(detail.hazard?.roads?.length || detail.blockedRoads?.length) > 0 && (
                    <>
                      <div className="mng-detail-heading" style={{ marginTop: 10 }}>Affected / blocked roads</div>
                      <ul className="rsc-roadlist">
                        {(detail.hazard?.roads?.length
                          ? detail.hazard.roads
                          : detail.blockedRoads.map((name) => ({ name, status: 'flooded' }))
                        ).map((rd, i) => (
                          <li key={`${rd.wayId ?? 'x'}-${rd.name}-${i}`}>
                            <span className={`rsc-dot ${rd.status === 'closed' ? 'closed' : 'flooded'}`} />
                            <span className="rsc-road-name">{rd.name}</span>
                            <span className="rsc-road-meta">
                              {rd.status}
                              {rd.depthM ? ` · ${describeDepth(rd.depthM)}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>

                {/* Timeline */}
                <section className="rsc-sect">
                  <div className="mng-detail-heading">Activity timeline</div>
                  <ul className="mng-timeline">
                    {(detail.history || []).map((h, idx) => (
                      <li key={idx}>
                        <span className="mng-timeline-time">{h.time}</span>
                        <span>{h.label}</span>
                      </li>
                    ))}
                  </ul>
                  <form onSubmit={addNote} className="mng-timeline-add">
                    <input name="note" type="text" placeholder="Add a note to the timeline…" />
                    <button type="submit" className="mng-btn mng-btn-ghost">Add Note</button>
                  </form>
                </section>

                <div className="mng-form-actions" style={{ justifyContent: 'space-between' }}>
                  <button type="button" className="mng-btn mng-btn-ghost" onClick={() => routeToResident(detail)}>
                    Route to resident
                  </button>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {detail.status === 'pending' && (
                      <button type="button" className="mng-btn" onClick={() => setStatus(detail.id, 'responding')}>
                        Responding
                      </button>
                    )}
                    {detail.status === 'responding' && (
                      <button type="button" className="mng-btn" onClick={() => setStatus(detail.id, 'rescued')}>
                        Mark rescued
                      </button>
                    )}
                    {detail.status === 'rescued' && (
                      <button type="button" className="mng-btn" onClick={() => setStatus(detail.id, 'resolved')}>
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </DialogOverlay>
        )}

        <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    </AdminLayout>
  )
}

/* Pan the overview map to the request an operator just opened, so the list and
   the map never disagree about which person is being discussed. */
function FocusOn({ coords }) {
  const map = useMap()
  useEffect(() => {
    if (Array.isArray(coords)) map.flyTo(coords, Math.max(map.getZoom(), 16), { duration: 0.7 })
  }, [coords, map])
  return null
}
