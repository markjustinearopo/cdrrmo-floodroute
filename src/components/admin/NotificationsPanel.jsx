import { useEffect } from 'react'

/**
 * Notifications popup for the CDRRMO Admin (anchored under the topbar bell).
 *
 * These are notifications *for* the admin — system events, incoming barangay
 * reports, acknowledgements, etc. The list is empty until the backend feeds
 * it; figures and items start at none per the project rule.
 *
 * Closes on backdrop click or Escape.
 */
export default function NotificationsPanel({ onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // No notifications yet — fed from GET /notifications later.
  const notifications = []
  const unread = 0

  return (
    <>
      <div className="popover-backdrop" onMouseDown={onClose} />
      <div className="notif-popover" role="dialog" aria-label="Notifications">
        <div className="notif-head">
          <div className="notif-head-title">
            Notifications
            {unread > 0 && <span className="notif-count">{unread}</span>}
          </div>
          <button className="notif-mark" type="button" disabled={unread === 0}>
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
              <div className="notif-item" key={n.id}>
                <div className={`notif-dot ${n.level}`} />
                <div className="notif-item-body">
                  <div className="notif-item-title">{n.title}</div>
                  <div className="notif-item-desc">{n.message}</div>
                  <div className="notif-item-time">{n.time}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="notif-foot">View all notifications</div>
      </div>
    </>
  )
}
