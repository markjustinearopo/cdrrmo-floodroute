/* ============================================================
   RoadConditionsLayer + IncidentMarkers — the shared, READ-ONLY
   operational overlays for the barangay and resident flood maps.

   The command center's Flood Map has drawn flagged roads and incident
   pins since it shipped; the other two portals could see neither, even
   though "which roads are flooded or closed" is the single most
   actionable thing a barangay official or a resident can be told. These
   are that same picture, minus every operator control:

     • FlaggedRoadsLayer  — every road segment CDRRMO (or an approved
       barangay request) has marked flooded or closed, drawn in the
       system's road-status colours: closed = solid red, flooded =
       dashed orange. Hover for the name, condition and measured depth.
     • IncidentMarkers    — open incidents as priority-coloured pins.
       Barangay-facing only; residents never see these (an incident
       record carries the reporter, the assigned team and the response
       state — operational detail, not public information).

   Both accept `only={barangayName}` to clip the overlay to one
   jurisdiction, which is how the barangay portal's "My Barangay" view
   keeps an official inside their own area.
   ============================================================ */

import { useMemo } from 'react'
import { Polyline, Marker, Popup, Tooltip } from 'react-leaflet'
import { getCabuyaoRoads, useRoadStatus, ROAD_STATUS } from '../admin/routingHelpers.jsx'
import { useRoadReports } from '../../context/AdminDataContext.jsx'
import { barangayAt } from '../../data/cabuyaoBarangays.js'
import { ftToM, formatMeters } from '../../services/depth.js'
import { pinIcon, PIN_SIZE } from './pinIcons.js'

/* Incident priority → pin colour + size (same family the admin map uses). */
const INCIDENT_COLOR = { critical: '#7f1d1d', high: '#dc2626', medium: '#f97316', low: '#eab308' }
const INCIDENT_SIZE = { critical: PIN_SIZE.high, high: PIN_SIZE.high, medium: PIN_SIZE.moderate, low: PIN_SIZE.low }

/**
 * Resolve the painted road-status map into drawable polylines, carrying the
 * reported name / depth / reason where a report exists for the way.
 *
 * `only` clips to a single barangay. The road_status row's own `barangay`
 * column is trusted first (it is what the reporting official recorded); a
 * point-in-polygon test on the geometry is the fallback for rows written
 * before that column existed.
 */
export function useFlaggedRoadLines(only = null) {
  const [statusMap] = useRoadStatus()
  const { roadReports } = useRoadReports()

  return useMemo(() => {
    const network = getCabuyaoRoads()
    if (!network) return []
    const byId = new Map(network.features.map((f) => [String(f.properties.id), f]))
    const reportByWay = new Map(
      roadReports.filter((r) => r.wayId != null).map((r) => [String(r.wayId), r]),
    )

    const lines = []
    for (const [id, status] of Object.entries(statusMap)) {
      const f = byId.get(String(id))
      if (!f) continue
      const report = reportByWay.get(String(id))
      const latlngs = f.geometry.coordinates.map(([lng, lat]) => [lat, lng])
      if (only) {
        const mid = latlngs[Math.floor(latlngs.length / 2)]
        const brgy = report?.barangay || (mid ? barangayAt(mid[0], mid[1]) : null)
        if (brgy !== only) continue
      }
      lines.push({
        id,
        status,
        name: report?.name || f.properties.name || '',
        depthFt: report?.depthFt,
        reason: report?.reason || '',
        updated: report?.updated || '',
        latlngs,
      })
    }
    return lines
  }, [statusMap, roadReports, only])
}

/** Summary counts for the flagged network — { closed, flooded, total }. */
export function useRoadConditionSummary(only = null) {
  const lines = useFlaggedRoadLines(only)
  return useMemo(() => {
    const closed = lines.filter((l) => l.status === 'blocked').length
    return { closed, flooded: lines.length - closed, total: lines.length }
  }, [lines])
}

/**
 * Flooded / closed road segments, read-only.
 *
 * Rendered above the hazard surfaces so a closure is never buried under the
 * inundation shading — the whole point of the layer is that it is the first
 * thing you see.
 */
export function FlaggedRoadsLayer({ only = null }) {
  const lines = useFlaggedRoadLines(only)
  if (!lines.length) return null

  return (
    <>
      {lines.map((r) => {
        const meta = ROAD_STATUS[r.status] || ROAD_STATUS.flooded
        return (
          <Polyline
            key={`flagged-${r.id}`}
            positions={r.latlngs}
            pathOptions={{
              color: meta.line,
              weight: meta.weight,
              opacity: meta.opacity,
              // Closed reads as an unbroken barrier; flooded as a warning you
              // may still be able to cross. The dash carries that difference
              // without needing a legend.
              dashArray: r.status === 'blocked' ? null : '8 7',
            }}
          >
            <Tooltip sticky className="road-tip">
              <b>{r.name || 'Unnamed road'}</b>
              <br />
              {meta.label}
              {r.depthFt != null && <> · {formatMeters(ftToM(r.depthFt))} deep</>}
              {r.reason && <><br />{r.reason}</>}
              {r.updated && <><br /><small>Updated {r.updated}</small></>}
            </Tooltip>
          </Polyline>
        )
      })}
    </>
  )
}

/**
 * Open incident pins, read-only (no resolve / reassign controls).
 * Resolved incidents are dropped — the map shows what is still happening.
 */
export function IncidentMarkers({ incidents = [], only = null }) {
  const pins = useMemo(
    () =>
      incidents.filter(
        (i) =>
          Array.isArray(i.coords) &&
          i.status !== 'resolved' &&
          (!only || i.barangay === only),
      ),
    [incidents, only],
  )
  if (!pins.length) return null

  return (
    <>
      {pins.map((inc) => (
        <Marker
          key={`inc-${inc.id}`}
          position={inc.coords}
          icon={pinIcon({
            color: INCIDENT_COLOR[inc.priority] || '#dc2626',
            glyph: 'alert',
            size: INCIDENT_SIZE[inc.priority] || PIN_SIZE.moderate,
          })}
        >
          <Popup>
            <div className="fm-popup">
              <strong>{inc.type}</strong>
              <div className="fm-popup-sub">{inc.location || inc.barangay}</div>
              <div className="fm-popup-row">Priority: {inc.priority} · {inc.status}</div>
              {inc.team && <div className="fm-popup-row">Responding: {inc.team}</div>}
              {inc.description && <div className="fm-popup-row">{inc.description}</div>}
              {inc.reported && <div className="fm-popup-row"><small>Reported {inc.reported}</small></div>}
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  )
}
