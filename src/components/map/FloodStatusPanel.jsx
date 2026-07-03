/* ============================================================
   Live flood status panel — the per-area monitoring dashboard.

   One row per barangay with the three-band status the client asked
   for (Safe / Warning / Critical), the modeled water level, and the
   live indicators. The data itself is the same auto-refreshing
   flood-risk field the maps paint (Open-Meteo driven, re-pulled
   every few minutes without a page reload); this panel just gives
   it a monitoring-dashboard face.

     Safe      (green)  < 0.1 m modeled depth
     Warning   (yellow) 0.1 – 0.5 m  (low + moderate bands)
     Critical  (red)    ≥ 0.5 m — flooded

   Renders inside the Flood Map right panel (a tab), so it inherits
   the panel's scroll + responsive behaviour.
   ============================================================ */

import { useEffect, useMemo, useState } from 'react'
import { formatPHT } from '../admin/mapHelpers.jsx'
import './mapUpgrade.css'

const BAND = {
  safe: { label: 'Safe', tone: 'green' },
  warning: { label: 'Warning', tone: 'yellow' },
  critical: { label: 'Critical', tone: 'red' },
}

/** Collapse the four model levels into the Safe/Warning/Critical bands. */
export function statusBand(level) {
  if (level === 'high') return 'critical'
  if (level === 'moderate' || level === 'low') return 'warning'
  return 'safe'
}

export default function FloodStatusPanel({ barangays = [], roadReports = [], myBrgy }) {
  const [updated, setUpdated] = useState(formatPHT())

  // Heartbeat: re-stamp when the live field lands a new snapshot.
  useEffect(() => setUpdated(formatPHT()), [barangays])
  useEffect(() => {
    const id = setInterval(() => setUpdated(formatPHT()), 30_000)
    return () => clearInterval(id)
  }, [])

  const rows = useMemo(
    () =>
      [...barangays]
        .map((b) => ({ ...b, band: statusBand(b.level) }))
        .sort((a, b) => b.floodDepth - a.floodDepth || a.name.localeCompare(b.name)),
    [barangays],
  )

  const counts = useMemo(() => {
    const c = { safe: 0, warning: 0, critical: 0 }
    rows.forEach((r) => c[r.band]++)
    return c
  }, [rows])

  const affected = rows.filter((r) => r.band !== 'safe')
  const closedRoads = roadReports.filter((r) => r.status === 'closed').length

  return (
    <div className="fsp">
      <div className="fsp-head">
        <span className="fsp-live">
          <span className="fsc-pulse" />
          LIVE MONITORING
        </span>
        <span className="fsp-updated">Updated {updated} PHT</span>
      </div>

      <div className="fsp-chips">
        <span className="fsp-chip fsp-chip--red">{counts.critical} Critical</span>
        <span className="fsp-chip fsp-chip--yellow">{counts.warning} Warning</span>
        <span className="fsp-chip fsp-chip--green">{counts.safe} Safe</span>
      </div>

      <div className="fsp-summary">
        {affected.length === 0
          ? 'No areas currently affected by flooding.'
          : `${affected.length} affected area${affected.length > 1 ? 's' : ''}${closedRoads ? ` · ${closedRoads} road${closedRoads > 1 ? 's' : ''} closed` : ''}`}
      </div>

      <div className="fsp-list">
        {rows.map((r) => {
          const meta = BAND[r.band]
          const mine = r.name === myBrgy
          return (
            <div className={`fsp-row ${mine ? 'mine' : ''}`} key={r.name}>
              <span className={`fsp-dot fsp-dot--${meta.tone}`} />
              <span className="fsp-row-name">
                {r.name}
                {mine && <em> · YOU</em>}
              </span>
              <span className="fsp-row-depth" title="Modeled water level">
                {r.floodDepth >= 0.05 ? `${r.floodDepth.toFixed(2)} m` : '—'}
              </span>
              <span className={`fsp-badge fsp-badge--${meta.tone}`}>{meta.label}</span>
            </div>
          )
        })}
      </div>

      <div className="fsp-foot">
        Water levels are model estimates (Open-Meteo + terrain), refreshed automatically.
      </div>
    </div>
  )
}
