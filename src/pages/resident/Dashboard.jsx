import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet'
import ResidentLayout from '../../components/resident/ResidentLayout.jsx'
import {
  CABUYAO_CENTER,
  CABUYAO_ZOOM,
  levelFromDepth,
  RISK_META,
  CabuyaoLock,
} from '../../components/admin/mapHelpers.jsx'
import { residentBarangayLabel, getResidentBarangay, safeGet, brgyQuery } from '../../data/resident.js'
import './Resident.css'

/**
 * CDRRMO Resident — Dashboard ("My Safety Info").
 *
 * A citizen's personal safety summary: their measured flood-risk level, the
 * nearest open evacuation centre, a one-tap route to it, an area map, the
 * alerts affecting their barangay, a short forecast and emergency contacts.
 * Read-only — everything is filled from the shared backend (GET /barangays,
 * /alerts, /evac-centers, /barangay-contacts) and shows an empty state until
 * the database answers. Risk follows the measured flood depth, the system-wide
 * source of truth.
 */

const RISK_BLURB = {
  high: 'Severe flooding — evacuate now and follow the safe route below.',
  moderate: 'Rising water in low-lying areas — prepare to leave and stay alert.',
  low: 'Minor flooding possible — stay informed and avoid flooded roads.',
  safe: 'No elevated flood risk in your area. Conditions are being monitored.',
}

// National emergency line is a public constant (not demo data).
const NATIONAL_HOTLINE = { name: 'National Emergency Hotline', number: '911' }

export default function Dashboard() {
  const navigate = useNavigate()
  const brgyLabel = residentBarangayLabel()
  const myBrgy = getResidentBarangay()

  const [floodDepth, setFloodDepth] = useState(0)
  const [alerts, setAlerts] = useState([])
  const [nearestCenter, setNearestCenter] = useState(null)
  const [contacts, setContacts] = useState([])

  useEffect(() => {
    let active = true
    safeGet('/barangays').then((d) => {
      if (!active || !d?.barangays) return
      const mine = d.barangays.find((b) => b.name === myBrgy)
      if (mine) setFloodDepth(Number(mine.flood_depth ?? mine.floodDepth ?? 0))
    })
    safeGet(`/alerts${brgyQuery('isActive=true')}`).then((d) => active && d?.alerts && setAlerts(d.alerts))
    safeGet('/evac-centers').then((d) => {
      if (!active || !d?.centers) return
      const open = d.centers.filter((c) => c.status === 'open')
      // Prefer an open centre in the resident's own barangay, else the first open one.
      setNearestCenter(open.find((c) => c.barangay === myBrgy) || open[0] || null)
    })
    safeGet(`/barangay-contacts${brgyQuery()}`).then((d) => active && d?.contacts && setContacts(d.contacts))
    return () => { active = false }
  }, [myBrgy])

  const level = useMemo(() => levelFromDepth(floodDepth), [floodDepth])

  const forecast = useMemo(() => (
    Array.from({ length: 4 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() + i)
      return {
        day: i === 0 ? 'Today' : d.toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'Asia/Manila' }),
        temp: null,
      }
    })
  ), [])

  return (
    <ResidentLayout>
      <div className="res-dash">
        {/* ── Left: personal feed ── */}
        <div className="res-feed">
          <div className={`res-risk-card ${level}`}>
            <div className="res-risk-label">Your Flood Risk Level</div>
            <div className="res-risk-level">{RISK_META[level].label}</div>
            <div className="res-risk-sub">
              Brgy. {brgyLabel} · {floodDepth.toFixed(2)} m measured · {RISK_BLURB[level]}
            </div>
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
                <CabuyaoLock />
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
                  <div className="res-fc-icon">—</div>
                  <div className="res-fc-temp">{f.temp != null ? `${f.temp}°C` : '--'}</div>
                </div>
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
