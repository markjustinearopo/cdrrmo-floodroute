/* ============================================================
   PartialBlockPicker — choosing the section of road to close.

   Two components, because the work happens in two places that cannot be one
   component: the picking is inside the Leaflet map, and the controls are a
   panel over it.

     <PartialBlockPickMap>   — mounts INSIDE <MapContainer>. Catches clicks,
                               snaps them onto the chosen road, and draws the
                               candidate road, the two caps and the live span.
     <PartialBlockPanel>     — the floating control panel: Select Start Point,
                               Select End Point, Confirm, Cancel, and a preview
                               of what is about to be closed.

   BOTH clicks snap. An operator clicking "the flooded bit by the school" will
   land ten metres off the centreline; projectOnWay puts the pick back onto the
   road, because a start point that is not ON the road describes no section of
   it. A click that lands more than SNAP_TOLERANCE_M away is rejected with a
   message rather than silently snapped to somewhere surprising.

   The section is previewed BEFORE it is confirmed, in the same red the map
   will use afterwards, so the operator approves the thing itself rather than
   a description of it.
   ============================================================ */

import { useMemo } from 'react'
import { Polyline, CircleMarker, Tooltip, useMapEvents } from 'react-leaflet'
import {
  wayLatLngs, projectOnWay, sliceWay, wayLengthM,
} from './roadBlocks.js'
import { haversineMeters } from './geo.js'
import { describeDepth } from '../../services/depth.js'
import '../map/roadBlocks.css'
import './partialBlockPicker.css'

/* How far off the centreline a click may land and still count as "on this
   road". Generous, because a finger on a phone is not a mouse, and because the
   road is already chosen — the click is choosing a POSITION along it, not
   which road it is. Beyond this the operator has almost certainly clicked a
   different street, and guessing would put the closure in the wrong place. */
export const SNAP_TOLERANCE_M = 40

/**
 * The in-map half.
 *
 * @param road      the road GeoJSON feature being closed
 * @param start     projection | null   (from projectOnWay)
 * @param end       projection | null
 * @param stage     'start' | 'end' | 'done' — which click the next one is
 * @param onPick(projection)  a valid snapped pick
 * @param onReject(message)   the click did not land on this road
 */
export function PartialBlockPickMap({ road, start, end, stage, onPick, onReject }) {
  const latlngs = useMemo(() => wayLatLngs(road), [road])

  useMapEvents({
    click(e) {
      if (!latlngs.length || stage === 'done') return
      const hit = projectOnWay(latlngs, [e.latlng.lat, e.latlng.lng])
      if (!hit) return
      if (hit.offsetM > SNAP_TOLERANCE_M) {
        onReject?.(
          `That point is ${Math.round(hit.offsetM)} m from ${road?.properties?.name || 'this road'}.`
          + ' Click on the road itself.',
        )
        return
      }
      onPick?.(hit)
    },
  })

  if (!latlngs.length) return null

  // The section as it stands: drawn the moment BOTH points exist, in the
  // colour it will be after confirmation.
  const span = start && end ? sliceWay(latlngs, start, end) : []

  return (
    <>
      {/* The road under consideration, so there is no doubt which one the two
          clicks belong to. */}
      <Polyline
        positions={latlngs}
        className="rbp-candidate"
        pathOptions={{ color: '#2563eb', weight: 9, opacity: 0.45, lineCap: 'round' }}
        interactive={false}
      />

      {span.length > 1 && (
        <>
          <Polyline
            positions={span}
            pathOptions={{ color: '#dc2626', weight: 18, opacity: 0.25, lineCap: 'butt' }}
            interactive={false}
          />
          <Polyline
            positions={span}
            pathOptions={{ color: '#dc2626', weight: 7, opacity: 0.95, lineCap: 'butt' }}
            interactive={false}
          />
        </>
      )}

      {start && (
        <CircleMarker
          center={start.point}
          radius={7}
          pathOptions={{ color: '#fff', weight: 2.5, fillColor: '#dc2626', fillOpacity: 1 }}
          interactive={false}
        >
          <Tooltip permanent direction="top" offset={[0, -8]} className="rbp-cap-label">START</Tooltip>
        </CircleMarker>
      )}
      {end && (
        <CircleMarker
          center={end.point}
          radius={7}
          pathOptions={{ color: '#fff', weight: 2.5, fillColor: '#dc2626', fillOpacity: 1 }}
          interactive={false}
        >
          <Tooltip permanent direction="top" offset={[0, -8]} className="rbp-cap-label">END</Tooltip>
        </CircleMarker>
      )}
    </>
  )
}

