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
import DialogOverlay from '../DialogOverlay.jsx'

export default function RoadConditionModal({
  road,
  onClose,
  onSave,
  title = 'Road Condition',
  subtitle,
  saveLabel,
  /* Partial closure. Passing `onPartial` adds the "only part of this road"
     escape hatch: the modal closes and the caller puts its own map into
     point-picking mode (see PartialBlockPicker). Screens without a map of
     their own simply do not pass it, and the modal is exactly as it was.

     This is offered as a CHOICE rather than replacing the whole-road control,
     because closing an entire road is still the right answer often enough — a
     bridge, a short barangay street — and making the finer tool mandatory
     would slow down the case that is already correct. */
  onPartial,
  partialCount = 0,
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
    <DialogOverlay className="mng-overlay" onDismiss={onClose}>
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

          {/* The whole point of the feature, said where the mistake is made.
              An operator reaches this modal to close a road; this is the
              moment to offer closing only the part that is actually shut. */}
          {onPartial && status !== 'open' && (
            <div className="rcm-partial">
              <div className="rcm-partial-head">
                <span className="rcm-partial-title">Only part of this road affected?</span>
                {partialCount > 0 && (
                  <span className="rcm-partial-count">
                    {partialCount} section{partialCount > 1 ? 's' : ''} already closed
                  </span>
                )}
              </div>
              <p className="rcm-partial-body">
                Saving above closes <b>the entire road</b> to routing. If only a stretch of
                it is impassable, mark that section instead — the rest stays open and
                routes keep using it.
              </p>
              <button type="button" className="rcm-partial-btn" onClick={() => onPartial(road)}>
                <ScissorsIcon /> Select a section on the map…
              </button>
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
    </DialogOverlay>
  )
}

function ScissorsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  )
}
