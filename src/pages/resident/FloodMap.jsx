import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, CircleMarker, Tooltip, Marker, Popup, GeoJSON } from 'react-leaflet'
import ResidentLayout from '../../components/resident/ResidentLayout.jsx'
import { MapLayerToggles } from '../../components/admin/MapLayerToggles.jsx'
import { usePersistedState } from '../../utils/usePersistedState.js'
import {
  CABUYAO_CENTER,
  CABUYAO_ZOOM,
  levelFromDepth,
  RISK_META,
  formatPHT,
  CabuyaoLock,
  CoordReadout,
  LocateControl,
} from '../../components/admin/mapHelpers.jsx'
import { useFloodRisk, barangayRiskSamples } from '../../components/admin/floodRisk.js'
import { BarangayRiskLayer, InundationGrid } from '../../components/admin/BarangayRiskLayer.jsx'
import { useLiveWeather } from '../../services/weather.js'
import { evacPinIcon } from '../../components/admin/EvacLocationPicker.jsx'
import { FloodAreaMarkers } from '../../components/admin/FloodAreasLayer.jsx'
import { useEvacCenters, useFloodAreas } from '../../context/AdminDataContext.jsx'
import { residentBarangayLabel, getResidentBarangay } from '../../data/resident.js'
import '../admin/FloodMap.css'

/**
 * CDRRMO Resident — Flood Map (Monitor).
 *
 * The citywide flood picture a resident can browse for situational awareness —
 * the same live Leaflet + OpenStreetMap view the command center uses, with the
 * real barangay boundaries classified by the flood-risk model and their own
 * barangay ringed. Read-only; every barangay is drawn at its true location.
 */

const PANEL_TABS = ['Overview', 'Barangays']

const NOAH_STYLE = {
  1: { color: '#FBBF24', fillColor: '#FEF9C3', fillOpacity: 0.55, weight: 0.5 },
  2: { color: '#F97316', fillColor: '#FED7AA', fillOpacity: 0.6,  weight: 0.5 },
  3: { color: '#C0181B', fillColor: '#FCA5A5', fillOpacity: 0.65, weight: 0.5 },
}
const NOAH_LABEL = { 1: 'Low', 2: 'Moderate', 3: 'High' }
const RAIN_TICKS = ['-8h', '-7', '-6', '-5', '-4', '-3', '-2', 'Now']

// Toggleable overlays so a resident can isolate one layer (e.g. just flood
// inundation, or just evacuation centres). On by default; state persists.
const FLOOD_LAYERS = [
  { key: 'noah', label: 'Project NOAH Hazard', color: '#C0181B' },
  { key: 'floodAreas', label: 'Flood-Prone Areas', color: '#B91C1C' },
  { key: 'inundation', label: 'Flood Inundation', color: '#2563EB' },
  { key: 'barangays', label: 'Barangay Risk', color: '#F97316' },
  { key: 'evac', label: 'Evacuation Centres', color: '#1A7A4A' },
]

