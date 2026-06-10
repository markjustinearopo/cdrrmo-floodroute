import { useEffect, useMemo, useState } from 'react'
import BarangayLayout from '../../components/barangay/BarangayLayout.jsx'
import { ALERT_LEVELS } from '../../data/cabuyao.js'
import {
  officialBarangayLabel,
  getOfficialBarangay,
  safeGet,
  safeSend,
  brgyQuery,
} from '../../data/barangay.js'
import '../admin/Manage.css'

/**
 * CDRRMO Barangay — Alerts.
 *
 * The official broadcasts flood-hazard alerts to residents of THEIR barangay
 * and tracks the ones currently active. Alerts post to the shared /alerts
 * endpoint, so the CDRRMO command center sees every barangay broadcast. The
 * list starts empty and fills from the database.
 */

const LEVEL_LABEL = { high: 'High', moderate: 'Moderate', safe: 'All Clear' }

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'high', label: 'High' },
  { key: 'moderate', label: 'Moderate' },
  { key: 'resolved', label: 'Resolved' },
]

function nowLabel() {
  return new Date().toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'Asia/Manila',
  })
}

export default function Alerts() {
  const brgyLabel = officialBarangayLabel()
  const [alerts, setAlerts] = useState([])
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    let active = true
    safeGet(`/alerts${brgyQuery()}`).then((data) => {
      if (active && data?.alerts) setAlerts(data.alerts)
    })
    return () => { active = false }
  }, [])

  const stats = useMemo(() => ({
    active: alerts.filter((a) => a.status === 'active').length,
    high: alerts.filter((a) => a.status === 'active' && a.level === 'high').length,
    moderate: alerts.filter((a) => a.status === 'active' && a.level === 'moderate').length,
    resolved: alerts.filter((a) => a.status === 'resolved').length,
  }), [alerts])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return alerts.filter((a) => {
      if (filter === 'active' && a.status !== 'active') return false
      if (filter === 'resolved' && a.status !== 'resolved') return false
      if (filter === 'high' && a.level !== 'high') return false
      if (filter === 'moderate' && a.level !== 'moderate') return false
      if (q && !(`${a.title} ${a.message}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [alerts, filter, query])

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  function handleIssue(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const alert = {
      id: `al-${Date.now()}`,
      title: f.get('title').trim(),
      barangay: getOfficialBarangay(),
      level: f.get('level'),
      message: f.get('message').trim(),
      issued: nowLabel(),
      status: 'active',
    }
    setAlerts((prev) => [alert, ...prev])
    safeSend('post', '/alerts', alert)
    setShowModal(false)
    flash(`Alert broadcast to Brgy. ${brgyLabel}.`)
  }

  function resolve(id) {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'resolved' } : a)))
    safeSend('put', `/alerts/${id}`, { status: 'resolved' })
    flash('Alert marked resolved.')
  }
  function reopen(id) {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'active' } : a)))
    safeSend('put', `/alerts/${id}`, { status: 'active' })
  }
  function remove(id) {
    setAlerts((prev) => prev.filter((a) => a.id !== id))
    safeSend('del', `/alerts/${id}`)
    flash('Alert withdrawn.')
  }

  return (
    <BarangayLayout>
      <div className="mng">
        <div className="mng-head">
          <div className="mng-head-titles">
            <div className="mng-head-icon">
              <svg viewBox="0 0 24 24">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div>
              <div className="mng-title">Alerts</div>
              <div className="mng-sub">Broadcast and manage flood-hazard alerts for Brgy. {brgyLabel}</div>
            </div>
          </div>
          <button type="button" className="mng-btn" onClick={() => setShowModal(true)}>
            <PlusIcon /> Issue Alert
          </button>
        </div>

        <div className="mng-stats">
          <Stat color="red" value={stats.active} label="Active Alerts" />
          <Stat color="red" value={stats.high} label="High Level" />
          <Stat color="amber" value={stats.moderate} label="Moderate Level" />
          <Stat color="slate" value={stats.resolved} label="Resolved" />
        </div>

        <div className="mng-toolbar">
          <div className="mng-search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search alerts by title or message…"
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
                <th>Alert</th>
                <th>Level</th>
                <th>Issued</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="mng-empty">
                    <span className="mng-empty-strong">
                      {alerts.length === 0 ? 'No alerts issued yet' : 'No alerts match this filter'}
                    </span>
                    {alerts.length === 0
                      ? 'Use “Issue Alert” to broadcast a flood-hazard warning to your residents.'
                      : 'Try a different filter or clear your search.'}
                  </td>
                </tr>
              ) : (
                visible.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="mng-strong">{a.title}</div>
                      {a.message && <div className="mng-muted" style={{ fontSize: '0.75rem' }}>{a.message}</div>}
                    </td>
                    <td><span className={`mng-badge ${a.level}`}>{LEVEL_LABEL[a.level]}</span></td>
                    <td className="mng-muted mng-num" style={{ fontSize: '0.75rem' }}>{a.issued}</td>
                    <td><span className={`mng-badge ${a.status}`}>{a.status}</span></td>
                    <td>
                      <div className="mng-row-actions">
                        {a.status === 'active' ? (
                          <button type="button" className="mng-link" onClick={() => resolve(a.id)}>Resolve</button>
                        ) : (
                          <button type="button" className="mng-link subtle" onClick={() => reopen(a.id)}>Reopen</button>
                        )}
                        <button type="button" className="mng-link subtle" onClick={() => remove(a.id)}>Withdraw</button>
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
          <span>Alerts are broadcast to Brgy. {brgyLabel} and shared with the CDRRMO command center. They sync to the database once the backend is connected.</span>
        </div>
      </div>

      {/* Issue modal */}
      {showModal && (
        <div className="mng-overlay" onMouseDown={() => setShowModal(false)}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label="Issue Alert" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">Issue Hazard Alert</div>
                <div className="mng-modal-sub">Broadcast a flood-hazard warning to Brgy. {brgyLabel}</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setShowModal(false)} aria-label="Close">×</button>
            </div>
            <form className="mng-form" onSubmit={handleIssue}>
              <div className="mng-form-grid">
                <label>
                  Barangay
                  <input type="text" value={`Brgy. ${brgyLabel}`} readOnly className="mng-locked" />
                </label>
                <label>
                  Alert Level
                  <select name="level" required defaultValue="high">
                    {ALERT_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </label>
              </div>
              <label>
                Alert Title
                <input name="title" type="text" placeholder="Severe Flood Warning" required />
              </label>
              <label>
                Message
                <textarea name="message" rows={3} placeholder="Affected areas, water level and evacuation advice." required />
              </label>
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="mng-btn">Issue Alert</button>
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
