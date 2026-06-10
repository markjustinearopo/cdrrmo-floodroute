import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, CircleMarker, Tooltip } from 'react-leaflet'
import BarangayLayout from '../../components/barangay/BarangayLayout.jsx'
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
} from '../../components/admin/floodRisk.js'
import { BarangayRiskLayer, InundationGrid } from '../../components/admin/BarangayRiskLayer.jsx'
import { useLiveWeather } from '../../services/weather.js'
import { SAMPLE_EVAC_CENTERS } from '../../data/cabuyao.js'
import { officialBarangayLabel, getOfficialBarangay } from '../../data/barangay.js'
import '../admin/HazardLayer.css'

/**
 * CDRRMO Barangay — Flood Hazard Layer (Monitor).
 *
 * The official reads the SAME live hazard picture the command center works
 * from — Leaflet + OpenStreetMap with the real barangay boundaries classified
 * by the live flood-risk model (Google Flood Hub × Windy × OpenStreetMap +
 * bundled Cabuyao terrain). It is read-only here; the official's own barangay
 * is highlighted. Nothing is painted over Laguna de Bay — every barangay is
 * drawn at its true location.
 */

const LAYER_DEFS = [
  { key: 'inundation', label: 'Flood Inundation', desc: 'Live modeled flood-risk surface', color: '#2563EB' },
  { key: 'barangays', label: 'Affected Barangays', desc: 'Barangay-level risk classification', color: '#C0181B' },
  { key: 'evacuation', label: 'Evacuation Centers', desc: 'Open shelters & safe zones', color: '#1A7A4A' },
]

const RISK_LEGEND = [
  { level: 'high', label: 'High Risk', sub: '≥ 0.5 m flood depth' },
  { level: 'moderate', label: 'Moderate', sub: '0.3 – 0.5 m' },
  { level: 'low', label: 'Low Risk', sub: '0.1 – 0.3 m' },
  { level: 'safe', label: 'Safe', sub: '< 0.1 m' },
]

export default function HazardLayer() {
  const brgyLabel = officialBarangayLabel()
  const myBrgy = getOfficialBarangay()

  const { field, loading, error, refresh } = useFloodRisk()
  const { weather } = useLiveWeather()

  const [visible, setVisible] = useState(() => Object.fromEntries(LAYER_DEFS.map((l) => [l.key, true])))
  const [opacity, setOpacity] = useState(70)
  const [coords, setCoords] = useState(null)
  const [updated, setUpdated] = useState(formatPHT())

  function toggle(key) {
    setVisible((v) => ({ ...v, [key]: !v[key] }))
  }

  const samples = useMemo(() => barangayRiskSamples(field), [field])
  const summary = useMemo(() => hazardSummary(field, samples, {}), [field, samples])
  const openCentres = useMemo(
    () => SAMPLE_EVAC_CENTERS.filter((c) => c.coords && c.status !== 'closed'),
    [],
  )
  const myLevel = useMemo(() => samples.find((s) => s.name === myBrgy)?.level ?? 'safe', [samples, myBrgy])

  const counts = useMemo(() => ({
    inundation: field?.cells?.filter((c) => c.onLand && c.risk >= 0.34).length || 0,
    barangays: samples.filter((s) => s.level === 'high' || s.level === 'moderate').length,
    evacuation: openCentres.length,
  }), [field, samples, openCentres])

  useEffect(() => {
    const id = setInterval(() => setUpdated(formatPHT()), 60_000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => setUpdated(formatPHT()), [field, weather.updatedAt])

  const dischargeText = weather.discharge == null ? '--' : `${weather.discharge.toFixed(1)} m³/s`
  const hasField = Boolean(field?.cells?.length)

  return (
    <BarangayLayout mainClassName="main--flush">
      <div className="hazard">
        <div className="hz-toolbar">
          <div className="hz-title">
            <LayersIcon />
            <span>Flood Hazard Layers · Brgy. {brgyLabel}</span>
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

        <div className="hz-body">
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

              {visible.inundation && (
                <InundationGrid cells={field?.cells} opacity={opacity / 100} mode="interior" />
              )}
              {visible.barangays && (
                <BarangayRiskLayer samples={samples} opacity={Math.max(0.45, opacity / 100)} />
              )}
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

              <CoordReadout onChange={setCoords} />
            </MapContainer>

            {loading && !hasField && (
              <div className="hz-nodata">
                <span className="hz-spinner" />
                <span>Loading live hazard model…</span>
                <small>Fusing Flood Hub, Windy & terrain over Cabuyao</small>
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

          <aside className="hz-panel">
            {/* Official's own jurisdiction risk, foregrounded */}
            <section className="hz-section">
              <h3 className="hz-section-title">Your Barangay</h3>
              <div className="hz-stats">
                <div className="hz-stat">
                  <div className="hz-stat-val" style={{ color: RISK_META[myLevel].color }}>
                    {RISK_META[myLevel].label}
                  </div>
                  <div className="hz-stat-lbl">Brgy. {brgyLabel}</div>
                </div>
                <Stat
                  label="Est. Flood Depth"
                  value={(samples.find((s) => s.name === myBrgy)?.floodDepth ?? 0).toFixed(2)}
                  unit="m"
                />
              </div>
            </section>

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

            <section className="hz-section">
              <h3 className="hz-section-title">Hazard Summary</h3>
              <div className="hz-stats">
                <Stat label="At-Risk Area" value={`${summary.inundatedAreaKm2}`} unit="km²" />
                <Stat label="Avg Flood Depth" value={summary.avgFloodDepth.toFixed(2)} unit="m" />
                <Stat label="High-Risk Brgys" value={`${summary.highRiskZones}`} />
                <Stat label="Affected Brgys" value={`${counts.barangays}`} />
              </div>
            </section>

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
    </BarangayLayout>
  )
}

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
