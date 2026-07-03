import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { MapContainer, TileLayer, ZoomControl, Polyline, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import ResidentLayout from '../../components/resident/ResidentLayout.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../../components/admin/mapHelpers.jsx'
import {
  ROUTE_TYPES,
  RoadNetworkLayer,
  ClickToAddWaypoint,
  useCabuyaoRoads,
  useRoadStatus,
  useRoutes,
  waypointIcon,
  pathLengthMeters,
  formatDistance,
  formatWalkEta,
  activeRouteGeometry,
} from '../../components/admin/routingHelpers.jsx'
import { useRouteGraph, planToNearestSafe, DEFAULT_ALPHA } from '../../components/admin/routeEngine.js'
import { useFloodRisk, barangayRiskSamples } from '../../components/admin/floodRisk.js'
import '../../components/map/mapUpgrade.css'
import { MapViewToggle, use3DPreference } from '../../components/admin/Map3D.jsx'
import RouteSketch3DView from '../../components/admin/RouteSketch3DView.jsx'
import { evacPinIcon } from '../../components/admin/EvacLocationPicker.jsx'
import { useGeolocation } from '../../hooks/useGeolocation.js'
import { usePersistedState } from '../../utils/usePersistedState.js'
import { useEvacCenters, barangayCoords } from '../../context/AdminDataContext.jsx'
import { getResidentBarangay, residentBarangayLabel } from '../../data/resident.js'
import '../admin/RoutePlanning.css'
import './Resident.css'

// "You are here" draggable pin (blue dot with a white ring).
const youPinIcon = L.divIcon({
  className: 'res-you-pin',
  html: '<span class="res-you-dot"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

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
  const brgyLabel = residentBarangayLabel()
  const myBrgy = getResidentBarangay()
  const { roads } = useCabuyaoRoads()
  const graph = useRouteGraph(roads)
  const { field } = useFloodRisk()
  const { evacuationCenters } = useEvacCenters()
  const evacMarkers = useMemo(
    () => evacuationCenters.filter((c) => Array.isArray(c.coords)),
    [evacuationCenters],
  )
  const [statusMap] = useRoadStatus()
  const [routes] = useRoutes()
  const [selectedId, setSelectedId] = useState(null)
  const [coords, setCoords] = useState(null)
  const [use3D, setUse3D] = use3DPreference()

  // The resident's own location: pinned on the map and REMEMBERED (geolocation
  // can be off by a block, so a manual pin that stays put is the source of truth
  // for "directions from where I am"). Find-my-location seeds it from GPS; they
  // can then drag it to the exact spot.
  const [pin, setPin] = usePersistedState('cdrrmo-res-pin', null) // { lat, lng } | null
  const [pinning, setPinning] = useState(false)
  const { locate, loading: locating } = useGeolocation()

  // Read-only "generate" result: a flood-aware route the resident asks the
  // system to compute (origin = their pinned location, else their barangay).
  const [gen, setGen] = useState(null)
  const [genMsg, setGenMsg] = useState('')
  const routerLoc = useLocation()
  const autoDestRef = useRef(null) // guards the one-shot "Directions" auto-route

  function findMyLocation() {
    setGenMsg('')
    locate()
      .then((c) => { setPin({ lat: c.lat, lng: c.lng }); setPinning(false) })
      .catch((msg) => setGenMsg(typeof msg === 'string' ? msg : 'Could not get your location.'))
  }

  const selected = useMemo(
    () => routes.find((r) => r.id === selectedId) || routes[0] || null,
    [routes, selectedId],
  )

  // Live per-barangay risk — used to warn when the DESTINATION area is wet.
  const samples = useMemo(() => barangayRiskSamples(field), [field])
  const destRisk = useMemo(() => {
    if (!gen?.centre?.barangay) return null
    return samples.find((s) => s.name === gen.centre.barangay)?.level ?? null
  }, [gen, samples])

  // Route hazard verdict for the generated route: 'high' | 'mod' | null.
  const routeWarn = useMemo(() => {
    if (!gen) return null
    if (gen.floodedSegments > 0 || destRisk === 'high' || (gen.meanRisk ?? 0) >= 0.62) return 'high'
    if (destRisk === 'moderate' || (gen.meanRisk ?? 0) >= 0.34) return 'mod'
    return null
  }, [gen, destRisk])

  const publishedColor = selected ? (ROUTE_TYPES[selected.type]?.color || '#C0181B') : '#C0181B'
  // Residents see the geometry that is in effect: the road-following path of
  // auto routes, and the admin's override when one is active.
  const publishedPoints = selected ? activeRouteGeometry(selected) : []

  // The route shown on the map: the generated one when present, else the
  // selected published route.
  const showGen = Boolean(gen && gen.coords?.length > 1)
  const points = showGen ? gen.coords : publishedPoints
  const color = showGen ? '#16A34A' : publishedColor
  const distance = pathLengthMeters(points)

  // origin = pinned location when set, else the barangay centroid.
  const origin = pin ? [pin.lat, pin.lng] : barangayCoords(myBrgy)

  function generateRoute(targetId) {
    setGenMsg('')
    if (!origin) return setGenMsg('Pin your location (or set your barangay) to generate a route.')
    if (!graph || graph.size === 0) return setGenMsg('Road network unavailable.')
    let candidates = evacuationCenters.filter((c) => c.status === 'open' && Array.isArray(c.coords))
    if (targetId) {
      const t = evacuationCenters.find((c) => c.id === targetId && Array.isArray(c.coords))
      if (t) candidates = [t] // route specifically to the shelter the resident tapped
    }
    if (candidates.length === 0) return setGenMsg('No open evacuation centre to route to yet.')
    const best = planToNearestSafe(graph, origin, candidates, {
      riskAt: field?.riskAt,
      statusMap,
      alpha: DEFAULT_ALPHA,
    })
    if (!best) return setGenMsg('No reachable open evacuation centre right now.')
    setSelectedId(null)
    setGen({
      coords: best.plan.safe.coords,
      centre: best.centre,
      distanceM: best.plan.safe.distanceM,
      fromPin: Boolean(pin),
      // Risk readout for the warning banner: how wet is this path really,
      // and did the safest option still have to cross flagged water?
      meanRisk: best.plan.safe.meanRisk,
      floodedSegments: best.plan.safe.floodedSegments,
      detourM: best.plan.detourM,
    })
  }

  // Arriving from the Evacuation finder's "Directions" button: auto-route from
  // the pinned location to that specific shelter, once the graph is ready.
  useEffect(() => {
    const destId = routerLoc.state?.destId
    if (!destId || autoDestRef.current === destId) return
    if (!graph || graph.size === 0 || evacuationCenters.length === 0) return
    autoDestRef.current = destId
    generateRoute(destId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerLoc.state, graph, evacuationCenters.length])

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
            <button
              type="button"
              className="rp-btn"
              onClick={findMyLocation}
              disabled={locating}
              title="Use your device location to place your pin"
            >
              <PinIcon /> {locating ? 'Locating…' : 'Find my location'}
            </button>
            <button
              type="button"
              className={`rp-btn ${pinning ? 'on' : ''}`}
              onClick={() => { setPinning((v) => !v); if (use3D) setUse3D(false) }}
              title="Click the map to place your exact location pin"
            >
              {pinning ? 'Click the map…' : pin ? 'Move my pin' : 'Pin my location'}
            </button>
            <button
              type="button"
              className={`rp-btn rp-btn--auto ${showGen ? 'on' : ''}`}
              onClick={() => generateRoute()}
              title="Generate a flood-aware route from your location to the nearest open evacuation centre"
            >
              <SparkIcon /> Generate safe route
            </button>
            {showGen && (
              <button type="button" className="rp-btn" onClick={() => setGen(null)}>
                Clear
              </button>
            )}
          </div>

          <MapViewToggle value={use3D} onChange={setUse3D} />
        </div>

        <div className="rp-body">
          <div className="rp-map-area">
            {use3D ? (
              /* The full road network with live conditions + the published
                 route — the exact 2D picture, draped on the 3D terrain.
                 Picking a route plays the fly-along reveal of its line. */
              <RouteSketch3DView
                network={{ roads, statusMap }}
                lines={[{ id: 'route', coords: points, color }]}
                pins={
                  points.length > 1
                    ? [
                        { key: 'A', latlng: points[0], label: 'A', kind: 'start' },
                        { key: 'B', latlng: points[points.length - 1], label: 'B', kind: 'end' },
                      ]
                    : []
                }
                evac={evacMarkers}
                reveal={{ id: 'route', key: points.length > 1 ? (showGen ? 'gen' : selected?.id) : null }}
                onViewChange={setCoords}
              />
            ) : (
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

              {/* Click-to-pin while in pinning mode; the pin itself is draggable. */}
              <ClickToAddWaypoint enabled={pinning} onAdd={([lat, lng]) => { setPin({ lat, lng }); setPinning(false) }} />
              {pin && (
                <Marker
                  position={[pin.lat, pin.lng]}
                  icon={youPinIcon}
                  draggable
                  eventHandlers={{ dragend: (e) => { const ll = e.target.getLatLng(); setPin({ lat: ll.lat, lng: ll.lng }) } }}
                >
                  <Popup>
                    <strong>Your location</strong>
                    <div style={{ fontSize: '0.6875rem', color: '#7a7a7a' }}>Drag to adjust · routes start here</div>
                  </Popup>
                </Marker>
              )}

              {points.length > 1 && (
                <>
                  <Polyline positions={points} pathOptions={{ color, weight: 11, opacity: 0.22, lineCap: 'round' }} />
                  <Polyline positions={points} pathOptions={{ color, weight: 4, opacity: 0.95, lineCap: 'round' }} />
                  <Marker position={points[0]} icon={waypointIcon('A', 'start')} />
                  <Marker position={points[points.length - 1]} icon={waypointIcon('B', 'end')} />
                </>
              )}

              {/* Shared evacuation centres (city-wide) — where residents can go */}
              {evacMarkers.map((c) => (
                <Marker key={`evac-${c.id}`} position={c.coords} icon={evacPinIcon(c.status)}>
                  <Popup>
                    <strong>{c.name}</strong>
                    <div style={{ fontSize: '0.6875rem', color: '#7a7a7a' }}>{c.barangay} · {c.status}</div>
                  </Popup>
                </Marker>
              ))}

              <CoordReadout onChange={setCoords} />
            </MapContainer>
            )}

            {routes.length === 0 && !showGen && (
              <div className="rp-hint">
                <ShieldIcon />
                <span>No published evacuation routes yet</span>
                <small>Tap "Generate safe route", or wait for CDRRMO / your barangay to publish one.</small>
              </div>
            )}

            <div className="rp-coords">
              {coords
                ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E | Zoom: ${coords.zoom}`
                : 'No map data'}
            </div>
          </div>

          <aside className="rp-panel">
            <section className="rp-section">
              <h3 className="rp-section-title">Your Location</h3>
              {pin ? (
                <div className="rp-type-note">
                  <span className="rp-type-dot" style={{ background: '#2563eb' }} />
                  Pinned at {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)} — routes start here.
                </div>
              ) : (
                <div className="rp-type-note" style={{ color: '#9a3412' }}>
                  No pin set. Tap “Find my location” or “Pin my location”, then drag the
                  pin to your exact spot for accurate directions.
                </div>
              )}
            </section>

            {genMsg && (
              <section className="rp-section">
                <div className="rp-type-note" style={{ color: '#9a3412' }}>{genMsg}</div>
              </section>
            )}

            {showGen ? (
              <section className="rp-section">
                <h3 className="rp-section-title">Generated Safe Route</h3>
                <div className="rp-type-note">
                  <span className="rp-type-dot" style={{ background: '#16A34A' }} />
                  {gen.fromPin ? 'Your pinned location' : `Brgy. ${brgyLabel}`} → {gen.centre?.name || 'nearest open shelter'}
                </div>
                <div className="rp-metrics" style={{ marginTop: 10 }}>
                  <div className="rp-metric">
                    <div className="rp-metric-val">{formatDistance(distance)}</div>
                    <div className="rp-metric-lbl">Distance</div>
                  </div>
                  <div className="rp-metric">
                    <div className="rp-metric-val">{points.length > 1 ? formatWalkEta(distance) : '--'}</div>
                    <div className="rp-metric-lbl">Walk ETA</div>
                  </div>
                </div>
                <div className="rp-type-note" style={{ marginTop: 10 }}>
                  <span className="rp-type-dot" style={{ background: '#1a7a4a' }} />
                  Flood-aware · steers around flooded / closed roads
                  {gen.detourM > 30 ? ` · detours ${formatDistance(gen.detourM)} to stay dry` : ''}
                </div>

                {/* Hazard verdict: warn when even the safest path gets wet, or
                    when the shelter itself sits in a currently-risky barangay. */}
                {routeWarn ? (
                  <div className={`rp-route-warn ${routeWarn}`} role="alert">
                    <svg viewBox="0 0 24 24">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span>
                      <b>{routeWarn === 'high' ? 'Caution — hazards on this route' : 'Elevated flood risk on this route'}</b>
                      {gen.floodedSegments > 0 &&
                        `Passes ${gen.floodedSegments} flagged flooded/closed segment${gen.floodedSegments > 1 ? 's' : ''} with no dry alternative. `}
                      {destRisk && destRisk !== 'safe' && destRisk !== 'low' &&
                        `The destination area (Brgy. ${gen.centre?.barangay}) is currently at ${destRisk} flood risk. `}
                      {gen.floodedSegments === 0 && (gen.meanRisk ?? 0) >= 0.34 &&
                        'Parts of the route cross areas the live model marks as wet. '}
                      This is already the safest available path — proceed carefully and follow responders.
                    </span>
                  </div>
                ) : (
                  <div className="rp-route-ok">
                    <span className="rp-type-dot" style={{ background: '#16A34A' }} />
                    Route is clear of flagged flooding right now.
                  </div>
                )}
              </section>
            ) : selected && (
              <section className="rp-section">
                <h3 className="rp-section-title">Recommended Safe Route</h3>
                <div className="rp-type-note">
                  <span className="rp-type-dot" style={{ background: color }} />
                  {selected.name}
                </div>
                <div className="rp-metrics" style={{ marginTop: 10 }}>
                  <div className="rp-metric">
                    <div className="rp-metric-val">{(selected.points || []).length}</div>
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
                        onClick={() => { setSelectedId(r.id); setGen(null) }}
                        title="Show on map"
                        style={!showGen && selected?.id === r.id ? { background: '#fef2f2', borderRadius: 8 } : undefined}
                      >
                        <span className="rp-saved-name">{r.name}</span>
                        <span className="rp-saved-meta">
                          {ROUTE_TYPES[r.type]?.label || 'Route'} · {formatDistance(pathLengthMeters(activeRouteGeometry(r)))}
                          {r.active === 'override' && r.override?.length > 1 ? ' · rerouted' : ''}
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
function PinIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
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
