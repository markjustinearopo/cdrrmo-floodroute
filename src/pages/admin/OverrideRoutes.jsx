import { useEffect, useMemo, useState } from 'react'
import { usePersistedState } from '../../utils/usePersistedState.js'
import { MapContainer, TileLayer, ZoomControl, Polyline, Marker } from 'react-leaflet'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../../components/admin/mapHelpers.jsx'
import {
  ROUTE_TYPES,
  ClickToAddWaypoint,
  waypointIcon,
  pathLengthMeters,
  formatDistance,
  routeGeometry,
  RoadNetworkLayer,
  useCabuyaoRoads,
  useRoadStatus,
  useTrafficStatus,
} from '../../components/admin/routingHelpers.jsx'
import { useRouteGraph, planRoute, DEFAULT_BETA } from '../../components/admin/routeEngine.js'
import { useFloodRisk } from '../../components/admin/floodRisk.js'
import { useSavedRoutes } from '../../context/AdminDataContext.jsx'
import './OverrideRoutes.css'

const OVERRIDE_COLOR = '#B8860B' // gold — distinct from any route-type colour

/**
 * CDRRMO Admin — Override Routes.
 *
 * The admin selects a saved route and manually re-draws it — typically to
 * detour around roads flagged Flooded/Closed on the Road Status screen, which
 * are overlaid here as live hazards. The planned route shows as a dashed
 * "ghost"; the admin's override draws as a solid gold line. The admin chooses
 * which version is active for dispatch.
 *
 * This is the MANUAL override. The automatic flood-aware re-route that would
 * generate this detour on its own is a separate algorithmic study and is shown
 * only as a disabled "coming soon" control.
 */
