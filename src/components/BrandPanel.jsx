/**
 * Shared left-side branding panel used by the Login and Register pages.
 * The shield is the original inline SVG from the static markup.
 *
 * Stat numbers are dummy figures in the design; per the project rule they
 * start at 0 here and will be populated from the database later.
 */

const STATS = [
  // 18 barangays served (per design); other figures stay 0 until wired to the DB.
  { value: '18', label: 'Barangay' },
  { value: '0', label: 'Evacuation center' },
  { value: '24/7', label: 'Monitoring', navy: true },
]

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
        {STATS.map((s) => (
          <div key={s.label} className={`stat-box ${s.navy ? 'stat-navy' : ''}`}>
            <span className="stat-number">{s.value}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
