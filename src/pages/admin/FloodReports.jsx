import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import RecordList from '../../components/admin/RecordList.jsx'
import { CABUYAO_CENTER } from '../../components/admin/mapHelpers.jsx'
import { useFloodReports, useRoadReports } from '../../context/AdminDataContext.jsx'
import {
  FLOOD_LEVELS,
  FLOOD_LEVEL_META,
  VERIFY_STATUS_META,
  floodLevelMeta,
  verifyStatusMeta,
  formatReportDepth,
  roadStatusForLevel,
} from '../../data/floodReports.js'
import { getGraph, nearestNode } from '../../components/admin/routeEngine.js'
import { getCabuyaoRoads, haversineMeters } from '../../components/admin/routingHelpers.jsx'
import api from '../../services/api.js'
import '../admin/Manage.css'

/**
 * CDRRMO Admin — Flood Reports (resident submissions + verification).
 *
 * Every resident flood report lands here as "Pending Verification". An official
 * checks the details, location and photo evidence, then approves, rejects, or
 * sends it back for re-verification, optionally leaving an official note or
 * correcting the flood level. Only APPROVED reports become public on the flood
 * map — and approving a Severe / Impassable report also flags the nearest road
 * for the flood-aware route planner, so verified conditions steer routing.
 */

const FILTERS = [
  { key: 'pending', label: 'Pending', test: (r) => r.status === 'pending' },
  { key: 'approved', label: 'Approved', test: (r) => r.status === 'approved' },
  { key: 'rejected', label: 'Rejected', test: (r) => r.status === 'rejected' },
  { key: 'severe', label: 'Severe / Impassable', test: (r) => r.level === 'severe' || r.level === 'impassable' },
  { key: 'all', label: 'All' },
]

/** Nearest routable road way to a point (for the routing hand-off on approval). */
function nearestWay(coords) {
  const graph = getGraph(getCabuyaoRoads())
  if (!graph) return null
  const node = nearestNode(graph, coords)
  if (node < 0) return null
  const edges = graph.adj[node]
  if (!edges || !edges.length) return null
  let best = edges[0]
  let bestD = Infinity
  for (const e of edges) {
    const d = haversineMeters(coords, [e.mlat, e.mlng])
    if (d < bestD) { bestD = d; best = e }
  }
  const info = graph.wayInfo.get(best.wayId)
  return { wayId: best.wayId, name: info?.name || '' }
}

