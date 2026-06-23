import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet'
import BarangayLayout from '../../components/barangay/BarangayLayout.jsx'
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
import { useRoadStatus } from '../../components/admin/routingHelpers.jsx'
import { useLiveWeather, formatRain } from '../../services/weather.js'
import { officialBarangayLabel, getOfficialBarangay } from '../../data/barangay.js'
import {
  useAlerts, useEvacCenters, useIncidents, useRoadRequests, useBarangayAssignments,
} from '../../context/AdminDataContext.jsx'
import './Barangay.css'

/**
 * CDRRMO Barangay — Dashboard (Monitor landing).
 *
 * The official's at-a-glance picture of THEIR barangay: measured flood risk,
 * a jurisdiction map locked to their own border, the quick actions they reach
 * for in an event, and the latest alerts affecting their area. Figures are read
 * live from the shared system store, scoped to this barangay — the same alerts
 * and shelters the command center manages. Risk follows the measured flood
 * depth, the system-wide single source of truth.
 */

const RISK_BLURB = {
  high: 'Severe flooding likely — activate evacuation and keep residents updated.',
  moderate: 'Rising water in low-lying areas — prepare to evacuate vulnerable households.',
  low: 'Minor flooding possible — monitor conditions and advise caution.',
  safe: 'No elevated flood risk reported. Conditions are being monitored.',
}

