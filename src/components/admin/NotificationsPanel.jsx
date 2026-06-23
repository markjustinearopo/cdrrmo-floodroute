import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../../context/AdminDataContext.jsx'

/**
 * Notifications popup for the CDRRMO Admin (anchored under the topbar bell).
 *
 * These are notifications *for* the admin — system events generated as the
 * command center is operated: alerts issued, incidents reported, road status
 * changes. They are produced by the shared AdminDataContext store, so the bell
 * fills up as work happens and clears when the admin marks them read.
 *
 * Clicking a notification opens a detail popup; "View all notifications" opens
 * the dedicated Notifications screen. Closes on backdrop click or Escape.
 */
export default function NotificationsPanel({ onClose }) {
  const navigate = useNavigate()
  const { notifications, markNotificationsRead } = useNotifications()
  const unread = notifications.filter((n) => !n.read).length
  // The notification currently expanded in the detail popup (null = none).
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        if (selected) setSelected(null)
        else onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, selected])

  function viewAll() {
    onClose()
    navigate('/admin/notifications')
  }

  return (
    <>
      <div className="popover-backdrop" onMouseDown={onClose} />
      <div className="notif-popover" role="dialog" aria-label="Notifications">
        <div className="notif-head">
          <div className="notif-head-title">
            Notifications
            {unread > 0 && <span className="notif-count">{unread}</span>}
          </div>
          <button className="notif-mark" type="button" disabled={unread === 0} onClick={markNotificationsRead}>
            Mark all as read
          </button>
        </div>

        <div className="notif-body">
          {notifications.length === 0 ? (
            <div className="notif-empty">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <div className="notif-empty-title">You're all caught up</div>
              <div className="notif-empty-sub">
                System alerts and barangay reports will appear here.
              </div>
            </div>
          ) : (
            notifications.map((n) => (
              <button
                type="button"
                className={`notif-item ${n.read ? '' : 'unread'}`}
                key={n.id}
                onClick={() => setSelected(n)}
              >
                <div className={`notif-dot ${n.level}`} />
                <div className="notif-item-body">
                  <div className="notif-item-title">{n.title}</div>
                  <div className="notif-item-desc">{n.message}</div>
                  <div className="notif-item-time">{n.time}</div>
                </div>
              </button>
            ))
          )}
        </div>

        <button type="button" className="notif-foot" onClick={viewAll}>
          View all notifications
        </button>
      </div>

      {/* Detail popup for a single notification */}
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
                {selected.level === 'high' ? 'High' : selected.level === 'moderate' ? 'Moderate' : 'Info'}
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
              <button type="button" className="notif-detail-btn ghost" onClick={() => setSelected(null)}>
                Close
              </button>
              <button type="button" className="notif-detail-btn" onClick={viewAll}>
                View all notifications
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
