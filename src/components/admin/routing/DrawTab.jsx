import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, Polyline, Marker } from 'react-leaflet'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../mapHelpers.jsx'
import {
  ROUTE_TYPES,
  ClickToAddWaypoint,
  waypointIcon,
  pathLengthMeters,
  formatDistance,
  formatWalkEta,
  useRoadStatus,
  useTrafficStatus,
} from '../routingHelpers.jsx'
import { planRoute, DEFAULT_ALPHA, DEFAULT_BETA } from '../routeEngine.js'
import { useSavedRoutes } from '../../../context/AdminDataContext.jsx'
import SavedRouteList from '../SavedRouteList.jsx'

/**
 * Routing → Draw (was the Route Planning page).
 *
 * Author a route by hand: click the map to drop ordered stops, drag to
 * fine-tune, name it and save. This is the manual counterpart to Generate.
 *
 * Route Planning used to carry its own "Auto-suggest" button — the same solve
 * the Generate tab performs, under a third name. It is gone: snapping a
 * hand-drawn line to the network is what Generate is for, and the button here
 * now points at that tab rather than duplicating it. What stays is genuinely
 * manual: the ordered stops the operator chose.
 */
export default function DrawTab({ shared, onToast, onGoToTab }) {
  const { roads, graph, live, type, setType } = shared
  const [routes, { addRoute, removeRoute }] = useSavedRoutes()
  const [statusMap] = useRoadStatus()
  const [trafficMap] = useTrafficStatus()

  // ── Draft route being drawn on the map ──
  const [name, setName] = useState('')
  const [points, setPoints] = useState([]) // ordered stops [[lat, lng], …]
  const [path, setPath] = useState(null) // road-following geometry once snapped
  const [coords, setCoords] = useState(null)

  const color = ROUTE_TYPES[type].color
  // The drawn line follows roads once it has been snapped, else the raw stops.
  const geometry = path && path.length > 1 ? path : points
  const distance = useMemo(() => pathLengthMeters(geometry), [geometry])

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
   * Snap the hand-dropped stops onto the road network, connecting each
   * consecutive pair with the same flood-aware solve the Generate tab runs.
   * Any unreachable pair keeps its straight link so the route is never broken.
   */
  function snapToRoads() {
    if (points.length < 2) return onToast('Drop at least two stops first.')
    if (!graph || graph.size === 0) {
      return onToast(roads ? 'Road network unavailable.' : 'Road network still loading…')
    }
    // Vehicle routes (relief/response) steer around congestion; on-foot
    // evacuation ignores car traffic (β = 0).
    const beta = type === 'evacuation' ? 0 : DEFAULT_BETA
    const opts = { riskAt: live?.riskAt, statusMap, trafficMap, alpha: DEFAULT_ALPHA, beta }
    let line = []
    let gaps = 0
    for (let i = 1; i < points.length; i++) {
      const seg = planRoute(graph, points[i - 1], points[i], opts)
      const piece = seg.ok ? seg.safe.coords : [points[i - 1], points[i]]
      if (!seg.ok) gaps++
      line = line.length === 0 ? piece.slice() : line.concat(piece.slice(1))
    }
    setPath(line)
    onToast(
      gaps
        ? `Snapped to roads · ${gaps} gap${gaps > 1 ? 's' : ''} kept straight.`
        : 'Snapped to roads, steering around flood-prone segments.',
    )
  }

  function save() {
    if (points.length < 2) return onToast('Add at least two stops to save a route.')
    const finalName = name.trim() || `${ROUTE_TYPES[type].label} Route ${routes.length + 1}`
    const saved = { name: finalName, type, points }
    if (path && path.length > 1) saved.path = path
    addRoute(saved)
    onToast(`Saved "${finalName}".`)
    clearDraft()
  }

  function loadRoute(r) {
    setType(r.type)
    setName(r.name)
    setPoints(r.points)
    setPath(r.path && r.path.length > 1 ? r.path : null)
    onToast(`Loaded "${r.name}" for editing.`)
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
    <div className="route-plan rt-pane">
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
              snapped, otherwise links stops directly. */}
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
          <div className="rp-draw-tools">
            <button type="button" className="rp-btn" onClick={undo} disabled={!points.length}>
              <UndoIcon /> Undo
            </button>
            <button type="button" className="rp-btn" onClick={clearDraft} disabled={!points.length}>
              <TrashIcon /> Clear
            </button>
            <button
              type="button"
              className={`rp-btn rp-btn--auto ${path ? 'on' : ''}`}
              onClick={snapToRoads}
              disabled={points.length < 2}
              title="Connect the stops along the road network, avoiding flood-prone segments"
            >
              <SparkIcon /> Snap to roads
            </button>
          </div>

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
          {path ? (
            <div className="rp-type-note">
              <span className="rp-type-dot" style={{ background: '#1a7a4a' }} />
              Snapped to roads · flood-aware (OSM · Open-Meteo)
            </div>
          ) : (
            <div className="rp-type-note">
              <span className="rp-type-dot" style={{ background: '#cbb26b' }} />
              Straight lines between stops. Want the engine to pick the whole route?{' '}
              <button type="button" className="rp-inline-link" onClick={() => onGoToTab('generate')}>
                Use Generate
              </button>
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

        {/* Saved routes — mount point 2 of the one canonical list */}
        <section className="rp-section">
          <h3 className="rp-section-title">
            Saved Routes
            {routes.length > 0 && <span className="rp-pill">{routes.length}</span>}
          </h3>
          <SavedRouteList
            routes={routes}
            onSelect={loadRoute}
            onDelete={(r) => { removeRoute(r.id); onToast(`Deleted "${r.name}".`) }}
            selectHint="Load for editing"
            emptyText="Saved routes appear here and on the Saved tab."
          />
        </section>
      </aside>
    </div>
    </div>
  )
}

/* ── Icons ──────────────────────────────────────────────────────────────── */
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
  return <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
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
  return <svg viewBox="0 0 24 24"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /></svg>
}