export default function FloodMap() {
  const brgyLabel = residentBarangayLabel()
  const myBrgy = getResidentBarangay()

  const { weather } = useLiveWeather()
  const { field } = useFloodRisk()

  const [noahGeo, setNoahGeo] = useState(null)
  useEffect(() => {
    fetch('/noah_cabuyao_flood_100yr.geojson').then((r) => r.json()).then(setNoahGeo).catch(() => {})
  }, [])
  const noahStyle = useCallback((f) => NOAH_STYLE[f?.properties?.Var] ?? NOAH_STYLE[1], [])

  const barangays = useMemo(() => barangayRiskSamples(field), [field])
  const rainfall = weather.current.rain ?? 0
  const rainHistory = weather.rainHistory
  const { evacuationCenters } = useEvacCenters()
  const { floodAreas } = useFloodAreas()
  const evacMarkers = useMemo(
    () => evacuationCenters.filter((c) => Array.isArray(c.coords)),
    [evacuationCenters],
  )
  const evacuationOpen = useMemo(
    () => evacuationCenters.filter((c) => c.status !== 'closed').length,
    [evacuationCenters],
  )

  const [panelTab, setPanelTab] = useState('Overview')
  const [coords, setCoords] = useState(null)
  const [updated, setUpdated] = useState(formatPHT())
  const [layers, setLayers] = usePersistedState('cdrrmo-layers-res-floodmap-v2', { noah: true, floodAreas: true, inundation: true, barangays: true, evac: true })
  const [intensity, setIntensity] = usePersistedState('cdrrmo-layers-res-floodmap-intensity', 70)

  useEffect(() => {
    const id = setInterval(() => setUpdated(formatPHT()), 60_000)
    return () => clearInterval(id)
  }, [])

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

  const myLevel = useMemo(
    () => barangays.find((b) => b.name === myBrgy)?.level ?? 'safe',
    [barangays, myBrgy],
  )

  const forecast = useMemo(() => {
    if (weather.forecast.length) {
      return weather.forecast.map((f) => ({ day: f.day, condition: f.emoji, temp: f.tmax }))
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
    <ResidentLayout mainClassName="main--flush">
      <div className="floodmap">
        <div className="subtab-bar">
          <button type="button" className="subtab active">
            <MapIcon />
            Cabuyao City · Live Map
          </button>
          <span className={`risk-badge ${myLevel}`} style={{ marginLeft: 'auto', alignSelf: 'center' }}>
            Brgy. {brgyLabel}: {RISK_META[myLevel].label}
          </span>
        </div>

        <div className="map-panel-wrap">
          <div className="map-area">
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              className="floodmap-leaflet"
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.85} />
              <ZoomControl position="bottomright" />
              <CabuyaoLock />

              {layers.noah && noahGeo && (
                <GeoJSON
                  key="noah-100yr"
                  data={noahGeo}
                  style={noahStyle}
                  onEachFeature={(f, lyr) => {
                    const lvl = NOAH_LABEL[f.properties?.Var] ?? 'Unknown'
                    lyr.bindTooltip(`NOAH 100-yr Flood Zone · ${lvl} Hazard`, { sticky: true, className: 'road-tip' })
                  }}
                />
              )}

              {layers.floodAreas && <FloodAreaMarkers areas={floodAreas} />}

              {layers.inundation && <InundationGrid field={field} opacity={intensity / 100} />}
              {layers.barangays && <BarangayRiskLayer samples={barangays} opacity={Math.max(0.5, intensity / 100)} />}

              {layers.barangays && barangays.map((b) => {
                const mine = b.name === myBrgy
                return (
                  <CircleMarker
                    key={b.name}
                    center={b.coords}
                    radius={mine ? 8 : 5}
                    pathOptions={{
                      color: mine ? '#1A3A7A' : '#fff',
                      weight: mine ? 3 : 1.5,
                      fillColor: RISK_META[b.level].color,
                      fillOpacity: 1,
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -5]}>
                      <b>{b.name}</b>{mine ? ' · YOU' : ''}
                      <br />
                      {RISK_META[b.level].label} · ~{b.floodDepth.toFixed(2)} m
                    </Tooltip>
                  </CircleMarker>
                )
              })}

              {/* Shared evacuation centres (city-wide) — where residents can go */}
              {layers.evac && evacMarkers.map((c) => (
                <Marker key={`evac-${c.id}`} position={c.coords} icon={evacPinIcon(c.status)}>
                  <Popup>
                    <strong>{c.name}</strong>
                    <div style={{ fontSize: '0.6875rem', color: '#7a7a7a' }}>{c.barangay} · {c.status}</div>
                  </Popup>
                </Marker>
              ))}

              <CoordReadout onChange={setCoords} />
              <LocateControl />
            </MapContainer>

            <MapLayerToggles
              layers={FLOOD_LAYERS.map((l) => ({
                ...l,
                on: layers[l.key],
                onToggle: () => setLayers((v) => ({ ...v, [l.key]: !v[l.key] })),
              }))}
              opacity={intensity}
              onOpacity={setIntensity}
            />

            <div className="map-legend">
              <span className="legend-live">Live | Updated {updated} PHT</span>
            </div>

            <div className="map-coords">
              {coords
                ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E | Zoom: ${coords.zoom}`
                : 'No map data'}
            </div>
          </div>

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
                  stats={{ evacuationOpen }}
                  risk={risk}
                  rainfall={rainfall}
                  rainHistory={rainHistory}
                  forecast={forecast}
                />
              )}

              {panelTab === 'Barangays' && (
                <div className="brgy-list">
                  {[...barangays]
                    .sort((a, b) => b.floodDepth - a.floodDepth || a.name.localeCompare(b.name))
                    .map((b) => {
                      const mine = b.name === myBrgy
                      return (
                        <div className="brgy-row" key={b.name} style={mine ? { background: '#fef2f2' } : undefined}>
                          <span className="brgy-row-name">
                            {b.name}
                            {mine && <span style={{ color: '#c0181b', fontWeight: 700, marginLeft: 6, fontSize: '0.625rem' }}>· YOU</span>}
                          </span>
                          <span className={`risk-badge ${b.level}`}>{RISK_META[b.level].label}</span>
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ResidentLayout>
  )
}

function OverviewTab({ stats, risk, rainfall, rainHistory, forecast }) {
  const maxRain = Math.max(...rainHistory, 1)
  return (
    <>
      <div className="stats-grid">
        <StatCard color="blue" icon={<HomeIcon />} value={stats.evacuationOpen} label="Evacuation Open" />
        <StatCard color="orange" icon={<DropIcon />} value={`${rainfall.toFixed(1)}`} label="Rainfall mm/hr" />
      </div>

      <div className="divider" />

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

function RiskDonut({ risk }) {
  const R = 32
  const C = 2 * Math.PI * R
  const order = ['high', 'moderate', 'low', 'safe']
  const colors = { high: '#EF4444', moderate: '#F97316', low: '#EAB308', safe: '#22C55E' }

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

function StatCard({ color, icon, value, label }) {
  return (
    <div className={`stat-card ${color}`}>
      {icon}
      <div className="stat-num">{value}</div>
      <div className="stat-lbl">{label}</div>
    </div>
  )
}

function MapIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
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
function DropIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>
  )
}