/**
 * The controls half — rendered over the map, not inside it.
 *
 * @param road       the road feature being closed
 * @param start/end  projections
 * @param stage      'start' | 'end' | 'done'
 * @param details    { effect, reason, depthM, hazardLevel }
 * @param onDetails(patch)
 * @param onStage(stage)  re-arm "pick the start" / "pick the end"
 * @param onReset    clear both picks
 * @param onConfirm / onCancel
 * @param message    the last rejection, shown inline
 * @param busy       a save is in flight
 */
export function PartialBlockPanel({
  road, start, end, stage, details, onDetails, onStage, onReset, onConfirm, onCancel, message, busy,
}) {
  const latlngs = useMemo(() => wayLatLngs(road), [road])
  const span = start && end ? sliceWay(latlngs, start, end) : []
  const spanM = span.length > 1 ? wayLengthM(span) : 0
  const totalM = useMemo(() => wayLengthM(latlngs), [latlngs])
  const name = road?.properties?.name || `Road #${road?.properties?.id}`

  /* What stays OPEN. Stated as prominently as what closes, because the whole
     reason this feature exists is that closing the whole road was wrong — and
     an operator should be able to see, before confirming, that they have not
     just done that by accident. */
  const openM = Math.max(0, totalM - spanM)
  const share = totalM > 0 ? Math.round((spanM / totalM) * 100) : 0

  const ready = Boolean(start && end && span.length > 1)

  return (
    <div className="rbp-panel" role="group" aria-label="Select road block area">
      <div className="rbp-hdr">
        <span className="rbp-title">Partial Road Block</span>
        <span className="rbp-road">{name}</span>
      </div>

      <ol className="rbp-steps">
        <li className={stage === 'start' ? 'on' : start ? 'done' : ''}>
          <button type="button" onClick={() => onStage('start')}>
            <span className="rbp-step-n">1</span>
            <span className="rbp-step-l">
              Select Start Point
              <em>{start ? `${start.point[0].toFixed(5)}, ${start.point[1].toFixed(5)}` : 'Click the road on the map'}</em>
            </span>
          </button>
        </li>
        <li className={stage === 'end' ? 'on' : end ? 'done' : ''}>
          <button type="button" onClick={() => onStage('end')} disabled={!start}>
            <span className="rbp-step-n">2</span>
            <span className="rbp-step-l">
              Select End Point
              <em>{end ? `${end.point[0].toFixed(5)}, ${end.point[1].toFixed(5)}` : 'Click the far end of the closure'}</em>
            </span>
          </button>
        </li>
      </ol>

      {message && <div className="rbp-msg">{message}</div>}

      {/* The preview, in numbers. The map has the picture; this is the part an
          operator can check against what they were told on the radio. */}
      {ready && (
        <div className="rbp-preview">
          <div className="rbp-bar" aria-hidden="true">
            <span className="rbp-bar-open" style={{ flex: Math.max(0.001, start.alongM <= end.alongM ? start.alongM : end.alongM) }} />
            <span className="rbp-bar-blocked" style={{ flex: Math.max(0.001, spanM) }} />
            <span className="rbp-bar-open" style={{ flex: Math.max(0.001, totalM - spanM - (start.alongM <= end.alongM ? start.alongM : end.alongM)) }} />
          </div>
          <div className="rbp-figures">
            <span className="rbp-fig blocked"><b>{fmtM(spanM)}</b> blocked ({share}%)</span>
            <span className="rbp-fig open"><b>{fmtM(openM)}</b> stays open</span>
          </div>
        </div>
      )}

      <label className="rbp-field">
        Effect on routing
        <div className="rbp-effect">
          {[
            { v: 'blocked', l: 'Impassable', c: '#dc2626' },
            { v: 'flooded', l: 'Flooded (passable)', c: '#f97316' },
          ].map((o) => (
            <button
              type="button"
              key={o.v}
              className={`rbp-effect-btn ${details.effect === o.v ? 'on' : ''}`}
              style={{ '--c': o.c }}
              onClick={() => onDetails({ effect: o.v })}
            >
              <span className="rbp-effect-dot" />{o.l}
            </button>
          ))}
        </div>
        <span className="rbp-hint">
          {details.effect === 'blocked'
            ? 'Routes will not use this section at all.'
            : 'Routes will avoid this section unless there is no alternative.'}
        </span>
      </label>

      <label className="rbp-field">
        Flood depth (metres)
        <input
          type="number"
          min="0"
          step="0.05"
          value={details.depthM}
          onChange={(e) => onDetails({ depthM: e.target.value })}
          placeholder="e.g. 0.8"
        />
        <span className="rbp-hint">
          {describeDepth(details.depthM === '' ? null : Number(details.depthM))
            || 'Sets the hazard level shown to residents.'}
        </span>
      </label>

      <label className="rbp-field">
        Reason for closure
        <textarea
          rows={2}
          value={details.reason}
          onChange={(e) => onDetails({ reason: e.target.value })}
          placeholder="e.g. Underpass under water; impassable to all vehicles."
        />
      </label>

      <div className="rbp-actions">
        <button type="button" className="rbp-btn ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {(start || end) && (
          <button type="button" className="rbp-btn ghost" onClick={onReset} disabled={busy}>
            Clear points
          </button>
        )}
        <button type="button" className="rbp-btn primary" onClick={onConfirm} disabled={!ready || busy}>
          {busy ? 'Saving…' : 'Confirm Road Block'}
        </button>
      </div>
    </div>
  )
}

