/* ============================================================
   Nearby-flood proximity warning.

   Once the user's position is known (the My Location FAB), this
   scans everything the system knows is wet — documented flood-prone
   areas at moderate/high severity, verified resident flood reports,
   and barangays the live model marks moderate/high — and if any sit
   within the warning radius, slides in an animated banner naming
   the nearest hazard and how far away it is. Dismissible; re-arms
   when the hazard picture or the user's position changes.
   ============================================================ */

import { useEffect, useMemo, useState } from 'react'
import { floodSeverity } from '../../data/floodAreas.js'
import { haversineKm } from './searchTools.js'
import './mapUpgrade.css'

const WARN_RADIUS_KM = 1.0

function fmtKm(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}

export default function NearbyFloodAlert({ origin, barangays = [], floodAreas = [], floodReports = [] }) {
  const [dismissedKey, setDismissedKey] = useState(null)

  const hazards = useMemo(() => {
    if (!origin) return []
    const list = []
    floodAreas.forEach((a) => {
      if (!Array.isArray(a.coords)) return
      const sev = floodSeverity(a)
      if (sev === 'low') return
      list.push({ name: a.name, kind: 'flood-prone area', coords: a.coords, sev })
    })
    floodReports.forEach((r) => {
      if (!Array.isArray(r.coords)) return
      if (!['moderate', 'severe', 'impassable'].includes(r.level)) return
      list.push({
        name: r.location || r.barangay || 'Reported flooding',
        kind: 'verified flood report',
        coords: r.coords,
        sev: r.level === 'moderate' ? 'moderate' : 'high',
      })
    })
    barangays.forEach((b) => {
      if (!Array.isArray(b.coords)) return
      if (b.level !== 'high' && b.level !== 'moderate') return
      list.push({ name: `Brgy. ${b.name}`, kind: 'flooded area', coords: b.coords, sev: b.level })
    })
    return list
      .map((h) => ({ ...h, km: haversineKm(origin, { lat: h.coords[0], lng: h.coords[1] }) }))
      .filter((h) => h.km <= WARN_RADIUS_KM)
      .sort((a, b) => a.km - b.km)
  }, [origin, barangays, floodAreas, floodReports])

  // One key per distinct warning situation → dismissing hides THIS warning,
  // but a new nearest hazard (or a big position change) re-arms the banner.
  const key = hazards.length
    ? `${hazards[0].name}-${hazards.length}-${origin?.lat.toFixed(3)},${origin?.lng.toFixed(3)}`
    : null
  useEffect(() => {
    if (key === null) setDismissedKey(null)
  }, [key])

  if (!origin || hazards.length === 0 || dismissedKey === key) return null

  const nearest = hazards[0]
  const severe = hazards.some((h) => h.sev === 'high')

  return (
    <div className={`nfa ${severe ? 'nfa--high' : 'nfa--mod'}`} role="alert">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div className="nfa-txt">
        <b>{severe ? 'Flooding near you' : 'Flood risk near you'}</b>
        <span>
          {nearest.name} ({nearest.kind}) is {fmtKm(nearest.km)} away
          {hazards.length > 1 ? ` · +${hazards.length - 1} more within ${fmtKm(WARN_RADIUS_KM)}` : ''}
        </span>
      </div>
      <button type="button" className="nfa-x" onClick={() => setDismissedKey(key)} aria-label="Dismiss warning">
        ×
      </button>
    </div>
  )
}
