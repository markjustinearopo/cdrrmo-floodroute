/* ============================================================
   useRescueTrigger — filing the automatic rescue request.

   One place decides everything that happens after routeSafety returns
   'no-safe-route', so every entry point that can reach that verdict (the
   resident routing screen's "Generate safe route", "Start guided navigation",
   and anything added later) files an identical, complete request instead of
   each screen assembling its own half of the payload.

   Three things this owns that a screen should not:

   1. A LIVE GPS FIX. The route may have been planned from a pin the resident
      dropped twenty minutes ago; the rescue must carry where they are NOW.
      The fix is attempted with a short leash and falls back to the pin — a
      request with an approximate position beats no request, and the accuracy
      travels with it so a responder knows which one they are reading.

   2. DEDUPLICATION. Pressing the button three times must not put three people
      on CDRRMO's screen. An open request from this account inside the reuse
      window is returned as-is instead of a new row.

   3. NEVER SWALLOWING THE FAILURE. If the write cannot reach the database the
      popup still opens, still says stay put, and says plainly that the request
      has not gone through and to call instead. The one unacceptable outcome is
      a screen that says help is coming when nothing was sent.
   ============================================================ */

import { useCallback, useRef, useState } from 'react'
import { useRescueRequests, barangayCoords } from '../context/AdminDataContext.jsx'
import { describeBlockage, blockageLevel } from '../components/admin/routeSafety.js'
import { getResidentBarangay } from '../data/resident.js'
import api from '../services/api.js'

/* How long an open request from the same person is reused rather than
   duplicated. Thirty minutes is longer than a person will keep pressing the
   button and shorter than a rescue takes, so a genuinely new situation an hour
   later still raises a new request. */
const REUSE_WINDOW_MS = 30 * 60 * 1000

/* Statuses that mean "CDRRMO has not finished with this yet". A rescued or
   resolved request is history and never suppresses a new one. */
const OPEN = new Set(['pending', 'responding'])

export function useRescueTrigger() {
  const { rescueRequests, createRescueRequest } = useRescueRequests()
  const [alert, setAlert] = useState(null) // { location, evidence, summary } | null
  const [request, setRequest] = useState(null)
  const [localError, setLocalError] = useState(null)
  const [filing, setFiling] = useState(false)
  // Last payload, so "Try sending again" re-files exactly what failed rather
  // than re-running the router from a screen that has since moved on.
  const lastPayload = useRef(null)
  const inFlight = useRef(false)

  /**
   * File the request and open the resident takeover.
   *
   * @param verdict  routeSafety.findSafeRoute result (verdict 'no-safe-route')
   * @param ctx      { origin, pin, locate }  — where the resident is, and a
   *                 way to ask the device for a better answer
   */
  const trigger = useCallback(async (verdict, { origin, locate } = {}) => {
    if (inFlight.current) return null
    inFlight.current = true
    const user = api.getUser?.() || null
    const barangay = getResidentBarangay() || user?.barangay || ''
    const evidence = verdict?.evidence || { roads: [], maxDepthM: 0 }
    const summary = describeBlockage(evidence)

    setFiling(true)
    setLocalError(null)
    setRequest(null)

    /* A fresh fix, if the device will give one quickly. Failure here is
       ordinary (indoors, permission denied, no signal) and must not stop the
       request — it only means the pin is the best position available. */
    let coords = origin || barangayCoords(barangay)
    let accuracyM = null
    if (locate) {
      try {
        const fix = await locate()
        coords = [fix.lat, fix.lng]
        accuracyM = fix.accuracy ?? null
      } catch {
        /* keep the pin */
      }
    }

    const location = {
      coords,
      accuracyM,
      barangay,
      label: barangay ? `Brgy. ${barangay}` : 'Cabuyao City',
    }

    // An open request from this person already on CDRRMO's screen: point the
    // popup at it instead of filing a second one.
    const existing = rescueRequests.find((r) => (
      OPEN.has(r.status)
      && r.id != null && !String(r.id).startsWith('tmp-')
      && (user?.id != null ? r.accountId === user.id : r.barangay === barangay)
      && Date.now() - (r.requestedAt || 0) < REUSE_WINDOW_MS
    ))

    const payload = {
      accountId: user?.id ?? null,
      reporter: user?.fullName || user?.username || user?.email || 'Resident',
      contact: user?.contact || user?.phone || user?.email || '',
      barangay,
      coords,
      accuracyM,
      location: location.label,
      reason: 'no-safe-route',
      /* The evidence, kept whole. A responder deciding whether to send a truck
         or a boat needs the depth and the road names, and an after-action
         review needs to see what the model said at the moment it refused. */
      hazard: {
        summary,
        level: blockageLevel(evidence),
        maxDepthM: evidence.maxDepthM ?? null,
        meanRisk: evidence.meanRisk ?? null,
        roads: evidence.roads || [],
        attempted: verdict?.attempted || [],
        nearestCentre: verdict?.nearest?.name || null,
        at: Date.now(),
      },
      blockedRoads: (evidence.roads || []).map((r) => r.name).filter(Boolean),
    }
    lastPayload.current = payload
    setAlert({ location, evidence, summary })

    let filed = existing || null
    let error = null
    if (!existing) {
      try {
        filed = await createRescueRequest(payload)
      } catch (e) {
        error = e?.message || 'Could not reach CDRRMO.'
      }
    }

    setRequest(filed)
    setLocalError(error)
    setAlert({ location, evidence, summary })
    setFiling(false)
    inFlight.current = false
    return filed
  }, [rescueRequests, createRescueRequest])

  const retry = useCallback(async () => {
    if (!lastPayload.current || inFlight.current) return
    inFlight.current = true
    setFiling(true)
    setLocalError(null)
    try {
      setRequest(await createRescueRequest(lastPayload.current))
      setLocalError(null)
    } catch (e) {
      setLocalError(e?.message || 'Could not reach CDRRMO.')
    } finally {
      inFlight.current = false
      setFiling(false)
    }
  }, [createRescueRequest])

  const dismiss = useCallback(() => setAlert(null), [])

  const sendError = localError

  /* The row the popup shows, re-read from the live collection on every render
     so the status a responder sets (Pending → Responding → Rescued) appears on
     the resident's own screen. Keep the acknowledged row until the next read. */
  const liveRequest = (request && rescueRequests.find((r) => r.id === request.id)) || request

  return { alert, request: liveRequest, sendError, filing, trigger, retry, dismiss }
}

export default useRescueTrigger
