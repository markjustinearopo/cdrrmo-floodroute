/* ============================================================
   FloodAreasLayer — the shared Leaflet overlay for the city's
   documented flood-prone areas (depth in feet).

   One implementation, reused by every flood map (admin / barangay /
   resident) and the admin Flood-Prone Areas management screen, so a
   record looks and reads the same everywhere. Each area is a teardrop
   pin from the shared pin family (coloured + sized by severity, droplet
   glyph — warning triangle for flash floods) with a detailed popup:
   depth in feet with a severity meter, flood type, provenance
   (observed record vs estimated band), the rain drivers, the storms it
   was recorded under, and the CDRRMO note.
   ============================================================ */

import { Marker, Tooltip, Popup } from 'react-leaflet'
import {
  FLOOD_SEVERITY_META,
  FLOOD_TYPE_LABEL,
  floodSeverity,
  formatFloodDepth,
} from '../../data/floodAreas.js'
import { pinIcon, PIN_SIZE } from '../map/pinIcons.js'
import { nowLabel } from '../../context/AdminDataContext.jsx'
import './FloodAreasLayer.css'

/* Depth (ft) that fills the popup severity meter — deeper stays capped. */
const METER_FULL_FT = 4

/** Detailed popup body for one flood-prone area (also used by the manage page). */
export function FloodAreaPopup({ area }) {
  const sev = floodSeverity(area)
  const meta = FLOOD_SEVERITY_META[sev]
  const ft = Number(area.depthFt) || 0
  // Flash floods read as full-severity even without a pooled depth.
  const meterPct = area.type === 'flash_flood' && !ft ? 100 : Math.min(100, (ft / METER_FULL_FT) * 100)
  return (
    <div className="fa-popup">
      <div className="fa-popup-head">
        <span className="fa-popup-dot" style={{ background: meta.color }} />
        <strong>{area.name}</strong>
      </div>
      <div className="fa-popup-sub">Brgy. {area.barangay} · {FLOOD_TYPE_LABEL[area.type] || 'Flood'}</div>
      <div className="fa-popup-depth" style={{ color: meta.color }}>
        {formatFloodDepth(area)} <span className="fa-popup-depth-lbl">· {meta.label} risk</span>
      </div>
      <div className="fa-popup-meter" role="img" aria-label={`Severity: ${meta.label}`}>
        <div className="fa-popup-meter-fill" style={{ width: `${meterPct}%`, background: meta.color }} />
      </div>
      <span className={`fa-popup-prov ${area.estimated ? 'est' : 'obs'}`}>
        {area.estimated ? 'Estimated band — barangay-wide figure' : 'Documented observation'}
      </span>
      {Array.isArray(area.causes) && area.causes.length > 0 && (
        <div className="fa-popup-row"><b>Cause:</b> {area.causes.join(', ')}</div>
      )}
      {area.sourceStorms && (
        <div className="fa-popup-row"><b>Recorded under:</b> {area.sourceStorms}</div>
      )}
      {area.notes && <div className="fa-popup-notes">{area.notes}</div>}
      <div className="fa-popup-foot">
        {area.reportedBy || 'CDRRMO'}{area.updatedAt ? ` · ${nowLabel(area.updatedAt)}` : ''}
      </div>
    </div>
  )
}

/**
 * Render the flood-prone areas as map markers (shared pin family).
 *   areas    — array of flood-area records
 *   only     — optional barangay name to filter to (barangay jurisdiction view)
 *   onSelect — optional click handler (manage screen highlights the row)
 *   interactive — when false, no popup/click (e.g. static report context)
 */
export function FloodAreaMarkers({ areas = [], only = null, onSelect, interactive = true }) {
  const list = only ? areas.filter((a) => a.barangay === only) : areas
  return list
    .filter((a) => Array.isArray(a.coords) && a.coords.length === 2)
    .map((a) => {
      const sev = floodSeverity(a)
      const meta = FLOOD_SEVERITY_META[sev]
      return (
        <Marker
          key={a.id}
          position={a.coords}
          icon={pinIcon({
            color: meta.color,
            glyph: a.type === 'flash_flood' ? 'alert' : 'drop',
            size: PIN_SIZE[sev],
          })}
          eventHandlers={onSelect ? { click: () => onSelect(a) } : undefined}
        >
          {!interactive && (
            <Tooltip direction="top">
              <b>{a.name}</b> · {formatFloodDepth(a)}
            </Tooltip>
          )}
          {interactive && <Popup><FloodAreaPopup area={a} /></Popup>}
        </Marker>
      )
    })
}

/** Compact legend row set for the flood-prone-area severity ramp. */
export function FloodAreaLegend() {
  return (
    <div className="fa-legend">
      {['high', 'moderate', 'low'].map((k) => (
        <span className="fa-legend-row" key={k}>
          <span className="fa-legend-dot" style={{ background: FLOOD_SEVERITY_META[k].color }} />
          {FLOOD_SEVERITY_META[k].label}
        </span>
      ))}
    </div>
  )
}
