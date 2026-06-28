import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, Polyline, Marker } from 'react-leaflet'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../../components/admin/mapHelpers.jsx'
import {
  ROUTE_TYPES,
  ClickToAddWaypoint,
  waypointIcon,
  pathLengthMeters,
  formatDistance,
  formatWalkEta,
  routeGeometry,
  useCabuyaoRoads,
  useRoadStatus,
  useTrafficStatus,
} from '../../components/admin/routingHelpers.jsx'
import { useRouteGraph, planRoute, DEFAULT_ALPHA, DEFAULT_BETA } from '../../components/admin/routeEngine.js'
import { useFloodRisk } from '../../components/admin/floodRisk.js'
import { useSavedRoutes } from '../../context/AdminDataContext.jsx'
import './RoutePlanning.css'

/**
 * CDRRMO Admin — Route Planning.
 *
 * The admin authors evacuation / relief / response routes by clicking on the
 * Cabuyao map to drop ordered stops; the stops are connected into a route the
 * admin can drag, trim and name, then save. This is the MANUAL side of routing
 * specified for the system — the automatic, flood-aware route suggestion is a
 * separate algorithmic study and is intentionally left as a disabled
 * "coming soon" control here.
 *
 * Saved routes persist client-side (localStorage via routingHelpers) so they
 * survive a refresh and appear on the Override Routes screen, standing in for
 * the backend save endpoint until the API is wired in.
 */
