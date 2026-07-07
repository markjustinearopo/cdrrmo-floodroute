import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePersistedState } from '../../utils/usePersistedState.js'
import { MapContainer, TileLayer, ZoomControl, Marker, Tooltip, GeoJSON } from 'react-leaflet'
import L from 'leaflet'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import {
  CABUYAO_CENTER,
  CABUYAO_ZOOM,
  RISK_META,
  formatPHT,
  CabuyaoLock,
  CoordReadout,
} from '../../components/admin/mapHelpers.jsx'
import {
  useFloodRisk,
  barangayRiskSamples,
  hazardSummary,
  riskLevel,
} from '../../components/admin/floodRisk.js'
import { BarangayRiskLayer, InundationGrid, FocusController } from '../../components/admin/BarangayRiskLayer.jsx'
import { BarangayDetailCard } from '../../components/admin/BarangayDetailCard.jsx'
import { barangayBounds } from '../../data/cabuyaoBarangays.js'
import { RoadNetworkLayer, useCabuyaoRoads, useRoadStatus } from '../../components/admin/routingHelpers.jsx'
import { useLiveWeather } from '../../services/weather.js'
import { useEvacCenters, useFloodAreas } from '../../context/AdminDataContext.jsx'
import { pinIcon, PIN_SIZE } from '../../components/map/pinIcons.js'
import Map3D, { MapViewToggle, use3DPreference } from '../../components/admin/Map3D.jsx'
import {
  useBarangayLayers,
  addHazardRoadsLayer,
  updateHazardRoadsData,
  addEvacCentersLayer,
  updateEvacCentersData,
  setMapLayerVisible,
} from '../../components/admin/mapbox3dHelpers.js'
import MapSearchBar from '../../components/map/MapSearchBar.jsx'
import SearchResultLayer from '../../components/map/SearchResultLayer.jsx'
import { buildLocalIndex } from '../../components/map/searchTools.js'
import './HazardLayer.css'

/**
 * CDRRMO Admin — Flood Hazard Layer.
 *
 * A real-time, Project-NOAH-style hazard map: the live flood-risk field
 * (floodRisk.js) is painted as a green→red inundation surface over Cabuyao,
 * with barangay risk markers, the admin's flooded/closed roads, and the open
 * evacuation centres layered on top. Everything is derived live from three
 * real feeds —
 *
 *   • Open-Meteo Flood API → river discharge + low-elevation susceptibility
 *   • Open-Meteo Forecast  → rainfall / wind driving the wetness of the field
 *   • OpenStreetMap        → the base map + the road segments
 *
 * — and recomputes whenever the feeds refresh, so the colours track the actual
 * weather. No backend required; all keyless (an optional Open-Meteo API key on
 * Integrations only raises rate limits).
 */

/* ── Toggleable map overlays ──────────────────────────────────────────────
   Layer names are shared verbatim with the Flood Map's toggle panel, so the
   two screens describe the same hazard picture in the same words. */
const LAYER_DEFS = [
  { key: 'noahHazard', label: 'NOAH Flood Hazard', desc: 'Project NOAH official 100-yr return-period flood zones', color: '#7C3AED' },
  { key: 'inundation', label: 'Live Inundation', desc: 'Real-time flood-risk surface (Open-Meteo)', color: '#2563EB' },
  { key: 'roadRisk', label: 'Flagged Roads', desc: 'Flooded / closed road segments', color: '#F97316' },
  { key: 'barangays', label: 'Barangay Risk', desc: 'Barangay-level risk classification', color: '#C0181B' },
  { key: 'evacuation', label: 'Evacuation Centers', desc: 'Open shelters & safe zones', color: '#1A7A4A' },
]

