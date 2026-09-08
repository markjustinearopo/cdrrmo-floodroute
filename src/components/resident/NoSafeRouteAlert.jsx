/* ============================================================
   NO SAFE ROUTE AVAILABLE — the resident takeover.

   This is the screen a person sees when the flood-aware router has searched
   every road out of where they are standing and found that all of them are
   flooded or closed. It is the one place in this product where the correct
   advice is DO NOT MOVE, and it has to be unmistakable for that, because the
   instinct in rising water is to walk.

   It deliberately looks like EmergencyAlert (the same red takeover, the same
   pulsing rail) rather than like a routing error, because it IS an emergency:
   by the time it appears, a rescue request has already been filed with CDRRMO
   on this person's behalf. Nothing here asks them to do anything to make that
   happen — they are cut off, possibly in the dark, possibly on a phone at 4%.

   What it must show, and does:
     • the instruction to stay put, first and largest
     • their own GPS position, in words and numbers, so they can read it to a
       responder on the phone if the app cannot reach the network
     • which roads are flooded or closed, and how deep
     • that the request WAS sent, its reference, and its live status
     • the hotlines, because a phone call still beats an app
   ============================================================ */

import { useEffect } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap.js'
import { describeDepth } from '../../services/depth.js'
import { RESCUE_STATUS_LABEL } from '../../services/db.js'
import './NoSafeRouteAlert.css'

const HOTLINES = [
  { name: 'CDRRMO Cabuyao', number: '(049) 502-2377', tel: '0495022377' },
  { name: 'National Emergency', number: '911', tel: '911' },
]

/**
 * @param open       show it
 * @param location   { coords: [lat, lng], accuracyM, barangay, label }
 * @param evidence   routeSafety.hazardEvidence result ({ roads, maxDepthM })
 * @param summary    routeSafety.describeBlockage(evidence)
 * @param request    the rescue request row (optimistic or persisted) | null
 * @param sendError  message when the request could not reach the database
 * @param onClose    dismiss (the advice stands; the request is already filed)
 * @param onRetry    re-file a request whose write failed
 */