function fmtM(m) {
  if (!Number.isFinite(m)) return '—'
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`
}

/**
 * Turn two picks into the record the database stores. Kept beside the picker
 * so the shape the panel previews and the shape that is saved are written in
 * one place and cannot drift apart.
 */
export function buildBlockRecord({ road, start, end, details, barangay, createdBy, accountId }) {
  const latlngs = wayLatLngs(road)
  const geometry = sliceWay(latlngs, start, end)
  const depthM = details.depthM === '' || details.depthM == null ? null : Number(details.depthM)
  const [from, to] = start.alongM <= end.alongM ? [start, end] : [end, start]
  return {
    wayId: road?.properties?.id,
    roadName: road?.properties?.name || `Road #${road?.properties?.id}`,
    barangay: barangay || '',
    scope: 'partial',
    start: from.point,
    end: to.point,
    geometry,
    lengthM: Math.round(wayLengthM(geometry)),
    reason: details.reason || '',
    depthM,
    hazardLevel: hazardLevelFor(depthM, details.effect),
    effect: details.effect === 'flooded' ? 'flooded' : 'blocked',
    status: 'active',
    createdBy: createdBy || 'CDRRMO',
    accountId: accountId ?? null,
  }
}

/* Depth → the hazard vocabulary the rest of the product uses. A closure with
   no depth recorded is still a hazard, so an impassable one without a
   measurement reports 'high' rather than nothing — the operator closed it for
   a reason even if they did not have a ruler. */
function hazardLevelFor(depthM, effect) {
  if (depthM == null) return effect === 'blocked' ? 'high' : 'moderate'
  if (depthM >= 1.0) return 'severe'
  if (depthM >= 0.5) return 'high'
  if (depthM >= 0.3) return 'moderate'
  return 'low'
}

/* Distance between two picks, for callers that want it without slicing. */
export function pickSeparationM(a, b) {
  return a && b ? haversineMeters(a.point, b.point) : 0
}