// Project NOAH 100-yr flood hazard: Var 1=Low 2=Moderate 3=High
const NOAH_STYLE = {
  1: { color: '#FBBF24', fillColor: '#FEF9C3', fillOpacity: 0.55, weight: 0.5 },
  2: { color: '#F97316', fillColor: '#FED7AA', fillOpacity: 0.6,  weight: 0.5 },
  3: { color: '#C0181B', fillColor: '#FCA5A5', fillOpacity: 0.65, weight: 0.5 },
}
const NOAH_LABEL = { 1: 'Low', 2: 'Moderate', 3: 'High' }

/* Risk classification legend — same vocabulary as the Dashboard / Flood Map. */
const RISK_LEGEND = [
  { level: 'high', label: 'High Risk', sub: '≥ 0.5 m flood depth' },
  { level: 'moderate', label: 'Moderate', sub: '0.3 – 0.5 m' },
  { level: 'low', label: 'Low Risk', sub: '0.1 – 0.3 m' },
  { level: 'safe', label: 'Safe', sub: '< 0.1 m' },
]

export default function HazardLayer() {
  // ── Live feeds ──
  const { field, loading, error, refresh } = useFloodRisk()
  const { weather } = useLiveWeather()
  const { roads } = useCabuyaoRoads() // for the flooded/closed-road overlay
  const [statusMap] = useRoadStatus()
  const { evacuationCenters } = useEvacCenters()
  const { floodAreas } = useFloodAreas() // feeds the location search index

  // ── NOAH static hazard GeoJSON (loaded once from public/) ──
  const [noahGeo, setNoahGeo] = useState(null)
  useEffect(() => {
    fetch('/noah_cabuyao_flood_100yr.geojson')
      .then((r) => r.json())
      .then(setNoahGeo)
      .catch(() => {}) // non-fatal if file absent
  }, [])
  const noahStyle = useCallback((f) => NOAH_STYLE[f?.properties?.Var] || NOAH_STYLE[1], [])

  // ── Overlay visibility + opacity ──
  const [visible, setVisible] = usePersistedState('cdrrmo-layers-admin-hazard-visible', Object.fromEntries(LAYER_DEFS.map((l) => [l.key, false])))
  const [opacity, setOpacity] = usePersistedState('cdrrmo-layers-admin-hazard-opacity', 85)
  const [coords, setCoords] = useState(null)
  const [updated, setUpdated] = useState(formatPHT())

  // Focus view + detail card.
  const [selected, setSelected] = useState(null)

  // Smart location search (barangays, evac centres, flood-prone areas +
  // OpenStreetMap results) — the same index the Flood Map search uses.
  const [searchResult, setSearchResult] = useState(null)
  const localIndex = useMemo(
    () => buildLocalIndex({ evacCenters: evacuationCenters, floodAreas }),
    [evacuationCenters, floodAreas],
  )

  // 2D (Leaflet, default) ⇄ 3D (Mapbox terrain) — shared preference with the
  // Flood Map. Both views render the SAME live state (toggles, opacity,
  // selection), so switching never changes what the hazard picture says.
  const [use3D, setUse3D] = use3DPreference()

  // Canvas renderer with a full-viewport pad: the hazard overlays stay painted
  // while the map is dragged (the default SVG renderer clips to ~viewport and
  // blanks the edges mid-pan). Fresh instance per 2D mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const canvasRenderer = useMemo(() => L.canvas({ padding: 1 }), [use3D])

  function toggle(key) {
    setVisible((v) => ({ ...v, [key]: !v[key] }))
  }

  // ── Derived live data ──
  const samples = useMemo(() => barangayRiskSamples(field), [field])
  const selectedSample = useMemo(() => samples.find((b) => b.name === selected) || null, [samples, selected])
  const focusBounds = useMemo(() => (selected ? barangayBounds(selected) : null), [selected])
  const summary = useMemo(() => hazardSummary(field, samples, statusMap), [field, samples, statusMap])
  const openCentres = useMemo(
    () => evacuationCenters.filter((c) => Array.isArray(c.coords) && c.status !== 'closed'),
    [evacuationCenters],
  )
  const hazardRoads = useMemo(() => {
    if (!roads) return null
    const ids = new Set(Object.keys(statusMap))
    if (ids.size === 0) return null
    return { type: 'FeatureCollection', features: roads.features.filter((f) => ids.has(String(f.properties.id))) }
  }, [roads, statusMap])

  const counts = useMemo(() => ({
    // Elevated-risk cells that actually sit on land (the rendered surface).
    inundation: field?.cells?.filter((c) => c.onLand && riskLevel(c.risk) !== 'low').length || 0,
    roadRisk: Object.keys(statusMap).length,
    barangays: samples.filter((s) => s.level === 'high' || s.level === 'moderate').length,
    evacuation: openCentres.length,
  }), [field, statusMap, samples, openCentres])

  // Refresh the "Updated --:-- PHT" stamp every minute.
  useEffect(() => {
    const id = setInterval(() => setUpdated(formatPHT()), 60_000)
    return () => clearInterval(id)
  }, [])
  // …and re-stamp whenever a fresh field/weather pull lands.
  useEffect(() => setUpdated(formatPHT()), [field, weather.updatedAt])

  const dischargeText = weather.discharge == null ? '--' : `${weather.discharge.toFixed(1)} m³/s`
  const hasField = Boolean(field?.cells?.length)

  return (
    <AdminLayout mainClassName="main--flush">
      <div className="hazard">
        {/* ── Toolbar ── */}
        <div className="hz-toolbar">
          <div className="hz-title">
            <LayersIcon />
            <span>Flood Hazard Layers</span>
          </div>
          <div className="hz-source">
            <span className="hz-source-dot" />
            Source: Open-Meteo (Forecast + Flood API) · OpenStreetMap
          </div>
          <div className="hz-updated">
            <span className={`hz-live-dot ${loading ? 'loading' : ''}`} />
            Live · Updated {updated} PHT
          </div>
          {/* 2D (classic Leaflet) ⇄ 3D (Mapbox terrain) — hidden without a token. */}
          <MapViewToggle value={use3D} onChange={setUse3D} />
        </div>

        {/* ── Map + control panel ── */}
        <div className="hz-body">
          {/* Map */}
          <div className="hz-map-area">
            {use3D ? (
              <Hazard3DView
                samples={samples}
                field={field}
                visible={visible}
                opacity={opacity}
                selected={selected}
                onSelect={setSelected}
                weather={weather}
                roads={roads}
                statusMap={statusMap}
                openCentres={openCentres}
                onViewChange={setCoords}
              />
            ) : (
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              renderer={canvasRenderer}
              className="hz-leaflet"
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.85} />
              <ZoomControl position="bottomright" />
              <CabuyaoLock />

              {/* Project NOAH official 5-year return-period flood hazard zones */}
              {visible.noahHazard && noahGeo && (
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

              {/* Live flood-inundation surface — the NOAH-style honeycomb,
                  clipped to land so it never spills into Laguna de Bay. */}
              {visible.inundation && <InundationGrid field={field} opacity={opacity / 100} />}

              {/* Affected barangays — the REAL boundary polygons classified by
                  live risk. Click one to focus + open its detail card. */}
              {visible.barangays && (
                <BarangayRiskLayer
                  samples={samples}
                  opacity={Math.max(0.45, opacity / 100)}
                  onSelect={setSelected}
                  selected={selected}
                />
              )}

              {/* Flooded / closed road segments */}
              {visible.roadRisk && hazardRoads && (
                <RoadNetworkLayer roads={hazardRoads} statusMap={statusMap} interactive={false} />
              )}

              {/* Barangay risk pins, anchored at each polygon's interior point */}
              {visible.barangays &&
                samples.map((b) => (
                  <Marker
                    key={b.name}
                    position={b.coords}
                    icon={pinIcon({
                      color: RISK_META[b.level].color,
                      glyph: 'dot',
                      size: PIN_SIZE.low,
                      selected: b.name === selected,
                    })}
                    eventHandlers={{ click: () => setSelected(b.name) }}
                  >
                    <Tooltip direction="top">
                      <b>{b.name}</b>
                      <br />
                      {RISK_META[b.level].label} · ~{b.floodDepth.toFixed(2)} m
                    </Tooltip>
                  </Marker>
                ))}

              {/* Open evacuation centres (shared house pin) */}
              {visible.evacuation &&
                openCentres.map((c) => (
                  <Marker
                    key={c.id}
                    position={c.coords}
                    icon={pinIcon({ color: '#1A7A4A', glyph: 'home', size: PIN_SIZE.moderate })}
                  >
                    <Tooltip direction="top">
                      <b>{c.name}</b>
                      <br />
                      {c.barangay} · cap. {c.capacity}
                    </Tooltip>
                  </Marker>
                ))}

              {/* Searched location: flyTo + pin + glowing road highlight */}
              <SearchResultLayer result={searchResult} barangays={samples} navigateTo="/admin/route-planning" />

              <FocusController bounds={focusBounds} />
              <CoordReadout onChange={setCoords} />
            </MapContainer>
            )}

            {/* Floating smart search (2D view; the result layer is Leaflet-only) */}
            {!use3D && <MapSearchBar localIndex={localIndex} onSelect={setSearchResult} />}

            {/* Focused barangay detail card */}
            {selectedSample && (
              <BarangayDetailCard sample={selectedSample} onClose={() => setSelected(null)} />
            )}

            {/* Loading / offline hint */}
            {loading && !hasField && (
              <div className="hz-nodata">
                <span className="hz-spinner" />
                <span>Loading live hazard model…</span>
                <small>Fusing Open-Meteo forecast, flood & elevation over Cabuyao</small>
              </div>
            )}
            {error && !hasField && (
              <div className="hz-nodata">
                <LayersIcon />
                <span>Live feeds unavailable</span>
                <small>Showing base map only — retry once the network is back.</small>
                <button type="button" className="hz-retry" onClick={refresh}>Retry</button>
              </div>
            )}

            <div className="hz-coords">
              {coords
                ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E | Zoom: ${coords.zoom}`
                : 'No map data'}
            </div>
          </div>

          {/* ── Right control panel ── */}
          <aside className="hz-panel">
            {/* Map layers */}
            <section className="hz-section">
              <h3 className="hz-section-title">Map Layers</h3>
              <div className="hz-layer-list">
                {LAYER_DEFS.map((l) => (
                  <label className="hz-layer" key={l.key}>
                    <span className="hz-layer-main">
                      <span className="hz-layer-swatch" style={{ background: l.color }} />
                      <span className="hz-layer-text">
                        <span className="hz-layer-name">{l.label}</span>
                        <span className="hz-layer-desc">{l.desc}</span>
                      </span>
                    </span>
                    <span className="hz-layer-right">
                      <span className="hz-layer-count">{counts[l.key]}</span>
                      <span className={`hz-switch ${visible[l.key] ? 'on' : ''}`}>
                        <input type="checkbox" checked={visible[l.key]} onChange={() => toggle(l.key)} />
                        <span className="hz-switch-knob" />
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            {/* Overlay opacity */}
            <section className="hz-section">
              <div className="hz-opacity-head">
                <h3 className="hz-section-title">Inundation Opacity</h3>
                <span className="hz-opacity-val">{opacity}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="hz-range"
              />
            </section>

            {/* Risk classification legend */}
            <section className="hz-section">
              <h3 className="hz-section-title">Risk Classification</h3>
              <div className="hz-legend">
                {RISK_LEGEND.map((r) => (
                  <div className="hz-legend-row" key={r.level}>
                    <span className="hz-legend-swatch" style={{ background: RISK_META[r.level].color }} />
                    <span className="hz-legend-label">{r.label}</span>
                    <span className="hz-legend-sub">{r.sub}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Live hazard summary (derived from the field) */}
            <section className="hz-section">
              <h3 className="hz-section-title">Hazard Summary</h3>
              <div className="hz-stats">
                <Stat label="At-Risk Area" value={`${summary.inundatedAreaKm2}`} unit="km²" />
                <Stat label="Est. Avg Depth" value={`~${summary.avgFloodDepth.toFixed(2)}`} unit="m" />
                <Stat label="High-Risk Brgys" value={`${summary.highRiskZones}`} />
                <Stat label="Flagged Roads" value={`${summary.affectedRoads}`} />
              </div>
              <p className="hz-feed-note" style={{ marginTop: '0.5rem' }}>
                Depths are model estimates (Open-Meteo + terrain), not sensor readings. Verify on the ground before acting.
              </p>
            </section>

            {/* Live external feed (Open-Meteo Flood API) */}
            <section className="hz-section hz-feed">
              <h3 className="hz-section-title">Live River Discharge</h3>
              <div className="hz-feed-row">
                <DropletIcon />
                <span className="hz-feed-val">{dischargeText}</span>
                <span className="hz-feed-src">Open-Meteo Flood</span>
              </div>
              <p className="hz-feed-note">
                Modeled discharge near Cabuyao. Feeds the flood-risk model that
                classifies the hazard surface above.
              </p>
              <button type="button" className="hz-refresh" onClick={refresh} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh feeds'}
              </button>
            </section>
          </aside>
        </div>
      </div>
    </AdminLayout>
  )
}

/* ── 3D map view (Mapbox GL) ─────────────────────────────────────────────── */
/**
 * The Map3D-backed hazard map: the NOAH-style banded inundation honeycomb,
 * pulsing barangay risk polygons + ripple markers, the flagged road segments,
 * the open evacuation centres and the Cabuyao city boundary — all native
 * Mapbox layers (mapbox3dHelpers), draped onto the 3D terrain so the hazard
 * colours stay glued to the ground through any camera movement. Driven by the
 * SAME state as the Leaflet view (toggles, opacity slider, selection), so
 * switching 2D ⇄ 3D never changes what the map says.
 */
function Hazard3DView({
  samples,
  field,
  visible,
  opacity,
  selected,
  onSelect,
  weather,
  roads,
  statusMap,
  openCentres,
  onViewChange,
}) {
  const { onMapLoad, mapRef, ready } = useBarangayLayers({
    samples,
    field,
    inundation: visible.inundation,
    noah: visible.noahHazard,
    fills: visible.barangays,
    markers: visible.barangays,
    baseOpacity: opacity / 100,
    selected,
    onSelect,
  })

  // Flagged roads + open evacuation centres ride on the same map once the
  // barangay layers are up; fresh data re-feeds the sources in place.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (!map.getSource('hazard-roads')) addHazardRoadsLayer(map, roads, statusMap, visible.roadRisk)
    else updateHazardRoadsData(map, roads, statusMap)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mapRef, roads, statusMap])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (!map.getSource('evac-centres')) addEvacCentersLayer(map, openCentres, visible.evacuation)
    else updateEvacCentersData(map, openCentres)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mapRef, openCentres])

  // Page layer toggles.
  useEffect(() => {
    if (ready && mapRef.current) setMapLayerVisible(mapRef.current, 'hazard-roads', visible.roadRisk)
  }, [ready, mapRef, visible.roadRisk])
  useEffect(() => {
    if (ready && mapRef.current) setMapLayerVisible(mapRef.current, 'evac-centres', visible.evacuation)
  }, [ready, mapRef, visible.evacuation])

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

/* ── Small building blocks ───────────────────────────────────────────────── */
function Stat({ label, value, unit }) {
  return (
    <div className="hz-stat">
      <div className="hz-stat-val">
        {value}
        {unit && <span className="hz-stat-unit">{unit}</span>}
      </div>
      <div className="hz-stat-lbl">{label}</div>
    </div>
  )
}

/* ── Icons (inline SVG, matching the admin style) ────────────────────────── */
function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
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
