import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePersistedState } from '../../../utils/usePersistedState.js'
import { MapContainer, TileLayer, ZoomControl, Polyline, Marker, CircleMarker, Tooltip } from 'react-leaflet'
import ConfirmDialog from '../../ConfirmDialog.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../mapHelpers.jsx'
import {
  ROUTE_TYPES,
  ClickToAddWaypoint,
  waypointIcon,
  RoadNetworkLayer,
  useRoadStatus,
  useTrafficStatus,
} from '../routingHelpers.jsx'
import { planRoute, planToNearestSafe, DEFAULT_ALPHA, DEFAULT_BETA } from '../routeEngine.js'
import { barangayRiskSamples, projectedRoadStatus } from '../floodRisk.js'
import { liveThresholds } from '../../../services/systemConfig.js'
import { BarangayRiskLayer, InundationGrid } from '../BarangayRiskLayer.jsx'
import Map3D from '../Map3D.jsx'
import {
  addInundationLayer,
  addBarangayLayers,
  setBarangayVisibility,
  setMapLayerVisible,
  updateBarangayData,
  updateInundationData,
  addHazardRoadsLayer,
  updateHazardRoadsData,
  addCityBoundary,
  addNoahHazardLayer,
  setNoahVisible,
} from '../mapbox3dHelpers.js'
import {
  useMap3DSetup,
  addRouteLine3D,
  setRouteLine3D,
  startFlowDash3D,
  syncWaypoints3D,
  addEvacCentres3D,
  updateEvacCentres3D,
  setChosenCentre3D,
  clickedEvacCentre3D,
  playRouteReveal3D,
} from '../routing3d.js'
import { useEvacCenters, useSavedRoutes } from '../../../context/AdminDataContext.jsx'
import RouteResultPanel, { SHORTEST_COLOR } from '../RouteResultPanel.jsx'

/**
 * Routing → Generate (was the Auto Route page).
 *
 * Drop an origin and a destination — or just an origin and let the engine pick
 * the safest reachable evacuation centre — and the flood-weighted A* returns
 * the lowest-risk drivable path, compared against the plain shortest path.
 *
 * The "avoid this road" control on the result panel feeds excluded roads back
 * into the solve as blocked, which is what Override Routes' auto-reroute did
 * on its own screen; here it is a constraint on the route in front of you.
 */
