import { useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { useNotifications } from '../../context/AdminDataContext.jsx'
import './Manage.css'
import './Notifications.css'

/**
 * CDRRMO Admin — Notifications.
 *
 * The dedicated screen behind the topbar bell's "View all notifications" link.
 * Lists every system event the command center has produced (alerts issued,
 * incidents reported, road-status changes) from the shared AdminDataContext
 * store. Rows are clickable and open a detail popup, mirroring the bell popover.
 */

const LEVEL_LABEL = { high: 'High', moderate: 'Moderate', info: 'Info' }

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'high', label: 'High' },
  { key: 'moderate', label: 'Moderate' },
  { key: 'info', label: 'Info' },
]

export default function Notifications() {
  const { notifications, markNotificationsRead } = useNotifications()
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)

  const stats = useMemo(() => ({
    total: notifications.length,
    unread: notifications.filter((n) => !n.read).length,
    high: notifications.filter((n) => n.level === 'high').length,
    moderate: notifications.filter((n) => n.level === 'moderate').length,
  }), [notifications])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return notifications.filter((n) => {
      if (filter === 'unread' && n.read) return false
      if ((filter === 'high' || filter === 'moderate' || filter === 'info') && n.level !== filter) return false
      if (q && !(`${n.title} ${n.message}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [notifications, filter, query])

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
              <div className="mng-title">Notifications</div>
              <div className="mng-sub">System events from across the command center</div>
            </div>
          </div>
          <button
            type="button"
            className="mng-btn"
            disabled={stats.unread === 0}
            onClick={markNotificationsRead}
          >
            Mark all as read
          </button>
        </div>

        {/* Stats */}
        <div className="mng-stats">
          <Stat color="slate" value={stats.total} label="Total" />
          <Stat color="red" value={stats.unread} label="Unread" />
          <Stat color="red" value={stats.high} label="High" />
          <Stat color="amber" value={stats.moderate} label="Moderate" />
        </div>

        {/* Toolbar */}
        <div className="mng-toolbar">
          <div className="mng-search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search notifications…"
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

        {/* List */}
        <div className="mng-card">
          {visible.length === 0 ? (
            <div className="notif-page-empty">
              <span className="mng-empty-strong">
                {notifications.length === 0 ? 'No notifications yet' : 'No notifications match this filter'}
              </span>
              {notifications.length === 0
                ? 'System alerts and barangay reports will appear here as the command center is operated.'
                : 'Try a different filter or clear your search.'}
            </div>
          ) : (
            <div className="notif-page-list">
              {visible.map((n) => (
                <button
                  type="button"
                  className={`notif-page-item ${n.read ? '' : 'unread'}`}
                  key={n.id}
                  onClick={() => setSelected(n)}
                >
                  <div className={`notif-dot ${n.level}`} />
                  <div className="notif-page-body">
                    <div className="notif-page-row">
                      <span className="notif-page-title">{n.title}</span>
                      <span className="notif-page-time">{n.time}</span>
                    </div>
                    <div className="notif-page-desc">{n.message}</div>
                  </div>
                  <span className={`mng-badge ${n.level === 'info' ? 'safe' : n.level}`}>
                    {LEVEL_LABEL[n.level] || 'Info'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail popup */}
      {selected && (
        <div className="notif-detail-overlay" onMouseDown={() => setSelected(null)}>
          <div
            className="notif-detail"
            role="dialog"
            aria-modal="true"
            aria-label="Notification details"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="notif-detail-head">
              <span className={`notif-detail-badge ${selected.level}`}>
                {LEVEL_LABEL[selected.level] || 'Info'}
              </span>
              <button
                type="button"
                className="notif-detail-close"
                onClick={() => setSelected(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="notif-detail-title">{selected.title}</div>
            <div className="notif-detail-time">{selected.time}</div>
            <p className="notif-detail-msg">{selected.message}</p>
            <div className="notif-detail-actions">
              <button type="button" className="notif-detail-btn" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
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
