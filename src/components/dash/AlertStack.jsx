import { useState } from 'react'
import { CITY_WIDE } from '../../data/cabuyao.js'
import './AlertStack.css'

/* ============================================================
   The alert feed, collapsed.

   Every alert used to print its full message into the list, so four alerts
   made a wall of text roughly nine hundred pixels tall and the reader's eye
   had nowhere to land. An alert feed is a scanning surface: a person arrives
   at it asking "what is out, and how bad", and only then "what does that one
   say". Those are two questions and they were being answered at once.

   So a row is now a severity bar, a title, and a time. Click it and the
   message opens underneath. One at a time, because the point is to compare
   headlines and then drop into exactly one of them.

   Nothing is lost: the operator's Details / Resolve actions live inside the
   opened row, which is also the only place they were ever reachable from.
   ============================================================ */

const LEVEL_LABEL = {
  emergency: 'EMERGENCY',
  high: 'HIGH',
  moderate: 'MODERATE',
  low: 'LOW',
  safe: 'ALL CLEAR',
}

/**
 * @param alerts     the alert records to list
 * @param limit      how many rows before the list stops
 * @param onDetail   optional — renders a "Details" action inside the open row
 * @param onResolve  optional — renders a "Resolve" action inside the open row
 * @param emptyTitle/emptyHint  the empty state
 * @param defaultOpenFirst  open the newest row on mount (used where the feed
 *                          is the whole point of the screen)
 */
export default function AlertStack({
  alerts = [],
  limit = 6,
  onDetail,
  onResolve,
  emptyTitle = 'No active alerts',
  emptyHint = 'Alerts will appear here as they are issued.',
  defaultOpenFirst = false,
}) {
  const rows = alerts.slice(0, limit)
  const [openId, setOpenId] = useState(() =>
    (defaultOpenFirst && rows.length ? rows[0].id : null))

  if (rows.length === 0) {
    return (
      <div className="as-empty">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <div>
          <b>{emptyTitle}</b>
          <em>{emptyHint}</em>
        </div>
      </div>
    )
  }

  return (
    <ul className="as-list">
      {rows.map((a) => {
        const level = a.level || 'safe'
        const open = openId === a.id
        const scope = !a.barangay || a.barangay === CITY_WIDE ? 'Citywide' : a.barangay
        return (
          <li className={`as-row ${level} ${open ? 'open' : ''}`} key={a.id}>
            <button
              type="button"
              className="as-head"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : a.id)}
            >
              <span className="as-bar" aria-hidden="true" />
              <span className="as-sev">{LEVEL_LABEL[level] || level}</span>
              <span className="as-title">{a.title}</span>
              <span className="as-meta">
                <span className="as-scope">{scope}</span>
                {a.issued && <span className="as-time">{a.issued}</span>}
              </span>
              <svg className="as-chev" viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {open && (
              <div className="as-body">
                {a.message
                  ? <p className="as-msg">{a.message}</p>
                  : <p className="as-msg muted">No further detail was recorded with this alert.</p>}
                {(onDetail || onResolve) && (
                  <div className="as-acts">
                    {onDetail && (
                      <button type="button" className="as-act" onClick={() => onDetail(a)}>
                        Full record
                      </button>
                    )}
                    {onResolve && a.status === 'active' && (
                      <button type="button" className="as-act danger" onClick={() => onResolve(a)}>
                        Resolve
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
