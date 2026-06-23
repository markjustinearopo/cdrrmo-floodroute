import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet'
import ResidentLayout from '../../components/resident/ResidentLayout.jsx'
import {
  CABUYAO_CENTER,
  CABUYAO_ZOOM,
  levelFromDepth,
  RISK_META,
  CabuyaoLock,
  BarangayLock,
  LocateControl,
} from '../../components/admin/mapHelpers.jsx'
import { useFloodRisk, barangayRiskSamples } from '../../components/admin/floodRisk.js'
import { useLiveWeather } from '../../services/weather.js'
import { usePersistedState } from '../../utils/usePersistedState.js'
import { residentBarangayLabel, getResidentBarangay } from '../../data/resident.js'
import { useAlerts, useEvacCenters, useBarangayAssignments } from '../../context/AdminDataContext.jsx'
import './Resident.css'

/**
 * CDRRMO Resident — Dashboard ("My Safety Info").
 *
 * A citizen's personal safety summary: their measured flood-risk level, the
 * nearest open evacuation centre, a one-tap route to it, an area map locked to
 * their barangay, the alerts affecting their barangay, a short forecast and
 * emergency contacts. Read-only — everything is read live from the SAME shared
 * system store the command center and barangay write to, scoped to this
 * resident's barangay. Risk follows the measured flood depth, the system-wide
 * source of truth.
 */

const RISK_BLURB = {
  high: 'Severe flooding — evacuate now and follow the safe route below.',
  moderate: 'Rising water in low-lying areas — prepare to leave and stay alert.',
  low: 'Minor flooding possible — stay informed and avoid flooded roads.',
  safe: 'No elevated flood risk in your area. Conditions are being monitored.',
}

// What a resident should actually DO right now, by their current risk level.
const RISK_STEPS = {
  high: [
    'Evacuate now using the safe route below',
    'Bring your go-bag, medicines and IDs',
    'Switch off main power before leaving',
    'Avoid flooded roads, bridges and creeks',
  ],
  moderate: [
    'Ready your go-bag and prepare to leave',
    'Move valuables and vehicles to higher ground',
    'Watch for alerts from CDRRMO and your barangay',
    'Avoid low-lying roads',
  ],
  low: [
    'Stay informed — watch for new alerts',
    'Keep away from fast-moving or rising water',
    'Charge your phone and keep a power bank ready',
  ],
  safe: [
    'No action needed — stay alert',
    'Know your nearest evacuation centre',
    'Keep an emergency kit ready, just in case',
  ],
}

// Personal preparedness checklist — ticked state persists per browser.
const PREP_ITEMS = [
  { key: 'gobag', label: 'Go-bag packed (water, food, meds, flashlight)' },
  { key: 'docs', label: 'IDs & documents in a waterproof bag' },
  { key: 'route', label: 'I know my evacuation route & centre' },
  { key: 'phone', label: 'Phone charged + power bank ready' },
  { key: 'family', label: 'Family contacts & meeting point agreed' },
]

// National emergency line is a public constant (not demo data).
const NATIONAL_HOTLINE = { name: 'National Emergency Hotline', number: '911' }

