/* ============================================================
   FloodReportsLayer — the shared Leaflet overlay for VERIFIED
   resident flood reports.

   One implementation, reused by every flood map (admin / barangay /
   resident). It only ever paints reports whose verification_status is
   'approved', so unverified or rejected submissions never reach the
   public map. Each report is a colour-coded marker (green→dark-red by
   flood level) with a popup carrying the location, level, water depth,
   report time, the resident's remarks, the official who verified it and
   any photo evidence.
   ============================================================ */

import { Marker, Tooltip, Popup } from 'react-leaflet'
import {
  FLOOD_LEVEL_META,
  floodLevelMeta,
  formatReportDepth,
} from '../../data/floodReports.js'
import { pinIcon, PIN_SIZE } from '../map/pinIcons.js'
import './FloodAreasLayer.css'

/* Report level → pin size (severity reads largest) — shared pin family. */
const REPORT_PIN_SIZE = { none: PIN_SIZE.low, low: PIN_SIZE.low, moderate: PIN_SIZE.moderate, severe: 28, impassable: PIN_SIZE.high }

/** Detailed popup body for one verified flood report. */
export function FloodReportPopup({ report }) {
  const meta = floodLevelMeta(report.level)
  const depth = formatReportDepth(report.depthFt)
  return (
    <div className="fa-popup">
      <div className="fa-popup-head">
        <span className="fa-popup-dot" style={{ background: meta.color }} />
        <strong>{meta.label}</strong>
      </div>
      <div className="fa-popup-sub">
        Brgy. {report.barangay || '—'}
        {report.coords ? ` · ${report.coords[0].toFixed(4)}, ${report.coords[1].toFixed(4)}` : ''}
      </div>
      {depth && (
        <div className="fa-popup-depth" style={{ color: meta.color }}>
          {depth} <span className="fa-popup-depth-lbl">· reported water depth</span>
        </div>
      )}
      {report.description && <div className="fa-popup-notes">{report.description}</div>}
      {report.photo && (
        <img
          src={report.photo}
          alt={`Evidence for ${meta.label}`}
          style={{ width: '100%', borderRadius: 6, margin: '6px 0', display: 'block' }}
        />
      )}
      <div className="fa-popup-row"><b>Reported:</b> {report.reported}</div>
      <div className="fa-popup-foot">
        Verified by {report.verifiedBy || 'CDRRMO'}{report.verified ? ` · ${report.verified}` : ''}
      </div>
    </div>
  )
}

/**
 * Render verified flood reports as map markers.
 *   reports     — array of flood-report records (any status; filtered here)
 *   only        — optional barangay name to filter to (barangay jurisdiction)
 *   interactive — when false, hover tooltip instead of a click popup
 */
export function FloodReportMarkers({ reports = [], only = null, interactive = true }) {
  const list = reports.filter((r) => (
    r.status === 'approved'
    && Array.isArray(r.coords) && r.coords.length === 2
    && (!only || r.barangay === only)
  ))
  return list.map((r) => {
    const meta = floodLevelMeta(r.level)
    return (
      <Marker
        key={`fr-${r.id}`}
        position={r.coords}
        icon={pinIcon({ color: meta.color, glyph: 'drop', size: REPORT_PIN_SIZE[r.level] || PIN_SIZE.low })}
      >
        {interactive
          ? <Popup><FloodReportPopup report={r} /></Popup>
          : (
            <Tooltip direction="top">
              <b>{meta.label}</b>{formatReportDepth(r.depthFt) ? ` · ${formatReportDepth(r.depthFt)}` : ''}
            </Tooltip>
          )}
      </Marker>
    )
  })
}

/** Compact legend for the resident/verified flood-report ramp. */
export function FloodReportLegend() {
  return (
    <div className="fa-legend">
      {['low', 'moderate', 'severe', 'impassable'].map((k) => (
        <span className="fa-legend-row" key={k}>
          <span className="fa-legend-dot" style={{ background: FLOOD_LEVEL_META[k].color }} />
          {FLOOD_LEVEL_META[k].short}
        </span>
      ))}
    </div>
  )
}