export default function OverrideRoutes() {
  const [routes, { updateRoute }] = useSavedRoutes()
  const { roads } = useCabuyaoRoads() // hazard overlay + the auto-reroute graph
  const graph = useRouteGraph(roads)
  const { field } = useFloodRisk()
  const [roadStatus] = useRoadStatus()
  const [trafficMap] = useTrafficStatus()

  const [selectedId, setSelectedId] = useState(null)
  const [override, setOverride] = useState([]) // [[lat,lng], …]
  const [overrideAuto, setOverrideAuto] = useState(false) // auto-detour vs hand-drawn
  const [showHazards, setShowHazards] = usePersistedState('cdrrmo-layers-admin-override-hazards', false)
  const [coords, setCoords] = useState(null)
  const [toast, setToast] = useState('')

  const selected = routes.find((r) => r.id === selectedId) || null

  // When a route is chosen, seed the editor from any saved override.
  useEffect(() => {
    if (selected) {
      setOverride(selected.override || [])
      setOverrideAuto(Boolean(selected.overrideAuto))
    } else {
      setOverride([])
      setOverrideAuto(false)
    }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hazard overlay: only the roads flagged on the Road Status screen.
  const hazardRoads = useMemo(() => {
    if (!roads) return null
    const ids = new Set(Object.keys(roadStatus))
    if (ids.size === 0) return null
    return {
      type: 'FeatureCollection',
      features: roads.features.filter((f) => ids.has(String(f.properties.id))),
    }
  }, [roads, roadStatus])

  const hazardCount = Object.keys(roadStatus).length

  function flash(msg) {
    setToast(msg)
    window.clearTimeout(flash._t)
    flash._t = window.setTimeout(() => setToast(''), 2200)
  }

  function addPoint(latlng) {
    if (!selected) return flash('Select a route to override first.')
    setOverride((p) => [...p, latlng])
  }
  function movePoint(i, latlng) {
    setOverride((p) => p.map((pt, idx) => (idx === i ? latlng : pt)))
  }
  function removePoint(i) {
    setOverride((p) => p.filter((_, idx) => idx !== i))
  }
  function startFromPlanned() {
    if (selected) {
      setOverride(routeGeometry(selected).map((p) => [...p]))
      setOverrideAuto(false)
    }
  }

  /**
   * Auto-reroute: regenerate this route's path along the OpenStreetMap network
   * while strongly avoiding the roads flagged Flooded/Closed on Road Status and
   * the flood-prone areas in the live risk field — the automatic version of the
   * detour the admin would otherwise draw by hand. Routes through the planned
   * route's own waypoints so the override still visits the same key points.
   */
  function autoReroute() {
    if (!selected) return flash('Select a route to re-route first.')
    if (!graph || graph.size === 0) return flash('Road network unavailable — try again shortly.')
    const waypoints = selected.points?.length >= 2 ? selected.points : routeGeometry(selected)
    if (!waypoints || waypoints.length < 2) return flash('This route has no endpoints to re-route.')

    // High avoidance weight: take a meaningful detour to stay out of the water.
    // Traffic weighs in for vehicle routes; an on-foot evacuation ignores it.
    const beta = selected.type === 'evacuation' ? 0 : DEFAULT_BETA
    const opts = { riskAt: field?.riskAt, statusMap: roadStatus, trafficMap, alpha: 14, beta }
    let line = []
    let gaps = 0
    for (let i = 1; i < waypoints.length; i++) {
      const seg = planRoute(graph, waypoints[i - 1], waypoints[i], opts)
      const piece = seg.ok ? seg.safe.coords : [waypoints[i - 1], waypoints[i]]
      if (!seg.ok) gaps++
      line = line.length === 0 ? piece.slice() : line.concat(piece.slice(1))
    }
    setOverride(line)
    setOverrideAuto(true)
    flash(
      gaps
        ? `Auto-detour drawn · ${gaps} gap${gaps > 1 ? 's' : ''} kept straight.`
        : 'Auto-detour drawn around flooded / closed roads.',
    )
  }

  function saveOverride() {
    if (!selected) return
    if (override.length < 2) return flash('Draw at least two points for the override.')
    updateRoute(selected.id, { override, overrideAuto, active: 'override' })
    flash(overrideAuto ? 'Auto-detour saved & set active.' : 'Override saved & set active.')
  }
  function clearOverride() {
    if (!selected) return
    setOverride([])
    setOverrideAuto(false)
    updateRoute(selected.id, { override: [], overrideAuto: false, active: 'planned' })
    flash('Reverted to planned route.')
  }
  function setActive(version) {
    if (!selected) return
    updateRoute(selected.id, { active: version })
  }

  const plannedGeom = selected ? routeGeometry(selected) : []
  const plannedAnchors = selected?.points || []
  const plannedDist = pathLengthMeters(plannedGeom)
  const overrideDist = pathLengthMeters(override)
  const activeVersion = selected?.active || 'planned'

  function ovrKind(i) {
    if (i === 0) return 'start'
    if (i === override.length - 1 && override.length > 1) return 'end'
    return 'ovr'
  }
  function ovrLabel(i) {
    if (i === 0) return 'A'
    if (i === override.length - 1 && override.length > 1) return 'B'
    return String(i)
  }

  return (
    <AdminLayout mainClassName="main--flush">
      <div className="override-routes">
        {/* ── Toolbar ── */}
        <div className="ov-toolbar">
          <div className="ov-title">
            <ShuffleIcon />
            <span>Override Routes</span>
            <span className="ov-badge">Manual</span>
          </div>

          <div className="ov-toolbar-right">
            <label className="ov-hazard-toggle" title="Show roads flagged on Road Status">
              <input
                type="checkbox"
                checked={showHazards}
                onChange={(e) => setShowHazards(e.target.checked)}
              />
              <span className="ov-switch" />
              Road hazards
              {hazardCount > 0 && <span className="ov-hazard-count">{hazardCount}</span>}
            </label>
            <button
              type="button"
              className="ov-auto-btn"
              onClick={autoReroute}
              disabled={!selected}
              title="Auto-detour around flooded / closed roads (OpenStreetMap · Flood Hub · Windy)"
            >
              <SparkIcon /> Auto-reroute
            </button>
          </div>
        </div>

        {/* ── Body: map + panel ── */}
        <div className="ov-body">
          <div className="ov-map-area">
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              className="ov-leaflet"
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.8} />
              <ZoomControl position="bottomright" />
              <CabuyaoLock />

              {/* Live hazard overlay (flagged roads from Road Status) */}
              {showHazards && hazardRoads && (
                <RoadNetworkLayer roads={hazardRoads} statusMap={roadStatus} interactive={false} />
              )}

              <ClickToAddWaypoint onAdd={addPoint} enabled={Boolean(selected) && !overrideAuto} />

              {/* Planned route — dashed ghost (follows roads for auto routes) */}
              {selected && plannedGeom.length > 1 && (
                <>
                  <Polyline
                    positions={plannedGeom}
                    pathOptions={{
                      color: ROUTE_TYPES[selected.type]?.color || '#1a2a4a',
                      weight: 4,
                      opacity: activeVersion === 'planned' ? 0.9 : 0.4,
                      dashArray: '2 9',
                      lineCap: 'round',
                    }}
                  />
                  {plannedAnchors.length > 1 &&
                    [plannedAnchors[0], plannedAnchors[plannedAnchors.length - 1]].map((pt, i) => (
                      <Marker key={`pl-${i}`} position={pt} icon={waypointIcon(i === 0 ? 'A' : 'B', i === 0 ? 'start' : 'end')} />
                    ))}
                </>
              )}

              {/* Override route — solid gold */}
              {override.length > 1 && (
                <>
                  <Polyline positions={override} pathOptions={{ color: OVERRIDE_COLOR, weight: 11, opacity: 0.2, lineCap: 'round' }} />
                  <Polyline
                    positions={override}
                    pathOptions={{ color: OVERRIDE_COLOR, weight: 4.5, opacity: activeVersion === 'override' ? 1 : 0.55, lineCap: 'round' }}
                  />
                </>
              )}
              {/* Hand-drawn overrides expose every point as a draggable pin; an
                  auto-detour follows hundreds of road vertices, so it shows only
                  its A/B endpoints to keep the map responsive. */}
              {overrideAuto
                ? override.length > 1 &&
                  [override[0], override[override.length - 1]].map((pt, i) => (
                    <Marker key={`ova-${i}`} position={pt} icon={waypointIcon(i === 0 ? 'A' : 'B', i === 0 ? 'start' : 'end')} />
                  ))
                : override.map((pt, i) => (
                    <Marker
                      key={`ov-${i}`}
                      position={pt}
                      icon={waypointIcon(ovrLabel(i), ovrKind(i))}
                      draggable
                      eventHandlers={{
                        dragend: (e) => {
                          const ll = e.target.getLatLng()
                          movePoint(i, [ll.lat, ll.lng])
                        },
                      }}
                    />
                  ))}

              <CoordReadout onChange={setCoords} />
            </MapContainer>

            {!selected && (
              <div className="ov-hint">
                <ShuffleIcon />
                <span>Select a route to override</span>
                <small>Pick a saved route on the right, then click the map to draw a manual detour</small>
              </div>
            )}
            {selected && override.length === 0 && (
              <div className="ov-hint ov-hint--top">
                <CursorIcon />
                <span>Click the map to draw the override path</span>
                <small>Or press “Copy planned” to start from the original route</small>
              </div>
            )}

            <div className="ov-coords">
              {coords
                ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E | Zoom: ${coords.zoom}`
                : 'No map data'}
            </div>

            {/* Map key */}
            <div className="ov-key">
              <span className="ov-key-item"><span className="ov-key-line ov-key-line--planned" /> Planned</span>
              <span className="ov-key-item"><span className="ov-key-line ov-key-line--override" /> Override</span>
            </div>
          </div>

          {/* ── Right panel ── */}
          <aside className="ov-panel">
            {/* Route picker */}
            <section className="ov-section">
              <h3 className="ov-section-title">
                Select Route
                {routes.length > 0 && <span className="ov-pill">{routes.length}</span>}
              </h3>
              {routes.length === 0 ? (
                <div className="ov-empty">
                  No saved routes yet. Create one on the <b>Route Planning</b> screen first.
                </div>
              ) : (
                <ul className="ov-route-list">
                  {routes.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className={`ov-route ${selectedId === r.id ? 'active' : ''}`}
                        onClick={() => setSelectedId(r.id)}
                      >
                        <span className="ov-route-dot" style={{ background: ROUTE_TYPES[r.type]?.color }} />
                        <span className="ov-route-text">
                          <span className="ov-route-name">{r.name}</span>
                          <span className="ov-route-meta">
                            {ROUTE_TYPES[r.type]?.label} · {formatDistance(pathLengthMeters(routeGeometry(r)))}
                            {r.source === 'auto' ? ' · auto' : ''}
                          </span>
                        </span>
                        {r.override?.length > 1 && (
                          <span className={`ov-route-tag ${r.active === 'override' ? 'on' : ''}`}>OVR</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {selected && (
              <>
                {/* Active version toggle */}
                <section className="ov-section">
                  <h3 className="ov-section-title">Active Version</h3>
                  <div className="ov-version-seg">
                    <button
                      type="button"
                      className={`ov-version ${activeVersion === 'planned' ? 'active' : ''}`}
                      onClick={() => setActive('planned')}
                    >
                      Planned
                    </button>
                    <button
                      type="button"
                      className={`ov-version ${activeVersion === 'override' ? 'active' : ''}`}
                      onClick={() => setActive('override')}
                      disabled={!(selected.override?.length > 1)}
                      title={selected.override?.length > 1 ? '' : 'Save an override first'}
                    >
                      Override
                    </button>
                  </div>
                </section>

                {/* Distance comparison */}
                <section className="ov-section">
                  <h3 className="ov-section-title">Comparison</h3>
                  <div className="ov-compare">
                    <div className="ov-compare-row">
                      <span className="ov-compare-dot planned" />
                      <span className="ov-compare-lbl">Planned</span>
                      <span className="ov-compare-val">{formatDistance(plannedDist)}</span>
                    </div>
                    <div className="ov-compare-row">
                      <span className="ov-compare-dot override" />
                      <span className="ov-compare-lbl">Override</span>
                      <span className="ov-compare-val">
                        {override.length > 1 ? formatDistance(overrideDist) : '--'}
                      </span>
                    </div>
                    {override.length > 1 && (
                      <div className="ov-delta">
                        {overrideDist >= plannedDist ? '+' : '−'}
                        {formatDistance(Math.abs(overrideDist - plannedDist))} vs planned
                      </div>
                    )}
                  </div>
                </section>

                {/* Override editor */}
                <section className="ov-section ov-section--grow">
                  <div className="ov-editor-head">
                    <h3 className="ov-section-title">
                      Override Path
                      {override.length > 0 && <span className="ov-pill">{override.length}</span>}
                    </h3>
                    <div className="ov-editor-tools">
                      <button
                        type="button"
                        className="ov-mini"
                        onClick={() => setOverride((p) => p.slice(0, -1))}
                        disabled={!override.length || overrideAuto}
                      >
                        Undo
                      </button>
                      <button type="button" className="ov-mini" onClick={startFromPlanned}>
                        Copy planned
                      </button>
                    </div>
                  </div>
                  {override.length === 0 ? (
                    <div className="ov-empty">
                      Click the map to add detour points around the hazards, or press
                      <b> Auto-reroute</b> to draw one automatically.
                    </div>
                  ) : overrideAuto ? (
                    <div className="ov-empty">
                      Auto-detour following <b>{override.length}</b> road points around flooded / closed
                      roads. Save it, or press <b>Copy planned</b> to edit by hand.
                    </div>
                  ) : (
                    <ul className="ov-points">
                      {override.map((pt, i) => (
                        <li className="ov-point" key={i}>
                          <span className={`ov-point-badge ${ovrKind(i)}`}>{ovrLabel(i)}</span>
                          <span className="ov-point-coords">{pt[0].toFixed(4)}, {pt[1].toFixed(4)}</span>
                          <button type="button" className="ov-point-x" onClick={() => removePoint(i)} title="Remove point">×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* Actions */}
                <section className="ov-section ov-actions">
                  <button type="button" className="ov-save" onClick={saveOverride} disabled={override.length < 2}>
                    <SaveIcon /> Save Override
                  </button>
                  <button type="button" className="ov-revert" onClick={clearOverride}>
                    Use planned route
                  </button>
                </section>
              </>
            )}
          </aside>
        </div>

        <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    </AdminLayout>
  )
}

/* ── Icons ──────────────────────────────────────────────────────────────── */
function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
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
function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  )
}
function CursorIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    </svg>
  )
}
