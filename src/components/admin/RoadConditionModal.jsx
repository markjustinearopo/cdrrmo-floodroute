/* ============================================================
   Road condition editor — set status + flood depth + note.

   The one way a road's condition changes. All four routes into it now come
   through here: the Road Status board, the Dashboard's click-to-flag map, the
   Road Status road list, and approving a barangay's proposed change — which
   used to apply the barangay's request verbatim without a CDRRMO operator ever
   seeing the depth they were signing off on.

   Depth is entered in METRES to match the rest of the product (services/
   depth.js) and converted to feet on save, because road_status.flood_depth_ft
   is still a feet column and moving it is a database change, not a UI one.

   Uses the global mng-* modal styling (Manage.css, loaded app-wide).
   ============================================================ */

import { useState } from 'react'
import { ROAD_STATUS } from './routingHelpers.jsx'
import { ftToM, mToFt, formatFeetHint } from '../../services/depth.js'

export default function RoadConditionModal({
  road,
  onClose,
  onSave,
  title = 'Road Condition',
  subtitle,
  saveLabel,
}) {
  const [status, setStatus] = useState(road.status === 'blocked' ? 'blocked' : road.status === 'flooded' ? 'flooded' : 'flooded')
  const [depthM, setDepthM] = useState(() => {
    const m = ftToM(road.depthFt)
    return m == null ? '' : String(+m.toFixed(2))
  })
  const [reason, setReason] = useState(road.reason || '')

  const feetHint = formatFeetHint(depthM === '' ? null : Number(depthM))

  function handleSave(e) {
    e.preventDefault()
    // Store feet: the column is feet, the operator thinks in metres.
    const depthFt = depthM === '' ? '' : +mToFt(Number(depthM)).toFixed(2)
    onSave({ ...road, status, depthFt, reason })
  }

  return (
    <div className="mng-overlay" onMouseDown={onClose}>
      <div className="mng-modal" role="dialog" aria-modal="true" style={{ maxWidth: 460 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mng-modal-head">
          <div>
            <div className="mng-modal-title">{title}</div>
            <div className="mng-modal-sub">
              {subtitle || <>{road.name}{road.barangay ? ` · ${road.barangay}` : ''}</>}
            </div>
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
                Flood Depth (metres)
                <input
                  type="number" min="0" step="0.05"
                  value={depthM}
                  onChange={(e) => setDepthM(e.target.value)}
                  placeholder={status === 'blocked' ? 'e.g. 0.9 (optional for a closure)' : 'e.g. 0.6'}
                  autoFocus
                />
                <span className="fa-depth-hint">
                  {feetHint || 'Measured on the ground in feet? The equivalent shows here.'}
                </span>
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
              {saveLabel || (status === 'open' ? 'Set Passable' : 'Save Condition')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
