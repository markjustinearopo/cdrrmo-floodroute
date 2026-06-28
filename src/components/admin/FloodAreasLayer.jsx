/* ============================================================
   FloodAreasLayer — the shared Leaflet overlay for the city's
   documented flood-prone areas (depth in feet).

   One implementation, reused by every flood map (admin / barangay /
   resident) and the admin Flood-Prone Areas management screen, so a
   record looks and reads the same everywhere. Each area is a colour-coded
   ring (sized + tinted by severity) with a detailed popup: depth in feet,
   flood type, the rain drivers, the storms it was recorded under, and the
   CDRRMO note.
   ============================================================ */

import { CircleMarker, Tooltip, Popup } from 'react-leaflet'
import {
  FLOOD_SEVERITY_META,
  FLOOD_TYPE_LABEL,
  floodSeverity,
  formatFloodDepth,
  floodMarkerRadius,
} from '../../data/floodAreas.js'
import { nowLabel } from '../../context/AdminDataContext.jsx'
import './FloodAreasLayer.css'

/** Detailed popup body for one flood-prone area (also used by the manage page). */
export function FloodAreaPopup({ area }) {
  const sev = floodSeverity(area)
  const meta = FLOOD_SEVERITY_META[sev]
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
 * Render the flood-prone areas as map markers.
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
        <CircleMarker
          key={a.id}
          center={a.coords}
          radius={floodMarkerRadius(a)}
          pathOptions={{
            color: '#fff',
            weight: 1.5,
            fillColor: meta.color,
            fillOpacity: 0.92,
          }}
          eventHandlers={onSelect ? { click: () => onSelect(a) } : undefined}
        >
          {!interactive && (
            <Tooltip direction="top">
              <b>{a.name}</b> · {formatFloodDepth(a)}
            </Tooltip>
          )}
          {interactive && <Popup><FloodAreaPopup area={a} /></Popup>}
        </CircleMarker>
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
