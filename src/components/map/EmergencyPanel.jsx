/* ============================================================
   Emergency quick panel (bottom-left of the map, collapsible).

   The "I need help NOW" surface: the nearest OPEN evacuation
   centres (distance from the user's GPS fix when available,
   otherwise from their home barangay), plus the CDRRMO and
   national emergency hotlines as tap-to-call links.
   ============================================================ */

import { useMemo, useState } from 'react'
import { haversineKm } from './searchTools.js'
import './mapUpgrade.css'

const HOTLINES = [
  { name: 'CDRRMO Cabuyao', number: '(049) 502-2377', tel: '0495022377' },
  { name: 'National Emergency', number: '911', tel: '911' },
]

export default function EmergencyPanel({ evacCenters = [], origin, originLabel, onGoto }) {
  const [open, setOpen] = useState(false)

  const nearest = useMemo(() => {
    if (!origin) return []
    return evacCenters
      .filter((c) => Array.isArray(c.coords) && c.status !== 'closed')
      .map((c) => ({
        ...c,
        km: haversineKm(origin, { lat: c.coords[0], lng: c.coords[1] }),
      }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 3)
  }, [evacCenters, origin])

  return (
    <div className={`emg ${open ? 'open' : ''}`}>
      <button type="button" className="emg-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
        Emergency
        <span className="emg-caret">{open ? '▾' : '▴'}</span>
      </button>

      {open && (
        <div className="emg-body">
          <div className="emg-sec">
            <div className="emg-sec-title">
              Nearest evacuation centres
              {originLabel && <small> · from {originLabel}</small>}
            </div>
            {nearest.length === 0 && (
              <div className="emg-empty">No open evacuation centre found. Call the hotline below.</div>
            )}
            {nearest.map((c) => (
              <button type="button" key={c.id} className="emg-row" onClick={() => onGoto?.(c)}>
                <span className="emg-row-dot" data-status={c.status} />
                <span className="emg-row-txt">
                  <b>{c.name}</b>
                  <small>{c.barangay} · {c.status}</small>
                </span>
                <span className="emg-row-km">{c.km < 1 ? `${Math.round(c.km * 1000)} m` : `${c.km.toFixed(1)} km`}</span>
              </button>
            ))}
          </div>

          <div className="emg-sec">
            <div className="emg-sec-title">Hotlines</div>
            {HOTLINES.map((h) => (
              <a key={h.tel} className="emg-row emg-row--call" href={`tel:${h.tel}`}>
                <span className="emg-row-txt">
                  <b>{h.name}</b>
                  <small>{h.number}</small>
                </span>
                <span className="emg-call">Call</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
