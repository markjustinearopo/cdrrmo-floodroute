import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, CircleMarker, Tooltip } from 'react-leaflet'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import {
  CABUYAO_CENTER,
  CABUYAO_ZOOM,
  levelFromDepth,
  RISK_META,
  formatPHT,
  CabuyaoLock,
  CoordReadout,
} from '../../components/admin/mapHelpers.jsx'
import { useLiveWeather } from '../../services/weather.js'
import { useFloodRisk, barangayRiskSamples, riskColor } from '../../components/admin/floodRisk.js'
import { BarangayRiskLayer, InundationGrid, FocusController } from '../../components/admin/BarangayRiskLayer.jsx'
import { BarangayDetailCard } from '../../components/admin/BarangayDetailCard.jsx'
import { MapLayerToggles } from '../../components/admin/MapLayerToggles.jsx'
import { WeatherPanel } from '../../components/admin/WeatherPanel.jsx'
import { barangayBounds } from '../../data/cabuyaoBarangays.js'
import {
  ROUTE_TYPES,
  routeGeometry,
  pathLengthMeters,
  formatDistance,
  useRoutes,
} from '../../components/admin/routingHelpers.jsx'
import { SAMPLE_EVAC_CENTERS } from '../../data/cabuyao.js'
import './FloodMap.css'

/**
 * CDRRMO Admin — Flood Map (React port of admin/flood-map.html).
 *
 * The Conceptual Framework specifies Leaflet.js + OpenStreetMap for all
 * mapping, so the live map below uses react-leaflet over OSM tiles centred on
 * Cabuyao City. Every figure (alerts, blocked roads, rainfall, risk index)
 * starts at zero/empty — real values will arrive from the Node/Express +
 * PostgreSQL/PostGIS (Supabase) backend together with the Open-Meteo and
 * Google Flood Hub feeds. The local state mirrors the shape the API will
 * return so the render code stays put once that wiring lands.
 *
 * The Cabuyao boundary lock, coordinate readout and risk vocabulary are
 * shared with the other admin map screens via ../../components/admin/mapHelpers.
 */

const MAP_SUBTABS = [
  { key: 'live', label: 'Live Map', icon: MapIcon },
  { key: 'modules', label: 'System Modules', icon: GridIcon },
  { key: 'incidents', label: 'Incident Reports', icon: AlertTriangleIcon },
]

const PANEL_TABS = ['Overview', 'Weather', 'Alerts', 'Routes', 'Barangays']

// Eight hourly buckets for the rainfall mini-chart (-8h … Now).
const RAIN_TICKS = ['-8h', '-7', '-6', '-5', '-4', '-3', '-2', 'Now']

