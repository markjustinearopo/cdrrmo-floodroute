/* ============================================================
   RescueAlertWatcher — the push onto the CDRRMO Admin screen.

   Mounted once in the admin shell, so a rescue request raised on a resident's
   phone announces itself on whatever screen the duty officer happens to be
   looking at — Dashboard, Flood Map, Settings, anything. Without this, the
   requirement "displayed in real time" would depend on somebody being on the
   right page at the right moment, which during a typhoon they will not be.

   The transport is already there: AdminDataContext subscribes to
   rescue_requests over Supabase realtime and polls every 6 s as a fallback.
   This component's whole job is to notice a request it has NOT announced yet
   and put it on the screen.

   WHY IT IS A BANNER AND NOT A FULL TAKEOVER
   EmergencyAlert takes the entire screen because an evacuation order is
   addressed TO the person reading it. A rescue request is addressed to the
   office ABOUT somebody else, and an operator who is mid-dispatch must not be
   locked out of the map to read it. So: a loud, sticky, unmissable card in the
   corner with a siren behind it, that does not steal the pointer and does not
   go away on its own. It stays until acknowledged, and acknowledging it is not
   the same as handling the request — the queue keeps that.

   Announcements are remembered per browser: a page reload must not re-sound
   requests the officer already dealt with an hour ago.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRescueRequests } from '../../context/AdminDataContext.jsx'
import './rescueAlert.css'

const SEEN_KEY = 'cdrrmo_rescue_seen'

/* Requests older than this are not announced on first load. Opening the
   console in the morning should not sound a siren for last night's rescues —
   they belong in the queue, not in your face. */
const FRESH_MS = 15 * 60 * 1000

function readSeen() {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
function writeSeen(ids) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-100))) } catch { /* full */ }
}

/**
 * Two short rising tones, twice — enough to turn a head in a busy operations
 * room, short enough that it does not have to be muted to keep working.
 * Synthesised for the same reason EmergencyAlert's siren is: no asset to load,
 * nothing that can fail silently because a file 404'd.
 */
function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.connect(gain)
    const t0 = ctx.currentTime
    gain.gain.setValueAtTime(0.0001, t0)
    for (let i = 0; i < 2; i++) {
      const t = t0 + i * 0.85
      osc.frequency.setValueAtTime(740, t)
      osc.frequency.setValueAtTime(988, t + 0.18)
      gain.gain.setValueAtTime(0.14, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    }
    osc.start(t0)
    osc.stop(t0 + 1.6)
    setTimeout(() => ctx.close().catch(() => {}), 2200)
  } catch {
    /* Autoplay policy, no audio device, anything: the card is the real signal
       and stands on its own. */
  }
}

export default function RescueAlertWatcher() {
  const { rescueRequests } = useRescueRequests()
  const navigate = useNavigate()
  const [seen, setSeen] = useState(readSeen)
  // Guards the very first render: everything already in the collection when
  // this mounts is history, not news.
  const mountedAt = useRef(Date.now())

  /* Announceable: still pending, not yet acknowledged on this browser, and
     raised recently enough to be actionable. */
  const queue = useMemo(() => rescueRequests.filter((r) => (
    r.status === 'pending'
    && !seen.includes(r.id)
    && Date.now() - (r.requestedAt || 0) < FRESH_MS
    // An optimistic row (tmp-…) is one this browser created; it will arrive
    // again with a real id. Announcing both would double-sound the same event.
    && !(typeof r.id === 'string' && r.id.startsWith('tmp-'))
  )), [rescueRequests, seen])

  const top = queue[0] || null

  // Sound once per newly announced request, not once per render.
  const soundedRef = useRef(null)
  useEffect(() => {
    if (!top || soundedRef.current === top.id) return
    soundedRef.current = top.id
    // A request that predates this session's start is being seen for the first
    // time by THIS browser but is not new — show it, do not sound it.
    if ((top.requestedAt || 0) >= mountedAt.current - FRESH_MS) chime()
    if (navigator.vibrate) navigator.vibrate([250, 120, 250])
  }, [top])

  const acknowledge = useCallback((id) => {
    const next = [...readSeen(), id]
    setSeen(next)
    writeSeen(next)
  }, [])

  const openRequest = useCallback((id) => {
    acknowledge(id)
    navigate(`/admin/rescue?id=${id}`)
  }, [acknowledge, navigate])

  if (!top) return null

  return (
    <div className="rsa" role="alert" aria-live="assertive">
      <div className="rsa-card">
        <div className="rsa-rail" aria-hidden="true" />
        <div className="rsa-body">
          <div className="rsa-kicker">
            🚨 Emergency Rescue Request
            {queue.length > 1 && <span className="rsa-more">+{queue.length - 1} more</span>}
          </div>

          <div className="rsa-who">
            {top.reporter || 'A resident'} — {top.barangay ? `Brgy. ${top.barangay}` : 'Cabuyao City'}
          </div>

          <div className="rsa-reason">
            Reason: <b>No safe route available</b>
          </div>

          {top.hazard?.summary && <div className="rsa-hazard">{top.hazard.summary}</div>}

          <div className="rsa-coords">
            {Array.isArray(top.coords)
              ? `${top.coords[0].toFixed(5)}, ${top.coords[1].toFixed(5)}`
              : 'No GPS position recorded'}
            {top.accuracyM != null && <> · ±{Math.round(top.accuracyM)} m</>}
            <span className="rsa-time"> · {top.requested}</span>
          </div>

          <div className="rsa-actions">
            <button type="button" className="rsa-open" onClick={() => openRequest(top.id)}>
              View on map
            </button>
            <button type="button" className="rsa-ack" onClick={() => acknowledge(top.id)}>
              Dismiss
            </button>
          </div>

          <div className="rsa-foot">
            The request stays in the rescue queue until CDRRMO resolves it.
          </div>
        </div>
      </div>
    </div>
  )
}
