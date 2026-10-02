import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet'
import ResidentLayout from '../../components/resident/ResidentLayout.jsx'
import FloodReportModal from '../../components/resident/FloodReportModal.jsx'
import {
  CABUYAO_CENTER,
  CABUYAO_ZOOM,
  levelFromDepth,
  CabuyaoLock,
  BarangayLock,
  LocateControl,
} from '../../components/admin/mapHelpers.jsx'
import { useFloodRisk, barangayRiskSamples } from '../../components/admin/floodRisk.js'
import { useLiveWeather } from '../../services/weather.js'
import { usePersistedState } from '../../utils/usePersistedState.js'
import { useNarrowScreen } from '../../hooks/useNarrowScreen.js'
import { residentBarangayLabel, getResidentBarangay } from '../../data/resident.js'
import { useAdminData, useAlerts, useEvacCenters, useBarangayAssignments, barangayCoords } from '../../context/AdminDataContext.jsx'
import { pickShelter, isNearlyFull, remainingHeadroom } from '../../data/shelters.js'
import { describeDepth } from '../../services/depth.js'
import { floodStatus } from '../../services/floodBanner.js'
import EmergencySmsCard from '../../components/resident/EmergencySmsCard.jsx'
import MapSearchBar from '../../components/map/MapSearchBar.jsx'
import SearchResultLayer from '../../components/map/SearchResultLayer.jsx'
import { buildLocalIndex } from '../../components/map/searchTools.js'
import './Resident.css'
import { alertAppliesTo, sortAlerts } from '../../data/cabuyao.js'
import { useT } from '../../services/i18n.js'

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

/* The citizen portal's own risk words. RISK_META (components/admin/
   mapHelpers) is the ADMIN map legend, where 'moderate' is abbreviated to
   "MOD" so it fits inside a polygon label — that abbreviation was leaking
   onto the one screen read by people with no operations training. */
