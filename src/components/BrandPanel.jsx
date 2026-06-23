/**
 * Shared left-side branding panel used by the Login and Register pages.
 * The shield is the original inline SVG from the static markup.
 *
 * The barangay + evacuation-centre figures are LIVE counts from Supabase
 * (fall back to a sensible default while loading / offline).
 */

import { useEffect, useState } from 'react'
import db from '../services/db.js'

export function ShieldLogo() {
  return (
    <img
      className="brand-logo"
      src="/cdrrmo-logo.png"
      alt="Cabuyao City CDRRMO logo"
    />
  )
}

export default function BrandPanel() {
  const [counts, setCounts] = useState({ barangays: 18, evac: 0 })

  useEffect(() => {
    let alive = true
    db.ref.counts()
      .then((c) => { if (alive) setCounts(c) })
      .catch((e) => console.error('[BrandPanel] counts failed', e))
    return () => { alive = false }
  }, [])

  const stats = [
    { value: String(counts.barangays), label: 'Barangay' },
    { value: String(counts.evac), label: 'Evacuation center' },
    { value: '24/7', label: 'Monitoring', navy: true },
  ]

  return (
    <div className="brand-panel">
      <ShieldLogo />

      <h1 className="brand-title">
        Cabuyao City Disaster Risk Reduction and Management Office
      </h1>
      <p className="brand-subtitle">
        Web-based disaster management and safe-route navigation platform for
        Cabuyao City. Protecting communities during flooding emergencies.
      </p>

      <div className="stats-row">
        {stats.map((s) => (
          <div key={s.label} className={`stat-box ${s.navy ? 'stat-navy' : ''}`}>
            <span className="stat-number">{s.value}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
