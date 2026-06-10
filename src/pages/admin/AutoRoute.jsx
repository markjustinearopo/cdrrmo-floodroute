import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MapContainer,
  TileLayer,
  ZoomControl,
  Polyline,
  Marker,
  Rectangle,
  CircleMarker,
  Tooltip,
} from 'react-leaflet'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../../components/admin/mapHelpers.jsx'
import {
  ROUTE_TYPES,
  ClickToAddWaypoint,
  waypointIcon,
  formatDistance,
  formatDriveEta,
  formatWalkEta,
  RoadNetworkLayer,
  useCabuyaoRoads,
  useRoadStatus,
  useRoutes,
} from '../../components/admin/routingHelpers.jsx'
import { useRouteGraph, planRoute, planToNearestSafe, DEFAULT_ALPHA } from '../../components/admin/routeEngine.js'
import {
  useFloodRisk,
  riskColor,
  riskLevel,
  RISK_LEVEL_META,
  NEUTRAL_FIELD,
} from '../../components/admin/floodRisk.js'
import { SAMPLE_EVAC_CENTERS } from '../../data/cabuyao.js'
import './AutoRoute.css'

const SHORTEST_COLOR = '#94A3B8' // slate — the "fastest" comparison ghost

/**
 * CDRRMO Admin — Auto Route.
 *
 * The automatic, flood-aware route suggestion the rest of the routing
 * suite previously left as a "coming soon" control. It is the meeting
 * point of the three feeds the Conceptual Framework names:
 *
 *   • OpenStreetMap      → the routable road network (Overpass), turned
 *     into a graph by routeEngine and searched with a flood-weighted A*.
 *   • Google Flood Hub   → per-location inundation risk (river discharge +
 *     low-elevation susceptibility) from floodRisk, painted as a heat
 *     overlay and used to weight every road segment.
 *   • Windy.com          → live rainfall/wind that drives that risk field.
 *
 * The admin drops an origin and a destination — or just an origin and lets
 * the engine pick the safest reachable evacuation centre — and the screen
 * generates the lowest-risk drivable path, compares it with the plain
 * shortest path, explains the trade-off, and saves it into the shared route
 * store so it flows on to Route Planning and Override Routes.
 */