export default function FloodMap() {
  // ── Live feeds ──
  const { weather } = useLiveWeather()
  const { field } = useFloodRisk()
  const [routes] = useRoutes()

  const [alerts] = useState([])
  const [roads] = useState([])
  // Barangay flood depths sampled live from the Flood Hub × Windy risk field.
  const barangays = useMemo(() => barangayRiskSamples(field), [field])
  const rainfall = weather.current.rain ?? 0 // mm/hr
  const rainHistory = weather.rainHistory
  const evacuationOpen = useMemo(
    () => SAMPLE_EVAC_CENTERS.filter((c) => c.status !== 'closed').length,
    [],
  )

  // ── UI state ──
  const [subtab, setSubtab] = useState('live')
  const [panelTab, setPanelTab] = useState('Overview')
  const [coords, setCoords] = useState(null) // {lat, lng, zoom}
  const [updated, setUpdated] = useState(formatPHT())

  // Layer visibility + intensity (the on-map toggle control). Default: clean
  // barangay classification + markers; inundation heat off so colours don't mix.
  const [layers, setLayers] = useState({ barangays: true, inundation: false, markers: true })
  const [intensity, setIntensity] = useState(85)
  const toggleLayer = (k) => setLayers((v) => ({ ...v, [k]: !v[k] }))

  // Focus view + detail card.
  const [selected, setSelected] = useState(null) // barangay name
  const selectedSample = useMemo(() => barangays.find((b) => b.name === selected) || null, [barangays, selected])
  const focusBounds = useMemo(() => (selected ? barangayBounds(selected) : null), [selected])

  // Refresh the "Updated --:-- PHT" stamp every minute.
  useEffect(() => {
    const id = setInterval(() => setUpdated(formatPHT()), 60_000)
    return () => clearInterval(id)
  }, [])

  // ── Derived figures (all resolve to 0 with empty data) ──
  const activeAlerts = alerts.filter((a) => a.level !== 'safe').length
  const blockedRoads = roads.filter((r) => r.status === 'closed').length
  const safeRoutes = roads.filter((r) => r.status === 'passable').length

  const risk = useMemo(() => {
    const counts = { high: 0, moderate: 0, low: 0, safe: 0 }
    barangays.forEach((b) => counts[levelFromDepth(b.floodDepth)]++)
    const total = Math.max(barangays.length, 1)
    const pct = Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, Math.round((v / total) * 100)]),
    )
    const worst =
      counts.high > 0 ? 'high'
      : counts.moderate > 0 ? 'moderate'
      : counts.low > 0 ? 'low'
      : 'safe'
    return { counts, pct, worst }
  }, [barangays])

  const elevated = useMemo(
    () =>
      barangays
        .filter((b) => levelFromDepth(b.floodDepth) === 'high' || levelFromDepth(b.floodDepth) === 'moderate')
        .map((b) => b.name),
    [barangays],
  )

  const bannerText = elevated.length
    ? `Flood Alert: ${elevated.join(', ')} affected by rising water levels.`
    : 'No active flood issues reported.'

  const riskSummary = elevated.length
    ? `Elevated Flood Risk: ${elevated.slice(0, 3).join(', ')}${elevated.length > 3 ? '…' : ''}`
    : 'No elevated flood risk reported.'

  // ── 4-day forecast from the live Windy/Open-Meteo feed (emoji + high temp).
  //    The full, detailed outlook lives in the Weather tab. ──
  const forecast = useMemo(() => {
    if (weather.forecast.length) {
      return weather.forecast.slice(0, 4).map((f) => ({ day: f.day, condition: f.emoji, temp: f.tmax, label: f.label }))
    }
    return Array.from({ length: 4 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() + i)
      return {
        day: i === 0 ? 'Today' : d.toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'Asia/Manila' }),
        condition: '—',
        temp: null,
      }
    })
  }, [weather.forecast])

  return (
    <AdminLayout mainClassName="main--flush">
      <div className="floodmap">
        {/* ── Sub-tab bar ── */}
        <div className="subtab-bar">
          {MAP_SUBTABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className={`subtab ${subtab === key ? 'active' : ''}`}
              onClick={() => setSubtab(key)}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>

        {/* ── Map + Right panel ── */}
        <div className="map-panel-wrap">
          {/* Map */}
          <div className="map-area">
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              className="floodmap-leaflet"
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                opacity={0.85}
              />
              <ZoomControl position="bottomright" />
              <CabuyaoLock />

              {/* Land-clipped NOAH-style heat surface (Flood Hub × Windy) —
                  toggle so it never has to compete with the classification. */}
              {layers.inundation && (
                <InundationGrid cells={field?.cells} opacity={intensity / 100} mode="interior" />
              )}

              {/* The 18 REAL barangay polygons, coloured by live risk. Click one
                  to focus the map on it and open its detail card. */}
              {layers.barangays && (
                <BarangayRiskLayer
                  samples={barangays}
                  opacity={intensity / 100}
                  onSelect={setSelected}
                  selected={selected}
                />
              )}

              {/* Barangay risk markers, anchored at each polygon's interior
                  point (never in the lake). Also clickable for focus. */}
              {layers.markers &&
                barangays.map((b) => (
                  <CircleMarker
                    key={b.name}
                    center={b.coords}
                    radius={b.name === selected ? 7 : 5}
                    pathOptions={{ color: b.name === selected ? '#0f172a' : '#fff', weight: b.name === selected ? 3 : 1.5, fillColor: RISK_META[b.level].color, fillOpacity: 1 }}
                    eventHandlers={{ click: () => setSelected(b.name) }}
                  >
                    <Tooltip direction="top" offset={[0, -5]}>
                      <b>{b.name}</b>
                      <br />
                      {RISK_META[b.level].label} · ~{b.floodDepth.toFixed(2)} m
                    </Tooltip>
                  </CircleMarker>
                ))}

              <FocusController bounds={focusBounds} />
              <CoordReadout onChange={setCoords} />
            </MapContainer>

            {/* On-map layer toggles + intensity */}
            <MapLayerToggles
              opacity={intensity}
              onOpacity={setIntensity}
              layers={[
                { key: 'barangays', label: 'Barangay Risk', color: '#c0181b', on: layers.barangays, onToggle: () => toggleLayer('barangays') },
                { key: 'inundation', label: 'Flood Inundation', color: '#2563eb', on: layers.inundation, onToggle: () => toggleLayer('inundation') },
                { key: 'markers', label: 'Risk Markers', color: '#1a7a4a', on: layers.markers, onToggle: () => toggleLayer('markers') },
              ]}
            />

            {/* Focused barangay detail card */}
            {selectedSample && (
              <BarangayDetailCard sample={selectedSample} onClose={() => setSelected(null)} />
            )}

            {/* Legend (live timestamp + risk ramp) */}
            <div className="map-legend">
              <span className="legend-live">Live | Updated {updated} PHT</span>
              <span className="legend-ramp" aria-hidden="true">
                <i style={{ background: riskColor(0.05) }} />
                <i style={{ background: riskColor(0.4) }} />
                <i style={{ background: riskColor(0.7) }} />
                <i style={{ background: riskColor(0.95) }} />
                <small>Low → High</small>
              </span>
            </div>

            <div className="map-coords">
              {coords
                ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E | Zoom: ${coords.zoom}`
                : 'No map data'}
            </div>
          </div>

          {/* ── Right Panel ── */}
          <div className="right-panel">
            <div className="panel-tabs">
              {PANEL_TABS.map((tab) => (
                <div
                  key={tab}
                  className={`panel-tab ${panelTab === tab ? 'active' : ''}`}
                  onClick={() => setPanelTab(tab)}
                >
                  {tab}
                </div>
              ))}
            </div>

            <div className="panel-content">
              {panelTab === 'Overview' && (
                <OverviewTab
                  stats={{ activeAlerts, blockedRoads, safeRoutes, evacuationOpen }}
                  risk={risk}
                  rainfall={rainfall}
                  rainHistory={rainHistory}
                  forecast={forecast}
                  riskSummary={riskSummary}
                />
              )}

              {panelTab === 'Weather' && (
                <WeatherPanel weather={weather} discharge={weather.discharge} />
              )}

              {panelTab === 'Alerts' && (
                <EmptyPanel
                  title="No active alerts"
                  sub="Flood hazard alerts issued by CDRRMO will appear here."
                />
              )}

              {panelTab === 'Routes' &&
                (routes.length === 0 ? (
                  <EmptyPanel
                    title="No active routes"
                    sub="Generate flood-aware routes on Auto Route or Route Planning."
                  />
                ) : (
                  <div className="brgy-list">
                    {routes.map((r) => (
                      <div className="brgy-row" key={r.id}>
                        <span className="brgy-row-name">
                          <span
                            style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: ROUTE_TYPES[r.type]?.color || '#1a2a4a',
                              marginRight: 8,
                            }}
                          />
                          {r.name}
                        </span>
                        <span style={{ fontSize: '0.6875rem', color: '#7a7a7a', fontWeight: 600 }}>
                          {formatDistance(pathLengthMeters(routeGeometry(r)))}
                          {r.source === 'auto' ? ' · auto' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}

              {panelTab === 'Barangays' && (
                <div className="brgy-list">
                  {barangays.map((b) => {
                    const level = levelFromDepth(b.floodDepth)
                    return (
                      <div className="brgy-row" key={b.name}>
                        <span className="brgy-row-name">{b.name}</span>
                        <span className={`risk-badge ${level}`}>{RISK_META[level].label}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Banner reflects current barangay risk (no issues by default). */}
        <span className="sr-only">{bannerText}</span>
      </div>
    </AdminLayout>
  )
}

/* ── Overview tab body ───────────────────────────────────────────────────── */
function OverviewTab({ stats, risk, rainfall, rainHistory, forecast, riskSummary }) {
  const maxRain = Math.max(...rainHistory, 1)

  return (
    <>
      {/* Stat cards */}
      <div className="stats-grid">
        <StatCard color="red" icon={<AlertTriangleIcon />} value={stats.activeAlerts} label="Active Flood Alerts" />
        <StatCard color="orange" icon={<BarIcon />} value={stats.blockedRoads} label="Road Blocked" />
        <StatCard color="green" icon={<TargetIcon />} value={stats.safeRoutes} label="Safe Routes Active" />
        <StatCard color="blue" icon={<HomeIcon />} value={stats.evacuationOpen} label="Evacuation Open" />
      </div>

      <div className="divider" />

      {/* City Flood Risk Index */}
      <div className="section-hdr section-hdr--center">
        <span>
          <svg viewBox="0 0 24 24" style={{ stroke: '#C0181B' }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          City Flood Risk Index
        </span>
        <span className="badge-rt">Real-time</span>
      </div>

      <div className="donut-wrap">
        <RiskDonut risk={risk} />
        <div className="donut-legend">
          <div className="donut-legend-item"><span style={{ background: '#EF4444' }} /> High ({risk.pct.high}%)</div>
          <div className="donut-legend-item"><span style={{ background: '#F97316' }} /> Moderate ({risk.pct.moderate}%)</div>
          <div className="donut-legend-item"><span style={{ background: '#EAB308' }} /> Low ({risk.pct.low}%)</div>
          <div className="donut-legend-item"><span style={{ background: '#22C55E' }} /> Safe ({risk.pct.safe}%)</div>
        </div>
      </div>

      <div className="divider" />

      {/* Rainfall intensity */}
      <div className="section-hdr">
        <span>
          <svg viewBox="0 0 24 24" style={{ stroke: '#2563EB' }}>
            <line x1="16" y1="13" x2="16" y2="21" />
            <line x1="8" y1="13" x2="8" y2="21" />
            <line x1="12" y1="15" x2="12" y2="23" />
            <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
          </svg>
          Rainfall Intensity
        </span>
        <span className="rainfall-val">{`${rainfall.toFixed(1)} mm/hr`}</span>
      </div>
      <div className="rain-sub">Last 8 hours (mm/hr)</div>
      <div className="rain-bars">
        {rainHistory.map((v, i) => (
          <div
            key={i}
            className={`rain-bar ${i === rainHistory.length - 1 ? 'active' : ''}`}
            style={{ height: v > 0 ? `${Math.max(8, (v / maxRain) * 100)}%` : '4px' }}
            title={`${v}mm/hr`}
          />
        ))}
      </div>
      <div className="rain-ticks">
        {RAIN_TICKS.map((t) => <span key={t}>{t}</span>)}
      </div>

      <div className="divider" />

      {/* 3-day forecast */}
      <div className="section-hdr"><span>3-Day Forecast</span></div>
      <div className="forecast-grid">
        {forecast.map((f, i) => (
          <div key={f.day} className={`forecast-day ${i === 0 ? 'today' : ''}`}>
            <div className="day-name">{f.day}</div>
            <div className="day-icon">{f.condition}</div>
            <div className="day-temp">{f.temp != null ? `${f.temp}°C` : '--'}</div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ── City Flood Risk donut (SVG) ─────────────────────────────────────────── */
function RiskDonut({ risk }) {
  const R = 32
  const C = 2 * Math.PI * R
  const order = ['high', 'moderate', 'low', 'safe']
  const colors = { high: '#EF4444', moderate: '#F97316', low: '#EAB308', safe: '#22C55E' }

  // Build the coloured arcs from the risk percentages.
  let offset = 0
  const segments = order.map((key) => {
    const len = (risk.pct[key] / 100) * C
    const seg = { key, len, dashoffset: -offset, color: colors[key], on: risk.counts[key] > 0 }
    offset += len
    return seg
  })

  const meta = RISK_META[risk.worst]

  return (
    <svg className="donut-svg" viewBox="0 0 90 90">
      <circle cx="45" cy="45" r={R} fill="none" stroke="#F0EEE9" strokeWidth="12" />
      {segments.map((s) => (
        <circle
          key={s.key}
          cx="45"
          cy="45"
          r={R}
          fill="none"
          stroke={s.color}
          strokeWidth="12"
          strokeDasharray={`${s.len.toFixed(1)} ${(C - s.len).toFixed(1)}`}
          strokeDashoffset={s.dashoffset.toFixed(1)}
          strokeLinecap="butt"
          style={{ opacity: s.on ? 1 : 0, transform: 'rotate(-90deg)', transformOrigin: '45px 45px' }}
        />
      ))}
      <text x="45" y="42" textAnchor="middle" fontFamily="var(--font-display)" fontSize="11" fontWeight="800" fill={meta.color}>
        {meta.label}
      </text>
      <text x="45" y="54" textAnchor="middle" fontFamily="var(--font-body)" fontSize="6.5" fill="#9A9A9A">
        Overall
      </text>
    </svg>
  )
}

/* ── Small building blocks ───────────────────────────────────────────────── */
function StatCard({ color, icon, value, label }) {
  return (
    <div className={`stat-card ${color}`}>
      {icon}
      <div className="stat-num">{value}</div>
      <div className="stat-lbl">{label}</div>
    </div>
  )
}

function EmptyPanel({ title, sub }) {
  return (
    <div className="panel-empty">
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div className="panel-empty-title">{title}</div>
      <div className="panel-empty-sub">{sub}</div>
    </div>
  )
}

/* ── Icons (inline SVG, ported from the static markup) ───────────────────── */
function MapIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  )
}
function GridIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}
function AlertTriangleIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
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
function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" />
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
