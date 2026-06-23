import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePersistedState } from '../../utils/usePersistedState.js'
import { MapContainer, TileLayer, ZoomControl, CircleMarker, Tooltip, Polyline, Marker, Popup, GeoJSON } from 'react-leaflet'
import L from 'leaflet'
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
import { useFloodRisk, barangayRiskSamples } from '../../components/admin/floodRisk.js'
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
import { useAlerts, useEvacCenters, useIncidents, useRoadReports } from '../../context/AdminDataContext.jsx'
import { useRoadStatus, getCabuyaoRoads } from '../../components/admin/routingHelpers.jsx'
import SystemModulesPanel from '../../components/admin/SystemModulesPanel.jsx'
import IncidentReportsPanel from '../../components/admin/IncidentReportsPanel.jsx'
import Map3D, { MapViewToggle, use3DPreference } from '../../components/admin/Map3D.jsx'
import { useBarangayLayers } from '../../components/admin/mapbox3dHelpers.js'
import { useEvacCentres3D } from '../../components/admin/routing3d.js'
import './FloodMap.css'

/**
 * CDRRMO Admin — Flood Map (React port of admin/flood-map.html).
 *
 * When a Mapbox token is configured (VITE_MAPBOX_TOKEN) the user can switch
 * to the 3D view — Mapbox GL dark basemap with 3D terrain, the barangay risk
 * polygons pulsing on elevated risk, the NOAH-style banded inundation surface
 * and the city boundary as native terrain-draped layers, plus the animated
 * wind-particle / rainfall-radar overlays. Without a token (Mapbox is a paid
 * subscription) the 2D react-leaflet + OSM map below is the whole experience —
 * it renders the exact same live hazard data, so the screen always works.
 *
 * The Conceptual Framework specifies Leaflet.js + OpenStreetMap for all
 * mapping, so the fallback map uses react-leaflet over OSM tiles centred on
 * Cabuyao City. Rainfall, wind, river discharge and the risk index are read
 * live from the Open-Meteo Forecast + Flood APIs; alerts and blocked roads
 * come from the shared admin store. The local state mirrors the shape the API
 * returns so the render code stays put as more backend wiring lands.
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

// Operational-overlay vocabularies (shared with the Incident Reports panel).
const INCIDENT_PRIORITY_COLOR = { critical: '#dc2626', high: '#f97316', medium: '#eab308', low: '#3b82f6' }
const EVAC_STATUS_LABEL = { open: 'Open', full: 'Full', closed: 'Closed' }
const EVAC_STATUS_COLOR = { open: '#16a34a', full: '#f97316', closed: '#dc2626' }

// House-shaped evacuation-centre pin, tinted by status (divIcon — no images).
const evacIconCache = {}
function evacIcon(status) {
  if (evacIconCache[status]) return evacIconCache[status]
  const color = EVAC_STATUS_COLOR[status] || '#16a34a'
  const icon = L.divIcon({
    className: 'fm-evac-divicon',
    html: `<span class="fm-evac-pin" style="background:${color}">
      <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    </span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
  evacIconCache[status] = icon
  return icon
}

const NOAH_STYLE = {
  1: { color: '#FBBF24', fillColor: '#FEF9C3', fillOpacity: 0.55, weight: 0.5 },
  2: { color: '#F97316', fillColor: '#FED7AA', fillOpacity: 0.6,  weight: 0.5 },
  3: { color: '#C0181B', fillColor: '#FCA5A5', fillOpacity: 0.65, weight: 0.5 },
}
const NOAH_LABEL = { 1: 'Low', 2: 'Moderate', 3: 'High' }

export default function FloodMap() {
  // ── Live feeds ──
  const { weather } = useLiveWeather()
  const { field } = useFloodRisk()
  const [routes] = useRoutes()

  // ── NOAH 100-yr flood hazard zones ──
  const [noahGeo, setNoahGeo] = useState(null)
  useEffect(() => {
    fetch('/noah_cabuyao_flood_100yr.geojson').then((r) => r.json()).then(setNoahGeo).catch(() => {})
  }, [])
  const noahStyle = useCallback((f) => NOAH_STYLE[f?.properties?.Var] ?? NOAH_STYLE[1], [])

  // ── Shared store ──
  const { alerts, resolveAlert } = useAlerts()
  const { incidents, updateIncident } = useIncidents()
  const { evacuationCenters, updateEvacCenter } = useEvacCenters()
  const { roadReports } = useRoadReports()
  const [roadStatus] = useRoadStatus()
  const roadNetwork = useMemo(() => getCabuyaoRoads(), [])

  // Barangay flood depths sampled live from the Open-Meteo flood × forecast risk field.
  const barangays = useMemo(() => barangayRiskSamples(field), [field])
  const rainfall = weather.current.rain ?? 0 // mm/hr
  const rainHistory = weather.rainHistory
  const activeAlertList = useMemo(() => alerts.filter((a) => a.status === 'active'), [alerts])
  const evacuationOpen = useMemo(
    () => evacuationCenters.filter((c) => c.status !== 'closed').length,
    [evacuationCenters],
  )

  // ── UI state ──
  const [subtab, setSubtab] = useState('live')
  const [panelTab, setPanelTab] = useState('Overview')
  // 3D map is opt-in: the classic Leaflet map stays the default view.
  const [use3D, setUse3D] = use3DPreference()
  const [coords, setCoords] = useState(null) // {lat, lng, zoom}
  const [updated, setUpdated] = useState(formatPHT())

  // Overlay visibility (incidents / roads / evac / routes) — independent of the
  // hazard layer toggles below so the operational pins can be shown or hidden.
  const [overlays, setOverlays] = usePersistedState('cdrrmo-layers-admin-floodmap-overlays', { incidents: false, roads: false, evac: false, routes: false })
  const toggleOverlay = (k) => setOverlays((v) => ({ ...v, [k]: !v[k] }))

  // Layer visibility + intensity (the on-map toggle control). Default: clean
  // barangay classification + markers; inundation heat off so colours don't mix.
  const [layers, setLayers] = usePersistedState('cdrrmo-layers-admin-floodmap-layers', { barangays: false, inundation: false, markers: false })
  const [intensity, setIntensity] = usePersistedState('cdrrmo-layers-admin-floodmap-intensity', 85)
  const toggleLayer = (k) => setLayers((v) => ({ ...v, [k]: !v[k] }))

  // Focus view + detail card.
  const [selected, setSelected] = useState(null) // barangay name
  const selectedSample = useMemo(() => barangays.find((b) => b.name === selected) || null, [barangays, selected])
  const focusBounds = useMemo(() => (selected ? barangayBounds(selected) : null), [selected])

  // Canvas renderer with a full-viewport pad: the hazard overlays stay painted
  // while the map is dragged (the default SVG renderer clips to ~viewport and
  // blanks the edges mid-pan). Fresh instance per 2D mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const canvasRenderer = useMemo(() => L.canvas({ padding: 1 }), [use3D])

  // Refresh the "Updated --:-- PHT" stamp every minute.
  useEffect(() => {
    const id = setInterval(() => setUpdated(formatPHT()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Incidents that carry a mapped location → markers.
  const mappedIncidents = useMemo(
    () => incidents.filter((i) => Array.isArray(i.coords) && i.status !== 'resolved'),
    [incidents],
  )

  // Flagged road segments (painted on Road Status + named Dashboard reports),
  // resolved to drawable polylines with a status colour.
  const flaggedRoadLines = useMemo(() => {
    if (!roadNetwork) return []
    const byId = new Map(roadNetwork.features.map((f) => [String(f.properties.id), f]))
    const reportByWay = new Map(roadReports.filter((r) => r.wayId != null).map((r) => [String(r.wayId), r]))
    return Object.entries(roadStatus)
      .map(([id, status]) => {
        const f = byId.get(String(id))
        if (!f) return null
        const latlngs = f.geometry.coordinates.map(([lng, lat]) => [lat, lng])
        const report = reportByWay.get(String(id))
        return { id, status, name: report?.name || f.properties.name, latlngs }
      })
      .filter(Boolean)
  }, [roadNetwork, roadStatus, roadReports])

  // ── Derived figures ──
  const activeAlerts = activeAlertList.length
  const blockedRoads = flaggedRoadLines.filter((r) => r.status === 'blocked').length
  const safeRoutes = routes.length

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

  // ── 4-day forecast from the live Open-Meteo feed (emoji + high temp).
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
          {/* 2D (classic Leaflet) ⇄ 3D (Mapbox terrain) — only the live map. */}
          {subtab === 'live' && <MapViewToggle value={use3D} onChange={setUse3D} />}
        </div>

        {/* System Modules + Incident Reports subtabs render full-bleed panels. */}
        {subtab === 'modules' && <SystemModulesPanel />}
        {subtab === 'incidents' && <IncidentReportsPanel />}

        {/* ── Map + Right panel (Live Map subtab) ── */}
        {subtab === 'live' && (
        <div className="map-panel-wrap">
          {/* Map */}
          <div className="map-area">
            {use3D ? (
              <FloodMap3DView
                barangays={barangays}
                field={field}
                layers={layers}
                intensity={intensity}
                selected={selected}
                onSelect={setSelected}
                weather={weather}
                evac={overlays.evac ? evacuationCenters : []}
                onViewChange={setCoords}
              />
            ) : (
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              renderer={canvasRenderer}
              className="floodmap-leaflet"
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                opacity={0.85}
              />
              <ZoomControl position="bottomright" />
              <CabuyaoLock />

              {/* Project NOAH official 5-year return-period flood hazard zones (always on) */}
              {noahGeo && (
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

              {/* Land-clipped NOAH-style honeycomb surface (Open-Meteo flood × forecast) —
                  toggle so it never has to compete with the classification. */}
              {layers.inundation && <InundationGrid field={field} opacity={intensity / 100} />}

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

              {/* ── Operational overlays (shared store) ── */}

              {/* Flagged road segments: closed = solid red, flooded = dashed orange */}
              {overlays.roads && flaggedRoadLines.map((r) => (
                <Polyline
                  key={`road-${r.id}`}
                  positions={r.latlngs}
                  pathOptions={{
                    color: r.status === 'blocked' ? '#dc2626' : '#f97316',
                    weight: 5,
                    opacity: 0.95,
                    dashArray: r.status === 'blocked' ? null : '8 7',
                  }}
                >
                  {r.name && (
                    <Tooltip sticky>
                      <b>{r.name}</b><br />{r.status === 'blocked' ? 'Closed' : 'Flooded'}
                    </Tooltip>
                  )}
                </Polyline>
              ))}

              {/* Saved routes as polylines (toggle in the overlay control) */}
              {overlays.routes && routes.map((r) => {
                const geom = routeGeometry(r)
                if (geom.length < 2) return null
                return (
                  <Polyline
                    key={`route-${r.id}`}
                    positions={geom}
                    pathOptions={{ color: ROUTE_TYPES[r.type]?.color || '#1a3a7a', weight: 4, opacity: 0.85 }}
                  >
                    <Tooltip sticky>
                      <b>{r.name}</b><br />
                      {formatDistance(pathLengthMeters(geom))}{r.destination ? ` → ${r.destination}` : ''}
                    </Tooltip>
                  </Polyline>
                )
              })}

              {/* Evacuation centres: open = green, full = orange, closed = red */}
              {overlays.evac && evacuationCenters.filter((c) => Array.isArray(c.coords)).map((c) => (
                <Marker key={`evac-${c.id}`} position={c.coords} icon={evacIcon(c.status)}>
                  <Popup>
                    <div className="fm-popup">
                      <strong>{c.name}</strong>
                      <div className="fm-popup-sub">{c.barangay} · {EVAC_STATUS_LABEL[c.status] || c.status}</div>
                      <div className="fm-occ-track">
                        <div
                          className="fm-occ-fill"
                          style={{ width: `${c.capacity ? Math.min(100, (c.occupancy / c.capacity) * 100) : 0}%` }}
                        />
                      </div>
                      <div className="fm-popup-row">{(c.occupancy || 0).toLocaleString()} / {(c.capacity || 0).toLocaleString()} evacuees</div>
                      {c.manager && <div className="fm-popup-row">Manager: {c.manager}</div>}
                      <div className="fm-popup-actions">
                        <button
                          type="button"
                          onClick={() => {
                            const v = window.prompt(`Update occupancy for ${c.name}`, String(c.occupancy || 0))
                            if (v == null) return
                            const occ = Math.max(0, Number(v) || 0)
                            const status = c.capacity && occ >= c.capacity ? 'full' : c.status === 'full' ? 'open' : c.status
                            updateEvacCenter(c.id, { occupancy: occ, status })
                          }}
                        >
                          Update occupancy
                        </button>
                        {c.status !== 'closed'
                          ? <button type="button" onClick={() => updateEvacCenter(c.id, { status: 'closed' })}>Close centre</button>
                          : <button type="button" onClick={() => updateEvacCenter(c.id, { status: 'open' })}>Reopen</button>}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}

              {/* Incident markers, colour-coded + sized by priority */}
              {overlays.incidents && mappedIncidents.map((inc) => {
                const color = INCIDENT_PRIORITY_COLOR[inc.priority] || '#3b82f6'
                return (
                  <CircleMarker
                    key={`inc-${inc.id}`}
                    center={inc.coords}
                    radius={inc.priority === 'critical' ? 10 : inc.priority === 'high' ? 8 : 6}
                    pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.65 }}
                  >
                    <Popup>
                      <div className="fm-popup">
                        <strong>{inc.type}</strong>
                        <div className="fm-popup-sub">{inc.location || inc.barangay}</div>
                        <div className="fm-popup-row">Priority: {inc.priority} · {inc.status}</div>
                        <div className="fm-popup-row">Team: {inc.team || '—'}</div>
                        <div className="fm-popup-actions">
                          {inc.status === 'assigned' && (
                            <button type="button" onClick={() => updateIncident(inc.id, { status: 'in-progress' })}>Start</button>
                          )}
                          {inc.status !== 'resolved' && (
                            <button type="button" onClick={() => updateIncident(inc.id, { status: 'resolved' })}>Resolve</button>
                          )}
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                )
              })}

              <FocusController bounds={focusBounds} />
              <CoordReadout onChange={setCoords} />
            </MapContainer>
            )}

            {/* On-map layer toggles + intensity */}
            <MapLayerToggles
              opacity={intensity}
              onOpacity={setIntensity}
              layers={[
                { key: 'barangays', label: 'Barangay Risk', color: '#c0181b', on: layers.barangays, onToggle: () => toggleLayer('barangays') },
                { key: 'inundation', label: 'Flood Inundation', color: '#2563eb', on: layers.inundation, onToggle: () => toggleLayer('inundation') },
                { key: 'markers', label: 'Risk Markers', color: '#1a7a4a', on: layers.markers, onToggle: () => toggleLayer('markers') },
                { key: 'incidents', label: 'Incidents', color: '#dc2626', on: overlays.incidents, onToggle: () => toggleOverlay('incidents') },
                { key: 'roads', label: 'Blocked Roads', color: '#f97316', on: overlays.roads, onToggle: () => toggleOverlay('roads') },
                { key: 'evac', label: 'Evacuation', color: '#16a34a', on: overlays.evac, onToggle: () => toggleOverlay('evac') },
                { key: 'routes', label: 'Routes', color: '#1a3a7a', on: overlays.routes, onToggle: () => toggleOverlay('routes') },
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
                <i style={{ background: RISK_META.safe.color }} />
                <i style={{ background: RISK_META.low.color }} />
                <i style={{ background: RISK_META.moderate.color }} />
                <i style={{ background: RISK_META.high.color }} />
                <small>Safe → High</small>
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

              {panelTab === 'Alerts' &&
                (activeAlertList.length === 0 ? (
                  <EmptyPanel
                    title="No active alerts"
                    sub="Flood hazard alerts issued by CDRRMO will appear here."
                  />
                ) : (
                  <div className="brgy-list">
                    {activeAlertList.map((a) => (
                      <div className="fm-alert-row" key={a.id}>
                        <div className={`fm-alert-stripe ${a.level}`} />
                        <div className="fm-alert-body">
                          <div className="fm-alert-top">
                            <span className="fm-alert-title">{a.title}</span>
                            <button type="button" className="fm-alert-resolve" onClick={() => resolveAlert(a.id)}>Resolve</button>
                          </div>
                          <div className="fm-alert-meta">{a.barangay} · {a.issued}</div>
                          {a.message && <div className="fm-alert-msg">{a.message}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

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
        )}

        {/* Banner reflects current barangay risk (no issues by default). */}
        <span className="sr-only">{bannerText}</span>
      </div>
    </AdminLayout>
  )
}

/* ── 3D map view (Mapbox GL) ─────────────────────────────────────────────── */
/**
 * The Map3D-backed live map: pulsing barangay risk polygons + ripple markers,
 * the NOAH-style banded inundation surface, and the Cabuyao city boundary —
 * all native Mapbox layers (mapbox3dHelpers), draped onto the 3D terrain so
 * they stay glued to the ground through any camera movement. Mirrors the
 * Leaflet view's layer toggles, opacity slider and click-to-focus exactly.
 */
function FloodMap3DView({
  barangays,
  field,
  layers,
  intensity,
  selected,
  onSelect,
  weather,
  evac = [],
  onViewChange,
}) {
  const { onMapLoad, mapRef, ready } = useBarangayLayers({
    samples: barangays,
    field,
    inundation: layers.inundation,
    fills: layers.barangays,
    markers: layers.markers,
    baseOpacity: intensity / 100,
    selected,
    onSelect,
  })

  // Shared evacuation centres (city-wide) — same dots the 2D Leaflet map shows.
  useEvacCentres3D(mapRef, ready, evac)

  // Open-Meteo wind: km/h + meteorological degrees → m/s for the particles.
  const wind = useMemo(
    () => ({
      speed: (weather.current.windKmh ?? 0) / 3.6,
      deg: weather.current.windDir ?? 0,
    }),
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
