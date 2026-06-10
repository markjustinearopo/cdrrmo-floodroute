import { useEffect, useMemo, useState } from 'react'
import ResidentLayout from '../../components/resident/ResidentLayout.jsx'
import { residentBarangayLabel, safeGet, safeSend, brgyQuery } from '../../data/resident.js'
import './Resident.css'

/**
 * CDRRMO Resident — Alerts (notifications feed).
 *
 * The alerts and advisories pushed to a resident for their area: flood
 * warnings, evacuation calls, all-clears. Read-only consumption — the resident
 * can filter and mark items read, but doesn't author anything. The feed starts
 * empty and fills from the shared backend (GET /notifications); marking read
 * syncs back when the API is reachable.
 */

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'critical', label: 'Critical' },
  { key: 'info', label: 'Info' },
]

function fmtTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'Asia/Manila',
  }) + ' PHT'
}

export default function Alerts() {
  const brgyLabel = residentBarangayLabel()
  const [notifs, setNotifs] = useState([])
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    let active = true
    safeGet(`/notifications${brgyQuery()}`).then((d) => {
      if (active && d?.notifications) setNotifs(d.notifications)
    })
    return () => { active = false }
  }, [])

  const counts = useMemo(() => ({
    all: notifs.length,
    unread: notifs.filter((n) => !n.is_read).length,
  }), [notifs])

  const visible = useMemo(() => notifs.filter((n) => {
    if (filter === 'unread') return !n.is_read
    if (filter === 'critical') return n.type === 'critical' || n.type === 'high'
    if (filter === 'info') return n.type === 'info'
    return true
  }), [notifs, filter])

  const unread = visible.filter((n) => !n.is_read)
  const read = visible.filter((n) => n.is_read)

  function markRead(id) {
    setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
    safeSend('put', `/notifications/${id}/read`)
  }
  function markAllRead() {
    if (counts.unread === 0) return
    setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })))
    safeSend('put', '/notifications/read-all')
  }

  return (
    <ResidentLayout>
      <div className="res">
        <div className="res-head">
          <div className="res-head-icon">
            <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
          </div>
          <div>
            <div className="res-head-title">Alerts</div>
            <div className="res-head-sub">Flood warnings and advisories for Brgy. {brgyLabel}</div>
          </div>
        </div>

        <div className="res-filter-bar">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`res-filter-tab ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {f.key === 'all' && ` ( ${counts.all} )`}
              {f.key === 'unread' && ` ( ${counts.unread} )`}
            </button>
          ))}
          <button type="button" className="res-mark-all" onClick={markAllRead} disabled={counts.unread === 0}>
            Mark all as read
          </button>
        </div>

        {notifs.length === 0 ? (
          <div className="res-side-card">
            <div className="res-empty">
              <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
              <div className="res-empty-title">You're all caught up</div>
              <div className="res-empty-sub">Flood alerts and advisories for your area will appear here.</div>
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="res-side-card">
            <div className="res-empty">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <div className="res-empty-title">Nothing in this filter</div>
              <div className="res-empty-sub">Try a different tab.</div>
            </div>
          </div>
        ) : (
          <div className="res-notif-feed">
            {unread.length > 0 && <div className="res-section-label">Unread</div>}
            {unread.map((n) => (
              <NotifCard key={n.id} n={n} onClick={() => markRead(n.id)} />
            ))}
            {read.length > 0 && <div className="res-section-label">Earlier</div>}
            {read.map((n) => (
              <NotifCard key={n.id} n={n} />
            ))}
          </div>
        )}
      </div>
    </ResidentLayout>
  )
}

function NotifCard({ n, onClick }) {
  const unread = !n.is_read
  return (
    <div
      className={`res-notif-card ${unread ? 'unread' : 'read'}`}
      onClick={unread ? onClick : undefined}
      style={unread ? { cursor: 'pointer' } : undefined}
    >
      <span className={`res-notif-stripe ${n.type || 'info'}`} />
      <div className="res-notif-body">
        <div className="res-notif-title">{n.title}</div>
        {n.message && <div className="res-notif-msg">{n.message}</div>}
        <div className="res-notif-meta">
          {fmtTime(n.created_at)}
          {!unread && <span className="res-read-tag">Read</span>}
        </div>
      </div>
      {unread && <span className="res-unread-dot" />}
    </div>
  )
}
