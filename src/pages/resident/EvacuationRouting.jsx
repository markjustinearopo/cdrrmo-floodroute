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
import { useRouteGraph, planRoute, planToNearestSafe, DEFAULT_ALPHA } from '../../components/admin/routeEngine.js'
import { useFloodRisk, barangayRiskSamples } from '../../components/admin/floodRisk.js'
import '../../components/map/mapUpgrade.css'
import { MapViewToggle, use3DPreference } from '../../components/admin/Map3D.jsx'
import RouteSketch3DView from '../../components/admin/RouteSketch3DView.jsx'
import { evacPinIcon } from '../../components/admin/EvacLocationPicker.jsx'
import { useGeolocation } from '../../hooks/useGeolocation.js'
import { usePersistedState } from '../../utils/usePersistedState.js'
import { useEvacCenters, barangayCoords } from '../../context/AdminDataContext.jsx'
import MapSearchBar from '../../components/map/MapSearchBar.jsx'
import SearchResultLayer from '../../components/map/SearchResultLayer.jsx'
import { buildLocalIndex } from '../../components/map/searchTools.js'
import { getResidentBarangay, residentBarangayLabel } from '../../data/resident.js'
import { usableShelters } from '../../data/shelters.js'
import LiveNavigation from '../../components/resident/LiveNavigation.jsx'
import RoutingGuide, { hasSeenRoutingGuide } from '../../components/resident/RoutingGuide.jsx'
import * as speech from '../../services/speech.js'
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

  /* Search matters more here than anywhere: a resident routing to safety may
     be starting from a relative's house or a workplace rather than the pin
     they saved, and the fastest way to say where that is, is to name it. */
  const [searchResult, setSearchResult] = useState(null)
  const localIndex = useMemo(
    () => buildLocalIndex({ evacCenters: evacuationCenters }),
    [evacuationCenters],
  )

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
  /* Persisted: someone who is the family member that helps a grandparent
     evacuate is that person every time, and re-ticking this during the next
     typhoon is not a thing to ask of them. */
  const [slowerMobility, setSlowerMobility] = usePersistedState('cdrrmo-res-slow-pace', false)

  /* Guided navigation. `navSession` is the route actually being walked — it is
     planned fresh from a live GPS fix at the moment "Start" is pressed, not
     reused from the preview above, because the preview may have been generated
     from a pin the resident set twenty minutes and two streets ago. */
  const [navSession, setNavSession] = useState(null)
  const [starting, setStarting] = useState(false)
  // The walkthrough opens by itself the first time, and stays one tap away.
  const [guideOpen, setGuideOpen] = useState(() => !hasSeenRoutingGuide())
  const routerLoc = useLocation()
  const autoDestRef = useRef(null) // guards the one-shot "Directions" auto-route

  /**
   * Begin guided navigation.
   *
   * Order matters here. speech.prime() has to run inside the tap itself —
   * mobile browsers only unlock audio from a real user gesture, and awaiting
   * the GPS fix first breaks that chain, leaving a navigator that silently
   * never speaks. Everything slow happens after.
   */
  async function startNavigation() {
    speech.prime()
    setGenMsg('')
    if (!graph || graph.size === 0) return setGenMsg('Road network unavailable.')

    // Where are we going? The shelter the generated route picked, else the end
    // of whichever published route is on screen.
    let dest = null
    if (gen?.centre?.coords) {
      dest = { id: gen.centre.id, name: gen.centre.name, barangay: gen.centre.barangay, coords: gen.centre.coords }
    } else if (points.length > 1) {
      // A published route's endpoint is a place, not the route itself —
      // "Arrive at Evacuation Route 2" tells the walker nothing about where
      // they are standing when they get there.
      dest = {
        name: selected?.name ? `the end of ${selected.name}` : 'your route destination',
        coords: points[points.length - 1],
      }
    } else {
      return setGenMsg('Generate a safe route first, then start guided navigation.')
    }

    setStarting(true)
    let start = origin
    try {
      const c = await locate()
      setPin({ lat: c.lat, lng: c.lng })
      start = [c.lat, c.lng]
    } catch {
      /* No fix (indoors, permission denied): fall back to the pin they set. The
         navigator will keep asking for a fix on its own once it opens. */
    }
    setStarting(false)
    if (!start) return setGenMsg('Pin your location first, then start guided navigation.')

    const plan = planRoute(graph, start, dest.coords, {
      riskAt: field?.riskAt, statusMap, alpha: DEFAULT_ALPHA, compare: false,
    })
    if (!plan?.ok || plan.safe.coords.length < 2) {
      return setGenMsg('No route from your location to that shelter right now. Try another centre or call CDRRMO.')
    }
    setNavSession({ coords: plan.safe.coords, segments: plan.safe.segments, destination: dest })
  }

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
    /* Same eligibility rules as the dashboard card (src/data/shelters.js):
       'open' is an operator-set flag, so a centre at 499/500 still carries it.
       Routing someone across a flooded city to a building that cannot take
       them is the failure this filter exists to prevent. */
    let candidates = usableShelters(evacuationCenters).filter((c) => Array.isArray(c.coords))
    if (targetId) {
      // An explicit tap overrides the filter — if a resident deliberately
      // chooses a centre, route them there and let the badge warn them.
      const t = evacuationCenters.find((c) => c.id === targetId && Array.isArray(c.coords))
      if (t) candidates = [t]
    }
    if (candidates.length === 0) {
      return setGenMsg('No evacuation centre has space right now. Call your barangay hall or 911.')
    }
    const best = planToNearestSafe(graph, origin, candidates, {
      riskAt: field?.riskAt,
      statusMap,
      alpha: DEFAULT_ALPHA,
    })
    if (!best) return setGenMsg('No reachable open evacuation centre right now.')
      setSelectedId(null)
    setGen({
      coords: best.plan.safe.coords,
      segments: best.plan.safe.segments,
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
          {/* Caption, not a control: there is only one routing mode here. The
              --note modifier gives the pill the inner spacing the buttons
              would normally have brought with them. */}
          <div className="rp-type-seg rp-type-seg--note">
            <span className="rp-type-note">
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
            <button
              type="button"
              className="rp-btn rp-btn--nav"
              onClick={startNavigation}
              disabled={starting || points.length < 2}
              title="Follow this route live, with spoken turn-by-turn directions"
            >
              <NavIcon /> {starting ? 'Getting GPS…' : 'Start guided navigation'}
            </button>
            {showGen && (
              <button type="button" className="rp-btn" onClick={() => setGen(null)}>
                Clear
              </button>
            )}
            <button
              type="button"
              className="rp-btn rp-btn--help"
              onClick={() => setGuideOpen(true)}
              title="How to use evacuation routing"
            >
              <HelpIcon /> How to use
            </button>
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

              <SearchResultLayer result={searchResult} />
              <CoordReadout onChange={setCoords} />
            </MapContainer>
            )}

            {/* 2D only — the result layer draws through Leaflet. */}
            {!use3D && <MapSearchBar localIndex={localIndex} onSelect={setSearchResult} />}

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
                    {/* Paced off this route's OWN flood exposure, not a flat
                        5 km/h. The engine already knows the path wades; the
                        person walking it should not find that out en route. */}
                    <div className="rp-metric-val">
                      {points.length > 1
                        ? formatWalkEta(distance, { meanRisk: gen.meanRisk, slowerMobility })
                        : '--'}
                    </div>
                    <div className="rp-metric-lbl">Walk ETA</div>
                  </div>
                </div>
                <label className="rp-mobility">
                  <input
                    type="checkbox"
                    checked={slowerMobility}
                    onChange={(e) => setSlowerMobility(e.target.checked)}
                  />
                  Walking with a child, an elderly person, or slowly
                </label>
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
                {/* "Stops" used to sit here, showing (selected.points).length
                    — the number of vertices in the drawn polyline. That is a
                    geometry artifact: a straighter road produces fewer points,
                    and none of them are places anyone stops. It read as real
                    information next to two numbers that are, so it is gone
                    rather than relabelled. */}
                <div className="rp-metrics" style={{ marginTop: 10 }}>
                  <div className="rp-metric">
                    <div className="rp-metric-val">{formatDistance(distance)}</div>
                    <div className="rp-metric-lbl">Distance</div>
                  </div>
                  <div className="rp-metric">
                    <div className="rp-metric-val">
                      {points.length > 1 ? formatWalkEta(distance, { slowerMobility }) : '--'}
                    </div>
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

      {/* First-run walkthrough — opens by itself once, reopenable from the
          toolbar. */}
      <RoutingGuide open={guideOpen} onClose={() => setGuideOpen(false)} />

      {/* Guided navigation takes over the whole screen while it runs. */}
      {navSession && (
        <LiveNavigation
          open
          graph={graph}
          riskAt={field?.riskAt}
          statusMap={statusMap}
          destination={navSession.destination}
          initialCoords={navSession.coords}
          initialSegments={navSession.segments}
          onExit={() => setNavSession(null)}
        />
      )}
    </ResidentLayout>
  )
}

function NavIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  )
}
function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
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
