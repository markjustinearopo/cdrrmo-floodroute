import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, CircleMarker, Tooltip, Marker, Popup, GeoJSON } from 'react-leaflet'
import BarangayLayout from '../../components/barangay/BarangayLayout.jsx'
import { MapLayerToggles } from '../../components/admin/MapLayerToggles.jsx'
import { MapGuideButton } from '../../components/MapGuide.jsx'
import { barangayFloodMapSteps } from '../../components/mapGuideSteps.jsx'
import { usePersistedState } from '../../utils/usePersistedState.js'
import {
  CABUYAO_CENTER,
  CABUYAO_ZOOM,
  levelFromDepth,
  RISK_META,
  formatPHT,
  CabuyaoLock,
  BarangayLock,
  JurisdictionToggle,
  CoordReadout,
  LocateControl,
} from '../../components/admin/mapHelpers.jsx'
import { useFloodRisk, barangayRiskSamples } from '../../components/admin/floodRisk.js'
import { BarangayRiskLayer, InundationGrid } from '../../components/admin/BarangayRiskLayer.jsx'
import Map3D, { MapViewToggle, use3DPreference } from '../../components/admin/Map3D.jsx'
import { useBarangayLayers } from '../../components/admin/mapbox3dHelpers.js'
import { useEvacCentres3D } from '../../components/admin/routing3d.js'
import { useRoadStatus, getCabuyaoRoads } from '../../components/admin/routingHelpers.jsx'
import { evacPinIcon } from '../../components/admin/EvacLocationPicker.jsx'
import { FloodAreaMarkers } from '../../components/admin/FloodAreasLayer.jsx'
import { FloodReportMarkers } from '../../components/admin/FloodReportsLayer.jsx'
import {
  FlaggedRoadsLayer,
  IncidentMarkers,
  useRoadConditionSummary,
} from '../../components/map/RoadConditionsLayer.jsx'
import MapStatusLine from '../../components/map/MapStatusLine.jsx'
import { useEvacCenters, useFloodAreas, useFloodReports, useIncidents, useAdminData } from '../../context/AdminDataContext.jsx'
import { useLiveWeather } from '../../services/weather.js'
import { officialBarangayLabel, getOfficialBarangay, useJurisdictionView } from '../../data/barangay.js'
import '../admin/FloodMap.css'

/**
 * CDRRMO Barangay — Flood Map (Monitor).
 *
 * A Barangay Official keeps the CITY-WIDE picture for situational awareness —
 * the same live Leaflet + OpenStreetMap view the command center uses, with the
 * real barangay boundaries classified by the flood-risk model — but the panel
 * foregrounds their own jurisdiction. Every barangay is drawn at its true
 * location; the official's barangay is ringed on the map.
 */

const PANEL_TABS = ['Overview', 'Barangays']
const RAIN_TICKS = ['-8h', '-7', '-6', '-5', '-4', '-3', '-2', 'Now']

const NOAH_STYLE = {
  1: { color: '#FBBF24', fillColor: '#FEF9C3', fillOpacity: 0.55, weight: 0.5 },
  2: { color: '#F97316', fillColor: '#FED7AA', fillOpacity: 0.6,  weight: 0.5 },
  3: { color: '#C0181B', fillColor: '#FCA5A5', fillOpacity: 0.65, weight: 0.5 },
}
const NOAH_LABEL = { 1: 'Low', 2: 'Moderate', 3: 'High' }

// Toggleable map overlays so an official can isolate one picture (e.g. just the
// flood inundation, or just the evacuation centres). Default on — it's the flood
// map — but each remembers its state across pages (usePersistedState).
//
// The first six are the hazard layers every portal shares, in the command
// center's order, labels and swatches, so the three read as one system. The
// last two are the OPERATIONAL layers a barangay official needs and a resident
// does not get: which roads are flooded or closed in their jurisdiction, and
// what incidents are still open on the ground. (Cut-Off Areas stays admin-only
// — it is a hypothetical driven by an operator's water-level slider, not a
// statement about the barangay right now.)
const FLOOD_LAYERS = [
  { key: 'noah', label: 'Project NOAH Hazard', color: '#C0181B' },
  { key: 'floodAreas', label: 'Flood-Prone Areas', color: '#B91C1C' },
  { key: 'reports', label: 'Verified Flood Reports', color: '#EF4444' },
  { key: 'inundation', label: 'Flood Inundation', color: '#2563EB' },
  { key: 'barangays', label: 'Barangay Risk', color: '#F97316' },
  { key: 'evac', label: 'Evacuation Centres', color: '#1A7A4A' },
  { key: 'roads', label: 'Flooded / Closed Roads', color: '#B45309' },
  { key: 'incidents', label: 'Open Incidents', color: '#DC2626' },
]

