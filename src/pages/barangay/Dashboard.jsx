import { useMemo, useState } from 'react'
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
  useFloodReports, useRoadReports,
} from '../../context/AdminDataContext.jsx'
import MapSearchBar from '../../components/map/MapSearchBar.jsx'
import SearchResultLayer from '../../components/map/SearchResultLayer.jsx'
import { buildLocalIndex } from '../../components/map/searchTools.js'
import AlertStack from '../../components/dash/AlertStack.jsx'
import FloodOutlook from '../../components/dash/FloodOutlook.jsx'
import DepthGauge from '../../components/dash/DepthGauge.jsx'
import PulseTicker from '../../components/dash/PulseTicker.jsx'
import { useCountUp } from '../../components/dash/dashHooks.js'
import './Barangay.css'
import { alertAppliesTo } from '../../data/cabuyao.js'

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

  /* Same search as every other map in the system — an official checking their
     own barangay still needs to jump to a named street. */
  const [searchResult, setSearchResult] = useState(null)
  const localIndex = useMemo(
    () => buildLocalIndex({ evacCenters: evacuationCenters }),
    [evacuationCenters],
  )
  const { incidents } = useIncidents()
  const { roadChangeRequests } = useRoadRequests()
  const { barangayAssignments } = useBarangayAssignments()
  const { floodReports } = useFloodReports()
  const { roadReports } = useRoadReports()
  const { weather } = useLiveWeather()
  const [statusMap] = useRoadStatus()

  const floodDepth = useMemo(
    () => barangayRiskSamples(field).find((b) => b.name === myBrgy)?.floodDepth ?? 0,
    [field, myBrgy],
  )
  const alerts = useMemo(
    () => allAlerts.filter((a) => alertAppliesTo(a, myBrgy) && a.status === 'active'),
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

        {/* ── What the number actually means, and what is coming ──
            "0.62 m" is the one form of this reading a captain standing in
            front of the water cannot use. The gauge draws it against a person
            and a car; the outlook says whether it is about to get worse. */}
        <div className="bq-insight">
          <div className="bq-panel bq-depth-panel">
            <div className="bq-panel-head">
              <div className="bq-panel-title"><DropletIcon /> Depth In Context</div>
              <span className="bq-panel-note" title="Modeled from the live rainfall and terrain — not a gauge reading">
                Model estimate
              </span>
            </div>
            <DepthGauge depth={floodDepth} label={`Brgy. ${brgyLabel}`} />
          </div>
          <FloodOutlook weather={weather} hours={12} />
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
                <SearchResultLayer result={searchResult} navigateTo="/barangay/evacuation-routing" />
              </MapContainer>
              <MapSearchBar localIndex={localIndex} onSelect={setSearchResult} />
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
                  <div className="bq-kv-val bq-kv-ready">
                    <ReadinessRing done={readyCount} total={6} />
                    {readyCount}/6
                  </div>
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
              <AlertStack
                alerts={alerts}
                limit={5}
                emptyTitle="No active alerts"
                emptyHint={`Alerts affecting Brgy. ${brgyLabel} will appear here.`}
              />
            </div>

            {/* Everything happening in this barangay, in one column: the
                captain's own reports, the residents', and what the command
                centre has issued back. */}
            <PulseTicker
              alerts={allAlerts}
              incidents={incidents}
              floodReports={floodReports}
              roadReports={roadReports}
              barangay={myBrgy}
              limit={6}
              title="Live Activity"
              onOpen={(kind) => {
                if (kind === 'alert') navigate('/barangay/alerts')
                else if (kind === 'incident') navigate('/barangay/incidents')
                else navigate('/barangay/road-status')
              }}
            />
          </div>
        </div>
      </div>
    </BarangayLayout>
  )
}

/**
 * Readiness as a ring rather than a fraction. Six BDRRMC items is a small
 * enough number that "4/6" is readable, but a ring is readable without being
 * read — a captain glancing at this panel sees an incomplete circle before
 * they see any digits.
 */
function ReadinessRing({ done, total }) {
  const R = 9
  const C = 2 * Math.PI * R
  const pct = total > 0 ? Math.min(1, done / total) : 0
  const tone = pct >= 1 ? '#16a34a' : pct >= 0.5 ? '#f97316' : '#dc2626'
  return (
    <svg className="bq-ring" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r={R} className="bq-ring-track" />
      <circle
        cx="12" cy="12" r={R}
        className="bq-ring-arc"
        stroke={tone}
        strokeDasharray={`${(C * pct).toFixed(2)} ${(C * (1 - pct)).toFixed(2)}`}
      />
    </svg>
  )
}

/* ── Stat card ──
   Numbers ease to their new value instead of snapping, the same way the
   command centre's cards do — a figure that changes while somebody is looking
   at this screen should announce itself. Text values (a risk label) pass
   straight through. */
function Stat({ color, icon, value, label }) {
  const animated = useCountUp(value)
  const shown = typeof animated === 'number' ? Math.round(animated).toLocaleString() : animated
  return (
    <div className={`bq-stat ${color}`}>
      <div className="bq-stat-icon">{icon}</div>
      <div className="bq-stat-val">{shown}</div>
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