const RESIDENT_RISK_LABEL = {
  high: 'HIGH RISK',
  moderate: 'MODERATE RISK',
  low: 'LOW RISK',
  safe: 'NO FLOOD RISK',
}

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
  const { safetyReady } = useAdminData()
  const navigate = useNavigate()
  const t = useT()
  const brgyLabel = residentBarangayLabel()
  const myBrgy = getResidentBarangay()

  const { field } = useFloodRisk()
  const conditionsVerified = safetyReady && Boolean(field?.meta?.live)
  const { weather } = useLiveWeather()
  const { alerts: allAlerts } = useAlerts()
  const { evacuationCenters } = useEvacCenters()
  const { barangayAssignments } = useBarangayAssignments()

  const floodDepth = useMemo(
    () => barangayRiskSamples(field).find((b) => b.name === myBrgy)?.floodDepth ?? 0,
    [field, myBrgy],
  )
  const alerts = useMemo(
    () => sortAlerts(allAlerts.filter((a) => alertAppliesTo(a, myBrgy) && a.status === 'active')),
    [allAlerts, myBrgy],
  )
  /* The centre we actually send this resident to. Ranked by real distance
     from their barangay centroid and by how much room is left, and centres
     at/near capacity are excluded outright — see src/data/shelters.js. The
     routing page draws its candidates from the same rules, so the card and
     the route can no longer name different shelters. */
  const nearestCenter = useMemo(
    () => pickShelter(evacuationCenters, barangayCoords(myBrgy), myBrgy),
    [evacuationCenters, myBrgy],
  )
  const contacts = useMemo(
    () => barangayAssignments[myBrgy]?.contacts || [],
    [barangayAssignments, myBrgy],
  )

  const status = useMemo(() => floodStatus(allAlerts, field, myBrgy), [allAlerts, field, myBrgy])
  const level = status.source === 'alert'
    ? (status.level === 'emergency' ? 'high' : status.level)
    : levelFromDepth(floodDepth)

  /* Alert rows collapse to their title — the adviser's note that the
     dashboards are too crowded, and on a phone four full alert bodies were
     900px of the page.

     BUT an emergency is never hidden behind a tap. Anything at emergency or
     high severity starts open: the whole point of that tier is that it takes
     over the screen, and "FORCED EVACUATION" collapsed to one line that a
     frightened person has to think to tap is the exact failure this feed
     exists to prevent. Everything below that tier starts closed. */
  const [openAlerts, setOpenAlerts] = useState(() => new Set())
  const isAlertOpen = (a) =>
    a.level === 'emergency' || a.level === 'high' || openAlerts.has(a.id)
  const toggleAlert = (id) => setOpenAlerts((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const [prep, setPrep] = usePersistedState('cdrrmo-res-prep', {})
  const prepDone = PREP_ITEMS.filter((i) => prep[i.key]).length
  const [showReport, setShowReport] = useState(false)

  /* Even the small area map earns a search box: this is the first screen a
     resident lands on, and "where is the nearest centre to my street?" is the
     first question they bring to it. */
  const [searchResult, setSearchResult] = useState(null)
  const localIndex = useMemo(
    () => buildLocalIndex({ evacCenters: evacuationCenters }),
    [evacuationCenters],
  )

  /* On a phone this page was 2,690px tall — more than three screens — and the
     alert card alone accounted for 900px of it. Five full alerts is a digest,
     not a dashboard: it buries the forecast, the checklist and the hotlines
     below a wall of text nobody scrolls to. Phones get the newest two and a
     link into the full feed; desktop, which shows this in a side column beside
     the map, keeps all five. */
  const narrow = useNarrowScreen()
  const alertLimit = narrow ? 2 : 5
  const hiddenAlerts = Math.max(0, alerts.length - alertLimit)

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
            <div className="res-risk-label">{t('Your Flood Risk Level')}</div>
            {/* Not RISK_META — that is the admin map constant, where
                'moderate' is the four-character "MOD" that fits in a map
                legend. A resident reading their own safety card gets the
                whole word. */}
            <div className="res-risk-level">{status.source === 'alert' || conditionsVerified ? t(RESIDENT_RISK_LABEL[level]) : 'UNVERIFIED'}</div>
            <div className="res-risk-sub">
              Brgy. {brgyLabel}
              {conditionsVerified && status.source !== 'alert' && describeDepth(floodDepth) && <> · Modeled: {describeDepth(floodDepth)}</>}
              {' · '}{status.source === 'alert' || conditionsVerified ? t(RISK_BLURB[level]) : 'Current flood conditions are unavailable.'}
            </div>
            {/* The admin screens carry this caveat; the person who has to act
                on the number did not. It is a model estimate from rainfall and
                terrain, not a gauge reading on their street. */}
            <div className="res-risk-note">
              {status.source === 'alert'
                ? status.alert.title
                : t('Estimated from rainfall and ground height — not a measurement of your street. Trust what you can see outside.')}
            </div>
          </div>

          <div className={`res-steps-card ${level}`}>
            <div className="res-card-head">
              <svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              {t('What To Do Now')}
            </div>
            <ul className="res-steps">
              {RISK_STEPS[level].map((s) => (
                <li key={s}><span className="res-step-dot" />{t(s)}</li>
              ))}
            </ul>
          </div>

          <div className="res-evac-card">
            <div className="res-card-head">
              <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
              {t('Nearest Evacuation Centre')}
            </div>
            {safetyReady && nearestCenter ? (
              <>
                <div className="res-evac-name">{nearestCenter.name}</div>
                <div className="res-evac-meta">
                  Brgy. {nearestCenter.barangay}
                  {remainingHeadroom(nearestCenter) != null && (
                    <> · room for about {remainingHeadroom(nearestCenter).toLocaleString()} more</>
                  )}
                </div>
                {/* Said plainly rather than left for the reader to work out of
                    "460/500": someone deciding whether to walk here in the rain
                    needs to know it may be full when they arrive. */}
                {isNearlyFull(nearestCenter) && (
                  <div className="res-evac-warn">
                    Filling up — go now, or head to another centre if you can.
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="res-evac-name muted">{safetyReady ? 'No eligible centre listed' : 'Shelter availability unverified'}</div>
                <div className="res-evac-meta">
                  Confirm an open centre with your barangay hall before travelling. Call 911 in an emergency.
                </div>
              </>
            )}
          </div>

          <button type="button" className="res-route-btn" onClick={() => navigate('/resident/evacuation-routing')}>
            <svg viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
            {t('Get Safe Route to Evacuation Centre')}
          </button>

          <button type="button" className="res-route-btn" style={{ background: '#c0181b' }} onClick={() => setShowReport(true)}>
            <svg viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" /><path d="M9 14c1 1 2 1 3 0s2-1 3 0" /></svg>
            {t('Report Flood Status')}
          </button>

          {/* Emergency text sign-up, on the landing page and not only under
              Alerts. The point of the SMS channel is reaching residents who are
              NOT looking at this site, and the only way to enrol was a card on
              a page you had to already be browsing to find. Putting it on the
              screen every resident lands on is what makes "all residents can
              give us their number" true rather than technically available.
              The card no-ops for anyone already verified, so it costs a
              subscribed resident nothing. */}
          <EmergencySmsCard />

          <div className="res-map-card">
            <div className="res-map">
              <div className="res-map-label">Brgy. {brgyLabel} · Area Map</div>
              <MapContainer center={CABUYAO_CENTER} zoom={CABUYAO_ZOOM} zoomControl={false} attributionControl={false}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.85} />
                <ZoomControl position="bottomright" />
                {myBrgy ? <BarangayLock name={myBrgy} /> : <CabuyaoLock />}
                <LocateControl />
                <SearchResultLayer result={searchResult} />
              </MapContainer>
              <MapSearchBar localIndex={localIndex} onSelect={setSearchResult} />
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
          <div className="res-side-card res-alerts-card">
            <div className="res-side-title">
              <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
              {t('Active Alerts Near You')}
            </div>
            {alerts.length === 0 ? (
              <div className="res-empty">
                <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                <div className="res-empty-title">{safetyReady ? 'No active alerts' : 'Alert feed unverified'}</div>
                <div className="res-empty-sub">{safetyReady ? `Alerts affecting Brgy. ${brgyLabel} will show here.` : 'Check official announcements from CDRRMO and your barangay.'}</div>
              </div>
            ) : (
              <div className="res-alert-list">
                {alerts.slice(0, alertLimit).map((a) => {
                  const open = isAlertOpen(a)
                  return (
                    <div className={`res-alert-row ${open ? 'open' : ''}`} key={a.id}>
                      <span className={`res-alert-stripe ${a.level || 'safe'}`} />
                      <div className="res-alert-main">
                        <button
                          type="button"
                          className="res-alert-head"
                          aria-expanded={open}
                          onClick={() => toggleAlert(a.id)}
                        >
                          <span className="res-alert-title">{a.title}</span>
                          <svg className="res-alert-chev" viewBox="0 0 24 24" aria-hidden="true">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                        {open && a.message && <div className="res-alert-msg">{a.message}</div>}
                        {a.issued && <div className="res-alert-time">{a.issued}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {hiddenAlerts > 0 && (
              <Link className="res-see-all" to="/resident/alerts">
                View all {alerts.length} alerts
                <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg>
              </Link>
            )}
          </div>

          <details className="res-side-card res-forecast-card res-disclosure">
            <summary className="res-side-title">
              <svg viewBox="0 0 24 24"><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" /><line x1="8" y1="19" x2="8" y2="21" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="16" y1="19" x2="16" y2="21" /></svg>
              {/* Counted from what is actually rendered. The heading said
                  "3-Day Forecast" above four columns (today plus three), and
                  a hardcoded "4" would drift the same way the moment the
                  upstream feed returns fewer days. */}
              {forecast.length}-Day Forecast
            </summary>
            <div className="res-forecast">
              {forecast.map((f, i) => (
                <div key={f.day} className={`res-fc-day ${i === 0 ? 'today' : ''}`}>
                  <div className="res-fc-name">{f.day}</div>
                  <div className="res-fc-icon">{f.icon || '—'}</div>
                  <div className="res-fc-temp">{f.temp != null ? `${f.temp}°C` : '--'}</div>
                </div>
              ))}
            </div>
          </details>

          <details className="res-side-card res-prep-card res-disclosure">
            <summary className="res-side-title">
              <svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              {t('Preparedness Checklist')}
              <span className="res-prep-count">{prepDone}/{PREP_ITEMS.length}</span>
            </summary>
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
                  <span className="res-prep-label">{t(it.label)}</span>
                </label>
              ))}
            </div>
          </details>

          <div className="res-side-card res-contacts-card">
            <div className="res-side-title">
              <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.18 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 21.5 16z" /></svg>
              {t('Emergency Contacts')}
            </div>
            <ContactRow name={NATIONAL_HOTLINE.name} number={NATIONAL_HOTLINE.number} />
            {contacts.map((c) => (
              <ContactRow key={c.id} name={c.role || c.name} number={c.contact} />
            ))}
            {contacts.length === 0 && (
              <ContactRow name={`Brgy. ${brgyLabel} Hotline`} number={null} />
            )}
          </div>
        </div>
      </div>

      {showReport && <FloodReportModal onClose={() => setShowReport(false)} />}
    </ResidentLayout>
  )
}

/**
 * One emergency-contact row. When a number is on file the whole row is a
 * `tel:` link — this page is read on a phone during a flood, and making the
 * reader memorise a hotline and retype it into the dialler is the wrong ask.
 * Rows with no number stay inert text rather than becoming a dead link.
 */
function ContactRow({ name, number }) {
  const dial = number && String(number).replace(/[^\d+]/g, '')
  if (!dial) {
    return (
      <div className="res-contact-row">
        <span className="res-contact-name">{name}</span>
        <span className="res-contact-num muted">—</span>
      </div>
    )
  }
  return (
    <a className="res-contact-row is-link" href={`tel:${dial}`}>
      <span className="res-contact-name">{name}</span>
      <span className="res-contact-num">
        {number}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.18 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 21.5 16z" />
        </svg>
      </span>
    </a>
  )
}