export default function GenerateTab({ shared, onToast }) {
  const { roads, graph, live, baselineField, fieldLoading, refreshField, use3D, type, setType, isForecast, forecastHour } = shared
  const [statusMap] = useRoadStatus()
  const [trafficMap] = useTrafficStatus()
  const [, { addRoute }] = useSavedRoutes()
  const { evacuationCenters } = useEvacCenters()

  const riskSamples = useMemo(() => barangayRiskSamples(live), [live])

  // ── Trip definition ──
  const [mode, setMode] = useState('nearest') // 'nearest' | 'points'
  const [start, setStart] = useState(null) // [lat, lng]
  const [goal, setGoal] = useState(null) // [lat, lng] (points mode)
  const [alpha, setAlpha] = useState(DEFAULT_ALPHA)
  // Roads the operator excluded from the result panel: name → wayIds[]
  const [avoided, setAvoided] = useState(() => new Map())
  // Off by default, and it stays off by default. See the toggle's note.
  const [projectClosures, setProjectClosures] = useState(false)

  // ── Result + overlays ──
  const [plan, setPlan] = useState(null)
  const [chosenCentre, setChosenCentre] = useState(null)
  const [showRisk, setShowRisk] = usePersistedState('cdrrmo-layers-admin-autoroute-risk', false)
  const [showHazards, setShowHazards] = usePersistedState('cdrrmo-layers-admin-autoroute-hazards', false)
  const [showCentres, setShowCentres] = usePersistedState('cdrrmo-layers-admin-autoroute-centres', false)
  const [showFastest, setShowFastest] = usePersistedState('cdrrmo-layers-admin-autoroute-fastest', false)
  const [showTraffic, setShowTraffic] = usePersistedState('cdrrmo-layers-admin-autoroute-traffic', false)

  const [name, setName] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [coords, setCoords] = useState(null)

  const color = ROUTE_TYPES[type].color
  // Destinations = the shared store's open centres (city-wide), so Generate
  // targets the same evacuation centres shown on every other map.
  const openCentres = useMemo(
    () => evacuationCenters.filter((c) => Array.isArray(c.coords) && c.status !== 'closed'),
    [evacuationCenters],
  )

  // Keep start/goal in refs so the map-click handler always sees fresh values.
  const stateRef = useRef({ mode, start, goal })
  stateRef.current = { mode, start, goal }

  // Any edit to the trip invalidates the last result.
  const resetResult = useCallback(() => {
    setPlan(null)
    setChosenCentre(null)
  }, [])

  function handleMapClick(latlng) {
    const { mode: m, start: s, goal: g } = stateRef.current
    resetResult()
    if (m === 'nearest') {
      setStart(latlng)
      return
    }
    // points mode: fill start, then goal, then restart.
    if (!s || (s && g)) {
      setStart(latlng)
      setGoal(null)
    } else {
      setGoal(latlng)
    }
  }

  // Hazard overlay (roads flagged on Road Status).
  const hazardRoads = useMemo(() => {
    if (!roads) return null
    const ids = new Set(Object.keys(statusMap))
    if (ids.size === 0) return null
    return {
      type: 'FeatureCollection',
      features: roads.features.filter((f) => ids.has(String(f.properties.id))),
    }
  }, [roads, statusMap])
  const hazardCount = Object.keys(statusMap).length

  // Congested roads overlay (painted on Road Status → Traffic), shown with the
  // navigation-style ramp on its own toggle so it never muddles the flood layer.
  const trafficRoads = useMemo(() => {
    if (!roads) return null
    const ids = new Set(Object.keys(trafficMap))
    if (ids.size === 0) return null
    return {
      type: 'FeatureCollection',
      features: roads.features.filter((f) => ids.has(String(f.properties.id))),
    }
  }, [roads, trafficMap])
  const trafficCount = Object.keys(trafficMap).length

  /* Roads the MODEL expects to be under water at the scrubbed hour.

     This is the only thing that actually moves a route across a forecast: rain
     falls on the whole city at once, so it raises every road's cost together
     and the engine returns the same path looking worse. A road crossing from
     passable to not is a step, and steps reroute.

     It is opt-in and stays that way. The model is uncalibrated — nothing in
     this system has been checked against a measured flood — and thresholding a
     smooth estimate turns a soft number into a hard claim about a named street.
     The operator gets to see how many roads it wants to flag before deciding
     whether to believe it. */
  const projectedClosures = useMemo(() => {
    if (!isForecast || !projectClosures || !roads || !baselineField) return null
    // Against the live field, so this is the roads the forecast ADDS.
    return projectedRoadStatus(roads, live, liveThresholds().high, baselineField)
  }, [isForecast, projectClosures, roads, live, baselineField])
  const projectedCount = projectedClosures ? Object.keys(projectedClosures).length : 0

  // Operator-excluded roads join the solve as blocked, exactly like a road
  // flagged Closed on Road Status — same mechanism, different author.
  const effectiveStatus = useMemo(() => {
    if (avoided.size === 0 && !projectedClosures) return statusMap
    // Projected first so an operator's own flag always wins over the model.
    const next = { ...projectedClosures, ...statusMap }
    for (const wayIds of avoided.values()) for (const id of wayIds) next[id] = 'blocked'
    return next
  }, [statusMap, avoided, projectedClosures])

  // Traffic only weighs on VEHICLE routes — evacuation is on foot, so
  // car congestion neither detours nor slows it (β = 0). Convoy/response
  // routes drive, so they steer around jams (β = DEFAULT_BETA).
  const beta = type === 'evacuation' ? 0 : DEFAULT_BETA
  const routeOpts = useMemo(
    () => ({ riskAt: live.riskAt, statusMap: effectiveStatus, trafficMap, alpha, beta }),
    [live, effectiveStatus, trafficMap, alpha, beta],
  )

  // Which hazard field the route currently on screen was solved against.
  // Compared by identity, so a scrub (or a feed refresh) is detectable.
  const liveRef = useRef(live)
  liveRef.current = live
  const solvedFieldRef = useRef(null)

  const solve = useCallback((opts) => {
    solvedFieldRef.current = liveRef.current
    if (!graph || graph.size === 0) {
      onToast('Road network unavailable.')
      return null
    }
    const { mode: m, start: s, goal: g } = stateRef.current
    if (!s) {
      onToast('Click the map to set the starting point.')
      return null
    }
    if (m === 'nearest') {
      const result = planToNearestSafe(graph, s, openCentres, opts)
      if (!result) {
        onToast('No evacuation centre is reachable from here on the mapped network.')
        return null
      }
      setChosenCentre(result.centre)
      setGoal(result.centre.coords)
      setPlan(result.plan)
      setName(`${ROUTE_TYPES[type].label} → ${result.centre.name}`)
      return result.centre.name
    }
    if (!g) {
      onToast('Click the map to set the destination.')
      return null
    }
    const result = planRoute(graph, s, g, opts)
    if (!result.ok) {
      const why = {
        'no-path': 'No drivable path between those points (they may be on disconnected roads).',
        'too-close': 'Start and destination snap to the same road node — move them apart.',
        'no-network': 'Road network unavailable.',
      }
      onToast(why[result.reason] || 'Could not generate a route.')
      return null
    }
    setChosenCentre(null)
    setPlan(result)
    setName(`${ROUTE_TYPES[type].label} Auto Route`)
    return 'points'
  }, [graph, openCentres, type, onToast])

  /* The route has to describe the hour the scrubber is pointing at. Leaving a
     route on screen that was solved against a different hour would be the worst
     kind of wrong here — it looks current and is not — so moving the clock
     re-solves it. This is also the demo: drag, and the line moves. */
  useEffect(() => {
    if (!plan?.ok) return
    if (solvedFieldRef.current === live) return
    solve(routeOpts)
  }, [live, plan, routeOpts, solve])

  function generate() {
    const outcome = solve(routeOpts)
    if (outcome === 'points') onToast('Flood-aware route generated.')
    else if (outcome) onToast(`Routed to ${outcome}.`)
  }

  /* ── Avoid a road: exclude it and immediately re-solve around it ──
     Some stretches cannot be avoided at all — the first and last legs into a
     destination usually have no alternative — and then the solve fails. The
     exclusion is only committed once a route actually comes back, so the
     panel can never claim to be avoiding a road the displayed route still
     drives down. */
  function reSolveWith(next, roadName, successMsg, failMsg) {
    const blocked = { ...statusMap }
    for (const ids of next.values()) for (const id of ids) blocked[id] = 'blocked'
    const outcome = solve({ ...routeOpts, statusMap: blocked })
    if (!outcome) {
      onToast(failMsg)
      return false
    }
    setAvoided(next)
    onToast(successMsg)
    return true
  }

  function avoidRoad(wayIds, roadName) {
    if (!wayIds?.length) return onToast('That stretch has no road id to exclude.')
    const next = new Map(avoided)
    next.set(roadName, wayIds)
    reSolveWith(
      next,
      roadName,
      `Re-routed around ${roadName}.`,
      `No route avoids ${roadName} — it is the only way through, so the route is unchanged.`,
    )
  }

  function unavoidRoad(_wayIds, roadName) {
    const next = new Map(avoided)
    next.delete(roadName)
    reSolveWith(
      next,
      roadName,
      `${roadName} is available again.`,
      `Could not re-route with ${roadName} allowed again.`,
    )
  }

  function clearAll() {
    setStart(null)
    setGoal(null)
    resetResult()
    setName('')
    setAvoided(new Map())
    setConfirmClear(false)
  }

  function save() {
    if (!plan?.ok) return onToast('Generate a route before saving.')
    const finalName = name.trim() || `${ROUTE_TYPES[type].label} Auto Route`
    const anchors = [plan.start, chosenCentre ? chosenCentre.coords : plan.goal]
    addRoute({
      name: finalName,
      type,
      points: anchors, // A/B anchors — edit on the Draw tab
      path: plan.safe.coords, // road-following geometry
      source: 'auto',
      destination: chosenCentre?.name || null,
      meanRisk: Number(plan.safe.meanRisk.toFixed(3)),
    })
    onToast(`Saved "${finalName}" — find it on the Saved tab.`)
  }

  // Drag handlers keep the result honest by invalidating it on move.
  const dragStart = useCallback((latlng) => { setStart(latlng); resetResult() }, [resetResult])
  const dragGoal = useCallback((latlng) => { setGoal(latlng); resetResult() }, [resetResult])

  const safe = plan?.ok ? plan.safe : null
  const fast = plan?.ok ? plan.fast : null

  const cautionLabel =
    alpha <= 2 ? 'Shortest first' : alpha <= 6 ? 'Balanced' : alpha <= 11 ? 'Avoid flooding' : 'Maximum avoidance'

  /* The legacy `.auto-route` wrapper stays so AutoRoute.css keeps matching —
     the tab bodies were lifted out of the old pages unchanged. */
  return (
    <div className="auto-route rt-pane">
    <div className="ar-body">
      <div className="ar-map-area">
        {use3D ? (
          /* The same trip, overlays and interactions on the Mapbox terrain
             map — 2D ⇄ 3D is a view preference, never a data change. */
          <Generate3DView
            live={live}
            riskSamples={riskSamples}
            roads={roads}
            statusMap={statusMap}
            openCentres={openCentres}
            chosenCentre={chosenCentre}
            plan={plan}
            color={color}
            start={start}
            goal={goal}
            mode={mode}
            showRisk={showRisk}
            showHazards={showHazards}
            showCentres={showCentres}
            showFastest={showFastest}
            onMapClick={handleMapClick}
            onDragStart={dragStart}
            onDragGoal={dragGoal}
            onViewChange={setCoords}
          />
        ) : (
          <MapContainer
            center={CABUYAO_CENTER}
            zoom={CABUYAO_ZOOM}
            zoomControl={false}
            attributionControl={false}
            className="ar-leaflet"
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.8} />
            <ZoomControl position="bottomright" />
            <CabuyaoLock />

            {/* Flood-risk context, clipped to the REAL barangay polygons exactly
                like the Flood Map — never bleeds into Laguna de Bay, and stays
                light so the route remains the loudest thing on the map. */}
            {showRisk && (
              <>
                <BarangayRiskLayer samples={riskSamples} opacity={0.35} interactive={false} />
                <InundationGrid field={live} opacity={0.4} />
              </>
            )}

            {/* Live road hazards flagged on Road Status */}
            {showHazards && hazardRoads && (
              <RoadNetworkLayer roads={hazardRoads} statusMap={statusMap} interactive={false} />
            )}

            {/* Live traffic congestion (Road Status → Traffic board) */}
            {showTraffic && trafficRoads && (
              <RoadNetworkLayer roads={trafficRoads} trafficMap={trafficMap} view="traffic" interactive={false} />
            )}

            {/* Evacuation centres */}
            {showCentres &&
              openCentres.map((c) => {
                const isChosen = chosenCentre?.id === c.id
                return (
                  <CircleMarker
                    key={c.id}
                    center={c.coords}
                    radius={isChosen ? 9 : 6}
                    pathOptions={{
                      color: '#fff',
                      weight: 2,
                      fillColor: isChosen ? '#1A7A4A' : '#2A9D6A',
                      fillOpacity: 1,
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -6]}>
                      <b>{c.name}</b>
                      <br />
                      {c.barangay} · cap. {c.capacity}
                    </Tooltip>
                  </CircleMarker>
                )
              })}

            <ClickToAddWaypoint onAdd={handleMapClick} />

            {/* Shortest comparison ghost */}
            {fast && showFastest && !plan.identical && (
              <Polyline
                positions={fast.coords}
                pathOptions={{ color: SHORTEST_COLOR, weight: 4, opacity: 0.85, dashArray: '3 8', lineCap: 'round' }}
              />
            )}

            {/* Safe (recommended) route: halo + core + a flowing white dash
                that animates A→B so the direction of travel reads at a glance */}
            {safe && (
              <>
                <Polyline positions={safe.coords} pathOptions={{ color, weight: 12, opacity: 0.22, lineCap: 'round' }} />
                <Polyline positions={safe.coords} pathOptions={{ color, weight: 4.5, opacity: 0.97, lineCap: 'round' }} />
                <Polyline
                  positions={safe.coords}
                  pathOptions={{
                    color: '#fff',
                    weight: 2,
                    opacity: 0.9,
                    dashArray: '1 14',
                    lineCap: 'round',
                    className: 'ar-flow',
                    interactive: false,
                  }}
                />
              </>
            )}

            {/* A / B markers */}
            {start && (
              <Marker
                position={start}
                icon={waypointIcon('A', 'start')}
                draggable
                eventHandlers={{ dragend: (e) => dragStart([e.target.getLatLng().lat, e.target.getLatLng().lng]) }}
              />
            )}
            {mode === 'points' && goal && (
              <Marker
                position={goal}
                icon={waypointIcon('B', 'end')}
                draggable
                eventHandlers={{ dragend: (e) => dragGoal([e.target.getLatLng().lat, e.target.getLatLng().lng]) }}
              />
            )}
            {mode === 'nearest' && chosenCentre && (
              <Marker position={chosenCentre.coords} icon={waypointIcon('B', 'end')} />
            )}

            <CoordReadout onChange={setCoords} />
          </MapContainer>
        )}

        {!start && (
          <div className="ar-hint">
            <CursorIcon />
            <span>Click the map to drop your starting point</span>
            <small>
              {mode === 'nearest'
                ? 'The engine routes to the safest reachable evacuation centre'
                : 'Then click again to set the destination'}
            </small>
          </div>
        )}

        <div className="ar-coords">
          {coords
            ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E | Zoom: ${coords.zoom}`
            : 'No map data'}
        </div>

        {/* Map key */}
        <div className="ar-key">
          <span className="ar-key-item"><span className="ar-key-line" style={{ background: color }} /> Safest</span>
          <span className="ar-key-item"><span className="ar-key-line ar-key-line--dash" /> Shortest</span>
          <span className="ar-key-item"><span className="ar-key-dot" /> Evac centre</span>
        </div>
      </div>

      {/* ── Right panel ── */}
      <aside className="ar-panel">
        {/* Trip */}
        <section className="ar-section">
          <h3 className="ar-section-title">Destination</h3>
          <div className="ar-mode-seg">
            <button
              type="button"
              className={`ar-mode ${mode === 'nearest' ? 'active' : ''}`}
              onClick={() => { setMode('nearest'); setGoal(null); resetResult() }}
            >
              Nearest safe centre
            </button>
            <button
              type="button"
              className={`ar-mode ${mode === 'points' ? 'active' : ''}`}
              onClick={() => { setMode('points'); resetResult() }}
            >
              Point to point
            </button>
          </div>

          <div className="ar-endpoints">
            <EndpointRow kind="start" label="Origin" value={start} placeholder="Click map to set origin" />
            <EndpointRow
              kind="end"
              label={mode === 'nearest' ? 'Evac centre' : 'Destination'}
              value={mode === 'nearest' ? chosenCentre?.coords : goal}
              placeholder={mode === 'nearest' ? 'Auto-selected on generate' : 'Click map to set destination'}
              caption={mode === 'nearest' ? chosenCentre?.name : null}
            />
          </div>
        </section>

        {/* Avoidance controls */}
        <section className="ar-section">
          <div className="ar-caution-head">
            <h3 className="ar-section-title">Flood Avoidance</h3>
            <span className="ar-caution-val">{cautionLabel}</span>
          </div>
          <input
            type="range"
            min="0"
            max="16"
            value={alpha}
            onChange={(e) => { setAlpha(Number(e.target.value)); resetResult() }}
            className="ar-range"
          />
          <div className="ar-range-ends"><span>Shortest</span><span>Safest</span></div>

          {isForecast && projectClosures && (
            <div className="ar-forecast-note">
              <b>{projectedCount.toLocaleString()}</b> road{projectedCount === 1 ? '' : 's'} the model
              expects to go under between now and this hour — where projected depth crosses{' '}
              {liveThresholds().high} m having been below it now. Roads already over that line
              are left out: that is standing terrain, not something this forecast does.
              This is an uncalibrated estimate, not a survey, and projected roads are costed
              as flooded rather than closed, so the engine will still route through one if
              there is no alternative.
            </div>
          )}

          <div className="ar-toggles">
            {isForecast && (
              <Toggle
                label={`Project road closures${projectedCount ? ` (${projectedCount})` : ''}`}
                on={projectClosures}
                onChange={() => setProjectClosures((v) => !v)}
              />
            )}
            <Toggle label="Flood-risk heat" on={showRisk} onChange={() => setShowRisk((v) => !v)} />
            <Toggle label={`Road hazards${hazardCount ? ` (${hazardCount})` : ''}`} on={showHazards} onChange={() => setShowHazards((v) => !v)} />
            <Toggle label={`Live traffic${trafficCount ? ` (${trafficCount})` : ''}`} on={showTraffic} onChange={() => setShowTraffic((v) => !v)} />
            <Toggle label="Evac centres" on={showCentres} onChange={() => setShowCentres((v) => !v)} />
            <Toggle label="Show shortest" on={showFastest} onChange={() => setShowFastest((v) => !v)} />
          </div>
        </section>

        {/* Generate */}
        <section className="ar-section ar-generate">
          <button type="button" className="ar-go" onClick={generate} disabled={!start}>
            <SparkIcon /> Generate Route
          </button>
          {(start || goal) && (
            <button type="button" className="ar-clear" onClick={() => setConfirmClear(true)}>Clear</button>
          )}
        </section>

        {/* Result — the shared panel, with avoid-a-road wired to the solve */}
        {safe && (
          <section className="ar-section">
            <h3 className="ar-section-title">
              {isForecast ? 'Projected Route' : 'Recommended Route'}
            </h3>
            {isForecast && (
              <div className="ar-forecast-note">
                Solved against the modelled hazard at{' '}
                <b>{forecastHour ? `${forecastHour.dayLabel} ${forecastHour.label}` : 'a future hour'}</b>.
                Roads flagged by hand on Road Status are treated as still flagged then —
                the model projects the weather, not an operator's next decision.
              </div>
            )}
            <RouteResultPanel
              plan={plan}
              color={color}
              walkEta={type === 'evacuation'}
              avoided={avoided}
              onAvoid={avoidRoad}
              onUnavoid={unavoidRoad}
            />
          </section>
        )}

        {/* Why this route — feed readout */}
        <section className="ar-section">
          <h3 className="ar-section-title">Conditions</h3>
          <div className="ar-feeds">
            <FeedRow
              label="Rainfall"
              src="Open-Meteo"
              value={live.meta.precip != null ? `${live.meta.precip.toFixed(1)} mm/h` : '--'}
            />
            <FeedRow
              label="River discharge"
              src="Open-Meteo"
              value={live.meta.discharge != null ? `${live.meta.discharge.toFixed(1)} m³/s` : '--'}
            />
            <FeedRow
              label="Elevation range"
              src="Open-Meteo"
              value={
                live.meta.minElev != null
                  ? `${Math.round(live.meta.minElev)}–${Math.round(live.meta.maxElev)} m`
                  : '--'
              }
            />
            <FeedRow label="Flagged roads" src="CDRRMO" value={`${hazardCount}`} />
            <FeedRow
              label="Road network"
              src="OSM"
              value={roads ? `${roads.features.length.toLocaleString()} streets` : '--'}
            />
          </div>
          <button type="button" className="ar-refresh" onClick={refreshField} disabled={fieldLoading}>
            {fieldLoading ? 'Refreshing…' : 'Refresh feeds'}
          </button>
        </section>

        {/* Save */}
        {safe && (
          <section className="ar-section ar-save-sec">
            <label className="ar-field">
              <span>Save as</span>
              <input type="text" value={name} placeholder="Route name…" onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="button" className="ar-save" onClick={save}>
              <SaveIcon /> Save Route
            </button>
          </section>
        )}
      </aside>

      {confirmClear && (
        <ConfirmDialog
          title="Clear this route?"
          tone="danger"
          confirmLabel="Clear route"
          message={safe
            ? 'The start point, destination and the generated route will be discarded. Save it first if you want to keep it.'
            : 'The start point and destination will be discarded.'}
          onConfirm={clearAll}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
    </div>
  )
}

/* ── 3D map view (Mapbox GL) ─────────────────────────────────────────────── */
/**
 * The Map3D-backed Generate map: the SAME risk context (barangay fills +
 * inundation honeycomb), flagged-road hazards, evacuation centres, safe/fast
 * route pair (with the flowing direction dash) and draggable A/B pins as the
 * Leaflet view. Generating a route plays the fly-along reveal: the safe line
 * draws itself A→B under the camera.
 */
function Generate3DView({
  live,
  riskSamples,
  roads,
  statusMap,
  openCentres,
  chosenCentre,
  plan,
  color,
  start,
  goal,
  mode,
  showRisk,
  showHazards,
  showCentres,
  showFastest,
  onMapClick,
  onDragStart,
  onDragGoal,
  onViewChange,
}) {
  const pinsRef = useRef(new Map())
  const stopFlowRef = useRef(null)

  // Live values for the one-time load callback.
  const initRef = useRef({})
  initRef.current = { live, riskSamples, roads, statusMap, showRisk, showHazards, showCentres, openCentres, color }

  const { onMapLoad, mapRef, ready } = useMap3DSetup((map) => {
    const v = initRef.current
    // NOAH hazard zones ride the same "Flood-risk heat" toggle as the rest of
    // the flood context — off by default so the route + roads stay legible.
    addNoahHazardLayer(map, { visible: v.showRisk })
    addInundationLayer(map, v.live, 0.4, v.showRisk)
    addBarangayLayers(map, v.riskSamples, 0.35)
    setBarangayVisibility(map, { fills: v.showRisk, markers: false })
    addCityBoundary(map)
    addHazardRoadsLayer(map, v.roads, v.statusMap, v.showHazards)
    addEvacCentres3D(map, v.openCentres, { visible: v.showCentres })
    // Shortest "ghost" under the safe line, exactly like the 2D dash pair.
    addRouteLine3D(map, 'route-fast', { color: SHORTEST_COLOR, halo: false, width: 4, dash: [0.4, 1.8], opacity: 0.85 })
    addRouteLine3D(map, 'route-safe', { color: v.color, flow: true })
    stopFlowRef.current = startFlowDash3D(map, 'route-safe-flow')
  })

  useEffect(
    () => () => {
      stopFlowRef.current?.()
      stopFlowRef.current = null
    },
    [],
  )

  // Fresh risk field → re-feed the context layers.
  useEffect(() => {
    if (ready && mapRef.current) {
      updateBarangayData(mapRef.current, riskSamples)
      updateInundationData(mapRef.current, live)
    }
  }, [riskSamples, live, ready, mapRef])

  // Road hazards follow the shared statusMap.
  useEffect(() => {
    if (ready && mapRef.current) updateHazardRoadsData(mapRef.current, roads, statusMap)
  }, [roads, statusMap, ready, mapRef])

  // Layer toggles.
  useEffect(() => {
    if (!ready || !mapRef.current) return
    setBarangayVisibility(mapRef.current, { fills: showRisk, markers: false })
    setMapLayerVisible(mapRef.current, 'inundation-fill', showRisk)
    setNoahVisible(mapRef.current, showRisk)
  }, [showRisk, ready, mapRef])
  useEffect(() => {
    if (ready && mapRef.current) setMapLayerVisible(mapRef.current, 'hazard-roads', showHazards)
  }, [showHazards, ready, mapRef])
  useEffect(() => {
    if (ready && mapRef.current) setMapLayerVisible(mapRef.current, 'evac-centres-3d', showCentres)
  }, [showCentres, ready, mapRef])
  // Live centre list (add / edit / remove from the shared store).
  useEffect(() => {
    if (ready && mapRef.current) updateEvacCentres3D(mapRef.current, openCentres)
  }, [openCentres, ready, mapRef])

  // New plan → the generation animation: the safe line draws itself A→B with
  // the camera riding its tip, then pulls back to frame the route; the
  // shortest "ghost" appears once the reveal lands. Clearing the plan clears
  // both lines.
  const lastPlanRef = useRef(null)
  const cancelRevealRef = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || lastPlanRef.current === plan) return
    lastPlanRef.current = plan
    cancelRevealRef.current?.()
    cancelRevealRef.current = null
    const safe = plan?.ok ? plan.safe.coords : null
    const fast = plan?.ok && !plan.identical ? plan.fast.coords : null
    if (!safe) {
      setRouteLine3D(map, 'route-safe', null)
      setRouteLine3D(map, 'route-fast', null)
      return
    }
    setRouteLine3D(map, 'route-fast', null) // ghost waits for the reveal
    const cancel = playRouteReveal3D(map, 'route-safe', safe, {
      onDone: () => {
        cancelRevealRef.current = null
        setRouteLine3D(map, 'route-fast', fast)
      },
    })
    cancelRevealRef.current = cancel
  }, [plan, ready, mapRef])

  useEffect(
    () => () => {
      cancelRevealRef.current?.()
    },
    [],
  )

  // "Show shortest" toggle (the line also stays hidden until its data lands).
  useEffect(() => {
    if (ready && mapRef.current) setMapLayerVisible(mapRef.current, 'route-fast-core', showFastest)
  }, [showFastest, ready, mapRef])

  // Route colour follows the trip type.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !map.getLayer('route-safe-core')) return
    map.setPaintProperty('route-safe-core', 'line-color', color)
    map.setPaintProperty('route-safe-halo', 'line-color', color)
  }, [color, ready, mapRef])

  // A/B pins (drag keeps the same invalidate-on-move contract as 2D).
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const pins = []
    if (start) pins.push({ key: 'A', latlng: start, label: 'A', kind: 'start', draggable: true, onDragEnd: onDragStart })
    if (mode === 'points' && goal) {
      pins.push({ key: 'B-pt', latlng: goal, label: 'B', kind: 'end', draggable: true, onDragEnd: onDragGoal })
    }
    if (mode === 'nearest' && chosenCentre) {
      pins.push({ key: 'B-ctr', latlng: chosenCentre.coords, label: 'B', kind: 'end' })
    }
    syncWaypoints3D(map, pinsRef.current, pins)
  }, [start, goal, mode, chosenCentre, ready, mapRef, onDragStart, onDragGoal])

  // Chosen-centre highlight.
  useEffect(() => {
    if (ready && mapRef.current) setChosenCentre3D(mapRef.current, openCentres, chosenCentre?.id)
  }, [chosenCentre, openCentres, ready, mapRef])

  return (
    <Map3D
      basemap="navigation"
      onMapLoad={onMapLoad}
      onViewChange={onViewChange}
      onMapClick={(lngLat, e) => {
        const map = mapRef.current
        if (map && clickedEvacCentre3D(map, e)) return // dot click ≠ waypoint drop
        onMapClick([lngLat.lat, lngLat.lng])
      }}
    />
  )
}

/* ── Small building blocks ───────────────────────────────────────────────── */
function EndpointRow({ kind, label, value, placeholder, caption }) {
  return (
    <div className="ar-endpoint">
      <span className={`ar-endpoint-badge ${kind}`}>{kind === 'start' ? 'A' : 'B'}</span>
      <span className="ar-endpoint-text">
        <span className="ar-endpoint-lbl">{label}</span>
        {value ? (
          <span className="ar-endpoint-val">
            {caption ? `${caption} · ` : ''}
            {value[0].toFixed(4)}, {value[1].toFixed(4)}
          </span>
        ) : (
          <span className="ar-endpoint-ph">{placeholder}</span>
        )}
      </span>
    </div>
  )
}

function Toggle({ label, on, onChange }) {
  return (
    <label className="ar-toggle">
      <span className={`ar-toggle-sw ${on ? 'on' : ''}`}>
        <input type="checkbox" checked={on} onChange={onChange} />
        <span className="ar-toggle-knob" />
      </span>
      {label}
    </label>
  )
}

function FeedRow({ label, src, value }) {
  return (
    <div className="ar-feed">
      <span className="ar-feed-lbl">{label}</span>
      <span className="ar-feed-val">{value}</span>
      <span className="ar-feed-src">{src}</span>
    </div>
  )
}

/* ── Icons ───────────────────────────────────────────────────────────────── */
function SparkIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
}
function CursorIcon() {
  return <svg viewBox="0 0 24 24"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /></svg>
}
function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  )
}
