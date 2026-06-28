import { useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { BARANGAYS, INCIDENT_TYPES, PRIORITIES, RESPONSE_TEAMS } from '../../data/cabuyao.js'
import { useIncidents, useSavedRoutes } from '../../context/AdminDataContext.jsx'
import { CABUYAO_CENTER } from '../../components/admin/mapHelpers.jsx'
import { getCabuyaoRoads, useRoadStatus, useTrafficStatus, formatDistance } from '../../components/admin/routingHelpers.jsx'
import { getGraph, planRoute } from '../../components/admin/routeEngine.js'
import { useFloodRisk } from '../../components/admin/floodRisk.js'
import './Manage.css'

/**
 * CDRRMO Admin — Incidents.
 *
 * Log field incidents and assign them to a response team. Records live in the
 * shared AdminDataContext store, so a report filed here appears instantly on
 * the Flood Map (Incident Reports tab + live markers) and persists across
 * refreshes. Status advances new → assigned → in-progress → resolved, every
 * change is kept on the incident's history timeline, photos can be attached
 * as evidence, rows support bulk dispatch, and "Route to incident" plans a
 * flood-aware response route from the command center with the A* engine.
 */

const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.value, p.label]))
const STATUS_LABEL = {
  new: 'New', assigned: 'Assigned', 'in-progress': 'In Progress', resolved: 'Resolved',
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'critical', label: 'Critical' },
  { key: 'resolved', label: 'Resolved' },
]

// Evidence photos are downscaled before storing (localStorage quota).
const PHOTO_MAX_PX = 800

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, PHOTO_MAX_PX / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.7))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('unreadable image'))
    }
    img.src = url
  })
}

