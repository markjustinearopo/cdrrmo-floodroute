/* ============================================================
   Road condition editor — set status + flood depth (feet) + note.

   Shared by the Road Status page and the Dashboard's click-to-flag map,
   so flagging a road ALWAYS asks the same questions (what condition,
   how deep, why) instead of silently flipping the segment. Uses the
   global mng-* modal styling (Manage.css, loaded app-wide).
   ============================================================ */

import { useState } from 'react'
import { ROAD_STATUS } from './routingHelpers.jsx'

export default function RoadConditionModal({ road, onClose, onSave }) {
  const [status, setStatus] = useState(road.status === 'blocked' ? 'blocked' : road.status === 'flooded' ? 'flooded' : 'flooded')
  const [depthFt, setDepthFt] = useState(road.depthFt ?? '')
  const [reason, setReason] = useState(road.reason || '')

  function handleSave(e) {
    e.preventDefault()
    onSave({ ...road, status, depthFt, reason })
  }

  return (
    <div className="mng-overlay" onMouseDown={onClose}>
      <div className="mng-modal" role="dialog" aria-modal="true" style={{ maxWidth: 460 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mng-modal-head">
          <div>
            <div className="mng-modal-title">Road Condition</div>
            <div className="mng-modal-sub">{road.name}{road.barangay ? ` · ${road.barangay}` : ''}</div>
          </div>
          <button type="button" className="mng-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form className="mng-form" onSubmit={handleSave} style={{ padding: '16px 18px' }}>
          <label>
            Condition
            <div className="rcm-status">
              {[
                { v: 'flooded', l: 'Flooded', c: ROAD_STATUS.flooded.swatch },
                { v: 'blocked', l: 'Closed', c: ROAD_STATUS.blocked.swatch },
                { v: 'open', l: 'Passable', c: ROAD_STATUS.open.swatch },
              ].map((o) => (
                <button
                  type="button"
                  key={o.v}
                  className={`rcm-status-btn ${status === o.v ? 'on' : ''}`}
                  style={{ '--c': o.c }}
                  onClick={() => setStatus(o.v)}
                >
                  <span className="rcm-status-dot" />{o.l}
                </button>
              ))}
            </div>
          </label>

          {status !== 'open' && (
            <>
              <label>
                Flood Depth (feet)
                <input
                  type="number" min="0" step="0.5"
                  value={depthFt}
                  onChange={(e) => setDepthFt(e.target.value)}
                  placeholder={status === 'blocked' ? 'e.g. 3 (optional for a closure)' : 'e.g. 2'}
                  autoFocus
                />
              </label>
              <label>
                Reason / Note
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Impassable to small vehicles; water rising at the underpass."
                />
              </label>
            </>
          )}

          {status === 'open' && (
            <div className="mng-pinned set" style={{ marginTop: 0 }}>
              This road will be cleared from the live map.
            </div>
          )}

          <div className="mng-form-actions">
            <button type="button" className="mng-btn mng-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="mng-btn">
              {status === 'open' ? 'Set Passable' : 'Save Condition'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
