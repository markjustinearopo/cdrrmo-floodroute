import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet'
import ResidentLayout from '../../components/resident/ResidentLayout.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../../components/admin/mapHelpers.jsx'
import {
  ROAD_STATUS,
  RoadNetworkLayer,
  useCabuyaoRoads,
  useRoadStatus,
} from '../../components/admin/routingHelpers.jsx'
import '../admin/RoadStatus.css'

/**
 * CDRRMO Resident — Road Status (Routing).
 *
 * READ-ONLY view of which roads are flooded or closed, so a resident can avoid
 * them. The conditions are exactly the ones CDRRMO and barangay officials tag
 * (shared store) — residents only look. The live Cabuyao road network comes
 * from OpenStreetMap (Overpass); flagged roads are drawn as a static overlay.
 */

export default function RoadStatus() {
  const { roads, loading, error, retry } = useCabuyaoRoads()
  const [statusMap] = useRoadStatus() // read-only consumption of the shared conditions
  const [coords, setCoords] = useState(null)

  const counts = useMemo(() => {
    const c = { flooded: 0, blocked: 0 }
    Object.values(statusMap).forEach((s) => {
      if (c[s] != null) c[s]++
    })
    const total = roads?.features.length || 0
    return { ...c, total, open: Math.max(total - c.flooded - c.blocked, 0) }
  }, [statusMap, roads])

  const flagged = useMemo(() => {
    if (!roads) return []
    const byId = new Map(roads.features.map((f) => [String(f.properties.id), f.properties]))
    return Object.entries(statusMap)
      .map(([id, status]) => ({ id, status, name: byId.get(String(id))?.name || `Road #${id}` }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [statusMap, roads])

  return (
    <ResidentLayout mainClassName="main--flush">
      <div className="road-status">
        <div className="rs-toolbar">
          <div className="rs-title">
            <RoadIcon />
            <span>Road Status</span>
          </div>

          <div className="rs-brushes">
            <span className="rs-brush-label" style={{ marginRight: 0 }}>Which roads to avoid right now</span>
          </div>

          <div className="rs-source">
            <span className="rs-source-dot" />
            OpenStreetMap · Overpass
          </div>
        </div>

        <div className="rs-body">
          <div className="rs-map-area">
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              className="rs-leaflet"
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.8} />
              <ZoomControl position="bottomright" />
              <CabuyaoLock />
              {roads && <RoadNetworkLayer roads={roads} statusMap={statusMap} interactive={false} />}
              <CoordReadout onChange={setCoords} />
            </MapContainer>

            {loading && (
              <div className="rs-overlay">
                <span className="rs-spinner" />
                <span>Loading Cabuyao road network…</span>
                <small>Fetching live roads from OpenStreetMap (Overpass)</small>
              </div>
            )}
            {error && !loading && (
              <div className="rs-overlay">
                <WarnIcon />
                <span>Couldn't load the road network</span>
                <small>The Overpass map service may be busy. Please try again.</small>
                <button type="button" className="rs-retry" onClick={retry}>
                  Retry
                </button>
              </div>
            )}

            <div className="rs-coords">
              {coords
                ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E | Zoom: ${coords.zoom}`
                : 'No map data'}
            </div>
          </div>

          <aside className="rs-panel">
            <section className="rs-section">
              <h3 className="rs-section-title">Network Conditions</h3>
              <div className="rs-summary">
                <div className="rs-sum rs-sum--blocked">
                  <div className="rs-sum-val">{counts.blocked}</div>
                  <div className="rs-sum-lbl">Closed</div>
                </div>
                <div className="rs-sum rs-sum--flooded">
                  <div className="rs-sum-val">{counts.flooded}</div>
                  <div className="rs-sum-lbl">Flooded</div>
                </div>
                <div className="rs-sum rs-sum--open">
                  <div className="rs-sum-val">{counts.open}</div>
                  <div className="rs-sum-lbl">Passable</div>
                </div>
              </div>
              <div className="rs-total">{counts.total} road segments mapped</div>
            </section>

            <section className="rs-section">
              <h3 className="rs-section-title">Legend</h3>
              <div className="rs-legend">
                {Object.entries(ROAD_STATUS).map(([key, m]) => (
                  <div className="rs-legend-row" key={key}>
                    <span className="rs-legend-line" style={{ background: m.line, opacity: key === 'open' ? 0.6 : 1 }} />
                    <span className="rs-legend-name">{m.label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rs-section rs-section--grow">
              <div className="rs-flagged-head">
                <h3 className="rs-section-title">
                  Roads to Avoid
                  {flagged.length > 0 && <span className="rs-pill">{flagged.length}</span>}
                </h3>
              </div>
              {flagged.length === 0 ? (
                <div className="rs-empty">No roads are flagged flooded or closed right now.</div>
              ) : (
                <ul className="rs-flagged">
                  {flagged.map((r) => (
                    <li className="rs-flagged-row" key={r.id}>
                      <span className="rs-flagged-line" style={{ background: ROAD_STATUS[r.status].swatch }} />
                      <span className="rs-flagged-name" title={r.name}>{r.name}</span>
                      <span className={`rs-badge ${r.status}`}>{ROAD_STATUS[r.status].label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rs-section rs-note">
              <SparkIcon />
              <span>
                Road conditions are reported by CDRRMO and barangay officials and update
                live. Always follow on-the-ground advice from responders.
              </span>
            </section>
          </aside>
        </div>
      </div>
    </ResidentLayout>
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
function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    </svg>
  )
}