export default function Dashboard() {
  const navigate = useNavigate()
  const brgyLabel = officialBarangayLabel()
  const myBrgy = getOfficialBarangay()

  const { field } = useFloodRisk()
  const { alerts: allAlerts } = useAlerts()
  const { evacuationCenters } = useEvacCenters()
  const { incidents } = useIncidents()
  const { roadChangeRequests } = useRoadRequests()
  const { barangayAssignments } = useBarangayAssignments()
  const { weather } = useLiveWeather()
  const [statusMap] = useRoadStatus()

  const floodDepth = useMemo(
    () => barangayRiskSamples(field).find((b) => b.name === myBrgy)?.floodDepth ?? 0,
    [field, myBrgy],
  )
  const alerts = useMemo(
    () => allAlerts.filter((a) => a.barangay === myBrgy && a.status === 'active'),
    [allAlerts, myBrgy],
  )
  const openShelters = useMemo(
    () => evacuationCenters.filter((c) => c.barangay === myBrgy && c.status === 'open').length,
    [evacuationCenters, myBrgy],
  )

  // Situation snapshot figures, all from the shared store, scoped where it makes sense.
  const openIncidents = useMemo(
    () => incidents.filter((i) => i.barangay === myBrgy && i.status !== 'resolved').length,
    [incidents, myBrgy],
  )
  const pendingRoadReqs = useMemo(
    () => roadChangeRequests.filter((r) => r.barangay === myBrgy && r.status === 'pending').length,
    [roadChangeRequests, myBrgy],
  )
  const liveFlaggedRoads = useMemo(
    () => Object.values(statusMap).filter((s) => s === 'flooded' || s === 'blocked').length,
    [statusMap],
  )
  // Response readiness: how many of the 6 standard BDRRMC items are marked ready.
  const readyCount = useMemo(() => {
    const r = barangayAssignments[myBrgy]?.readiness || {}
    return Object.values(r).filter(Boolean).length
  }, [barangayAssignments, myBrgy])

  const level = useMemo(() => levelFromDepth(floodDepth), [floodDepth])
  const activeAlerts = alerts.length

  function go(path) {
    return () => navigate(path)
  }

  return (
    <BarangayLayout>
      <div className="bq">
        {/* ── Status banner ── */}
        <div className={`bq-banner ${level}`}>
          <div className="bq-banner-icon">
            <svg viewBox="0 0 24 24">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="bq-banner-text">
            <h2>Brgy. {brgyLabel} — Flood Status</h2>
            <p>{RISK_BLURB[level]}</p>
          </div>
          <div className="bq-banner-level">
            <div className="bq-banner-level-val">{RISK_META[level].label}</div>
            <div className="bq-banner-level-lbl">Risk Level</div>
          </div>
        </div>

        {/* ── Stat cards ── */}
        <div className="bq-stats">
          <Stat
            color={level === 'safe' ? 'green' : level === 'high' ? 'red' : 'orange'}
            icon={<GaugeIcon />}
            value={RISK_META[level].label}
            label="Current Risk"
          />
          <Stat color="blue" icon={<DropletIcon />} value={`~${floodDepth.toFixed(2)}m`} label="Est. Depth" />
          <Stat color="red" icon={<BellIcon />} value={activeAlerts} label="Active Alerts" />
          <Stat color="green" icon={<HomeIcon />} value={openShelters} label="Open Shelters" />
        </div>

        {/* ── Map + side panel ── */}
        <div className="bq-grid">
          {/* Jurisdiction map */}
          <div className="bq-panel bq-map-card">
            <div className="bq-map">
              <div className="bq-map-label">Brgy. {brgyLabel} · Jurisdiction</div>
              <MapContainer
                center={CABUYAO_CENTER}
                zoom={CABUYAO_ZOOM}
                zoomControl={false}
                attributionControl={false}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.85} />
                <ZoomControl position="bottomright" />
                {myBrgy ? <BarangayLock name={myBrgy} /> : <CabuyaoLock />}
                <LocateControl />
              </MapContainer>
              <div className="bq-map-legend">
                <div className="bq-legend-item"><span className="bq-legend-line" style={{ background: '#16A34A' }} /> Safe Route</div>
                <div className="bq-legend-item"><span className="bq-legend-line" style={{ background: '#F97316' }} /> Flood Risk</div>
                <div className="bq-legend-item"><span className="bq-legend-line" style={{ background: '#EF4444' }} /> Blocked</div>
              </div>
            </div>
          </div>

          {/* Side: quick actions + recent alerts */}
          <div className="bq" style={{ gap: 14 }}>
            <div className="bq-panel">
              <div className="bq-panel-head">
                <div className="bq-panel-title"><BoltIcon /> Quick Actions</div>
              </div>
              <div className="bq-actions">
                <button type="button" className="bq-action primary" onClick={go('/barangay/alerts')}>
                  <span className="bq-action-icon"><BellIcon /></span>
                  Send Barangay Alert
                  <span className="bq-action-arrow">›</span>
                </button>
                <button type="button" className="bq-action" onClick={go('/barangay/incidents')}>
                  <span className="bq-action-icon"><TriangleIcon /></span>
                  Report Incident
                  <span className="bq-action-arrow">›</span>
                </button>
                <button type="button" className="bq-action" onClick={go('/barangay/road-status')}>
                  <span className="bq-action-icon"><RoadIcon /></span>
                  Update Road Status
                  <span className="bq-action-arrow">›</span>
                </button>
                <button type="button" className="bq-action" onClick={go('/barangay/evacuation-routing')}>
                  <span className="bq-action-icon"><TargetIcon /></span>
                  View Safe Routes
                  <span className="bq-action-arrow">›</span>
                </button>
              </div>
            </div>

            <div className="bq-panel">
              <div className="bq-panel-head">
                <div className="bq-panel-title"><PulseIcon /> Situation Snapshot</div>
              </div>
              <div className="bq-kv-grid">
                <div className="bq-kv">
                  <div className="bq-kv-label">Open Incidents</div>
                  <div className="bq-kv-val">{openIncidents}</div>
                </div>
                <div className="bq-kv">
                  <div className="bq-kv-label">Road Requests Pending</div>
                  <div className="bq-kv-val">{pendingRoadReqs}</div>
                </div>
                <div className="bq-kv">
                  <div className="bq-kv-label">Response Readiness</div>
                  <div className="bq-kv-val">{readyCount}/6</div>
                </div>
                <div className="bq-kv">
                  <div className="bq-kv-label">Live Rainfall</div>
                  <div className="bq-kv-val">{formatRain(weather.current.rain)}</div>
                </div>
                <div className="bq-kv">
                  <div className="bq-kv-label">Flagged Roads (City)</div>
                  <div className="bq-kv-val">{liveFlaggedRoads}</div>
                </div>
                <div className="bq-kv">
                  <div className="bq-kv-label">Open Shelters</div>
                  <div className="bq-kv-val">{openShelters}</div>
                </div>
              </div>
            </div>

            <div className="bq-panel">
              <div className="bq-panel-head">
                <div className="bq-panel-title"><BellIcon /> Recent Alerts</div>
                {alerts.length > 0 && (
                  <button type="button" className="bq-mini-btn" onClick={go('/barangay/alerts')}>View all</button>
                )}
              </div>
              {alerts.length === 0 ? (
                <div className="bq-empty">
                  <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                  <div className="bq-empty-title">No active alerts</div>
                  <div className="bq-empty-sub">Alerts affecting Brgy. {brgyLabel} will appear here.</div>
                </div>
              ) : (
                <div className="bq-feed">
                  {alerts.slice(0, 5).map((a) => (
                    <div className="bq-feed-item" key={a.id}>
                      <span className={`bq-feed-stripe ${a.level || 'safe'}`} />
                      <div>
                        <div className="bq-feed-title">{a.title}</div>
                        {a.message && <div className="bq-feed-msg">{a.message}</div>}
                        {a.issued && <div className="bq-feed-time">{a.issued}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </BarangayLayout>
  )
}

/* ── Stat card ── */
function Stat({ color, icon, value, label }) {
  return (
    <div className={`bq-stat ${color}`}>
      <div className="bq-stat-icon">{icon}</div>
      <div className="bq-stat-val">{value}</div>
      <div className="bq-stat-lbl">{label}</div>
    </div>
  )
}

/* ── Icons ── */
function GaugeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 14l4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </svg>
  )
}
function DropletIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>
  )
}
function BellIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}
function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}
function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}
function PulseIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  )
}
function TriangleIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  )
}
function RoadIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 21L8 3" />
      <path d="M20 21L16 3" />
      <line x1="12" y1="5" x2="12" y2="8" />
      <line x1="12" y1="11" x2="12" y2="14" />
      <line x1="12" y1="17" x2="12" y2="20" />
    </svg>
  )
}
function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
