import { useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { BARANGAYS, ALERT_LEVELS } from '../../data/cabuyao.js'
import { useAlerts, nowLabel } from '../../context/AdminDataContext.jsx'
import { sendAlertEmail } from '../../services/emailAlert.js'
import './Manage.css'

/**
 * CDRRMO Admin — Alerts.
 *
 * Manage (issue / resolve / withdraw) the flood-hazard alerts broadcast to
 * each barangay. Alerts live in the shared AdminDataContext store, so an
 * alert issued here appears instantly on the Dashboard feed and the Flood
 * Map's Alerts panel, persists across refreshes, and an alert can be
 * scheduled to auto-issue at a future time.
 */

const LEVEL_LABEL = { high: 'High', moderate: 'Moderate', safe: 'All Clear' }

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'high', label: 'High' },
  { key: 'moderate', label: 'Moderate' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'resolved', label: 'Resolved' },
]

// datetime-local needs "YYYY-MM-DDTHH:mm" — pre-fill ~1 hour from now.
function defaultScheduleValue() {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export default function Alerts() {
  const { alerts, addAlert, updateAlert, resolveAlert, removeAlert } = useAlerts()
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [toast, setToast] = useState('')

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
      if (filter === 'scheduled' && a.status !== 'scheduled') return false
      if (filter === 'high' && a.level !== 'high') return false
      if (filter === 'moderate' && a.level !== 'moderate') return false
      if (q && !(`${a.title} ${a.barangay} ${a.message}`.toLowerCase().includes(q))) return false
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
      title: f.get('title').trim(),
      barangay: f.get('barangay'),
      level: f.get('level'),
      message: f.get('message').trim(),
    }
    // "Schedule for later": the alert queues and auto-issues when due
    // (the shared store promotes it on the next real-time refresh tick).
    const when = scheduling ? new Date(f.get('when')).getTime() : null
    if (when && when > Date.now()) {
      alert.status = 'scheduled'
      alert.scheduledFor = when
      alert.issued = `Scheduled · ${nowLabel(when)}`
    }
    addAlert(alert)
    // Fire email for immediately-active alerts; scheduled ones email when they auto-promote.
    if (alert.status !== 'scheduled') {
      sendAlertEmail({ level: alert.level, title: alert.title, message: alert.message, barangay: alert.barangay })
        .catch(console.warn)
    }
    setShowModal(false)
    setScheduling(false)
    flash(alert.status === 'scheduled'
      ? `Alert scheduled for ${alert.barangay} at ${nowLabel(when)}.`
      : `Alert issued for ${alert.barangay}.`)
  }

  function resolve(id) {
    resolveAlert(id)
    flash('Alert marked resolved.')
  }
  function reopen(id) {
    updateAlert(id, { status: 'active', issued: nowLabel(), issuedAt: Date.now() })
  }
  function remove(id) {
    removeAlert(id)
    flash('Alert withdrawn.')
  }

  return (
    <AdminLayout>
      <div className="mng">
        {/* Header */}
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
              <div className="mng-sub">Issue and manage flood-hazard alerts per barangay</div>
            </div>
          </div>
          <button type="button" className="mng-btn" onClick={() => setShowModal(true)}>
            <PlusIcon /> Issue Alert
          </button>
        </div>

        {/* Stats */}
        <div className="mng-stats">
          <Stat color="red" value={stats.active} label="Active Alerts" />
          <Stat color="red" value={stats.high} label="High Level" />
          <Stat color="amber" value={stats.moderate} label="Moderate Level" />
          <Stat color="slate" value={stats.resolved} label="Resolved" />
        </div>

        {/* Toolbar */}
        <div className="mng-toolbar">
          <div className="mng-search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search alerts by title, barangay…"
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

        {/* Table */}
        <div className="mng-card">
          <table className="mng-table">
            <thead>
              <tr>
                <th>Alert</th>
                <th>Barangay</th>
                <th>Level</th>
                <th>Issued</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="mng-empty">
                    <span className="mng-empty-strong">
                      {alerts.length === 0 ? 'No alerts issued yet' : 'No alerts match this filter'}
                    </span>
                    {alerts.length === 0
                      ? 'Use “Issue Alert” to broadcast a flood-hazard warning to a barangay.'
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
                    <td>{a.barangay}</td>
                    <td><span className={`mng-badge ${a.level}`}>{LEVEL_LABEL[a.level]}</span></td>
                    <td className="mng-muted mng-num" style={{ fontSize: '0.75rem' }}>{a.issued}</td>
                    <td><span className={`mng-badge ${a.status}`}>{a.status}</span></td>
                    <td>
                      <div className="mng-row-actions">
                        {a.status === 'active' && (
                          <button type="button" className="mng-link" onClick={() => resolve(a.id)}>Resolve</button>
                        )}
                        {a.status === 'scheduled' && (
                          <button type="button" className="mng-link" onClick={() => reopen(a.id)}>Issue now</button>
                        )}
                        {a.status === 'resolved' && (
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
          <span>Alerts are shared system-wide: they appear on the Dashboard feed and the Flood Map, persist across refreshes, and scheduled alerts auto-issue at their set time.</span>
        </div>
      </div>

      {/* Issue modal */}
      {showModal && (
        <div className="mng-overlay" onMouseDown={() => { setShowModal(false); setScheduling(false) }}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label="Issue Alert" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">Issue Hazard Alert</div>
                <div className="mng-modal-sub">Broadcast a flood-hazard warning to a barangay</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setShowModal(false)} aria-label="Close">×</button>
            </div>
            <form className="mng-form" onSubmit={handleIssue}>
              <div className="mng-form-grid">
                <label>
                  Barangay
                  <select name="barangay" required defaultValue="">
                    <option value="" disabled>Select Barangay</option>
                    {BARANGAYS.map((b) => <option key={b}>{b}</option>)}
                  </select>
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
              <label className="mng-check">
                <input
                  type="checkbox"
                  checked={scheduling}
                  onChange={(e) => setScheduling(e.target.checked)}
                />
                <span>Schedule for later — queue this alert and issue it automatically</span>
              </label>
              {scheduling && (
                <label>
                  Issue At
                  <input name="when" type="datetime-local" defaultValue={defaultScheduleValue()} required />
                </label>
              )}
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => { setShowModal(false); setScheduling(false) }}>Cancel</button>
                <button type="submit" className="mng-btn">{scheduling ? 'Schedule Alert' : 'Issue Alert'}</button>
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
