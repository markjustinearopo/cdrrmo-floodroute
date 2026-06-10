import { useEffect, useMemo, useState } from 'react'
import BarangayLayout from '../../components/barangay/BarangayLayout.jsx'
import { INCIDENT_TYPES, PRIORITIES, RESPONSE_TEAMS } from '../../data/cabuyao.js'
import {
  officialBarangayLabel,
  getOfficialBarangay,
  safeGet,
  safeSend,
  brgyQuery,
} from '../../data/barangay.js'
import '../admin/Manage.css'

/**
 * CDRRMO Barangay — Incidents.
 *
 * The official logs field incidents inside THEIR barangay and dispatches a
 * response team. Reports are filed against the shared /incidents endpoint, so
 * the city command center sees them in its own queue (one system). The list
 * starts empty and fills from the database; until the backend is reachable,
 * edits are kept optimistically for the session.
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

function nowLabel() {
  return new Date().toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'Asia/Manila',
  })
}

export default function Incidents() {
  const brgyLabel = officialBarangayLabel()
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState('')

  // Pull this barangay's incidents from the shared backend; empty until then.
  useEffect(() => {
    let active = true
    safeGet(`/incidents${brgyQuery()}`).then((data) => {
      if (active && data?.incidents) setItems(data.incidents)
    })
    return () => { active = false }
  }, [])

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
      if (q && !(`${i.type} ${i.location} ${i.team}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [items, filter, query])

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  function handleReport(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const team = f.get('team') || ''
    const item = {
      id: `inc-${Date.now()}`,
      type: f.get('type'),
      barangay: getOfficialBarangay(),
      location: f.get('location').trim(),
      priority: f.get('priority'),
      notes: f.get('notes').trim(),
      team,
      status: team ? 'assigned' : 'new',
      reported: nowLabel(),
    }
    setItems((prev) => [item, ...prev])
    safeSend('post', '/incidents', item)
    setShowModal(false)
    flash('Incident logged and forwarded to CDRRMO.')
  }

  function assignTeam(id, team) {
    setItems((prev) => prev.map((i) => {
      if (i.id !== id) return i
      let status = i.status
      if (team && i.status === 'new') status = 'assigned'
      if (!team && i.status === 'assigned') status = 'new'
      return { ...i, team, status }
    }))
    safeSend('put', `/incidents/${id}`, { team })
  }
  function setStatus(id, status) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)))
    safeSend('put', `/incidents/${id}`, { status })
  }
  function remove(id) {
    setItems((prev) => prev.filter((i) => i.id !== id))
    safeSend('del', `/incidents/${id}`)
    flash('Incident removed.')
  }

  return (
    <BarangayLayout>
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
              <div className="mng-sub">Log field reports in Brgy. {brgyLabel} and dispatch a response team</div>
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
              placeholder="Search by type, location, team…"
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
                <th>Incident</th>
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
                  <td colSpan={6} className="mng-empty">
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
                      <div className="mng-strong">{i.type}</div>
                      {i.location && <div className="mng-muted" style={{ fontSize: '0.75rem' }}>{i.location}</div>}
                    </td>
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
          <span>Reports are filed against Brgy. {brgyLabel} and shared with the CDRRMO command center. Records sync to the database once the backend is connected.</span>
        </div>
      </div>

      {/* Report modal */}
      {showModal && (
        <div className="mng-overlay" onMouseDown={() => setShowModal(false)}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label="Report Incident" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">Report Incident</div>
                <div className="mng-modal-sub">Log a field report in Brgy. {brgyLabel} and optionally dispatch a team</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setShowModal(false)} aria-label="Close">×</button>
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
                  <input type="text" value={`Brgy. ${brgyLabel}`} readOnly className="mng-locked" />
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
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="mng-btn">Log Incident</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </BarangayLayout>
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
