import { useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { useLiveWeather, formatRain } from '../../services/weather.js'
import { useFloodRisk, barangayRiskSamples, estDepthFromRisk } from '../../components/admin/floodRisk.js'
import { useCabuyaoRoads, useRoadStatus } from '../../components/admin/routingHelpers.jsx'
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

// Road condition options — these map to the Status column / badge colours.
const ROAD_STATUSES = [
  { value: 'passable', label: 'Passable' },
  { value: 'caution', label: 'Caution' },
  { value: 'closed', label: 'Closed' },
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
  // ── Live feeds ──
  const { weather } = useLiveWeather()
  const { field } = useFloodRisk()
  const { roads: roadNetwork } = useCabuyaoRoads()
  const [roadStatus] = useRoadStatus()

  const [alerts] = useState([])
  // Each barangay's flood depth is derived live from the Flood Hub × Windy risk
  // field sampled at its location (model estimate, not a sensor reading).
  const barangays = useMemo(() => barangayRiskSamples(field), [field])

  const [realtime, setRealtime] = useState(true)
  const [riskFilter, setRiskFilter] = useState('all')
  // Which modal is open: 'hazard' (hazard alert) | 'road' (road status) | null
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState('')

  // Roads the admin flagged on Road Status, resolved to names + nearest
  // barangay + a live depth estimate so the table matches that screen.
  const flaggedRoads = useMemo(() => {
    if (!roadNetwork) return []
    const byId = new Map(roadNetwork.features.map((f) => [String(f.properties.id), f]))
    return Object.entries(roadStatus)
      .map(([id, status]) => {
        const f = byId.get(String(id))
        const geo = f?.geometry?.coordinates
        const mid = geo ? geo[Math.floor(geo.length / 2)] : null // [lng, lat]
        const pt = mid ? [mid[1], mid[0]] : null
        const depth = pt && field ? estDepthFromRisk(field.riskAt(pt[0], pt[1])) : 0
        return {
          id,
          status, // 'flooded' | 'blocked'
          name: f?.properties?.name || `Road #${id}`,
          barangay: pt ? barangayForPoint(pt[0], pt[1]) : '—',
          depth,
        }
      })
      .sort((a, b) => b.depth - a.depth || a.name.localeCompare(b.name))
  }, [roadNetwork, roadStatus, field])

  // ── Derived figures ──
  const activeAlerts = alerts.length
  const blockedRoads = flaggedRoads.filter((r) => r.status === 'blocked').length
  const rainfall = weather.current.rain
  const incidentCount = 0 // sourced from /incidents later

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
    // Backend not wired yet — a POST /alerts will replace this later.
    flashToast('Hazard alert queued — will be saved once the backend is connected.')
    setModal(null)
  }

  function handleRoadSubmit(e) {
    e.preventDefault()
    // Backend not wired yet — a POST /roads will replace this later.
    flashToast('Road status queued — will be saved once the backend is connected.')
    setModal(null)
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
            {alerts.length === 0 ? (
              <div className="empty-state">No active alerts.</div>
            ) : (
              alerts.map((a) => (
                <div className="alert-item" key={a.id}>
                  <div className={`alert-stripe ${a.severity}`} />
                  <div className="alert-body">
                    <div className="alert-title-row">
                      <span className="alert-name">{a.title}</span>
                      <span className="alert-time">{a.time}</span>
                    </div>
                    <div className="alert-desc">{a.message}</div>
                  </div>
                </div>
              ))
            )}
          </div>
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
                  title={`Flood depth: ${b.floodDepth.toFixed(2)} m`}
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

          <div className="view-all-link">View All Barangays</div>
        </div>
      </div>

      {/* ── Road Status table ── */}
      <div className="road-table-wrap">
        <div className="road-table-hdr">
          <div>
            <div className="section-title road-title">
              <ListIcon />
              Road Status
            </div>
            <div className="section-sub road-sub">Real-time alert feed</div>
          </div>
          <button className="btn-issue" onClick={() => setModal('road')}>
            <PlusIcon />
            Report Road
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Road Name</th>
              <th>Location (Barangay)</th>
              <th>Status</th>
              <th>Flood Depth</th>
              <th>Last Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {flaggedRoads.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-table">
                  No affected roads reported.
                </td>
              </tr>
            ) : (
              flaggedRoads.map((r) => {
                const badge = r.status === 'blocked'
                  ? { cls: 'closed', label: 'CLOSED' }
                  : { cls: 'caution', label: 'FLOODED' }
                return (
                  <tr key={r.id}>
                    <td className="road-name">{r.name}</td>
                    <td>{r.barangay}</td>
                    <td>
                      <span className={`road-status-badge ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td className="depth">{r.depth.toFixed(2)}m</td>
                    <td className="time-col">Live</td>
                    <td />
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Hazard Alert modal (Active Hazard Alerts feed) ── */}
      {modal === 'hazard' && (
        <div className="modal-overlay show" onMouseDown={() => setModal(null)}>
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
                  <select required defaultValue="">
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
                  <select required defaultValue="high">
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
                <input type="text" placeholder="Severe Flood Warning" required />
              </label>

              <label>
                Hazard Description
                <textarea
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

      {/* ── Road Status modal (Road Status table) ── */}
      {modal === 'road' && (
        <div className="modal-overlay show" onMouseDown={() => setModal(null)}>
          <div
            className="issue-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Report Road Status"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="section-title">Report Road Status</div>
                <div className="section-sub">
                  Log a road's passability and flood depth
                </div>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={() => setModal(null)}
                aria-label="Close road status form"
              >
                ×
              </button>
            </div>

            <form className="issue-form" onSubmit={handleRoadSubmit}>
              <div className="form-grid">
                <label>
                  Road Name
                  <input type="text" placeholder="e.g. J.P. Rizal Street" required />
                </label>
                <label>
                  Location (Barangay)
                  <select required defaultValue="">
                    <option value="" disabled>
                      Select Barangay
                    </option>
                    {BARANGAYS.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="form-grid">
                <label>
                  Status
                  <select required defaultValue="passable">
                    {ROAD_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Flood Depth (m)
                  <input type="number" min="0" max="5" step="0.1" defaultValue="0" required />
                </label>
              </div>

              <label>
                Notes (optional)
                <textarea
                  rows={3}
                  placeholder="Detour advice or any additional road condition details."
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
                  Save Road Status
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