export default function AutoRoute() {
  const { roads, loading: roadsLoading, error: roadsError, retry } = useCabuyaoRoads()
  const graph = useRouteGraph(roads)
  const { field, loading: fieldLoading, refresh: refreshField } = useFloodRisk()
  const [statusMap] = useRoadStatus()
  const [, { addRoute }] = useRoutes()

  const live = field || NEUTRAL_FIELD

  // ── Trip definition ──
  const [type, setType] = useState('evacuation')
  const [mode, setMode] = useState('nearest') // 'nearest' | 'points'
  const [start, setStart] = useState(null) // [lat, lng]
  const [goal, setGoal] = useState(null) // [lat, lng] (points mode)
  const [alpha, setAlpha] = useState(DEFAULT_ALPHA)

  // ── Result + overlays ──
  const [plan, setPlan] = useState(null)
  const [chosenCentre, setChosenCentre] = useState(null)
  const [showRisk, setShowRisk] = useState(true)
  const [showHazards, setShowHazards] = useState(true)
  const [showCentres, setShowCentres] = useState(true)
  const [showFastest, setShowFastest] = useState(true)

  const [name, setName] = useState('')
  const [coords, setCoords] = useState(null)
  const [toast, setToast] = useState('')

  const color = ROUTE_TYPES[type].color
  const openCentres = useMemo(
    () => SAMPLE_EVAC_CENTERS.filter((c) => c.coords && c.status !== 'closed'),
    [],
  )

  // Keep start/goal in refs so the map-click handler always sees fresh values.
  const stateRef = useRef({ mode, start, goal })
  stateRef.current = { mode, start, goal }

  function flash(msg) {
    setToast(msg)
    window.clearTimeout(flash._t)
    flash._t = window.setTimeout(() => setToast(''), 2400)
  }

  // Any edit to the trip invalidates the last result.
  function resetResult() {
    setPlan(null)
    setChosenCentre(null)
  }

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

  // Hazard overlay (roads flagged on Road Status), like Override Routes.
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

  const routeOpts = useMemo(
    () => ({ riskAt: live.riskAt, statusMap, alpha }),
    [live, statusMap, alpha],
  )

  function generate() {
    if (!graph || graph.size === 0) {
      return flash(roadsLoading ? 'Road network still loading…' : 'Road network unavailable.')
    }
    if (!start) return flash('Click the map to set the starting point.')

    if (mode === 'nearest') {
      const result = planToNearestSafe(graph, start, openCentres, routeOpts)
      if (!result) return flash('No evacuation centre is reachable from here on the mapped network.')
      setChosenCentre(result.centre)
      setGoal(result.centre.coords)
      setPlan(result.plan)
      setName(`${ROUTE_TYPES[type].label} → ${result.centre.name}`)
      flash(`Routed to ${result.centre.name}.`)
      return
    }

    // points mode
    if (!goal) return flash('Click the map to set the destination.')
    const result = planRoute(graph, start, goal, routeOpts)
    if (!result.ok) {
      const why = {
        'no-path': 'No drivable path between those points (they may be on disconnected roads).',
        'too-close': 'Start and destination snap to the same road node — move them apart.',
        'no-network': 'Road network unavailable.',
      }
      return flash(why[result.reason] || 'Could not generate a route.')
    }
    setChosenCentre(null)
    setPlan(result)
    setName(`${ROUTE_TYPES[type].label} Auto Route`)
    flash('Flood-aware route generated.')
  }

  function clearAll() {
    setStart(null)
    setGoal(null)
    resetResult()
    setName('')
  }

  function save() {
    if (!plan?.ok) return flash('Generate a route before saving.')
    const finalName = name.trim() || `${ROUTE_TYPES[type].label} Auto Route`
    const anchors = [plan.start, chosenCentre ? chosenCentre.coords : plan.goal]
    addRoute({
      name: finalName,
      type,
      points: anchors, // A/B anchors — edit on Route Planning
      path: plan.safe.coords, // road-following geometry
      source: 'auto',
      destination: chosenCentre?.name || null,
      meanRisk: Number(plan.safe.meanRisk.toFixed(3)),
    })
    flash(`Saved "${finalName}" — find it on Route Planning & Override Routes.`)
  }

  // Drag handlers keep the result honest by invalidating it on move.
  function dragStart(latlng) {
    setStart(latlng)
    resetResult()
  }
  function dragGoal(latlng) {
    setGoal(latlng)
    resetResult()
  }

  const safe = plan?.ok ? plan.safe : null
  const fast = plan?.ok ? plan.fast : null
  const etaLabel = type === 'evacuation' ? 'Walk ETA' : 'Drive ETA'
  const etaValue = safe ? (type === 'evacuation' ? formatWalkEta(safe.distanceM) : formatDriveEta(safe.distanceM)) : '--'
  const lvl = safe ? riskLevel(safe.meanRisk) : 'low'

  const cautionLabel =
    alpha <= 2 ? 'Shortest first' : alpha <= 6 ? 'Balanced' : alpha <= 11 ? 'Avoid flooding' : 'Maximum avoidance'

  return (
    <AdminLayout mainClassName="main--flush">
      <div className="auto-route">
        {/* ── Toolbar ── */}
        <div className="ar-toolbar">
          <div className="ar-title">
            <SparkIcon />
            <span>Auto Route</span>
            <span className="ar-badge">Flood-aware</span>
          </div>

          <div className="ar-type-seg">
            {Object.entries(ROUTE_TYPES).map(([key, t]) => (
              <button
                key={key}
                type="button"
                className={`ar-type ${type === key ? 'active' : ''}`}
                style={type === key ? { '--seg': t.color } : undefined}
                onClick={() => setType(key)}
              >
                <span className="ar-type-dot" style={{ background: t.color }} />
                {t.label}
              </button>
            ))}
          </div>

          <div className="ar-sources" title="Live data feeds powering the route">
            <SourceChip label="Flood Hub" on={live.meta.sources.floodHub} />
            <SourceChip label="Windy" on={live.meta.sources.windy} />
            <SourceChip label="OSM" on={Boolean(roads)} />
          </div>
        </div>

        {/* ── Body: map + panel ── */}
        <div className="ar-body">
          <div className="ar-map-area">
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

              {/* Flood-risk heat overlay (Flood Hub × Windy field) */}
              {showRisk &&
                live.cells.map((cell) => (
                  <Rectangle
                    key={cell.key}
                    bounds={cell.bounds}
                    pathOptions={{
                      stroke: false,
                      fillColor: riskColor(cell.risk),
                      fillOpacity: 0.07 + 0.32 * cell.risk,
                      interactive: false,
                    }}
                  />
                ))}

              {/* Live road hazards flagged on Road Status */}
              {showHazards && hazardRoads && (
                <RoadNetworkLayer roads={hazardRoads} statusMap={statusMap} interactive={false} />
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

              {/* Safe (recommended) route */}
              {safe && (
                <>
                  <Polyline positions={safe.coords} pathOptions={{ color, weight: 12, opacity: 0.22, lineCap: 'round' }} />
                  <Polyline positions={safe.coords} pathOptions={{ color, weight: 4.5, opacity: 0.97, lineCap: 'round' }} />
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

            {/* Overlays: loading / error / hint */}
            {roadsLoading && (
              <div className="ar-overlay">
                <span className="ar-spinner" />
                <span>Loading Cabuyao road network…</span>
                <small>Fetching live roads from OpenStreetMap (Overpass)</small>
              </div>
            )}
            {roadsError && !roadsLoading && (
              <div className="ar-overlay">
                <WarnIcon />
                <span>Couldn't load the road network</span>
                <small>The Overpass map service may be busy. Please try again.</small>
                <button type="button" className="ar-retry" onClick={retry}>Retry</button>
              </div>
            )}
            {!roadsLoading && !roadsError && !start && (
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

              <div className="ar-toggles">
                <Toggle label="Flood-risk heat" on={showRisk} onChange={() => setShowRisk((v) => !v)} />
                <Toggle label={`Road hazards${hazardCount ? ` (${hazardCount})` : ''}`} on={showHazards} onChange={() => setShowHazards((v) => !v)} />
                <Toggle label="Evac centres" on={showCentres} onChange={() => setShowCentres((v) => !v)} />
                <Toggle label="Show shortest" on={showFastest} onChange={() => setShowFastest((v) => !v)} />
              </div>
            </section>

            {/* Generate */}
            <section className="ar-section ar-generate">
              <button type="button" className="ar-go" onClick={generate} disabled={roadsLoading || !start}>
                <SparkIcon /> Generate Route
              </button>
              {(start || goal) && (
                <button type="button" className="ar-clear" onClick={clearAll}>Clear</button>
              )}
            </section>

            {/* Result */}
            {safe && (
              <section className="ar-section">
                <h3 className="ar-section-title">Recommended Route</h3>
                <div className="ar-metrics">
                  <Metric value={formatDistance(safe.distanceM)} label="Distance" />
                  <Metric value={etaValue} label={etaLabel} />
                  <Metric
                    value={`${Math.round(safe.meanRisk * 100)}%`}
                    label="Flood Risk"
                    accent={RISK_LEVEL_META[lvl].color}
                  />
                </div>

                <div className={`ar-riskline ${lvl}`}>
                  <span className="ar-riskdot" style={{ background: RISK_LEVEL_META[lvl].color }} />
                  {RISK_LEVEL_META[lvl].label} flood exposure along this route
                  {safe.floodedSegments > 0 && (
                    <b>&nbsp;· {safe.floodedSegments} flagged segment{safe.floodedSegments > 1 ? 's' : ''}</b>
                  )}
                </div>

                {/* Safest vs shortest */}
                <div className="ar-compare">
                  {plan.identical ? (
                    <div className="ar-compare-note">Already the shortest path — no safer detour was needed.</div>
                  ) : (
                    <>
                      <div className="ar-compare-row">
                        <span className="ar-compare-dot" style={{ background: color }} /> Safest
                        <span className="ar-compare-val">{formatDistance(safe.distanceM)}</span>
                      </div>
                      <div className="ar-compare-row">
                        <span className="ar-compare-dot" style={{ background: SHORTEST_COLOR }} /> Shortest
                        <span className="ar-compare-val">{formatDistance(fast.distanceM)}</span>
                      </div>
                      <div className="ar-compare-delta">
                        +{formatDistance(plan.detourM)} detour to cut exposure from{' '}
                        <b>{Math.round(fast.meanRisk * 100)}%</b> → <b>{Math.round(safe.meanRisk * 100)}%</b>
                      </div>
                    </>
                  )}
                </div>
              </section>
            )}

            {/* Why this route — feed readout */}
            <section className="ar-section">
              <h3 className="ar-section-title">Conditions</h3>
              <div className="ar-feeds">
                <FeedRow
                  label="Rainfall"
                  src="Windy"
                  value={live.meta.precip != null ? `${live.meta.precip.toFixed(1)} mm/h` : '--'}
                />
                <FeedRow
                  label="River discharge"
                  src="Flood Hub"
                  value={live.meta.discharge != null ? `${live.meta.discharge.toFixed(1)} m³/s` : '--'}
                />
                <FeedRow
                  label="Elevation range"
                  src="Flood Hub"
                  value={
                    live.meta.minElev != null
                      ? `${Math.round(live.meta.minElev)}–${Math.round(live.meta.maxElev)} m`
                      : '--'
                  }
                />
                <FeedRow label="Flagged roads" src="CDRRMO" value={`${hazardCount}`} />
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
        </div>

        <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    </AdminLayout>
  )
}

/* ── Small building blocks ───────────────────────────────────────────────── */
function SourceChip({ label, on }) {
  return (
    <span className={`ar-src ${on ? 'on' : ''}`} title={on ? `${label}: live` : `${label}: offline`}>
      <span className="ar-src-dot" />
      {label}
    </span>
  )
}

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

function Metric({ value, label, accent }) {
  return (
    <div className="ar-metric">
      <div className="ar-metric-val" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="ar-metric-lbl">{label}</div>
    </div>
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
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
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
function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
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