export default function FloodReports() {
  const { floodReports, verifyFloodReport, updateFloodReport, removeFloodReport } = useFloodReports()
  const { reportRoad } = useRoadReports()

  const [detailId, setDetailId] = useState(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null) // report pending deletion
  const [toast, setToast] = useState('')

  const official = api.getUser?.()?.fullName || api.getUser?.()?.username || 'CDRRMO'

  const stats = useMemo(() => [
    { color: 'amber', value: floodReports.filter((r) => r.status === 'pending').length, label: 'Pending' },
    { color: 'green', value: floodReports.filter((r) => r.status === 'approved').length, label: 'Approved' },
    { color: 'slate', value: floodReports.filter((r) => r.status === 'rejected').length, label: 'Rejected' },
    { color: 'red', value: floodReports.filter((r) => (r.level === 'severe' || r.level === 'impassable') && r.status !== 'rejected').length, label: 'Severe' },
  ], [floodReports])

  const detail = detailId ? floodReports.find((r) => r.id === detailId) : null

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3200)
  }

  function openDetail(report) {
    setDetailId(report.id)
    setNotesDraft(report.officialNotes || '')
  }

  function approve(report) {
    verifyFloodReport(report.id, 'approved', { verifiedBy: official, officialNotes: notesDraft.trim() })

    // Routing hand-off: a verified Severe/Impassable report flags the nearest
    // road (flooded/closed) so the flood-aware route planner steers around it.
    const painted = roadStatusForLevel(report.level)
    if (painted && Array.isArray(report.coords)) {
      const way = nearestWay(report.coords)
      if (way?.wayId != null) {
        reportRoad({
          wayId: way.wayId,
          name: way.name || `Near Brgy. ${report.barangay}`,
          barangay: report.barangay,
          status: painted === 'blocked' ? 'closed' : 'caution',
          depthFt: report.depthFt,
          reason: `Verified flood report — ${floodLevelMeta(report.level).label}`,
          reportedBy: official,
        })
        setDetailId(null)
        flash(`Approved — published to map and flagged ${way.name || 'the nearest road'} for routing.`)
        return
      }
    }
    setDetailId(null)
    flash('Approved — now visible on the public flood map.')
  }

  function reject(report) {
    verifyFloodReport(report.id, 'rejected', { verifiedBy: official, officialNotes: notesDraft.trim() })
    setDetailId(null)
    flash('Report rejected — kept hidden from the public map.')
  }

  function reopen(report) {
    verifyFloodReport(report.id, 'pending', { verifiedBy: official, note: 'Re-verification requested' })
    flash('Report sent back for re-verification.')
  }

  function saveNotes(report) {
    updateFloodReport(report.id, { officialNotes: notesDraft.trim() }, notesDraft.trim() ? 'Official note updated' : null)
    flash('Official note saved.')
  }

  function changeLevel(report, level) {
    if (level === report.level) return
    updateFloodReport(report.id, { level })
    flash(`Flood level updated to ${floodLevelMeta(level).label}.`)
  }

  function remove(report) {
    removeFloodReport(report.id)
    setConfirmDelete(null)
    setDetailId(null)
    flash('Report deleted.')
  }

  const columns = useMemo(() => [
    {
      key: 'level', header: 'Flood Level',
      render: (r) => {
        const level = floodLevelMeta(r.level)
        return (
          <button type="button" className="mng-cell-link" onClick={() => openDetail(r)}>
            <span className="mng-strong" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: level.color, display: 'inline-block' }} />
              {level.label}
            </span>
            {r.photo && <CameraIcon />}
          </button>
        )
      },
    },
    { key: 'barangay', header: 'Barangay', render: (r) => r.barangay || '—' },
    { key: 'reporter', header: 'Reported By', className: 'mng-muted', render: (r) => r.reporter || 'Resident' },
    { key: 'reported', header: 'Reported', className: 'mng-muted mng-num', render: (r) => r.reported },
    { key: 'depth', header: 'Depth', className: 'mng-muted mng-num', render: (r) => formatReportDepth(r.depthFt) || '—' },
    {
      key: 'status', header: 'Status',
      render: (r) => {
        const status = verifyStatusMeta(r.status)
        return <span className="mng-badge" style={{ color: status.color, background: `${status.color}18` }}>{status.label}</span>
      },
    },
  ], [])

  return (
    <AdminLayout>
      <div className="mng">
        <div className="mng-head">
          <div className="mng-head-titles">
            <div className="mng-head-icon">
              <svg viewBox="0 0 24 24">
                <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
              </svg>
            </div>
            <div>
              <div className="mng-title">Flood Reports</div>
              <div className="mng-sub">Verify resident-submitted flood reports before they reach the public map</div>
            </div>
          </div>
        </div>

        <RecordList
          rows={floodReports}
          rowLabel={(r) => `${floodLevelMeta(r.level).label} report`}
          stats={stats}
          filters={FILTERS}
          searchKeys={(r) => `${FLOOD_LEVEL_META[r.level]?.label} ${r.barangay} ${r.reporter} ${r.description}`}
          searchPlaceholder="Search level, barangay, reporter or description…"
          columns={columns}
          rowActions={(r) => [
            { label: 'Review', onClick: () => openDetail(r) },
            ...(r.status !== 'approved' ? [{ label: 'Approve', onClick: () => approve(r) }] : []),
            ...(r.status !== 'rejected' ? [{ label: 'Reject', onClick: () => reject(r), subtle: true }] : []),
          ]}
          emptyAll={{ title: 'No flood reports yet', sub: 'Resident submissions from the “Report Flood Status” flow will appear here for verification.' }}
          empty={{ title: 'No reports match this filter', sub: 'Try a different filter or clear your search.' }}
        />

        <div className="mng-note">
          <SparkIcon />
          <span>Only approved reports appear on the public flood map. Approving a Severe or Impassable report also flags the nearest road so the flood-aware route planner routes around it. Every decision is kept on the report's verification log.</span>
        </div>
      </div>

      {/* Detail / verification modal */}
      {detail && (
        <div className="mng-overlay" onMouseDown={() => setDetailId(null)}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label="Review flood report" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: floodLevelMeta(detail.level).color, display: 'inline-block' }} />
                  {floodLevelMeta(detail.level).label}
                </div>
                <div className="mng-modal-sub">Brgy. {detail.barangay || '—'} · reported by {detail.reporter || 'Resident'} · {detail.reported}</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setDetailId(null)} aria-label="Close">×</button>
            </div>

            <div className="mng-form" style={{ gap: 12 }}>
              <div className="mng-detail-badges">
                <span className="mng-badge" style={{ color: verifyStatusMeta(detail.status).color, background: `${verifyStatusMeta(detail.status).color}18` }}>
                  {verifyStatusMeta(detail.status).label}
                </span>
                {formatReportDepth(detail.depthFt) && (
                  <span className="mng-muted" style={{ fontSize: '0.75rem' }}>Water depth: {formatReportDepth(detail.depthFt)}</span>
                )}
                {detail.verifiedBy && detail.status !== 'pending' && (
                  <span className="mng-muted" style={{ fontSize: '0.75rem' }}>
                    {detail.status === 'approved' ? 'Verified' : 'Reviewed'} by {detail.verifiedBy}{detail.verified ? ` · ${detail.verified}` : ''}
                  </span>
                )}
              </div>

              {/* Location map */}
              {Array.isArray(detail.coords) && (
                <div style={{ height: 180, borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e2db' }}>
                  <MapContainer
                    center={detail.coords}
                    zoom={16}
                    zoomControl={false}
                    attributionControl={false}
                    style={{ width: '100%', height: '100%' }}
                  >
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.9} />
                    <CircleMarker
                      center={detail.coords}
                      radius={9}
                      pathOptions={{ color: '#fff', weight: 2, fillColor: floodLevelMeta(detail.level).color, fillOpacity: 0.95 }}
                    />
                  </MapContainer>
                </div>
              )}
              <div className="mng-muted" style={{ fontSize: '0.72rem' }}>
                {Array.isArray(detail.coords) ? `${detail.coords[0].toFixed(5)}, ${detail.coords[1].toFixed(5)}` : 'No coordinates recorded'}
              </div>

              {detail.description && <div className="mng-detail-notes">{detail.description}</div>}

              {detail.photo && (
                <div className="mng-photo-preview">
                  <img src={detail.photo} alt={`Evidence for ${floodLevelMeta(detail.level).label}`} />
                </div>
              )}

              {/* Manual flood-level correction */}
              <label>
                Flood level (correct if needed)
                <select value={detail.level} onChange={(e) => changeLevel(detail, e.target.value)}>
                  {FLOOD_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </label>

              {/* Official notes */}
              <label>
                Official notes
                <textarea
                  rows={2}
                  placeholder="Add a note for the record (visible to the resident)…"
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                />
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="mng-link" onClick={() => saveNotes(detail)}>Save note</button>
              </div>

              {/* Verification timeline */}
              <div>
                <div className="mng-detail-heading">Verification log</div>
                <ul className="mng-timeline">
                  {(detail.history || []).map((h, idx) => (
                    <li key={idx}>
                      <span className="mng-timeline-time">{h.time}</span>
                      <span>{h.label}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mng-form-actions" style={{ justifyContent: 'space-between' }}>
                <button type="button" className="mng-link subtle" onClick={() => setConfirmDelete(detail)}>Delete report</button>
                <div style={{ display: 'flex', gap: 10 }}>
                  {detail.status !== 'pending' && (
                    <button type="button" className="mng-btn mng-btn-ghost" onClick={() => reopen(detail)}>Re-verify</button>
                  )}
                  {detail.status !== 'rejected' && (
                    <button type="button" className="mng-btn mng-btn-ghost" onClick={() => reject(detail)}>Reject</button>
                  )}
                  {detail.status !== 'approved' && (
                    <button type="button" className="mng-btn" onClick={() => approve(detail)}>Approve &amp; Publish</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this flood report?"
          message={`Delete the ${floodLevelMeta(confirmDelete.level).label} report from Brgy. ${confirmDelete.barangay || '—'} (${confirmDelete.reporter || 'Resident'}, ${confirmDelete.reported})? It leaves the verification record permanently. This cannot be undone.`}
          confirmLabel="Delete report"
          tone="danger"
          onConfirm={() => remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </AdminLayout>
  )
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
  )
}
function CameraIcon() {
  return (
    <svg className="mng-cam" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
  )
}