export default function Incidents() {
  const { incidents: items, addIncident, updateIncident, removeIncident } = useIncidents()
  const [, { addRoute }] = useSavedRoutes()
  const [roadStatusMap] = useRoadStatus()
  const [trafficMap] = useTrafficStatus()
  const { field } = useFloodRisk()

  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [photo, setPhoto] = useState(null) // pending evidence for the report modal
  const [detailId, setDetailId] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [toast, setToast] = useState('')

  const stats = useMemo(() => ({
    open: items.filter((i) => i.status !== 'resolved').length,
    unassigned: items.filter((i) => !i.team).length,
    critical: items.filter((i) => i.priority === 'critical' && i.status !== 'resolved').length,
    resolved: items.filter((i) => i.status === 'resolved').length,
  }), [items])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((i) => {
      if (filter === 'open' && i.status === 'resolved') return false
      if (filter === 'unassigned' && i.team) return false
      if (filter === 'critical' && i.priority !== 'critical') return false
      if (filter === 'resolved' && i.status !== 'resolved') return false
      if (q && !(`${i.type} ${i.barangay} ${i.location} ${i.team}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [items, filter, query])

  const detail = detailId ? items.find((i) => i.id === detailId) : null
  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected.has(i.id))

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  function handleReport(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const team = f.get('team') || ''
    addIncident({
      type: f.get('type'),
      barangay: f.get('barangay'),
      location: f.get('location').trim(),
      priority: f.get('priority'),
      notes: f.get('notes').trim(),
      team,
      status: team ? 'assigned' : 'new',
      photo: photo || null,
    })
    setShowModal(false)
    setPhoto(null)
    flash('Incident logged.')
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return setPhoto(null)
    try {
      setPhoto(await compressImage(file))
    } catch {
      setPhoto(null)
      flash('Could not read that image — try a different file.')
    }
  }

  function assignTeam(id, team) {
    const i = items.find((x) => x.id === id)
    if (!i) return
    // Assigning a team moves a brand-new incident to "assigned";
    // clearing it sends an untouched one back to "new".
    let status = i.status
    if (team && i.status === 'new') status = 'assigned'
    if (!team && i.status === 'assigned') status = 'new'
    updateIncident(id, { team, status })
  }
  function setStatus(id, status) {
    updateIncident(id, { status })
  }
  function remove(id) {
    removeIncident(id)
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    flash('Incident removed.')
  }

  function addNote(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const note = f.get('note').trim()
    if (!note || !detail) return
    updateIncident(detail.id, {}, note)
    e.target.reset()
  }

  /** Flood-aware A* response route: command center → incident site. */
  function routeToIncident(inc) {
    if (!inc.coords) return flash('This incident has no mapped location.')
    const graph = getGraph(getCabuyaoRoads())
    const plan = planRoute(graph, CABUYAO_CENTER, inc.coords, {
      riskAt: field ? (lat, lng) => field.riskAt(lat, lng) : undefined,
      statusMap: roadStatusMap,
      trafficMap, // responders drive — steer the convoy around jams
    })
    if (!plan.ok) return flash('No drivable route found to this incident.')
    addRoute({
      name: `Response · ${inc.type} — ${inc.barangay}`,
      type: 'response',
      points: [plan.start, plan.goal],
      path: plan.safe.coords,
      source: 'auto',
      destination: inc.location || inc.barangay,
      meanRisk: Number(plan.safe.meanRisk.toFixed(3)),
      incidentId: inc.id,
    })
    updateIncident(inc.id, {}, `Response route planned (${formatDistance(plan.safe.distanceM)})`)
    flash(`Response route saved (${formatDistance(plan.safe.distanceM)}) — see Route Planning & Flood Map.`)
  }

  /* ── Bulk operations ── */
  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleSelectAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((i) => i.id)))
  }
  function bulkStatus(status) {
    if (!status) return
    selected.forEach((id) => updateIncident(id, { status }))
    flash(`${selected.size} incident${selected.size === 1 ? '' : 's'} → ${STATUS_LABEL[status]}.`)
    setSelected(new Set())
  }
  function bulkTeam(team) {
    if (!team) return
    selected.forEach((id) => assignTeam(id, team))
    flash(`${selected.size} incident${selected.size === 1 ? '' : 's'} assigned to ${team}.`)
    setSelected(new Set())
  }

  return (
    <AdminLayout>
      <div className="mng">
        <div className="mng-head">
          <div className="mng-head-titles">
            <div className="mng-head-icon">
              <svg viewBox="0 0 24 24">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div>
              <div className="mng-title">Incidents</div>
              <div className="mng-sub">Log field reports and dispatch a response team</div>
            </div>
          </div>
          <button type="button" className="mng-btn" onClick={() => setShowModal(true)}>
            <PlusIcon /> Report Incident
          </button>
        </div>

        <div className="mng-stats">
          <Stat color="amber" value={stats.open} label="Open" />
          <Stat color="slate" value={stats.unassigned} label="Unassigned" />
          <Stat color="red" value={stats.critical} label="Critical" />
          <Stat color="green" value={stats.resolved} label="Resolved" />
        </div>

        <div className="mng-toolbar">
          <div className="mng-search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search by type, barangay, location, team…"
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

        {/* Bulk action bar — appears once rows are ticked */}
        {selected.size > 0 && (
          <div className="mng-bulkbar">
            <span className="mng-bulkbar-count">{selected.size} selected</span>
            <select className="mng-inline-select" defaultValue="" onChange={(e) => { bulkStatus(e.target.value); e.target.value = '' }}>
              <option value="" disabled>Set status…</option>
              <option value="in-progress">In Progress</option>
              <option value="resolved">Resolved</option>
            </select>
            <select className="mng-inline-select" defaultValue="" onChange={(e) => { bulkTeam(e.target.value); e.target.value = '' }}>
              <option value="" disabled>Assign team…</option>
              {RESPONSE_TEAMS.map((t) => <option key={t}>{t}</option>)}
            </select>
            <button type="button" className="mng-link subtle" onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
        )}

        <div className="mng-card">
          <table className="mng-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    className="mng-rowcheck"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all visible incidents"
                  />
                </th>
                <th>Incident</th>
                <th>Barangay</th>
                <th>Priority</th>
                <th>Reported</th>
                <th>Assigned Team</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={8} className="mng-empty">
                    <span className="mng-empty-strong">
                      {items.length === 0 ? 'No incidents logged' : 'No incidents match this filter'}
                    </span>
                    {items.length === 0
                      ? 'Use “Report Incident” to log a field report and dispatch a team.'
                      : 'Try a different filter or clear your search.'}
                  </td>
                </tr>
              ) : (
                visible.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <input
                        type="checkbox"
                        className="mng-rowcheck"
                        checked={selected.has(i.id)}
                        onChange={() => toggleSelect(i.id)}
                        aria-label={`Select ${i.type} in ${i.barangay}`}
                      />
                    </td>
                    <td>
                      <button type="button" className="mng-cell-link" onClick={() => setDetailId(i.id)}>
                        <span className="mng-strong">{i.type}</span>
                        {i.photo && <CameraIcon />}
                      </button>
                      {i.location && <div className="mng-muted" style={{ fontSize: '0.75rem' }}>{i.location}</div>}
                    </td>
                    <td>{i.barangay}</td>
                    <td><span className={`mng-badge ${i.priority}`}>{PRIORITY_LABEL[i.priority]}</span></td>
                    <td className="mng-muted mng-num" style={{ fontSize: '0.75rem' }}>{i.reported}</td>
                    <td>
                      <select
                        className={`mng-inline-select ${i.team ? '' : 'unset'}`}
                        value={i.team}
                        onChange={(e) => assignTeam(i.id, e.target.value)}
                        disabled={i.status === 'resolved'}
                      >
                        <option value="">— Assign team —</option>
                        {RESPONSE_TEAMS.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td><span className={`mng-badge ${i.status}`}>{STATUS_LABEL[i.status]}</span></td>
                    <td>
                      <div className="mng-row-actions">
                        {i.status === 'assigned' && (
                          <button type="button" className="mng-link" onClick={() => setStatus(i.id, 'in-progress')}>Start</button>
                        )}
                        {(i.status === 'in-progress' || i.status === 'assigned') && (
                          <button type="button" className="mng-link" onClick={() => setStatus(i.id, 'resolved')}>Resolve</button>
                        )}
                        {i.status === 'resolved' && (
                          <button type="button" className="mng-link subtle" onClick={() => setStatus(i.id, i.team ? 'assigned' : 'new')}>Reopen</button>
                        )}
                        <button type="button" className="mng-link subtle" onClick={() => remove(i.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mng-note">
          <SparkIcon />
          <span>Incidents are shared system-wide: they appear as live markers on the Flood Map, every change lands on the incident timeline, and records persist across refreshes. Click an incident for details, evidence and the response-route planner.</span>
        </div>
      </div>

      {/* Report modal */}
      {showModal && (
        <div className="mng-overlay" onMouseDown={() => { setShowModal(false); setPhoto(null) }}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label="Report Incident" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">Report Incident</div>
                <div className="mng-modal-sub">Log a field report and optionally dispatch a team</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => { setShowModal(false); setPhoto(null) }} aria-label="Close">×</button>
            </div>
            <form className="mng-form" onSubmit={handleReport}>
              <div className="mng-form-grid">
                <label>
                  Incident Type
                  <select name="type" required defaultValue="">
                    <option value="" disabled>Select type</option>
                    {INCIDENT_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label>
                  Barangay
                  <select name="barangay" required defaultValue="">
                    <option value="" disabled>Select Barangay</option>
                    {BARANGAYS.map((b) => <option key={b}>{b}</option>)}
                  </select>
                </label>
              </div>
              <label>
                Specific Location
                <input name="location" type="text" placeholder="e.g. corner J.P. Rizal St. & Lakeshore Rd." required />
              </label>
              <div className="mng-form-grid">
                <label>
                  Priority
                  <select name="priority" required defaultValue="high">
                    {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </label>
                <label>
                  Assign Team (optional)
                  <select name="team" defaultValue="">
                    <option value="">Assign later</option>
                    {RESPONSE_TEAMS.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
              </div>
              <label>
                Details
                <textarea name="notes" rows={3} placeholder="What happened, how many affected, access notes." required />
              </label>
              <label>
                Photo Evidence (optional)
                <input name="photo" type="file" accept="image/*" onChange={handlePhoto} />
              </label>
              {photo && (
                <div className="mng-photo-preview">
                  <img src={photo} alt="Evidence preview" />
                  <button type="button" className="mng-link subtle" onClick={() => setPhoto(null)}>Remove photo</button>
                </div>
              )}
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => { setShowModal(false); setPhoto(null) }}>Cancel</button>
                <button type="submit" className="mng-btn">Log Incident</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail / timeline modal */}
      {detail && (
        <div className="mng-overlay" onMouseDown={() => setDetailId(null)}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label={`${detail.type} details`} onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">{detail.type} · {detail.barangay}</div>
                <div className="mng-modal-sub">{detail.location || 'No specific location recorded'}</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setDetailId(null)} aria-label="Close">×</button>
            </div>
            <div className="mng-form" style={{ gap: 12 }}>
              <div className="mng-detail-badges">
                <span className={`mng-badge ${detail.priority}`}>{PRIORITY_LABEL[detail.priority]}</span>
                <span className={`mng-badge ${detail.status}`}>{STATUS_LABEL[detail.status]}</span>
                <span className="mng-muted" style={{ fontSize: '0.75rem' }}>
                  {detail.team ? `Team: ${detail.team}` : 'Unassigned'} · Reported {detail.reported}
                </span>
              </div>

              {detail.notes && <div className="mng-detail-notes">{detail.notes}</div>}

              {detail.photo && (
                <div className="mng-photo-preview">
                  <img src={detail.photo} alt={`Evidence for ${detail.type}`} />
                </div>
              )}

              {/* Timeline */}
              <div>
                <div className="mng-detail-heading">Updates timeline</div>
                <ul className="mng-timeline">
                  {(detail.history || []).map((h, idx) => (
                    <li key={idx}>
                      <span className="mng-timeline-time">{h.time}</span>
                      <span>{h.label}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <form onSubmit={addNote} className="mng-timeline-add">
                <input name="note" type="text" placeholder="Add a note to the timeline…" />
                <button type="submit" className="mng-btn mng-btn-ghost">Add Note</button>
              </form>

              <div className="mng-form-actions" style={{ justifyContent: 'space-between' }}>
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => routeToIncident(detail)}>
                  <RouteIcon /> Route to Incident
                </button>
                <div style={{ display: 'flex', gap: 10 }}>
                  {detail.status === 'assigned' && (
                    <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setStatus(detail.id, 'in-progress')}>Start</button>
                  )}
                  {detail.status !== 'resolved' && (
                    <button type="button" className="mng-btn" onClick={() => setStatus(detail.id, 'resolved')}>Resolve</button>
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
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
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
function RouteIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 14, height: 14 }}><circle cx="6" cy="19" r="3" /><circle cx="18" cy="5" r="3" /><path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H12" /></svg>
  )
}
