/* ============================================================
   RescueRequestsLayer — the emergency marker on the CDRRMO map.

   One layer, drawn on every map CDRRMO looks at (Dashboard, Flood Map,
   the Rescue screen itself), so an operator never has to know WHICH screen
   shows people who are cut off. A rescue request is a person, and the pin
   has to read differently from the eighteen other kinds of pin on this map
   at a glance, in a room with the lights off:

     • it pulses while the request is still open (pending / responding)
     • it carries the GPS accuracy circle, because sending a boat to a 2 km
       circle and to a 5 m circle are different jobs and the map should not
       flatten the two into one confident dot
     • it stops pulsing, and desaturates, once the person is rescued

   Closed requests are hidden by default rather than accumulating on the map
   as red pins for events that are over.
   ============================================================ */

import { Marker, Popup, Circle } from 'react-leaflet'
import L from 'leaflet'
import './rescueMarker.css'

const OPEN = new Set(['pending', 'responding'])

const STATUS_COLOR = {
  pending: '#dc2626',
  responding: '#2563eb',
  rescued: '#16a34a',
  resolved: '#6b7280',
}

const STATUS_LABEL = {
  pending: 'Pending',
  responding: 'Responding',
  rescued: 'Rescued',
  resolved: 'Resolved',
}

const iconCache = new Map()

/** The marker itself: a person-in-distress glyph over a pulsing ring. */
export function rescueIcon(status = 'pending') {
  const key = status
  if (iconCache.has(key)) return iconCache.get(key)
  const color = STATUS_COLOR[status] || STATUS_COLOR.pending
  const live = OPEN.has(status)
  const icon = L.divIcon({
    className: 'rsq-pin-wrap',
    html:
      `<span class="rsq-pin ${live ? 'live' : 'done'}" style="--rsq:${color}">`
      + (live ? '<span class="rsq-ring" aria-hidden="true"></span>' : '')
      + '<span class="rsq-head">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>'
      + '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
      + '</svg></span></span>',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16],
  })
  iconCache.set(key, icon)
  return icon
}

/**
 * @param requests    rescue request rows (from useRescueRequests)
 * @param showClosed  also draw rescued/resolved requests
 * @param onOpen(r)   click-through to the full request
 */
export default function RescueRequestsLayer({ requests = [], showClosed = false, onOpen }) {
  const rows = requests.filter(
    (r) => Array.isArray(r.coords) && (showClosed || OPEN.has(r.status)),
  )
  if (rows.length === 0) return null

  return (
    <>
      {rows.map((r) => (
        <RescueMarker key={`rescue-${r.id}`} request={r} onOpen={onOpen} />
      ))}
    </>
  )
}

function RescueMarker({ request: r, onOpen }) {
  const color = STATUS_COLOR[r.status] || STATUS_COLOR.pending
  /* The uncertainty, drawn honestly. Only when the fix is vague enough to
     matter — a 10 m circle at city zoom is smaller than the pin and would
     just be visual noise. */
  const showAccuracy = r.accuracyM != null && r.accuracyM > 40

  return (
    <>
      {showAccuracy && (
        <Circle
          center={r.coords}
          radius={r.accuracyM}
          pathOptions={{ color, weight: 1, opacity: 0.5, fillOpacity: 0.06 }}
          interactive={false}
        />
      )}
      <Marker position={r.coords} icon={rescueIcon(r.status)} zIndexOffset={1000}>
        <Popup>
          <div className="rsq-pop">
            <div className="rsq-pop-kicker">🚨 Emergency rescue request</div>
            <strong>{r.reporter || 'Resident'}</strong>
            <div className="rsq-pop-meta">
              {r.barangay ? `Brgy. ${r.barangay}` : 'Cabuyao City'} · {r.requested}
            </div>
            <div className="rsq-pop-coords">
              {r.coords[0].toFixed(5)}, {r.coords[1].toFixed(5)}
              {r.accuracyM != null && <> · ±{Math.round(r.accuracyM)} m</>}
            </div>
            <div className="rsq-pop-reason">
              Reason: {r.reason === 'no-safe-route' ? 'No safe route available' : r.reason}
            </div>
            {r.hazard?.summary && <div className="rsq-pop-hazard">{r.hazard.summary}</div>}
            <div className="rsq-pop-row">
              <span className="rsq-pop-status" style={{ background: color }}>
                {STATUS_LABEL[r.status] || r.status}
              </span>
              {onOpen && (
                <button type="button" className="rsq-pop-open" onClick={() => onOpen(r)}>
                  Open request →
                </button>
              )}
            </div>
          </div>
        </Popup>
      </Marker>
    </>
  )
}
