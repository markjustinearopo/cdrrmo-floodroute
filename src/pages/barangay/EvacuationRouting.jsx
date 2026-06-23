import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, Polyline, Marker, Popup } from 'react-leaflet'
import BarangayLayout from '../../components/barangay/BarangayLayout.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import {
  CABUYAO_CENTER,
  CABUYAO_ZOOM,
  CabuyaoLock,
  BarangayLock,
  JurisdictionToggle,
  CoordReadout,
} from '../../components/admin/mapHelpers.jsx'
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
} from '../../components/admin/routingHelpers.jsx'
import { useRouteGraph, planRoute, DEFAULT_ALPHA } from '../../components/admin/routeEngine.js'
import { useFloodRisk } from '../../components/admin/floodRisk.js'
import { MapViewToggle, use3DPreference } from '../../components/admin/Map3D.jsx'
import RouteSketch3DView from '../../components/admin/RouteSketch3DView.jsx'
import { evacPinIcon } from '../../components/admin/EvacLocationPicker.jsx'
import { useEvacCenters, useSavedRoutes } from '../../context/AdminDataContext.jsx'
import { officialBarangayLabel, getOfficialBarangay, useJurisdictionView } from '../../data/barangay.js'
import '../admin/RoutePlanning.css'

/**
 * CDRRMO Barangay — Evacuation Routing (Routing).
 *
 * The official maps the safe route residents should take from their area to an
 * evacuation centre by clicking the Cabuyao map to drop ordered stops, then
 * names and saves it. Auto-suggest snaps the stops to the complete city road
 * network and connects them flood-aware — the same engine the command center
 * uses. Routes persist to the SAME shared store the command center reads, so a
 * barangay's evacuation route appears on the admin's Override Routes screen —
 * one routing picture for the whole city.
 */
export default function EvacuationRouting() {
  const brgyLabel = officialBarangayLabel()
  const myBrgy = getOfficialBarangay()
  const [view, setView] = useJurisdictionView()
  const locked = view === 'mine' && Boolean(myBrgy)
  const [routes, { addRoute, removeRoute }] = useSavedRoutes()
  const { roads } = useCabuyaoRoads()
  const graph = useRouteGraph(roads)
  const { field } = useFloodRisk()
  const [statusMap] = useRoadStatus()
  const { evacuationCenters } = useEvacCenters()
  const evacMarkers = useMemo(
    () => evacuationCenters.filter((c) => Array.isArray(c.coords)),
    [evacuationCenters],
  )

  const [type, setType] = useState('evacuation')
  const [name, setName] = useState('')
  const [points, setPoints] = useState([])
  const [path, setPath] = useState(null) // road-following geometry once auto-suggested
  const [coords, setCoords] = useState(null)
  const [toast, setToast] = useState('')
  const [use3D, setUse3D] = use3DPreference()
  const [confirmDel, setConfirmDel] = useState(null) // saved route pending deletion

  const color = ROUTE_TYPES[type].color
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

  // Same flood-aware snap the command center's Route Planning uses: connect
  // each consecutive pair of stops along the road network, steering around
  // flagged and flood-prone segments; unreachable pairs stay straight.
  function autoSuggest() {
    if (points.length < 2) return flash('Drop at least two stops, then Auto-suggest.')
    if (!graph || graph.size === 0) return flash('Road network unavailable.')
    const opts = { riskAt: field?.riskAt, statusMap, alpha: DEFAULT_ALPHA }
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
    const finalName = name.trim() || `Brgy. ${brgyLabel} ${ROUTE_TYPES[type].label} Route`
    const saved = { name: finalName, type, points, barangay: brgyLabel }
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
    <BarangayLayout mainClassName="main--flush">
      <div className="route-plan">
        <div className="rp-toolbar">
          <div className="rp-title">
            <TargetIcon />
            <span>Evacuation Routing · Brgy. {brgyLabel}</span>
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
              disabled={points.length < 2}
              title="Snap the stops to roads and avoid flood-prone segments (OpenStreetMap · Open-Meteo)"
            >
              <SparkIcon /> Auto-suggest
            </button>
          </div>

          <JurisdictionToggle value={view} onChange={setView} brgyLabel={brgyLabel} />
          <MapViewToggle value={use3D} onChange={setUse3D} />
        </div>

        <div className="rp-body">
          <div className="rp-map-area">
            {use3D ? (
              /* Same draft, same draggable stops, same click-to-add — on
                 terrain, masked to the barangay border in "My Barangay" view.
                 Auto-suggest plays the fly-along route reveal. */
              <RouteSketch3DView
                key={locked ? `b-${myBrgy}` : 'city'}
                lines={[{ id: 'draft', coords: geometry, color }]}
                pins={points.map((pt, i) => ({
                  key: `p${i}`,
                  latlng: pt,
                  label: pinLabel(i),
                  kind: pinKind(i),
                  draggable: true,
                  onDragEnd: (ll) => movePoint(i, ll),
                }))}
                evac={evacMarkers}
                reveal={{ id: 'draft', key: path }}
                jurisdiction={locked ? myBrgy : null}
                onMapClick={addPoint}
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
              {locked ? <BarangayLock name={myBrgy} /> : <CabuyaoLock />}
              <ClickToAddWaypoint onAdd={addPoint} />

              {/* Route line follows roads once Auto-suggest has snapped it,
                  otherwise links the stops directly. */}
              {geometry.length > 1 && (
                <>
                  <Polyline positions={geometry} pathOptions={{ color, weight: 11, opacity: 0.22, lineCap: 'round' }} />
                  <Polyline positions={geometry} pathOptions={{ color, weight: 4, opacity: 0.95, lineCap: 'round' }} />
                </>
              )}

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

              {/* Shared evacuation centres (city-wide) — possible destinations */}
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

            {points.length === 0 && (
              <div className="rp-hint">
                <CursorIcon />
                <span>Click the map to drop the route's starting point</span>
                <small>Each click adds an ordered stop · drag a pin to fine-tune it</small>
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
              <h3 className="rp-section-title">Route Details</h3>
              <label className="rp-field">
                <span>Route name</span>
                <input
                  type="text"
                  value={name}
                  placeholder={`Brgy. ${brgyLabel} ${ROUTE_TYPES[type].label.toLowerCase()} route…`}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <div className="rp-type-note">
                <span className="rp-type-dot" style={{ background: color }} />
                {ROUTE_TYPES[type].desc}
              </div>
            </section>

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
                  Snapped to roads · flood-aware (OSM · Open-Meteo)
                </div>
              )}
            </section>

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

            <section className="rp-section rp-actions">
              <button type="button" className="rp-save" onClick={save} disabled={points.length < 2}>
                <SaveIcon /> Save Route
              </button>
            </section>

            <section className="rp-section">
              <h3 className="rp-section-title">
                Saved Routes
                {routes.length > 0 && <span className="rp-pill">{routes.length}</span>}
              </h3>
              {routes.length === 0 ? (
                <div className="rp-empty">Saved routes appear here and on the command center's Override Routes screen.</div>
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
                      <button type="button" className="rp-saved-x" title="Delete route" onClick={() => setConfirmDel(r)}>
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

      {confirmDel && (
        <ConfirmDialog
          title="Delete this route?"
          confirmLabel="Delete route"
          message={(
            <>Delete the saved route <b>{confirmDel.name}</b>? This removes it for the command center and residents too and can't be undone.</>
          )}
          onConfirm={() => { removeRoute(confirmDel.id); setConfirmDel(null) }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </BarangayLayout>
  )
}

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
