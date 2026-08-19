import { useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { useNotifications } from '../../context/AdminDataContext.jsx'
import RecordList from '../../components/admin/RecordList.jsx'
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
  { key: 'unread', label: 'Unread', test: (n) => !n.read },
  { key: 'high', label: 'High', test: (n) => n.level === 'high' },
  { key: 'moderate', label: 'Moderate', test: (n) => n.level === 'moderate' },
  { key: 'info', label: 'Info', test: (n) => n.level === 'info' },
]

export default function Notifications() {
  const { notifications, markNotificationsRead } = useNotifications()
  const [selected, setSelected] = useState(null)

  const unread = notifications.filter((n) => !n.read).length

  const stats = useMemo(() => [
    { color: 'slate', value: notifications.length, label: 'Total' },
    { color: 'red', value: notifications.filter((n) => !n.read).length, label: 'Unread' },
    { color: 'red', value: notifications.filter((n) => n.level === 'high').length, label: 'High' },
    { color: 'amber', value: notifications.filter((n) => n.level === 'moderate').length, label: 'Moderate' },
  ], [notifications])

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
            disabled={unread === 0}
            onClick={markNotificationsRead}
          >
            Mark all as read
          </button>
        </div>

        {/* Stats */}
        <RecordList
          rows={notifications}
          rowLabel={(n) => n.title}
          stats={stats}
          filters={FILTERS}
          searchKeys={(n) => `${n.title} ${n.message}`}
          searchPlaceholder="Search notifications…"
          listClassName="notif-page-list"
          renderItem={(n) => (
            <button
              type="button"
              className={`notif-page-item ${n.read ? '' : 'unread'}`}
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
          )}
          emptyAll={{ title: 'No notifications yet', sub: 'System alerts and barangay reports will appear here as the command center is operated.' }}
          empty={{ title: 'No notifications match this filter', sub: 'Try a different filter or clear your search.' }}
        />
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


