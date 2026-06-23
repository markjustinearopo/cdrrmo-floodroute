import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { useLiveWeather, formatRain } from '../../services/weather.js'
import { useFloodRisk, barangayRiskSamples, estDepthFromRisk } from '../../components/admin/floodRisk.js'
import {
  useCabuyaoRoads,
  useRoadStatus,
  RoadNetworkLayer,
  ROAD_STATUS,
} from '../../components/admin/routingHelpers.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock } from '../../components/admin/mapHelpers.jsx'
import { useAlerts, useIncidents, useRoadReports } from '../../context/AdminDataContext.jsx'
import { barangayForPoint } from '../../data/cabuyaoBarangays.js'
import './Dashboard.css'

/**
 * CDRRMO Admin — Dashboard (React port of admin/dashboard.html).
 *
 * Every figure here starts empty/zero; live values will arrive from the
 * Node/Express + database backend (Conceptual Framework). The local state
 * below mirrors the shape the API will eventually return so the render
 * code does not have to change when that wiring lands.
 */

// The 18 official barangays of Cabuyao City (alphabetical).
const BARANGAYS = [
  'Baclaran', 'Banay-Banay', 'Banlic', 'Bigaa', 'Butong', 'Casile',
  'Diezmo', 'Gulod', 'Mamatid', 'Marinig', 'Niugan', 'Pittland',
  'Poblacion Dos', 'Poblacion Tres', 'Poblacion Uno', 'Pulo', 'Sala',
  'San Isidro',
]

const ALERT_LEVELS = [
  { value: 'high', label: 'High' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'safe', label: 'Safe / All Clear' },
]

/**
 * Barangay safeness is driven by the measured flood depth (in metres) that
 * the backend supplies per barangay. These breakpoints are the single source
 * of truth for both the badge and the bar — keep them in sync with the API.
 *   SAFE     < 0.1 m
 *   LOW      0.1 – < 0.3 m
 *   MODERATE 0.3 – < 0.5 m
 *   HIGH     >= 0.5 m
 */
const DEPTH_THRESHOLDS = { low: 0.1, moderate: 0.3, high: 0.5 }
// Depth (m) that fills the risk bar to 100% — anything deeper stays capped.
const DEPTH_FULL_BAR = 0.6

function levelFromDepth(depth) {
  if (depth >= DEPTH_THRESHOLDS.high) return 'high'
  if (depth >= DEPTH_THRESHOLDS.moderate) return 'moderate'
  if (depth >= DEPTH_THRESHOLDS.low) return 'low'
  return 'safe'
}

const RISK_FILTERS = [
  { key: 'high', label: 'High', cls: 'hi' },
  { key: 'moderate', label: 'Moderate', cls: 'mod' },
  { key: 'low', label: 'Low', cls: 'low' },
]

