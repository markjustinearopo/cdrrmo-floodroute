import { useMemo } from 'react'
import { manilaClock, manilaDate, relativeTime, useCountUp, useNow } from './dashHooks.js'
import './CommandBar.css'

/* ============================================================
   The state of the city, in one band across the top.

   A command centre screen should answer "what is our posture right now" before
   it answers anything else, and this one could not: an operator had to read
   four stat cards, a gauge and a list and assemble the answer themselves.

   The posture here is the NDRRMC alert-status convention Philippine LGUs
   actually run on — White, Blue, Red — derived from the same live figures the
   rest of the page is drawing, so it can never disagree with them:

     RED    an emergency-tier alert is live, or a barangay is over the high
            threshold — full activation, all personnel on duty
     BLUE   a warning is out or a barangay is over the moderate threshold —
            augmented duty, monitoring around the clock
     WHITE  routine monitoring

   The clock ticks and the sync stamp counts up because a dashboard that has
   silently stopped receiving data looks exactly like a dashboard on a quiet
   day, and an operator has to be able to tell those apart at a glance.
   ============================================================ */

const POSTURE = {
  red: {
    code: 'RED ALERT',
    blurb: 'Full activation — all personnel on duty, response ongoing',
  },
  blue: {
    code: 'BLUE ALERT',
    blurb: 'Augmented duty — warnings in effect, monitoring around the clock',
  },
  white: {
    code: 'WHITE ALERT',
    blurb: 'Routine monitoring — no warning-level conditions reported',
  },
}

/**
 * @param riskCounts   { high, moderate, low, safe, affected }
 * @param alerts       the live alert collection (already the shared store's)
 * @param blockedRoads count of impassable roads
 * @param openShelters count of shelters accepting people
 * @param sheltered    total occupancy across open shelters
 * @param lastUpdated  epoch ms of the last successful store sync
 * @param live         whether the weather feed is answering
 */
export default function CommandBar({
  riskCounts = {},
  alerts = [],
  blockedRoads = 0,
  openShelters = 0,
  sheltered = 0,
  lastUpdated = null,
  live = false,
}) {
  const now = useNow(1000)

  const active = useMemo(() => alerts.filter((a) => a.status === 'active'), [alerts])

  const posture = useMemo(() => {
    if (active.some((a) => a.level === 'emergency') || (riskCounts.high || 0) > 0) return 'red'
    if (active.some((a) => a.level === 'high' || a.level === 'moderate') || (riskCounts.moderate || 0) > 0) return 'blue'
    return 'white'
  }, [active, riskCounts.high, riskCounts.moderate])

  // How long since the most recent alert went out — the number an operator
  // reaches for when deciding whether the city has been told anything lately.
  const lastAlertAt = useMemo(() => {
    const stamps = active.map((a) => a.issuedAt).filter(Boolean)
    return stamps.length ? Math.max(...stamps) : null
  }, [active])

  const meta = POSTURE[posture]

  return (
    <section className={`cb ${posture}`} aria-label="Operational status">
      <div className="cb-sweep" aria-hidden="true" />

      <div className="cb-posture">
        <span className="cb-shield">
          <ShieldIcon />
          <i className="cb-ping" aria-hidden="true" />
        </span>
        <div className="cb-posture-text">
          <div className="cb-code">{meta.code}</div>
          <div className="cb-blurb">{meta.blurb}</div>
        </div>
      </div>

      <div className="cb-stats">
        <Metric value={riskCounts.affected || 0} label="Barangays affected" tone={riskCounts.affected ? 'warn' : ''} />
        <Metric value={active.length} label="Active alerts" tone={active.length ? 'warn' : ''} />
        <Metric value={blockedRoads} label="Roads impassable" tone={blockedRoads ? 'bad' : ''} />
        <Metric value={openShelters} label="Shelters open" tone="good" />
        <Metric value={sheltered} label="People sheltered" tone="good" />
      </div>

      <div className="cb-clock">
        <div className="cb-time">{manilaClock(now)}</div>
        <div className="cb-date">{manilaDate(now)} · PHT</div>
        <div className="cb-sync">
          <span className={`cb-dot ${live ? 'on' : 'off'}`} />
          {live ? 'Feeds live' : 'Feed unreachable'}
          {lastUpdated ? ` · synced ${relativeTime(lastUpdated, now)}` : ''}
        </div>
        {lastAlertAt && (
          <div className="cb-sync">Last alert issued {relativeTime(lastAlertAt, now)}</div>
        )}
      </div>
    </section>
  )
}

function Metric({ value, label, tone = '' }) {
  const shown = useCountUp(value)
  return (
    <div className={`cb-metric ${tone}`}>
      <span className="cb-metric-val">
        {typeof shown === 'number' ? Math.round(shown).toLocaleString() : shown}
      </span>
      <span className="cb-metric-lbl">{label}</span>
    </div>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}
