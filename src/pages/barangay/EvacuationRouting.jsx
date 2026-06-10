import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, Polyline, Marker } from 'react-leaflet'
import BarangayLayout from '../../components/barangay/BarangayLayout.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../../components/admin/mapHelpers.jsx'
import {
  ROUTE_TYPES,
  ClickToAddWaypoint,
  waypointIcon,
  pathLengthMeters,
  formatDistance,
  formatWalkEta,
  useRoutes,
} from '../../components/admin/routingHelpers.jsx'
import { officialBarangayLabel } from '../../data/barangay.js'
import '../admin/RoutePlanning.css'

/**
 * CDRRMO Barangay — Evacuation Routing (Routing).
 *
 * The official maps the safe route residents should take from their area to an
 * evacuation centre by clicking the Cabuyao map to drop ordered stops, then
 * names and saves it. Routes persist to the SAME shared store the command
 * center reads, so a barangay's evacuation route appears on the admin's
 * Override Routes screen — one routing picture for the whole city. Automatic
 * flood-aware suggestion is a separate algorithmic study (disabled here).
 */
export default function EvacuationRouting() {
  const brgyLabel = officialBarangayLabel()
  const [routes, { addRoute, removeRoute }] = useRoutes()

  const [type, setType] = useState('evacuation')
  const [name, setName] = useState('')
  const [points, setPoints] = useState([])
  const [coords, setCoords] = useState(null)
  const [toast, setToast] = useState('')

  const color = ROUTE_TYPES[type].color
  const distance = useMemo(() => pathLengthMeters(points), [points])

  function flash(msg) {
    setToast(msg)
    window.clearTimeout(flash._t)
    flash._t = window.setTimeout(() => setToast(''), 2200)
  }

  function addPoint(latlng) {
    setPoints((p) => [...p, latlng])
  }
  function movePoint(i, latlng) {
    setPoints((p) => p.map((pt, idx) => (idx === i ? latlng : pt)))
  }
  function removePoint(i) {
    setPoints((p) => p.filter((_, idx) => idx !== i))
  }
  function undo() {
    setPoints((p) => p.slice(0, -1))
  }
  function clearDraft() {
    setPoints([])
    setName('')
  }

  function save() {
    if (points.length < 2) return flash('Add at least two stops to save a route.')
    const finalName = name.trim() || `Brgy. ${brgyLabel} ${ROUTE_TYPES[type].label} Route`
    addRoute({ name: finalName, type, points, barangay: brgyLabel })
    flash(`Saved "${finalName}".`)
    clearDraft()
  }

  function loadRoute(r) {
    setType(r.type)
    setName(r.name)
    setPoints(r.points)
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
              className="rp-btn rp-btn--ghost"
              disabled
              title="Automatic flood-aware suggestion is a separate study — coming soon."
            >
              <SparkIcon /> Auto-suggest
              <span className="rp-soon">Soon</span>
            </button>
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
              <ClickToAddWaypoint onAdd={addPoint} />

              {points.length > 1 && (
                <>
                  <Polyline positions={points} pathOptions={{ color, weight: 11, opacity: 0.22, lineCap: 'round' }} />
                  <Polyline positions={points} pathOptions={{ color, weight: 4, opacity: 0.95, lineCap: 'round' }} />
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

              <CoordReadout onChange={setCoords} />
            </MapContainer>

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
                  <div className="rp-metric-val">{points.length > 1 ? formatWalkEta(distance) : '--'}</div>
                  <div className="rp-metric-lbl">Walk ETA</div>
                </div>
              </div>
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
                          {ROUTE_TYPES[r.type]?.label} · {formatDistance(pathLengthMeters(r.points))} · {r.points.length} stops
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
