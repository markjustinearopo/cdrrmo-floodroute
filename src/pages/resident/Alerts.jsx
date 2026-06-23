import { useMemo, useState } from 'react'
import ResidentLayout from '../../components/resident/ResidentLayout.jsx'
import { residentBarangayLabel, getResidentBarangay } from '../../data/resident.js'
import { useAlerts } from '../../context/AdminDataContext.jsx'
import './Resident.css'

/**
 * CDRRMO Resident — Alerts (notifications feed).
 *
 * The flood-hazard alerts CDRRMO and the resident's barangay issue for their
 * area: warnings, evacuation calls, all-clears. Read-only — the resident reads
 * the SAME shared alerts the command center and barangay author, scoped to
 * their own barangay, and can mark items read locally. They never author or
 * change anything.
 */

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'critical', label: 'Critical' },
  { key: 'info', label: 'Info' },
]

// Per-resident read state lives locally (a resident reading an alert doesn't
// mutate the shared record other portals see).
const READ_KEY = 'cdrrmo_resident_read_alerts'

// Alert hazard level → notification stripe class.
const LEVEL_TYPE = { high: 'critical', moderate: 'high', safe: 'info' }

function fmtTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'Asia/Manila',
  }) + ' PHT'
}

function loadReadIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

export default function Alerts() {
  const brgyLabel = residentBarangayLabel()
  const myBrgy = getResidentBarangay()
  const { alerts } = useAlerts()
  const [filter, setFilter] = useState('all')
  const [readIds, setReadIds] = useState(loadReadIds)

  // Shared alerts for this barangay, mapped into the notification-card shape.
  const notifs = useMemo(
    () => alerts
      .filter((a) => a.barangay === myBrgy)
      .map((a) => ({
        id: a.id,
        title: a.title,
        message: a.message,
        created_at: a.issuedAt,
        type: LEVEL_TYPE[a.level] || 'info',
        is_read: readIds.has(a.id),
      })),
    [alerts, myBrgy, readIds],
  )

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

  function persistRead(next) {
    setReadIds(next)
    try {
      localStorage.setItem(READ_KEY, JSON.stringify([...next]))
    } catch {
      /* private mode */
    }
  }
  function markRead(id) {
    persistRead(new Set(readIds).add(id))
  }
  function markAllRead() {
    if (counts.unread === 0) return
    persistRead(new Set([...readIds, ...notifs.map((n) => n.id)]))
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