export default function RoutePlanning() {
  const [routes, { addRoute, removeRoute }] = useSavedRoutes()
  const { roads, loading: roadsLoading } = useCabuyaoRoads()
  const graph = useRouteGraph(roads)
  const { field } = useFloodRisk()
  const [statusMap] = useRoadStatus()
  const [trafficMap] = useTrafficStatus()

  // ── Draft route being drawn on the map ──
  const [type, setType] = useState('evacuation')
  const [name, setName] = useState('')
  const [points, setPoints] = useState([]) // ordered stops [[lat, lng], …]
  const [path, setPath] = useState(null) // road-following geometry once auto-suggested
  const [coords, setCoords] = useState(null)
  const [toast, setToast] = useState('')

  const color = ROUTE_TYPES[type].color
  // The drawn line follows roads once Auto-suggest has run, else the raw stops.
  const geometry = path && path.length > 1 ? path : points
  const distance = useMemo(() => pathLengthMeters(geometry), [geometry])

  function flash(msg) {
    setToast(msg)
    window.clearTimeout(flash._t)
    flash._t = window.setTimeout(() => setToast(''), 2200)
  }

  // Editing the stops invalidates any previously snapped road path.
  function addPoint(latlng) {
    setPoints((p) => [...p, latlng])
    setPath(null)
  }

  function movePoint(i, latlng) {
    setPoints((p) => p.map((pt, idx) => (idx === i ? latlng : pt)))
    setPath(null)
  }

  function removePoint(i) {
    setPoints((p) => p.filter((_, idx) => idx !== i))
    setPath(null)
  }

  function undo() {
    setPoints((p) => p.slice(0, -1))
    setPath(null)
  }

  function clearDraft() {
    setPoints([])
    setPath(null)
    setName('')
  }

  /**
   * Auto-suggest: snap the manually-dropped stops onto the OpenStreetMap road
   * network and connect them with flood-aware shortest paths (the same engine
   * the Auto Route screen uses). Each consecutive pair is routed to avoid
   * flagged/flood-prone segments; any unreachable pair keeps its straight link
   * so the route is never left broken.
   */
  function autoSuggest() {
    if (points.length < 2) return flash('Drop at least two stops, then Auto-suggest.')
    if (!graph || graph.size === 0) {
      return flash(roadsLoading ? 'Road network still loading…' : 'Road network unavailable.')
    }
    // Vehicle routes (relief/response) steer around congestion; on-foot
    // evacuation ignores car traffic (β = 0).
    const beta = type === 'evacuation' ? 0 : DEFAULT_BETA
    const opts = { riskAt: field?.riskAt, statusMap, trafficMap, alpha: DEFAULT_ALPHA, beta }
    let line = []
    let gaps = 0
    for (let i = 1; i < points.length; i++) {
      const seg = planRoute(graph, points[i - 1], points[i], opts)
      const piece = seg.ok ? seg.safe.coords : [points[i - 1], points[i]]
      if (!seg.ok) gaps++
      line = line.length === 0 ? piece.slice() : line.concat(piece.slice(1))
    }
    setPath(line)
    flash(
      gaps
        ? `Snapped to roads · ${gaps} gap${gaps > 1 ? 's' : ''} kept straight.`
        : 'Snapped to roads, steering around flood-prone segments.',
    )
  }

  function save() {
    if (points.length < 2) return flash('Add at least two stops to save a route.')
    const finalName = name.trim() || `${ROUTE_TYPES[type].label} Route ${routes.length + 1}`
    const saved = { name: finalName, type, points }
    if (path && path.length > 1) saved.path = path
    addRoute(saved)
    flash(`Saved "${finalName}".`)
    clearDraft()
  }

  function loadRoute(r) {
    setType(r.type)
    setName(r.name)
    setPoints(r.points)
    setPath(r.path && r.path.length > 1 ? r.path : null)
    flash(`Loaded "${r.name}" for editing.`)
  }

  function pinKind(i) {
    if (i === 0) return 'start'
    if (i === points.length - 1 && points.length > 1) return 'end'
    return 'mid'
  }

  function pinLabel(i) {
    if (i === 0) return 'A'
    if (i === points.length - 1 && points.length > 1) return 'B'
    return String(i)
  }

  return (
    <AdminLayout mainClassName="main--flush">
      <div className="route-plan">
        {/* ── Toolbar ── */}
        <div className="rp-toolbar">
          <div className="rp-title">
            <TargetIcon />
            <span>Route Planning</span>
          </div>

          <div className="rp-type-seg">
            {Object.entries(ROUTE_TYPES).map(([key, t]) => (
              <button
                key={key}
                type="button"
                className={`rp-type ${type === key ? 'active' : ''}`}
                style={type === key ? { '--seg': t.color } : undefined}
                onClick={() => setType(key)}
              >
                <span className="rp-type-dot" style={{ background: t.color }} />
                {t.label}
              </button>
            ))}
          </div>

          <div className="rp-tools">
            <button type="button" className="rp-btn" onClick={undo} disabled={!points.length}>
              <UndoIcon /> Undo
            </button>
            <button type="button" className="rp-btn" onClick={clearDraft} disabled={!points.length}>
              <TrashIcon /> Clear
            </button>
            <button
              type="button"
              className={`rp-btn rp-btn--auto ${path ? 'on' : ''}`}
              onClick={autoSuggest}
              disabled={points.length < 2 || roadsLoading}
              title="Snap the stops to roads and avoid flood-prone segments (OpenStreetMap · Flood Hub · Windy)"
            >
              <SparkIcon /> {roadsLoading ? 'Loading roads…' : 'Auto-suggest'}
            </button>
          </div>
        </div>

        {/* ── Map + panel ── */}
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
              <ClickToAddWaypoint onAdd={addPoint} />

              {/* Route line: a soft halo under a solid core. Follows roads once
                  Auto-suggest has snapped it, otherwise links stops directly. */}
              {geometry.length > 1 && (
                <>
                  <Polyline positions={geometry} pathOptions={{ color, weight: 11, opacity: 0.22, lineCap: 'round' }} />
                  <Polyline positions={geometry} pathOptions={{ color, weight: 4, opacity: 0.95, lineCap: 'round' }} />
                </>
              )}

              {/* Draggable, numbered stops. */}
              {points.map((pt, i) => (
                <Marker
                  key={i}
                  position={pt}
                  icon={waypointIcon(pinLabel(i), pinKind(i))}
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

            {/* First-run hint */}
            {points.length === 0 && (
              <div className="rp-hint">
                <CursorIcon />
                <span>Click anywhere in Cabuyao to drop your first stop</span>
                <small>Each click adds an ordered stop · drag a pin to fine-tune it</small>
              </div>
            )}

            <div className="rp-coords">
              {coords
                ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E | Zoom: ${coords.zoom}`
                : 'No map data'}
            </div>
          </div>

          {/* ── Right panel ── */}
          <aside className="rp-panel">
            {/* Draft editor */}
            <section className="rp-section">
              <h3 className="rp-section-title">Route Details</h3>
              <label className="rp-field">
                <span>Route name</span>
                <input
                  type="text"
                  value={name}
                  placeholder={`${ROUTE_TYPES[type].label} route…`}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <div className="rp-type-note">
                <span className="rp-type-dot" style={{ background: color }} />
                {ROUTE_TYPES[type].desc}
              </div>
            </section>

            {/* Live metrics */}
            <section className="rp-section">
              <div className="rp-metrics">
                <div className="rp-metric">
                  <div className="rp-metric-val">{points.length}</div>
                  <div className="rp-metric-lbl">Stops</div>
                </div>
                <div className="rp-metric">
                  <div className="rp-metric-val">{formatDistance(distance)}</div>
                  <div className="rp-metric-lbl">Distance</div>
                </div>
                <div className="rp-metric">
                  <div className="rp-metric-val">{geometry.length > 1 ? formatWalkEta(distance) : '--'}</div>
                  <div className="rp-metric-lbl">Walk ETA</div>
                </div>
              </div>
              {path && (
                <div className="rp-type-note">
                  <span className="rp-type-dot" style={{ background: '#1a7a4a' }} />
                  Snapped to roads · flood-aware (OSM · Flood Hub · Windy)
                </div>
              )}
            </section>

            {/* Stop list */}
            <section className="rp-section rp-section--grow">
              <h3 className="rp-section-title">
                Stops
                {points.length > 0 && <span className="rp-pill">{points.length}</span>}
              </h3>
              {points.length === 0 ? (
                <div className="rp-empty">No stops yet. Click the map to begin.</div>
              ) : (
                <ul className="rp-stops">
                  {points.map((pt, i) => (
                    <li className="rp-stop" key={i}>
                      <span className={`rp-stop-badge ${pinKind(i)}`}>{pinLabel(i)}</span>
                      <span className="rp-stop-coords">
                        {pt[0].toFixed(4)}, {pt[1].toFixed(4)}
                      </span>
                      <button
                        type="button"
                        className="rp-stop-x"
                        title="Remove stop"
                        onClick={() => removePoint(i)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Actions */}
            <section className="rp-section rp-actions">
              <button type="button" className="rp-save" onClick={save} disabled={points.length < 2}>
                <SaveIcon /> Save Route
              </button>
            </section>

            {/* Saved routes */}
            <section className="rp-section">
              <h3 className="rp-section-title">
                Saved Routes
                {routes.length > 0 && <span className="rp-pill">{routes.length}</span>}
              </h3>
              {routes.length === 0 ? (
                <div className="rp-empty">Saved routes appear here and on the Override Routes screen.</div>
              ) : (
                <ul className="rp-saved">
                  {routes.map((r) => (
                    <li className="rp-saved-row" key={r.id}>
                      <span className="rp-saved-dot" style={{ background: ROUTE_TYPES[r.type]?.color }} />
                      <button type="button" className="rp-saved-main" onClick={() => loadRoute(r)} title="Load for editing">
                        <span className="rp-saved-name">{r.name}</span>
                        <span className="rp-saved-meta">
                          {ROUTE_TYPES[r.type]?.label} · {formatDistance(pathLengthMeters(routeGeometry(r)))} · {r.points.length} stops
                          {r.source === 'auto' || r.path ? ' · auto' : ''}
                        </span>
                      </button>
                      <button type="button" className="rp-saved-x" title="Delete route" onClick={() => removeRoute(r.id)}>
                        <TrashIcon />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>

        <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    </AdminLayout>
  )
}

/* ── Icons ──────────────────────────────────────────────────────────────── */
function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
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
