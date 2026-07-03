import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
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
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'severe', label: 'Severe / Impassable' },
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

  const [filter, setFilter] = useState('pending')
  const [query, setQuery] = useState('')
  const [detailId, setDetailId] = useState(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [toast, setToast] = useState('')

  const official = api.getUser?.()?.fullName || api.getUser?.()?.username || 'CDRRMO'

  const stats = useMemo(() => ({
    pending: floodReports.filter((r) => r.status === 'pending').length,
    approved: floodReports.filter((r) => r.status === 'approved').length,
    rejected: floodReports.filter((r) => r.status === 'rejected').length,
    severe: floodReports.filter((r) => (r.level === 'severe' || r.level === 'impassable') && r.status !== 'rejected').length,
  }), [floodReports])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return floodReports.filter((r) => {
      if (filter === 'pending' && r.status !== 'pending') return false
      if (filter === 'approved' && r.status !== 'approved') return false
      if (filter === 'rejected' && r.status !== 'rejected') return false
      if (filter === 'severe' && !(r.level === 'severe' || r.level === 'impassable')) return false
      if (q && !(`${FLOOD_LEVEL_META[r.level]?.label} ${r.barangay} ${r.reporter} ${r.description}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [floodReports, filter, query])

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
    setDetailId(null)
    flash('Report deleted.')
  }

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

        <div className="mng-stats">
          <Stat color="amber" value={stats.pending} label="Pending Verification" />
          <Stat color="green" value={stats.approved} label="Approved" />
          <Stat color="red" value={stats.rejected} label="Rejected" />
          <Stat color="slate" value={stats.severe} label="Severe / Impassable" />
        </div>

        <div className="mng-toolbar">
          <div className="mng-search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search by level, barangay, reporter, description…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="mng-filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`mng-chip ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mng-card">
          <table className="mng-table">
            <thead>
              <tr>
                <th>Flood Level</th>
                <th>Barangay</th>
                <th>Reported By</th>
                <th>Reported</th>
                <th>Depth</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="mng-empty">
                    <span className="mng-empty-strong">
                      {floodReports.length === 0 ? 'No flood reports yet' : 'No reports match this filter'}
                    </span>
                    {floodReports.length === 0
                      ? 'Resident submissions from the “Report Flood Status” flow will appear here for verification.'
                      : 'Try a different filter or clear your search.'}
                  </td>
                </tr>
              ) : (
                visible.map((r) => {
                  const level = floodLevelMeta(r.level)
                  const status = verifyStatusMeta(r.status)
                  const depth = formatReportDepth(r.depthFt)
                  return (
                    <tr key={r.id}>
                      <td>
                        <button type="button" className="mng-cell-link" onClick={() => openDetail(r)}>
                          <span className="mng-strong" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: level.color, display: 'inline-block' }} />
                            {level.label}
                          </span>
                          {r.photo && <CameraIcon />}
                        </button>
                      </td>
                      <td>{r.barangay || '—'}</td>
                      <td className="mng-muted">{r.reporter || 'Resident'}</td>
                      <td className="mng-muted mng-num" style={{ fontSize: '0.75rem' }}>{r.reported}</td>
                      <td className="mng-muted mng-num">{depth || '—'}</td>
                      <td>
                        <span className="mng-badge" style={{ color: status.color, background: `${status.color}18` }}>
                          {status.label}
                        </span>
                      </td>
                      <td>
                        <div className="mng-row-actions">
                          <button type="button" className="mng-link" onClick={() => openDetail(r)}>Review</button>
                          {r.status !== 'approved' && (
                            <button type="button" className="mng-link" onClick={() => approve(r)}>Approve</button>
                          )}
                          {r.status !== 'rejected' && (
                            <button type="button" className="mng-link subtle" onClick={() => reject(r)}>Reject</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

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
                <button type="button" className="mng-link subtle" onClick={() => remove(detail)}>Delete report</button>
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

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </AdminLayout>
  )
}

function Stat({ color, value, label }) {
  return (
    <div className={`mng-stat ${color}`}>
      <div className="mng-stat-val">{value}</div>
      <div className="mng-stat-lbl">{label}</div>
    </div>
  )
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
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
