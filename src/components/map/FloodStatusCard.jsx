/* ============================================================
   Real-time flood status card (floating, top-right of the map).

   Distils the live picture into ONE headline status the way Waze
   summarises traffic:

     Road Closed  (red)     any road currently closed by CDRRMO
     High Flood   (orange)  any barangay at HIGH flood depth
     Moderate     (yellow)  any barangay at MODERATE depth
     Normal       (green)   everything else

   Ticks every 15 s (the underlying model/weather refresh on their
   own cadence) and slides in an animated toast whenever the
   headline status actually changes.
   ============================================================ */

import { useEffect, useMemo, useRef, useState } from 'react'
import { formatPHT } from '../admin/mapHelpers.jsx'
import './mapUpgrade.css'

const TICK_MS = 15_000

const STATUS_META = {
  closed: { label: 'Road Closed', tone: 'red', hint: 'One or more roads are impassable' },
  high: { label: 'High Flood', tone: 'orange', hint: 'Dangerous flood depth detected' },
  moderate: { label: 'Moderate Flood', tone: 'yellow', hint: 'Flooding in low-lying areas' },
  normal: { label: 'Normal', tone: 'green', hint: 'No significant flooding' },
}

export default function FloodStatusCard({ barangays = [], roadReports = [] }) {
  const [updated, setUpdated] = useState(formatPHT())
  const [toast, setToast] = useState(null)
  const prevRef = useRef(null)
  // The live feeds land asynchronously right after mount; those first
  // transitions are "loading", not "the flood changed" — don't toast them.
  const settledAtRef = useRef(Date.now() + 5000)

  const summary = useMemo(() => {
    const closed = roadReports.filter((r) => r.status === 'closed').length
    const high = barangays.filter((b) => b.level === 'high').length
    const moderate = barangays.filter((b) => b.level === 'moderate').length
    const key = closed > 0 ? 'closed' : high > 0 ? 'high' : moderate > 0 ? 'moderate' : 'normal'
    return { key, closed, high, moderate, meta: STATUS_META[key] }
  }, [barangays, roadReports])

  /* "Last Updated" heartbeat — proves to the user the feed is alive. */
  useEffect(() => {
    const id = setInterval(() => setUpdated(formatPHT()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  /* Animated toast when the headline status flips (skip the initial render). */
  useEffect(() => {
    if (Date.now() < settledAtRef.current) {
      prevRef.current = summary.key
      return undefined
    }
    if (prevRef.current && prevRef.current !== summary.key) {
      setToast({ from: STATUS_META[prevRef.current].label, to: summary.meta.label, tone: summary.meta.tone })
      setUpdated(formatPHT())
      const id = setTimeout(() => setToast(null), 6000)
      prevRef.current = summary.key
      return () => clearTimeout(id)
    }
    prevRef.current = summary.key
    return undefined
  }, [summary])

  return (
    <div className="fsc">
      <div className={`fsc-card fsc--${summary.meta.tone}`}>
        <div className="fsc-head">
          <span className="fsc-pulse" aria-hidden="true" />
          <span className="fsc-title">Current Flood Status</span>
        </div>
        <div className="fsc-badge-row">
          <span className={`fsc-badge fsc-badge--${summary.meta.tone}`}>{summary.meta.label}</span>
          <span className="fsc-hint">{summary.meta.hint}</span>
        </div>
        <div className="fsc-counts">
          <span className="fsc-count fsc-count--red">{summary.closed} closed</span>
          <span className="fsc-count fsc-count--orange">{summary.high} high</span>
          <span className="fsc-count fsc-count--yellow">{summary.moderate} moderate</span>
        </div>
        <div className="fsc-meta">
          <div>Last Updated: <b>{updated} PHT</b></div>
          <div>Data Source: Flood model · Open-Meteo · CDRRMO reports</div>
        </div>
      </div>

      {toast && (
        <div className={`fsc-toast fsc-toast--${toast.tone}`} role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <b>Flood status changed</b>
            <div className="fsc-toast-sub">{toast.from} → {toast.to}</div>
          </div>
        </div>
      )}
    </div>
  )
}