export default function Dashboard() {
  const navigate = useNavigate()

  // ── Live feeds ──
  const { weather } = useLiveWeather()
  const { field } = useFloodRisk()
  const { roads: roadNetwork } = useCabuyaoRoads()
  const [roadStatus, { setStatus }] = useRoadStatus()

  // ── Shared store ──
  const { alerts, addAlert } = useAlerts()
  const { incidents } = useIncidents()
  const { roadReports, removeRoadReport } = useRoadReports()

  // Each barangay's flood depth is derived live from the Open-Meteo flood ×
  // forecast risk field sampled at its location (model estimate, not a sensor reading).
  const barangays = useMemo(() => barangayRiskSamples(field), [field])

  const [realtime, setRealtime] = useState(true)
  const [riskFilter, setRiskFilter] = useState('all')
  // Which modal is open: 'hazard' (hazard alert) | null
  const [modal, setModal] = useState(null)
  // Active brush for clicking roads on the map: 'flooded' | 'blocked' (Closed).
  const [roadBrush, setRoadBrush] = useState('flooded')
  const [toast, setToast] = useState('')

  // Only active alerts surface on the dashboard feed (scheduled/resolved hide).
  const activeAlertList = useMemo(
    () => alerts.filter((a) => a.status === 'active'),
    [alerts],
  )

  // Roads flagged on Road Status (painted map) + the admin's named road reports
  // from the modal below, resolved to names + nearest barangay + live depth.
  const flaggedRoads = useMemo(() => {
    if (!roadNetwork) return []
    const byId = new Map(roadNetwork.features.map((f) => [String(f.properties.id), f]))
    const reportByWay = new Map(roadReports.filter((r) => r.wayId != null).map((r) => [String(r.wayId), r]))
    const rows = Object.entries(roadStatus).map(([id, status]) => {
      const f = byId.get(String(id))
      const geo = f?.geometry?.coordinates
      const mid = geo ? geo[Math.floor(geo.length / 2)] : null // [lng, lat]
      const pt = mid ? [mid[1], mid[0]] : null
      const report = reportByWay.get(String(id))
      const depth = report?.depth != null
        ? Number(report.depth)
        : (pt && field ? estDepthFromRisk(field.riskAt(pt[0], pt[1])) : 0)
      return {
        id,
        status, // 'flooded' | 'blocked'
        name: report?.name || f?.properties?.name || `Road #${id}`,
        barangay: report?.barangay || (pt ? barangayForPoint(pt[0], pt[1]) : '—'),
        depth,
        updated: report?.updated || 'Live',
      }
    })
    // Named reports that aren't tied to a mapped way (free-text road name).
    // Every report shows here — including ones logged as "Passable" — so an
    // admin always gets visible confirmation that their report was recorded.
    roadReports
      .filter((r) => r.wayId == null)
      .forEach((r) => rows.push({
        id: r.id,
        status: r.status === 'closed' ? 'blocked' : r.status === 'passable' ? 'passable' : 'flooded',
        name: r.name,
        barangay: r.barangay,
        depth: Number(r.depth) || 0,
        updated: r.updated,
      }))
    return rows.sort((a, b) => b.depth - a.depth || a.name.localeCompare(b.name))
  }, [roadNetwork, roadStatus, roadReports, field])

  // ── Derived figures ──
  const activeAlerts = activeAlertList.length
  const blockedRoads = flaggedRoads.filter((r) => r.status === 'blocked').length
  const rainfall = weather.current.rain
  const incidentCount = incidents.filter((i) => i.status !== 'resolved').length

  const riskCounts = useMemo(() => {
    const high = barangays.filter((b) => levelFromDepth(b.floodDepth) === 'high').length
    const moderate = barangays.filter((b) => levelFromDepth(b.floodDepth) === 'moderate').length
    const low = barangays.filter((b) => levelFromDepth(b.floodDepth) === 'low').length
    const affected = high + moderate
    return { high, moderate, low, affected }
  }, [barangays])

  const sortedBarangays = useMemo(() => {
    return [...barangays]
      .filter((b) => riskFilter === 'all' || levelFromDepth(b.floodDepth) === riskFilter)
      .sort((a, b) => b.floodDepth - a.floodDepth || a.name.localeCompare(b.name))
  }, [barangays, riskFilter])

  function flashToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  function handleHazardSubmit(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const alert = addAlert({
      title: f.get('title').trim(),
      barangay: f.get('barangay'),
      level: f.get('level'),
      message: f.get('message').trim(),
    })
    setModal(null)
    flashToast(`Alert issued for ${alert.barangay}.`)
  }

  // Click-to-flag on the dashboard map: apply the active brush to the picked
  // road (clicking it again with the same brush clears it). setStatus writes
  // the shared painted layer (localStorage + Supabase), so the change reflects
  // on every map — Flood Map, Road Status, routing — for all users.
  function paintRoad(props) {
    const current = roadStatus[props.id]
    const next = current === roadBrush ? 'open' : roadBrush
    setStatus(props.id, next)
    const label = roadBrush === 'blocked' ? 'closed' : 'flooded'
    const name = props.name || `Road #${props.id}`
    flashToast(next === 'open' ? `Cleared ${name}.` : `${name} marked ${label}.`)
  }

  // Clear a road row: lift the painted flag if it's a mapped way, or withdraw
  // the saved report if it's a free-text one.
  function clearRoad(row) {
    const report = roadReports.find((r) => r.id === row.id || String(r.wayId) === String(row.id))
    if (report) removeRoadReport(report.id)
    else setStatus(row.id, 'open')
    flashToast(`Cleared ${row.name}.`)
  }

  return (
    <AdminLayout>
      {/* ── Stat cards ── */}
      <div className="stat-cards">
        <StatCard
          color="yellow"
          icon={<BellIcon />}
          value={activeAlerts}
          label="Active Alerts"
        />
        <StatCard
          color="red"
          icon={<BarIcon />}
          value={blockedRoads}
          label="Blocked Roads"
        />
        <StatCard
          color="green"
          icon={<TriangleIcon />}
          value={incidentCount}
          label="Incidents"
        />
        <StatCard
          color="blue"
          icon={<RainIcon />}
          value={formatRain(rainfall)}
          label="Current Rainfall"
        />
      </div>

      {/* ── Flood Insight bar ── */}
      <div className="insight-bar">
        <span className="insight-label">Flood Insight :</span>
        <span className="insight-chip blue">{riskCounts.affected} Barangays affected</span>
        <span className="insight-chip red">{barangays.length} Barangays</span>
        {RISK_FILTERS.map((f) => (
          <span
            key={f.key}
            className={`insight-chip ${f.cls} filter-btn ${riskFilter === f.key ? 'active' : ''}`}
            onClick={() => setRiskFilter(f.key)}
          >
            {riskCounts[f.key]} {f.label}
          </span>
        ))}
        <span
          className="insight-chip clear"
          onClick={() => setRiskFilter('all')}
        >
          Clear Filter
        </span>
      </div>

      {/* ── Two column: Alerts + Barangay status ── */}
      <div className="two-col">
        {/* Active Hazard Alerts */}
        <div className="section-card">
          <div className="section-hdr">
            <div className="section-hdr-left">
              <BellIcon />
              <div>
                <div className="section-title">Active Hazard Alerts</div>
                <div className="section-sub">Real-time alert feed</div>
              </div>
            </div>
            <button className="btn-issue" onClick={() => setModal('hazard')}>
              <PlusIcon />
              Issue Alert
            </button>
          </div>
          <div className="alert-list">
            {activeAlertList.length === 0 ? (
              <div className="empty-state">No active alerts.</div>
            ) : (
              activeAlertList.map((a) => (
                <div className="alert-item" key={a.id}>
                  <div className={`alert-stripe ${a.level}`} />
                  <div className="alert-body">
                    <div className="alert-title-row">
                      <span className="alert-name">{a.title}</span>
                      <span className="alert-time">{a.issued}</span>
                    </div>
                    <div className="alert-desc">{a.barangay} — {a.message}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            className="view-all-link"
            onClick={() => navigate('/admin/alerts')}
          >
            View All Alerts
          </button>
        </div>

        {/* Barangay Flood Status */}
        <div className="section-card">
          <div className="section-hdr">
            <div className="section-hdr-left">
              <HomeIcon />
              <div>
                <div className="section-title">Barangay Flood Status</div>
                <div className="section-sub">
                  Current monitoring · All {barangays.length} Barangays
                </div>
              </div>
            </div>
            <div className="realtime-wrap">
              <span className="section-badge">Real-Time Data</span>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={realtime}
                  onChange={(e) => setRealtime(e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>

          <div className="brgy-list">
            {sortedBarangays.map((b) => {
              const level = levelFromDepth(b.floodDepth)
              const label = level.toUpperCase()
              const fill = Math.min(100, (b.floodDepth / DEPTH_FULL_BAR) * 100)
              return (
                <div
                  className="brgy-item"
                  key={b.name}
                  title={`Est. flood depth: ~${b.floodDepth.toFixed(2)} m`}
                >
                  <span className="brgy-name">{b.name}</span>
                  <div className="brgy-bar-track">
                    <div className={`brgy-bar-fill ${level}`} style={{ width: `${fill}%` }} />
                  </div>
                  <span className={`risk-badge ${level}`}>{label}</span>
                </div>
              )
            })}
          </div>

          <button
            type="button"
            className="view-all-link"
            onClick={() => navigate('/admin/barangay')}
          >
            View All Barangays
          </button>
        </div>
      </div>

      {/* ── Road Status: interactive 2D map + flagged-roads list ── */}
      <div className="section-card road-card">
        <div className="section-hdr">
          <div className="section-hdr-left">
            <ListIcon />
            <div>
              <div className="section-title">Road Status</div>
              <div className="section-sub">Click a road on the map to flag it</div>
            </div>
          </div>
          <div className="road-hdr-actions">
            <div className="road-brushes">
              <span className="road-brush-label">Tag as</span>
              <button
                type="button"
                className={`road-brush flooded ${roadBrush === 'flooded' ? 'active' : ''}`}
                onClick={() => setRoadBrush('flooded')}
              >
                <span className="road-brush-dot" />
                Flooded
              </button>
              <button
                type="button"
                className={`road-brush blocked ${roadBrush === 'blocked' ? 'active' : ''}`}
                onClick={() => setRoadBrush('blocked')}
              >
                <span className="road-brush-dot" />
                Closed
              </button>
            </div>
            <button
              type="button"
              className="btn-soft-sm"
              onClick={() => navigate('/admin/road-status')}
            >
              Open Road Status
              <ArrowIcon />
            </button>
          </div>
        </div>

        <div className="road-card-body">
          {/* Interactive 2D map — scroll zooms while hovering, page scrolls
              otherwise; click a road to flag it on every map. */}
          <div className="road-map">
            <span className="road-map-badge">2D View</span>
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              scrollWheelZoom
              className="road-map-leaflet"
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.85} />
              <ZoomControl position="bottomright" />
              <CabuyaoLock />
              {roadNetwork && (
                <RoadNetworkLayer roads={roadNetwork} statusMap={roadStatus} onPick={paintRoad} interactive />
              )}
            </MapContainer>
            <div className="road-map-hint">
              Click a road to mark it{' '}
              <b style={{ color: ROAD_STATUS[roadBrush].swatch }}>
                {roadBrush === 'blocked' ? 'Closed' : 'Flooded'}
              </b>
            </div>
            <div className="road-map-legend">
              <span><i style={{ background: ROAD_STATUS.flooded.swatch }} /> Flooded</span>
              <span><i style={{ background: ROAD_STATUS.blocked.swatch }} /> Closed</span>
              <span><i style={{ background: ROAD_STATUS.open.swatch }} /> Passable</span>
            </div>
          </div>

          {/* Flagged roads — clicking a road on the map adds it here */}
          <div className="road-list">
            <div className="road-list-head">
              <span>Flagged Roads</span>
              <span className="road-list-count">{flaggedRoads.length}</span>
            </div>
            <div className="road-list-scroll">
              {flaggedRoads.length === 0 ? (
                <div className="empty-state">No roads flagged yet. Click a road on the map.</div>
              ) : (
                flaggedRoads.map((r) => {
                  const badge = r.status === 'blocked'
                    ? { cls: 'closed', label: 'CLOSED' }
                    : r.status === 'passable'
                      ? { cls: 'passable', label: 'PASSABLE' }
                      : { cls: 'caution', label: 'FLOODED' }
                  return (
                    <div className="road-list-item" key={r.id}>
                      <div className="road-list-main">
                        <span className="road-list-name" title={r.name}>{r.name}</span>
                        <span className="road-list-brgy">{r.barangay} · {r.depth.toFixed(2)} m · {r.updated}</span>
                      </div>
                      <span className={`road-status-badge ${badge.cls}`}>{badge.label}</span>
                      <button
                        type="button"
                        className="road-clear-btn"
                        title="Clear this road"
                        onClick={() => clearRoad(r)}
                      >
                        Clear
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Hazard Alert modal (Active Hazard Alerts feed) ── */}
      {modal === 'hazard' && (
        <div className="dash-modal-overlay" onMouseDown={() => setModal(null)}>
          <div
            className="issue-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Issue Hazard Alert"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="section-title">Issue Hazard Alert</div>
                <div className="section-sub">
                  Broadcast a flood hazard warning to a barangay
                </div>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={() => setModal(null)}
                aria-label="Close hazard form"
              >
                ×
              </button>
            </div>

            <form className="issue-form" onSubmit={handleHazardSubmit}>
              <div className="form-grid">
                <label>
                  Barangay
                  <select name="barangay" required defaultValue="">
                    <option value="" disabled>
                      Select Barangay
                    </option>
                    {BARANGAYS.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Alert Level
                  <select name="level" required defaultValue="high">
                    {ALERT_LEVELS.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                Alert Title
                <input name="title" type="text" placeholder="Severe Flood Warning" required />
              </label>

              <label>
                Hazard Description
                <textarea
                  name="message"
                  rows={3}
                  placeholder="Describe the hazard, affected areas, and evacuation advice."
                  required
                />
              </label>

              <div className="modal-actions">
                <button
                  className="btn-cancel"
                  type="button"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button className="btn-issue" type="submit">
                  Issue Alert
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </AdminLayout>
  )
}

/* ── Stat card ── */
function StatCard({ color, icon, value, label }) {
  return (
    <div className="stat-card">
      <div className={`stat-card-top-bar ${color}`} />
      <div className="stat-card-header">
        <div className={`stat-card-icon ${color}`}>{icon}</div>
        <span className="stat-delta">--</span>
      </div>
      <div className="stat-num">{value}</div>
      <div className="stat-lbl">{label}</div>
    </div>
  )
}

/* ── Icons ── */
function BellIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}
function BarIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
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
function RainIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="16" y1="13" x2="16" y2="21" />
      <line x1="8" y1="13" x2="8" y2="21" />
      <line x1="12" y1="15" x2="12" y2="23" />
      <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}
function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}
function ListIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#C0181B"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}
