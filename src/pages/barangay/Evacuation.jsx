import { useEffect, useMemo, useState } from 'react'
import BarangayLayout from '../../components/barangay/BarangayLayout.jsx'
import { EVAC_STATUSES } from '../../data/cabuyao.js'
import {
  officialBarangayLabel,
  getOfficialBarangay,
  safeGet,
  safeSend,
  brgyQuery,
} from '../../data/barangay.js'
import '../admin/Manage.css'

/**
 * CDRRMO Barangay — Evacuation.
 *
 * Directory of the evacuation centres inside THIS barangay. The official
 * registers each centre, names a manager and contact, sets capacity and keeps
 * live occupancy and open/full/closed status current during an evacuation.
 * Centres sync to the shared /evac-centers endpoint so the command center sees
 * city-wide capacity. The list starts empty and fills from the database.
 */

const STATUS_LABEL = Object.fromEntries(EVAC_STATUSES.map((s) => [s.value, s.label]))

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'full', label: 'Full' },
  { key: 'closed', label: 'Closed' },
]

function occClass(occupancy, capacity, status) {
  if (status === 'full') return 'full'
  if (!capacity) return ''
  const pct = occupancy / capacity
  if (pct >= 1) return 'full'
  if (pct >= 0.8) return 'warn'
  return ''
}

