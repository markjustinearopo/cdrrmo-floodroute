import { useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { BARANGAYS, levelFromDepth } from '../../data/cabuyao.js'
import './Manage.css'

/**
 * CDRRMO Admin — Barangay.
 *
 * Roster of Cabuyao's 18 barangays. The list itself is fixed reference data,
 * so the work here is assignment: naming each barangay's captain and
 * evacuation coordinator, recording a contact number and setting an
 * operational status. The flood-status badge is derived from the measured
 * flood depth the backend supplies (safeness = flood depth) and is read-only.
 */

const OPS_STATUSES = [
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'standby', label: 'On Standby' },
  { value: 'active', label: 'Active Response' },
]
const STATUS_LABEL = Object.fromEntries(OPS_STATUSES.map((s) => [s.value, s.label]))
const RISK_LABEL = { high: 'High', moderate: 'Moderate', low: 'Low', safe: 'Safe' }

export default function Barangay() {
  // floodDepth (m) arrives from the DB/sensor feed; 0 until then.
  const [rows, setRows] = useState(() =>
    BARANGAYS.map((name) => ({
      name, floodDepth: 0, captain: '', contact: '', coordinator: '', status: 'monitoring',
    })),
  )
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null) // barangay name being assigned
  const [toast, setToast] = useState('')

  const stats = useMemo(() => ({
    total: rows.length,
    assigned: rows.filter((b) => b.captain.trim()).length,
    unassigned: rows.filter((b) => !b.captain.trim()).length,
    atRisk: rows.filter((b) => ['high', 'moderate'].includes(levelFromDepth(b.floodDepth))).length,
  }), [rows])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((b) => `${b.name} ${b.captain} ${b.coordinator}`.toLowerCase().includes(q))
  }, [rows, query])

  const current = editing ? rows.find((b) => b.name === editing) : null

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  function handleSave(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setRows((prev) => prev.map((b) => (b.name === editing ? {
      ...b,
      captain: f.get('captain').trim(),
      contact: f.get('contact').trim(),
      coordinator: f.get('coordinator').trim(),
      status: f.get('status'),
    } : b)))
    flash(`${editing} assignment saved.`)
    setEditing(null)
  }

  return (
    <AdminLayout>
      <div className="mng">
        <div className="mng-head">
          <div className="mng-head-titles">
            <div className="mng-head-icon">
              <svg viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div>
              <div className="mng-title">Barangay</div>
              <div className="mng-sub">Assign captains, evacuation coordinators and contacts for all 18 barangays</div>
            </div>
          </div>
        </div>

        <div className="mng-stats">
          <Stat color="blue" value={stats.total} label="Barangays" />
          <Stat color="green" value={stats.assigned} label="Captain Assigned" />
          <Stat color="amber" value={stats.unassigned} label="Unassigned" />
          <Stat color="red" value={stats.atRisk} label="At-Risk (Flood)" />
        </div>

        <div className="mng-toolbar">
          <div className="mng-search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search barangay, captain or coordinator…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="mng-card">
          <table className="mng-table">
            <thead>
              <tr>
                <th>Barangay</th>
                <th>Flood Status</th>
                <th>Captain</th>
                <th>Coordinator</th>
                <th>Contact</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((b) => {
                const risk = levelFromDepth(b.floodDepth)
                return (
                  <tr key={b.name}>
                    <td className="mng-strong">{b.name}</td>
                    <td><span className={`mng-badge ${risk}`}>{RISK_LABEL[risk]}</span></td>
                    <td>{b.captain || <span className="mng-muted">— Unassigned</span>}</td>
                    <td>{b.coordinator || <span className="mng-muted">—</span>}</td>
                    <td className="mng-num">{b.contact || <span className="mng-muted">—</span>}</td>
                    <td><span className={`mng-badge ${b.status}`}>{STATUS_LABEL[b.status]}</span></td>
                    <td>
                      <div className="mng-row-actions">
                        <button type="button" className="mng-link" onClick={() => setEditing(b.name)}>
                          {b.captain ? 'Edit' : 'Assign'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="mng-empty">
                    <span className="mng-empty-strong">No barangay matches your search</span>
                    Try a different name.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mng-note">
          <SparkIcon />
          <span>Flood status follows the measured depth from the hazard feed and cannot be edited here. Assignments are saved for this session until the backend is connected.</span>
        </div>
      </div>

      {/* Assign / edit modal */}
      {current && (
        <div className="mng-overlay" onMouseDown={() => setEditing(null)}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label={`Assign ${current.name}`} onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">Assign · {current.name}</div>
                <div className="mng-modal-sub">Barangay officials and operational status</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setEditing(null)} aria-label="Close">×</button>
            </div>
            <form className="mng-form" onSubmit={handleSave}>
              <label>
                Barangay Captain
                <input name="captain" type="text" defaultValue={current.captain} placeholder="e.g. Hon. Juan Dela Cruz" />
              </label>
              <div className="mng-form-grid">
                <label>
                  Evacuation Coordinator
                  <input name="coordinator" type="text" defaultValue={current.coordinator} placeholder="e.g. Maria Santos" />
                </label>
                <label>
                  Contact Number
                  <input name="contact" type="tel" defaultValue={current.contact} placeholder="0917 000 0000" />
                </label>
              </div>
              <label>
                Operational Status
                <select name="status" defaultValue={current.status}>
                  {OPS_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit" className="mng-btn">Save Assignment</button>
              </div>
            </form>
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