export default function Dashboard() {
  const navigate = useNavigate()
  const brgyLabel = residentBarangayLabel()
  const myBrgy = getResidentBarangay()

  const { field } = useFloodRisk()
  const { weather } = useLiveWeather()
  const { alerts: allAlerts } = useAlerts()
  const { evacuationCenters } = useEvacCenters()
  const { barangayAssignments } = useBarangayAssignments()

  const floodDepth = useMemo(
    () => barangayRiskSamples(field).find((b) => b.name === myBrgy)?.floodDepth ?? 0,
    [field, myBrgy],
  )
  const alerts = useMemo(
    () => allAlerts.filter((a) => a.barangay === myBrgy && a.status === 'active'),
    [allAlerts, myBrgy],
  )
  // Prefer an open centre in the resident's own barangay, else the first open one.
  const nearestCenter = useMemo(() => {
    const open = evacuationCenters.filter((c) => c.status === 'open')
    return open.find((c) => c.barangay === myBrgy) || open[0] || null
  }, [evacuationCenters, myBrgy])
  const contacts = useMemo(
    () => barangayAssignments[myBrgy]?.contacts || [],
    [barangayAssignments, myBrgy],
  )

  const level = useMemo(() => levelFromDepth(floodDepth), [floodDepth])

  const [prep, setPrep] = usePersistedState('cdrrmo-res-prep', {})
  const prepDone = PREP_ITEMS.filter((i) => prep[i.key]).length

  const forecast = useMemo(() => {
    if (weather.forecast.length) {
      return weather.forecast.slice(0, 4).map((f) => ({ day: f.day, icon: f.emoji, temp: f.tmax }))
    }
    return Array.from({ length: 4 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() + i)
      return {
        day: i === 0 ? 'Today' : d.toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'Asia/Manila' }),
        icon: '—',
        temp: null,
      }
    })
  }, [weather.forecast])

  return (
    <ResidentLayout>
      <div className="res-dash">
        {/* ── Left: personal feed ── */}
        <div className="res-feed">
          <div className={`res-risk-card ${level}`}>
            <div className="res-risk-label">Your Flood Risk Level</div>
            <div className="res-risk-level">{RISK_META[level].label}</div>
            <div className="res-risk-sub">
              Brgy. {brgyLabel} · ~{floodDepth.toFixed(2)} m est. depth · {RISK_BLURB[level]}
            </div>
          </div>

          <div className={`res-steps-card ${level}`}>
            <div className="res-card-head">
              <svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              What To Do Now
            </div>
            <ul className="res-steps">
              {RISK_STEPS[level].map((s) => (
                <li key={s}><span className="res-step-dot" />{s}</li>
              ))}
            </ul>
          </div>

          <div className="res-evac-card">
            <div className="res-card-head">
              <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
              Nearest Evacuation Centre
            </div>
            {nearestCenter ? (
              <>
                <div className="res-evac-name">{nearestCenter.name}</div>
                <div className="res-evac-meta">
                  Brgy. {nearestCenter.barangay} · {Number(nearestCenter.occupancy || 0).toLocaleString()}/{Number(nearestCenter.capacity || 0).toLocaleString()} occupancy · Open
                </div>
              </>
            ) : (
              <>
                <div className="res-evac-name muted">No open centre listed yet</div>
                <div className="res-evac-meta">Open shelters near you will appear here during an event.</div>
              </>
            )}
          </div>

          <button type="button" className="res-route-btn" onClick={() => navigate('/resident/evacuation-routing')}>
            <svg viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
            Get Safe Route to Evacuation Centre
          </button>

          <div className="res-map-card">
            <div className="res-map">
              <div className="res-map-label">Brgy. {brgyLabel} · Area Map</div>
              <MapContainer center={CABUYAO_CENTER} zoom={CABUYAO_ZOOM} zoomControl={false} attributionControl={false}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.85} />
                <ZoomControl position="bottomright" />
                {myBrgy ? <BarangayLock name={myBrgy} /> : <CabuyaoLock />}
                <LocateControl />
              </MapContainer>
              <div className="res-map-legend">
                <div className="res-legend-item"><span className="res-legend-line" style={{ background: '#16A34A' }} /> Safe Route</div>
                <div className="res-legend-item"><span className="res-legend-line" style={{ background: '#F97316' }} /> Flood Risk</div>
                <div className="res-legend-item"><span className="res-legend-line" style={{ background: '#EF4444' }} /> Blocked</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: side panel ── */}
        <div className="res-side">
          <div className="res-side-card">
            <div className="res-side-title">
              <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
              Active Alerts Near You
            </div>
            {alerts.length === 0 ? (
              <div className="res-empty">
                <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                <div className="res-empty-title">No active alerts</div>
                <div className="res-empty-sub">Alerts affecting Brgy. {brgyLabel} will show here.</div>
              </div>
            ) : (
              <div className="res-alert-list">
                {alerts.slice(0, 5).map((a) => (
                  <div className="res-alert-row" key={a.id}>
                    <span className={`res-alert-stripe ${a.level || 'safe'}`} />
                    <div>
                      <div className="res-alert-title">{a.title}</div>
                      {a.message && <div className="res-alert-msg">{a.message}</div>}
                      {a.issued && <div className="res-alert-time">{a.issued}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="res-side-card">
            <div className="res-side-title">
              <svg viewBox="0 0 24 24"><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" /><line x1="8" y1="19" x2="8" y2="21" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="16" y1="19" x2="16" y2="21" /></svg>
              3-Day Forecast
            </div>
            <div className="res-forecast">
              {forecast.map((f, i) => (
                <div key={f.day} className={`res-fc-day ${i === 0 ? 'today' : ''}`}>
                  <div className="res-fc-name">{f.day}</div>
                  <div className="res-fc-icon">{f.icon || '—'}</div>
                  <div className="res-fc-temp">{f.temp != null ? `${f.temp}°C` : '--'}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="res-side-card">
            <div className="res-side-title">
              <svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              Preparedness Checklist
              <span className="res-prep-count">{prepDone}/{PREP_ITEMS.length}</span>
            </div>
            <div className="res-prep-track">
              <div className="res-prep-fill" style={{ width: `${(prepDone / PREP_ITEMS.length) * 100}%` }} />
            </div>
            <div className="res-prep-list">
              {PREP_ITEMS.map((it) => (
                <label className="res-prep-row" key={it.key}>
                  <input
                    type="checkbox"
                    checked={!!prep[it.key]}
                    onChange={() => setPrep((p) => ({ ...p, [it.key]: !p[it.key] }))}
                  />
                  <span className="res-prep-box" />
                  <span className="res-prep-label">{it.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="res-side-card">
            <div className="res-side-title">
              <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.18 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 21.5 16z" /></svg>
              Emergency Contacts
            </div>
            <div className="res-contact-row">
              <span className="res-contact-name">{NATIONAL_HOTLINE.name}</span>
              <span className="res-contact-num">{NATIONAL_HOTLINE.number}</span>
            </div>
            {contacts.map((c) => (
              <div className="res-contact-row" key={c.id}>
                <span className="res-contact-name">{c.role || c.name}</span>
                <span className="res-contact-num">{c.contact || '—'}</span>
              </div>
            ))}
            {contacts.length === 0 && (
              <div className="res-contact-row">
                <span className="res-contact-name">Brgy. {brgyLabel} Hotline</span>
                <span className="res-contact-num">—</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </ResidentLayout>
  )
}
