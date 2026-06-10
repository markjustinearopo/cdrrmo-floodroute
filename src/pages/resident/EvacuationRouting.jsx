import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, Polyline, Marker } from 'react-leaflet'
import ResidentLayout from '../../components/resident/ResidentLayout.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../../components/admin/mapHelpers.jsx'
import {
  ROUTE_TYPES,
  ROAD_STATUS,
  RoadNetworkLayer,
  useCabuyaoRoads,
  useRoadStatus,
  useRoutes,
  waypointIcon,
  pathLengthMeters,
  formatDistance,
  formatWalkEta,
} from '../../components/admin/routingHelpers.jsx'
import '../admin/RoutePlanning.css'

/**
 * CDRRMO Resident — Evacuation Routing (Routing).
 *
 * READ-ONLY. Residents don't draw routes — they follow the safe routes CDRRMO
 * and barangay officials publish (shared store), shown over live road
 * conditions so flooded/closed segments are obvious. Pick a route to highlight
 * it and read its distance and walking time. The list is empty until officials
 * publish routes.
 */
export default function EvacuationRouting() {
  const { roads } = useCabuyaoRoads()
  const [statusMap] = useRoadStatus()
  const [routes] = useRoutes()
  const [selectedId, setSelectedId] = useState(null)
  const [coords, setCoords] = useState(null)

  const selected = useMemo(
    () => routes.find((r) => r.id === selectedId) || routes[0] || null,
    [routes, selectedId],
  )

  const color = selected ? (ROUTE_TYPES[selected.type]?.color || '#C0181B') : '#C0181B'
  const distance = selected ? pathLengthMeters(selected.points) : 0
  const points = selected?.points || []

  return (
    <ResidentLayout mainClassName="main--flush">
      <div className="route-plan">
        <div className="rp-toolbar">
          <div className="rp-title">
            <ShieldIcon />
            <span>Evacuation Routing</span>
          </div>
          <div className="rp-type-seg" style={{ pointerEvents: 'none' }}>
            <span className="rp-type-note" style={{ border: 'none', padding: 0 }}>
              <span className="rp-type-dot" style={{ background: '#16A34A' }} />
              Recommended safe routes to evacuation centres
            </span>
          </div>
          <div className="rp-tools">
            <span className="rp-soon" style={{ position: 'static' }}>View only</span>
          </div>
        </div>

        <div className="rp-body">
          <div className="rp-map-area">
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              className="rp-leaflet"
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.85} />
              <ZoomControl position="bottomright" />
              <CabuyaoLock />
              {/* Live road conditions as context so residents see what to avoid. */}
              {roads && <RoadNetworkLayer roads={roads} statusMap={statusMap} interactive={false} />}

              {points.length > 1 && (
                <>
                  <Polyline positions={points} pathOptions={{ color, weight: 11, opacity: 0.22, lineCap: 'round' }} />
                  <Polyline positions={points} pathOptions={{ color, weight: 4, opacity: 0.95, lineCap: 'round' }} />
                  <Marker position={points[0]} icon={waypointIcon('A', 'start')} />
                  <Marker position={points[points.length - 1]} icon={waypointIcon('B', 'end')} />
                </>
              )}

              <CoordReadout onChange={setCoords} />
            </MapContainer>

            {routes.length === 0 && (
              <div className="rp-hint">
                <ShieldIcon />
                <span>No published evacuation routes yet</span>
                <small>Safe routes from CDRRMO and your barangay will appear here.</small>
              </div>
            )}

            <div className="rp-coords">
              {coords
                ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E | Zoom: ${coords.zoom}`
                : 'No map data'}
            </div>
          </div>

          <aside className="rp-panel">
            {selected && (
              <section className="rp-section">
                <h3 className="rp-section-title">Recommended Safe Route</h3>
                <div className="rp-type-note">
                  <span className="rp-type-dot" style={{ background: color }} />
                  {selected.name}
                </div>
                <div className="rp-metrics" style={{ marginTop: 10 }}>
                  <div className="rp-metric">
                    <div className="rp-metric-val">{points.length}</div>
                    <div className="rp-metric-lbl">Stops</div>
                  </div>
                  <div className="rp-metric">
                    <div className="rp-metric-val">{formatDistance(distance)}</div>
                    <div className="rp-metric-lbl">Distance</div>
                  </div>
                  <div className="rp-metric">
                    <div className="rp-metric-val">{points.length > 1 ? formatWalkEta(distance) : '--'}</div>
                    <div className="rp-metric-lbl">Walk ETA</div>
                  </div>
                </div>
              </section>
            )}

            <section className="rp-section rp-section--grow">
              <h3 className="rp-section-title">
                Available Routes
                {routes.length > 0 && <span className="rp-pill">{routes.length}</span>}
              </h3>
              {routes.length === 0 ? (
                <div className="rp-empty">No evacuation routes have been published for your area yet.</div>
              ) : (
                <ul className="rp-saved">
                  {routes.map((r) => (
                    <li className="rp-saved-row" key={r.id}>
                      <span className="rp-saved-dot" style={{ background: ROUTE_TYPES[r.type]?.color }} />
                      <button
                        type="button"
                        className="rp-saved-main"
                        onClick={() => setSelectedId(r.id)}
                        title="Show on map"
                        style={selected?.id === r.id ? { background: '#fef2f2', borderRadius: 8 } : undefined}
                      >
                        <span className="rp-saved-name">{r.name}</span>
                        <span className="rp-saved-meta">
                          {ROUTE_TYPES[r.type]?.label || 'Route'} · {formatDistance(pathLengthMeters(r.points))} · {r.points.length} stops
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rp-section rp-note" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <SparkIcon />
              <span style={{ fontSize: '0.6875rem', color: '#9a9a9a', lineHeight: 1.5 }}>
                Routes avoid roads flagged flooded or closed. Conditions change fast —
                follow responders' instructions on the ground.
              </span>
            </section>
          </aside>
        </div>
      </div>
    </ResidentLayout>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
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