export default function Evacuation() {
  const brgyLabel = officialBarangayLabel()
  const [centers, setCenters] = useState([])
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null) // center object, 'new', or null
  const [toast, setToast] = useState('')

  useEffect(() => {
    let active = true
    safeGet(`/evac-centers${brgyQuery()}`).then((data) => {
      if (active && data?.centers) setCenters(data.centers)
    })
    return () => { active = false }
  }, [])

  const stats = useMemo(() => ({
    total: centers.length,
    open: centers.filter((c) => c.status === 'open').length,
    capacity: centers.reduce((sum, c) => sum + Number(c.capacity || 0), 0),
    evacuees: centers.reduce((sum, c) => sum + Number(c.occupancy || 0), 0),
  }), [centers])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return centers.filter((c) => {
      if (filter !== 'all' && c.status !== filter) return false
      if (q && !(`${c.name} ${c.manager}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [centers, filter, query])

  const current = editing && editing !== 'new' ? editing : null

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  function handleSave(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const capacity = Math.max(0, Number(f.get('capacity')) || 0)
    const occupancy = Math.max(0, Number(f.get('occupancy')) || 0)
    const data = {
      name: f.get('name').trim(),
      barangay: getOfficialBarangay(),
      capacity,
      occupancy,
      status: f.get('status'),
      manager: f.get('manager').trim(),
      contact: f.get('contact').trim(),
    }
    if (current) {
      setCenters((prev) => prev.map((c) => (c.id === current.id ? { ...c, ...data } : c)))
      safeSend('put', `/evac-centers/${current.id}`, data)
      flash(`${data.name} updated.`)
    } else {
      const created = { id: `ec-${Date.now()}`, ...data }
      setCenters((prev) => [created, ...prev])
      safeSend('post', '/evac-centers', created)
      flash(`${data.name} added.`)
    }
    setEditing(null)
  }

  function remove(id) {
    setCenters((prev) => prev.filter((c) => c.id !== id))
    safeSend('del', `/evac-centers/${id}`)
    flash('Evacuation centre removed.')
  }

  return (
    <BarangayLayout>
      <div className="mng">
        <div className="mng-head">
          <div className="mng-head-titles">
            <div className="mng-head-icon">
              <svg viewBox="0 0 24 24">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div>
              <div className="mng-title">Evacuation</div>
              <div className="mng-sub">Evacuation centres in Brgy. {brgyLabel} — capacity &amp; live occupancy</div>
            </div>
          </div>
          <button type="button" className="mng-btn" onClick={() => setEditing('new')}>
            <PlusIcon /> Add Centre
          </button>
        </div>

        <div className="mng-stats">
          <Stat color="blue" value={stats.total} label="Centres" />
          <Stat color="green" value={stats.open} label="Open" />
          <Stat color="slate" value={stats.capacity.toLocaleString()} label="Total Capacity" />
          <Stat color="amber" value={stats.evacuees.toLocaleString()} label="Current Evacuees" />
        </div>

        <div className="mng-toolbar">
          <div className="mng-search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search centre or manager…"
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
                <th>Evacuation Centre</th>
                <th>Occupancy</th>
                <th>Manager</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="mng-empty">
                    <span className="mng-empty-strong">
                      {centers.length === 0 ? 'No evacuation centres yet' : 'No centres match this filter'}
                    </span>
                    {centers.length === 0
                      ? 'Use “Add Centre” to register an evacuation centre in your barangay.'
                      : 'Try a different filter or clear your search.'}
                  </td>
                </tr>
              ) : (
                visible.map((c) => {
                  const pct = c.capacity ? Math.min(100, (c.occupancy / c.capacity) * 100) : 0
                  return (
                    <tr key={c.id}>
                      <td className="mng-strong">{c.name}</td>
                      <td>
                        <div className="mng-occ">
                          <div className="mng-occ-track">
                            <div className={`mng-occ-fill ${occClass(c.occupancy, c.capacity, c.status)}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="mng-occ-txt">{Number(c.occupancy).toLocaleString()}/{Number(c.capacity).toLocaleString()}</span>
                        </div>
                      </td>
                      <td>{c.manager || <span className="mng-muted">— Unassigned</span>}</td>
                      <td><span className={`mng-badge ${c.status}`}>{STATUS_LABEL[c.status]}</span></td>
                      <td>
                        <div className="mng-row-actions">
                          <button type="button" className="mng-link" onClick={() => setEditing(c)}>Manage</button>
                          <button type="button" className="mng-link subtle" onClick={() => remove(c.id)}>Remove</button>
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
          <span>Centres are scoped to Brgy. {brgyLabel} and roll up into the city-wide capacity the command center sees. Changes sync to the database once the backend is connected.</span>
        </div>
      </div>

      {/* Add / manage modal */}
      {editing && (
        <div className="mng-overlay" onMouseDown={() => setEditing(null)}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label={current ? 'Manage centre' : 'Add centre'} onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">{current ? `Manage · ${current.name}` : 'Add Evacuation Centre'}</div>
                <div className="mng-modal-sub">Capacity and live occupancy in Brgy. {brgyLabel}</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setEditing(null)} aria-label="Close">×</button>
            </div>
            <form className="mng-form" onSubmit={handleSave}>
              <label>
                Centre Name
                <input name="name" type="text" defaultValue={current?.name || ''} placeholder="e.g. Barangay Covered Court" required />
              </label>
              <label>
                Barangay
                <input type="text" value={`Brgy. ${brgyLabel}`} readOnly className="mng-locked" />
              </label>
              <div className="mng-form-grid">
                <label>
                  Capacity
                  <input name="capacity" type="number" min="0" step="10" defaultValue={current?.capacity ?? 0} required />
                </label>
                <label>
                  Current Occupancy
                  <input name="occupancy" type="number" min="0" step="1" defaultValue={current?.occupancy ?? 0} required />
                </label>
              </div>
              <div className="mng-form-grid">
                <label>
                  Centre Manager
                  <input name="manager" type="text" defaultValue={current?.manager || ''} placeholder="e.g. Maria Santos" />
                </label>
                <label>
                  Contact Number
                  <input name="contact" type="tel" defaultValue={current?.contact || ''} placeholder="0917 000 0000" />
                </label>
              </div>
              <label>
                Status
                <select name="status" defaultValue={current?.status || 'open'}>
                  {EVAC_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit" className="mng-btn">{current ? 'Save Changes' : 'Add Centre'}</button>
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
