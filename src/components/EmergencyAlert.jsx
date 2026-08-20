import { useCallback, useEffect, useRef, useState } from 'react'
import { useAlerts } from '../context/AdminDataContext.jsx'
import api from '../services/api.js'
import './EmergencyAlert.css'

/* ============================================================
   Emergency alert — the tier above High.

   WHAT THIS IS NOT, and the app must never imply otherwise: this is not the
   NDRRMC Emergency Cell Broadcast System. ECBS runs under RA 10639, is
   operated by the NTC and the telcos, and only authorised agencies can push to
   it. Nothing here reaches a handset that does not have this app open. The
   copy on screen says so, because a warning system that overstates its own
   reach is worse than one that admits its limits.

   WHAT IT IS: within this system, an alert an operator cannot miss. It takes
   over the whole screen on every portal — CDRRMO, barangay official, resident —
   sounds a siren, vibrates on mobile, and stays until the person acknowledges
   it by name. It is reserved for the case where someone has to move now.

   Acknowledgement is per person and per alert, held in localStorage: dismissing
   it on your own screen must never clear it from anyone else's, and reloading
   the page must not bring back a warning you already read and acted on.
   ============================================================ */

const ACK_KEY = 'cdrrmo_emergency_ack'

function readAck() {
  try {
    const v = JSON.parse(localStorage.getItem(ACK_KEY))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
function writeAck(ids) {
  try { localStorage.setItem(ACK_KEY, JSON.stringify(ids.slice(-50))) } catch { /* full — skip */ }
}

/**
 * The siren. Synthesised with the Web Audio API rather than shipped as an
 * audio file: no asset to load, no autoplay-blocked <audio> element, and it
 * cannot fail silently because a file 404s.
 *
 * Two alternating tones, the classic rising/falling pair, repeating until the
 * alert is acknowledged. Browsers refuse to start audio without a user
 * gesture, so if it is blocked the visual takeover still does the whole job —
 * the siren is an escalation, never the only signal.
 */
function useSiren(active) {
  const ctxRef = useRef(null)
  const stopRef = useRef(null)

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false

    const start = () => {
      if (cancelled || ctxRef.current) return
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      ctxRef.current = ctx

      const gain = ctx.createGain()
      gain.gain.value = 0.0001
      gain.connect(ctx.destination)

      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.connect(gain)
      osc.start()

      // Two-tone sweep, one cycle per second, held under a modest ceiling —
      // loud enough to turn a head, not loud enough to hurt someone wearing
      // headphones at 2am.
      const t0 = ctx.currentTime
      for (let i = 0; i < 600; i++) {
        const t = t0 + i
        osc.frequency.setValueAtTime(660, t)
        osc.frequency.setValueAtTime(880, t + 0.5)
        gain.gain.setValueAtTime(0.16, t)
        gain.gain.setValueAtTime(0.16, t + 0.45)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
        gain.gain.setValueAtTime(0.16, t + 0.5)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1)
      }

      stopRef.current = () => {
        try { osc.stop() } catch { /* already stopped */ }
        ctx.close().catch(() => {})
      }
    }

    start()
    // If the browser blocked it, the first click or key anywhere starts it.
    const retry = () => start()
    window.addEventListener('pointerdown', retry, { once: true })
    window.addEventListener('keydown', retry, { once: true })

    // Vibration, where the device has it. Same rhythm as the tone.
    let vib = null
    if (navigator.vibrate) {
      const pulse = () => navigator.vibrate([400, 200, 400, 200])
      pulse()
      vib = setInterval(pulse, 2000)
    }

    return () => {
      cancelled = true
      window.removeEventListener('pointerdown', retry)
      window.removeEventListener('keydown', retry)
      if (vib) clearInterval(vib)
      if (navigator.vibrate) navigator.vibrate(0)
      stopRef.current?.()
      stopRef.current = null
      ctxRef.current = null
    }
  }, [active])
}

/**
 * Mounted once per portal. Renders nothing until an emergency alert is active
 * and unacknowledged by this person.
 */
export default function EmergencyAlert() {
  const { alerts } = useAlerts()
  const [acked, setAcked] = useState(readAck)
  const user = api.getUser?.() || null

  const live = alerts.find(
    (a) => a.level === 'emergency' && a.status === 'active' && !acked.includes(a.id),
  )

  useSiren(Boolean(live))

  const acknowledge = useCallback(() => {
    if (!live) return
    const next = [...acked, live.id]
    setAcked(next)
    writeAck(next)
  }, [live, acked])

  // Escape must NOT dismiss this. Acknowledging is a deliberate act, and the
  // reflex that closes an ordinary modal should not clear a siren.
  useEffect(() => {
    if (!live) return undefined
    const block = (e) => { if (e.key === 'Escape') e.stopPropagation() }
    window.addEventListener('keydown', block, true)
    return () => window.removeEventListener('keydown', block, true)
  }, [live])

  if (!live) return null

  return (
    <div className="ea" role="alertdialog" aria-modal="true" aria-label="Emergency alert">
      <div className="ea-card">
        <div className="ea-bar" aria-hidden="true" />

        <div className="ea-head">
          <span className="ea-siren" aria-hidden="true">
            <SirenIcon />
          </span>
          <div>
            <div className="ea-kicker">EMERGENCY ALERT</div>
            <div className="ea-brgy">{live.barangay || 'City-wide'}</div>
          </div>
        </div>

        <h2 className="ea-title">{live.title}</h2>
        <p className="ea-msg">{live.message}</p>

        <div className="ea-meta">
          <span>Issued {live.issued}</span>
          {live.issuedBy && <span>by {live.issuedBy}</span>}
          <span>CDRRMO Cabuyao City</span>
        </div>

        <button type="button" className="ea-ack" onClick={acknowledge}>
          I have read this — acknowledge
        </button>

        {/* The limit of this channel, stated to the person reading it. */}
        <p className="ea-reach">
          Sent through CDRRMO FloodRoute to everyone with this app open. This is
          <b> not</b> a national cell broadcast — it will not reach phones that do not
          have the app. For life-threatening emergencies call <b>911</b>.
        </p>
      </div>
    </div>
  )
}

function SirenIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 3a5 5 0 0 0-5 5v5h10V8a5 5 0 0 0-5-5z" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <line x1="12" y1="3" x2="12" y2="1" />
      <line x1="4.5" y1="6.5" x2="3" y2="5" />
      <line x1="19.5" y1="6.5" x2="21" y2="5" />
    </svg>
  )
}