export default function NoSafeRouteAlert({
  open,
  location,
  evidence,
  summary,
  request,
  sendError,
  onClose,
  onRetry,
}) {
  const trapRef = useFocusTrap(Boolean(open))

  /* Escape does not close this. Same reasoning as the emergency takeover: the
     reflex that dismisses an ordinary modal must not dismiss the one screen
     telling somebody not to walk into a flooded street. The button does. */
  useEffect(() => {
    if (!open) return undefined
    const block = (e) => { if (e.key === 'Escape') e.stopPropagation() }
    window.addEventListener('keydown', block, true)
    return () => window.removeEventListener('keydown', block, true)
  }, [open])

  /* A short haptic burst where the device has it. No siren: unlike an
     evacuation order, this fires on a screen the person is already looking at
     — they just pressed the button — so noise adds nothing they do not
     already have, and the app may be the only light in the room. */
  useEffect(() => {
    if (!open || !navigator.vibrate) return undefined
    navigator.vibrate([300, 120, 300])
    return () => navigator.vibrate(0)
  }, [open])

  if (!open) return null

  const coords = location?.coords
  const roads = evidence?.roads || []
  const depth = describeDepth(evidence?.maxDepthM)
  const status = request?.status || 'pending'
  // A `tmp-` id is the optimistic row: the request exists on this screen but
  // has not come back from the database with a real reference number yet.
  const pending = typeof request?.id === 'string' && request.id.startsWith('tmp-')

  return (
    <div
      ref={trapRef}
      tabIndex={-1}
      className="nsr"
      role="alertdialog"
      aria-modal="true"
      aria-label="No safe route available"
    >
      <div className="nsr-card">
        <div className="nsr-bar" aria-hidden="true" />

        <div className="nsr-head">
          <span className="nsr-icon" aria-hidden="true"><WarnIcon /></span>
          <div>
            <div className="nsr-kicker">Automatic rescue request</div>
            <h2 className="nsr-title">NO SAFE ROUTE AVAILABLE</h2>
          </div>
        </div>

        {/* The instruction, in the exact words CDRRMO asked for. Everything
            else on this screen is supporting detail for this sentence. */}
        <p className="nsr-instruction">
          <b>Please stay at your current location.</b> Do not attempt to travel
          through flooded or blocked roads. A rescue request has been
          automatically sent to the CDRRMO.
        </p>

        {/* ── Where they are ── */}
        <section className="nsr-block">
          <h3 className="nsr-block-title"><PinIcon /> Your current location</h3>
          {coords ? (
            <>
              <div className="nsr-coords">
                {coords[0].toFixed(5)}, {coords[1].toFixed(5)}
              </div>
              <div className="nsr-sub">
                {location?.label || (location?.barangay ? `Brgy. ${location.barangay}` : 'Cabuyao City')}
                {location?.accuracyM != null && (
                  <> · GPS accurate to about {Math.round(location.accuracyM)} m</>
                )}
              </div>
              <div className="nsr-note">
                Read these numbers to the responder if you call. They have been sent
                to CDRRMO with your request.
              </div>
            </>
          ) : (
            <div className="nsr-sub">
              Your exact position is not available. Tell CDRRMO the nearest
              landmark when you call.
            </div>
          )}
        </section>

        {/* ── Why ── */}
        <section className="nsr-block">
          <h3 className="nsr-block-title"><WaterIcon /> Why there is no route</h3>
          <p className="nsr-sub">{summary}</p>
          {depth && <p className="nsr-depth">Deepest water on every route out: {depth}</p>}
          {roads.length > 0 && (
            <ul className="nsr-roads">
              {roads.slice(0, 8).map((r) => (
                <li key={`${r.wayId}-${r.name}`}>
                  <span className={`nsr-dot ${r.status === 'closed' ? 'closed' : 'flooded'}`} />
                  <span className="nsr-road-name">{r.name}</span>
                  <span className="nsr-road-status">{r.status}</span>
                </li>
              ))}
              {roads.length > 8 && (
                <li className="nsr-more">and {roads.length - 8} more</li>
              )}
            </ul>
          )}
        </section>

        {/* ── The request itself ── */}
        <section className={`nsr-block nsr-receipt ${sendError ? 'err' : ''}`}>
          {sendError ? (
            <>
              <h3 className="nsr-block-title"><WarnIcon /> Request not sent yet</h3>
              <p className="nsr-sub">
                Your phone could not reach CDRRMO ({sendError}). <b>Call now</b> using
                the numbers below — do not wait, and do not travel.
              </p>
              {onRetry && (
                <button type="button" className="nsr-retry" onClick={onRetry}>
                  Try sending again
                </button>
              )}
            </>
          ) : (
            <>
              <h3 className="nsr-block-title"><CheckIcon /> Rescue request sent to CDRRMO</h3>
              <div className="nsr-receipt-row">
                <span className="nsr-ref">
                  {pending ? 'Sending…' : `Request #${request?.id}`}
                </span>
                <span className={`nsr-status ${status}`}>
                  {RESCUE_STATUS_LABEL[status] || status}
                </span>
              </div>
              <div className="nsr-sub">
                Filed {request?.requested || 'just now'} · Reason: No safe route available.
                CDRRMO can see your location on their map. This status updates here
                as responders move.
              </div>
            </>
          )}
        </section>

        {/* ── Hotlines ── */}
        <div className="nsr-hotlines">
          {HOTLINES.map((h) => (
            <a key={h.tel} className="nsr-call" href={`tel:${h.tel}`}>
              <PhoneIcon />
              <span>
                <b>{h.name}</b>
                <em>{h.number}</em>
              </span>
            </a>
          ))}
        </div>

        <button type="button" className="nsr-ack" onClick={onClose}>
          I understand — I will stay here
        </button>

        <p className="nsr-foot">
          Your request stays open with CDRRMO after you close this. If the water
          reaches you before help does, move to the highest floor you can and
          call 911.
        </p>
      </div>
    </div>
  )
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
function PinIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
function WaterIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 2.7S5 10 5 14.2A7 7 0 0 0 19 14.2C19 10 12 2.7 12 2.7z" />
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}
function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.8a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.8.6a2 2 0 0 1 1.7 2z" />
    </svg>
  )
}
