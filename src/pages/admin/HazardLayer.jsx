import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, CircleMarker, Tooltip } from 'react-leaflet'
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
import { SAMPLE_EVAC_CENTERS } from '../../data/cabuyao.js'
import './HazardLayer.css'

/**
 * CDRRMO Admin — Flood Hazard Layer.
 *
 * A real-time, Project-NOAH-style hazard map: the live flood-risk field
 * (floodRisk.js) is painted as a green→red inundation surface over Cabuyao,
 * with barangay risk markers, the admin's flooded/closed roads, and the open
 * evacuation centres layered on top. Everything is derived live from the three
 * feeds the Conceptual Framework names —
 *
 *   • Google Flood Hub  → river discharge + low-elevation susceptibility
 *   • Windy.com         → rainfall / wind driving the wetness of the field
 *   • OpenStreetMap     → the base map + the road segments
 *
 * — and recomputes whenever the feeds refresh, so the colours track the actual
 * weather. No backend required; the production keys plug in on Integrations.
 */

/* ── Toggleable map overlays ─────────────────────────────────────────────── */
const LAYER_DEFS = [
  { key: 'inundation', label: 'Flood Inundation', desc: 'Live modeled flood-risk surface', color: '#2563EB' },
  { key: 'roadRisk', label: 'Road Network Risk', desc: 'Flooded / closed road segments', color: '#F97316' },
  { key: 'barangays', label: 'Affected Barangays', desc: 'Barangay-level risk classification', color: '#C0181B' },
  { key: 'evacuation', label: 'Evacuation Centers', desc: 'Open shelters & safe zones', color: '#1A7A4A' },
]

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

  // ── Overlay visibility + opacity ──
  const [visible, setVisible] = useState(() => Object.fromEntries(LAYER_DEFS.map((l) => [l.key, true])))
  const [opacity, setOpacity] = useState(85)
  const [coords, setCoords] = useState(null)
  const [updated, setUpdated] = useState(formatPHT())

  // Focus view + detail card.
  const [selected, setSelected] = useState(null)

  function toggle(key) {
    setVisible((v) => ({ ...v, [key]: !v[key] }))
  }

  // ── Derived live data ──
  const samples = useMemo(() => barangayRiskSamples(field), [field])
  const selectedSample = useMemo(() => samples.find((b) => b.name === selected) || null, [samples, selected])
  const focusBounds = useMemo(() => (selected ? barangayBounds(selected) : null), [selected])
  const summary = useMemo(() => hazardSummary(field, samples, statusMap), [field, samples, statusMap])
  const openCentres = useMemo(
    () => SAMPLE_EVAC_CENTERS.filter((c) => c.coords && c.status !== 'closed'),
    [],
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
            Source: Google Flood Hub · Windy · OpenStreetMap
          </div>
          <div className="hz-updated">
            <span className={`hz-live-dot ${loading ? 'loading' : ''}`} />
            Live · Updated {updated} PHT
          </div>
        </div>

        {/* ── Map + control panel ── */}
        <div className="hz-body">
          {/* Map */}
          <div className="hz-map-area">
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              className="hz-leaflet"
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.85} />
              <ZoomControl position="bottomright" />
              <CabuyaoLock />

              {/* Live flood-inundation surface — the NOAH-style heat field,
                  clipped to land so it never spills into Laguna de Bay. */}
              {visible.inundation && (
                <InundationGrid cells={field?.cells} opacity={opacity / 100} mode="interior" />
              )}

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

              {/* Barangay risk markers, anchored at each polygon's interior point */}
              {visible.barangays &&
                samples.map((b) => (
                  <CircleMarker
                    key={b.name}
                    center={b.coords}
                    radius={b.name === selected ? 8 : 6}
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

              {/* Open evacuation centres */}
              {visible.evacuation &&
                openCentres.map((c) => (
                  <CircleMarker
                    key={c.id}
                    center={c.coords}
                    radius={6}
                    pathOptions={{ color: '#fff', weight: 2, fillColor: '#1A7A4A', fillOpacity: 1 }}
                  >
                    <Tooltip direction="top" offset={[0, -5]}>
                      <b>{c.name}</b>
                      <br />
                      {c.barangay} · cap. {c.capacity}
                    </Tooltip>
                  </CircleMarker>
                ))}

              <FocusController bounds={focusBounds} />
              <CoordReadout onChange={setCoords} />
            </MapContainer>

            {/* Focused barangay detail card */}
            {selectedSample && (
              <BarangayDetailCard sample={selectedSample} onClose={() => setSelected(null)} />
            )}

            {/* Loading / offline hint */}
            {loading && !hasField && (
              <div className="hz-nodata">
                <span className="hz-spinner" />
                <span>Loading live hazard model…</span>
                <small>Fusing Flood Hub, Windy & elevation over Cabuyao</small>
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
                <Stat label="Avg Flood Depth" value={summary.avgFloodDepth.toFixed(2)} unit="m" />
                <Stat label="High-Risk Brgys" value={`${summary.highRiskZones}`} />
                <Stat label="Flagged Roads" value={`${summary.affectedRoads}`} />
              </div>
            </section>

            {/* Live external feed (Open-Meteo Flood API / Flood Hub) */}
            <section className="hz-section hz-feed">
              <h3 className="hz-section-title">Live River Discharge</h3>
              <div className="hz-feed-row">
                <DropletIcon />
                <span className="hz-feed-val">{dischargeText}</span>
                <span className="hz-feed-src">Flood Hub</span>
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