/* Which of those the Mapbox 3D view can actually draw. The toggle rail is
   filtered to this set in 3D so no switch is ever offered for a layer that
   would not appear. (Flood-prone areas, verified reports and incident pins are
   Leaflet marker layers with popups — 2D only.) */
const LAYERS_IN_3D = new Set(['noah', 'inundation', 'barangays', 'evac', 'roads'])

export default function FloodMap() {
  const brgyLabel = officialBarangayLabel()
  const myBrgy = getOfficialBarangay()

  const { weather } = useLiveWeather()
  const { field } = useFloodRisk()

  const [noahGeo, setNoahGeo] = useState(null)
  useEffect(() => {
    fetch('/noah_cabuyao_flood_100yr.geojson').then((r) => r.json()).then(setNoahGeo).catch(() => {})
  }, [])
  const noahStyle = useCallback((f) => NOAH_STYLE[f?.properties?.Var] ?? NOAH_STYLE[1], [])

  const [view, setView] = useJurisdictionView()
  const [use3D, setUse3D] = use3DPreference()
  // v4: adds the two operational layers. A new key rather than a migration, so
  // an official who already has v3 stored gets them switched ON rather than
  // inheriting an object with the new keys missing (which reads as "off").
  const [layers, setLayers] = usePersistedState('cdrrmo-layers-brgy-floodmap-v4', { noah: true, floodAreas: true, reports: true, inundation: true, barangays: true, evac: true, roads: true, incidents: true })
  const [intensity, setIntensity] = usePersistedState('cdrrmo-layers-brgy-floodmap-intensity', 70)
  const locked = view === 'mine' && Boolean(myBrgy)

  const barangays = useMemo(() => barangayRiskSamples(field), [field])
  // "My Barangay" view confines the map + panels to the official's own barangay;
  // "City" view keeps the whole-city situational picture.
  const panelBarangays = useMemo(
    () => (locked ? barangays.filter((b) => b.name === myBrgy) : barangays),
    [barangays, locked, myBrgy],
  )
  const rainfall = weather.current.rain ?? 0
  const rainHistory = weather.rainHistory
  // Evacuation centres are city-wide — every official sees the same set, and a
  // resident may shelter at any open centre regardless of barangay.
  const { evacuationCenters } = useEvacCenters()
  const { floodAreas } = useFloodAreas()
  const { floodReports } = useFloodReports()
  const { incidents } = useIncidents()
  const evacMarkers = useMemo(
    () => evacuationCenters.filter((c) => Array.isArray(c.coords)),
    [evacuationCenters],
  )
  /* "Open" has to mean ACCEPTING. Counting every non-closed centre reported
     centres that are at capacity as open, which is the one number an official
     acts on when deciding where to send families. */
  const evacCounts = useMemo(() => {
    let open = 0
    let full = 0
    for (const c of evacuationCenters) {
      if (c.status === 'closed') continue
      if (c.status === 'full' || (c.capacity > 0 && (c.occupancy || 0) >= c.capacity)) full++
      else open++
    }
    return { open, full }
  }, [evacuationCenters])
  // Road conditions in the panel's current scope, so the Overview tab reports
  // the same picture the map is painting.
  const roadSummary = useRoadConditionSummary(locked ? myBrgy : null)
  const openIncidents = useMemo(
    () => incidents.filter((i) => i.status !== 'resolved' && (!locked || i.barangay === myBrgy)).length,
    [incidents, locked, myBrgy],
  )

  const [panelTab, setPanelTab] = useState('Overview')
  const [coords, setCoords] = useState(null)
  const [updated, setUpdated] = useState(formatPHT())

  useEffect(() => {
    const id = setInterval(() => setUpdated(formatPHT()), 60_000)
    return () => clearInterval(id)
  }, [])

  const risk = useMemo(() => {
    const counts = { high: 0, moderate: 0, low: 0, safe: 0 }
    panelBarangays.forEach((b) => counts[levelFromDepth(b.floodDepth)]++)
    const total = Math.max(panelBarangays.length, 1)
    const pct = Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, Math.round((v / total) * 100)]),
    )
    const worst =
      counts.high > 0 ? 'high'
      : counts.moderate > 0 ? 'moderate'
      : counts.low > 0 ? 'low'
      : 'safe'
    return { counts, pct, worst }
  }, [panelBarangays])

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
    <BarangayLayout mainClassName="main--flush">
      {/* --nosearch: this is the only flood map without a MapSearchBar, and the
          phone rules reserve the top strip for one. */}
      <div className="floodmap floodmap--nosearch">
        <div className="subtab-bar">
          <button type="button" className="subtab active">
            <MapIcon />
            {locked ? `Brgy. ${brgyLabel} · Jurisdiction` : 'Cabuyao City · Live Map'}
          </button>
          <span className={`bq-juris-badge risk-badge ${myLevel}`} style={{ marginLeft: 'auto', alignSelf: 'center' }}>
            Your barangay: {RISK_META[myLevel].label}
          </span>
          {/* Barangay officials are the least-trained users of a map screen
              this dense, and they use it under pressure. The walkthrough is
              always one click away, never auto-opened, never hidden again. */}
          <MapGuideButton steps={barangayFloodMapSteps} title="How to use the Flood Map" />
          <JurisdictionToggle value={view} onChange={setView} brgyLabel={brgyLabel} />
          <MapViewToggle value={use3D} onChange={setUse3D} />
        </div>

        <div className="map-panel-wrap">
          <div className="map-area">
            {use3D ? (
              <FloodMap3DView
                key={locked ? `b-${myBrgy}` : 'city'}
                barangays={panelBarangays}
                field={field}
                weather={weather}
                evac={evacMarkers}
                layers={layers}
                intensity={intensity}
                jurisdiction={locked ? myBrgy : null}
                onViewChange={setCoords}
              />
            ) : (
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              className="floodmap-leaflet"
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.85} />
              <ZoomControl position="bottomright" />
              {locked ? <BarangayLock name={myBrgy} /> : <CabuyaoLock />}

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

              {layers.floodAreas && <FloodAreaMarkers areas={floodAreas} only={locked ? myBrgy : null} />}

              {/* Verified resident flood reports (approved only) */}
              {layers.reports && <FloodReportMarkers reports={floodReports} only={locked ? myBrgy : null} />}

              {layers.inundation && <InundationGrid field={field} opacity={intensity / 100} only={locked ? myBrgy : null} />}
              {layers.barangays && <BarangayRiskLayer samples={panelBarangays} opacity={Math.max(0.5, intensity / 100)} only={locked ? myBrgy : null} />}

              {layers.barangays && panelBarangays.map((b) => {
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

              {/* Shared evacuation centres (city-wide) */}
              {layers.evac && evacMarkers.map((c) => (
                <Marker key={`evac-${c.id}`} position={c.coords} icon={evacPinIcon(c.status)}>
                  <Popup>
                    <strong>{c.name}</strong>
                    <div style={{ fontSize: '0.6875rem', color: '#7a7a7a' }}>
                      {c.barangay} · {c.status}
                      {c.capacity ? ` · ${(c.occupancy || 0).toLocaleString()} / ${c.capacity.toLocaleString()}` : ''}
                    </div>
                  </Popup>
                </Marker>
              ))}

              {/* ── Operational overlays (read-only, jurisdiction-scoped) ──
                  Drawn last so a closure sits ON TOP of the hazard shading —
                  an impassable road is the most actionable thing here. */}
              {layers.roads && <FlaggedRoadsLayer only={locked ? myBrgy : null} />}
              {layers.incidents && (
                <IncidentMarkers incidents={incidents} only={locked ? myBrgy : null} />
              )}

              <CoordReadout onChange={setCoords} />
              <LocateControl />
            </MapContainer>
            )}

            {/* The layer control is available in BOTH views. It used to be
                2D-only, which meant switching to 3D silently took away every
                toggle — including Flood Inundation, the one an official most
                often wants to isolate. The 3D view renders a subset of the
                layers, so it is offered the subset it can actually draw: a
                switch that does nothing is worse than no switch.

                Collapsible: the rail is ~190px tall and covered better than a
                fifth of a phone-sized map. It folds to a chip — shut by
                default on phone widths, open on desktop. */}
            <MapLayerToggles
              collapsible
              layers={(use3D ? FLOOD_LAYERS.filter((l) => LAYERS_IN_3D.has(l.key)) : FLOOD_LAYERS).map((l) => ({
                ...l,
                on: layers[l.key],
                onToggle: () => setLayers((v) => ({ ...v, [l.key]: !v[l.key] })),
              }))}
              opacity={intensity}
              onOpacity={setIntensity}
            />

            <MapStatusLine updated={updated} coords={coords} />
          </div>

          <div className="right-panel">
            <div className="panel-tabs">
              {PANEL_TABS.map((tab) => (
                <button
                  type="button"
                  key={tab}
                  className={`panel-tab ${panelTab === tab ? 'active' : ''}`}
                  aria-pressed={panelTab === tab}
                  onClick={() => setPanelTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="panel-content">
              {panelTab === 'Overview' && (
                <OverviewTab
                  stats={{ evacCounts, roadSummary, openIncidents }}
                  risk={risk}
                  rainfall={rainfall}
                  rainHistory={rainHistory}
                  forecast={forecast}
                />
              )}

              {panelTab === 'Barangays' && (
                <div className="brgy-list">
                  {[...panelBarangays]
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
    </BarangayLayout>
  )
}

/* ── 3D map view (Mapbox GL) — same hazard layers, locked to the barangay ─── */
function FloodMap3DView({ barangays, field, weather, evac = [], layers = { inundation: true, barangays: true, evac: true }, intensity = 70, jurisdiction, onViewChange }) {
  // The painted road conditions, so the 3D view answers the same "which roads
  // are flooded or closed" question the 2D view does.
  const [roadStatus] = useRoadStatus()
  const roadNetwork = useMemo(() => getCabuyaoRoads(), [])
  const { onMapLoad, mapRef, ready } = useBarangayLayers({
    samples: barangays,
    field,
    inundation: layers.inundation,
    noah: layers.noah,
    fills: layers.barangays,
    markers: layers.barangays,
    baseOpacity: intensity / 100,
    jurisdiction,
    roads: roadNetwork,
    roadStatus,
    roadsVisible: layers.roads,
  })
  // Shared evacuation centres (city-wide) — same dots the 2D map shows.
  useEvacCentres3D(mapRef, ready, layers.evac ? evac : [])
  const wind = useMemo(
    () => ({ speed: (weather.current.windKmh ?? 0) / 3.6, deg: weather.current.windDir ?? 0 }),
    [weather],
  )
  return (
    <Map3D
      onMapLoad={onMapLoad}
      onViewChange={onViewChange}
      wind={wind}
      rain={weather.current.rain ?? 0}
    />
  )
}

/* ── Overview tab body ───────────────────────────────────────────────────── */
function OverviewTab({ stats, risk, rainfall, rainHistory, forecast }) {
  const { safetyReady } = useAdminData()
  const maxRain = Math.max(...rainHistory, 1)

  return (
    <>
      <div className="stats-grid">
        <StatCard
          color="green"
          icon={<HomeIcon />}
          value={safetyReady ? stats.evacCounts?.open ?? 0 : '--'}
          label="Centres Accepting"
          note={stats.evacCounts?.full ? `${stats.evacCounts.full} full` : null}
        />
        <StatCard color="orange" icon={<DropIcon />} value={`${rainfall.toFixed(1)}`} label="Rainfall mm/hr" />
        <StatCard color="red" icon={<BarrierIcon />} value={safetyReady ? stats.roadSummary?.closed ?? 0 : '--'} label="Roads Closed" />
        <StatCard color="amber" icon={<WaveIcon />} value={safetyReady ? stats.roadSummary?.flooded ?? 0 : '--'} label="Roads Flooded" />
      </div>

      {stats.openIncidents > 0 && (
        <div className="bq-open-incidents">
          <span className="bq-oi-dot" aria-hidden="true" />
          {stats.openIncidents} open incident{stats.openIncidents === 1 ? '' : 's'} in this area
        </div>
      )}

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
        <span className="badge-rt">Modeled</span>
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

      <div className="section-hdr"><span>{forecast.length}-Day Forecast</span></div>
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
function StatCard({ color, icon, value, label, note = null }) {
  return (
    <div className={`stat-card ${color}`}>
      {icon}
      <div className="stat-num">{value}</div>
      <div className="stat-lbl">{label}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  )
}

/* ── Icons ───────────────────────────────────────────────────────────────── */
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
/* Road barrier — closures. */
function BarrierIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="2" y="7" width="20" height="7" rx="1" />
      <line x1="5" y1="14" x2="5" y2="21" />
      <line x1="19" y1="14" x2="19" y2="21" />
    </svg>
  )
}
/* Water line — flooded but still passable. */
function WaveIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M2 8c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2" />
      <path d="M2 14c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2" />
    </svg>
  )
}
