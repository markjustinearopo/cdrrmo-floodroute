import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, Polyline, Marker } from 'react-leaflet'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../../components/admin/mapHelpers.jsx'
import {
  ROUTE_TYPES,
  waypointIcon,
  pathLengthMeters,
  formatDistance,
  formatWalkEta,
  activeRouteGeometry,
  routeGeometry,
} from '../../components/admin/routingHelpers.jsx'
import { useSavedRoutes } from '../../context/AdminDataContext.jsx'
import './SavedRoutes.css'

/**
 * CDRRMO Admin — Saved Routes.
 *
 * Central library of every route that has been saved in Route Planning,
 * Auto Route, or Override Routes. All portals share the same localStorage
 * store so barangay officials and residents automatically see whatever the
 * admin has published here.
 *
 * Click any route to preview it on the map. The active version (planned vs.
 * override) is highlighted. Admins can delete routes; the map pans to fit
 * each selected route automatically.
 */
export default function SavedRoutes() {
  const [routes, { removeRoute }] = useSavedRoutes()
  const [selectedId, setSelectedId] = useState(null)
  const [coords, setCoords] = useState(null)
  const [filter, setFilter] = useState('all')   // 'all' | route type key
  const [toast, setToast] = useState('')

  const selected = routes.find((r) => r.id === selectedId) || null

  function flash(msg) {
    setToast(msg)
    window.clearTimeout(flash._t)
    flash._t = window.setTimeout(() => setToast(''), 2200)
  }

  function handleDelete(r) {
    if (!window.confirm(`Delete "${r.name}"? This cannot be undone.`)) return
    removeRoute(r.id)
    if (selectedId === r.id) setSelectedId(null)
    flash(`Deleted "${r.name}".`)
  }

  const filtered = useMemo(() =>
    filter === 'all' ? routes : routes.filter((r) => r.type === filter),
    [routes, filter],
  )

  const plannedGeom = selected ? routeGeometry(selected) : []
  const activeGeom  = selected ? activeRouteGeometry(selected) : []
  const activeVersion = selected?.active || 'planned'
  const hasOverride = selected?.override?.length > 1

  const typeBreakdown = useMemo(() => {
    const b = {}
    for (const r of routes) b[r.type] = (b[r.type] || 0) + 1
    return b
  }, [routes])

  return (
    <AdminLayout mainClassName="main--flush">
      <div className="sr-page">
        {/* ── Toolbar ── */}
        <div className="sr-toolbar">
          <div className="sr-title">
            <BookmarkIcon />
            <span>Saved Routes</span>
            {routes.length > 0 && <span className="sr-badge">{routes.length}</span>}
          </div>

          <div className="sr-filters">
            <button
              type="button"
              className={`sr-chip ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            {Object.entries(ROUTE_TYPES).filter(([k]) => typeBreakdown[k]).map(([key, t]) => (
              <button
                key={key}
                type="button"
                className={`sr-chip ${filter === key ? 'active' : ''}`}
                style={filter === key ? { '--chip-color': t.color } : {}}
                onClick={() => setFilter(filter === key ? 'all' : key)}
              >
                <span className="sr-chip-dot" style={{ background: t.color }} />
                {t.label}
                <span className="sr-chip-count">{typeBreakdown[key]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="sr-body">
          {/* Route list */}
          <aside className="sr-list-panel">
            {filtered.length === 0 ? (
              <div className="sr-empty">
                {routes.length === 0
                  ? 'No saved routes yet. Create one in Route Planning or Auto Route.'
                  : 'No routes match this filter.'}
              </div>
            ) : (
              <ul className="sr-list">
                {filtered.map((r) => {
                  const geom = activeRouteGeometry(r)
                  const dist = pathLengthMeters(geom)
                  const t = ROUTE_TYPES[r.type] || ROUTE_TYPES.evacuation
                  const isActive = r.id === selectedId
                  return (
                    <li key={r.id} className={`sr-item ${isActive ? 'active' : ''}`}>
                      <button
                        type="button"
                        className="sr-item-main"
                        onClick={() => setSelectedId(isActive ? null : r.id)}
                      >
                        <span className="sr-item-dot" style={{ background: t.color }} />
                        <span className="sr-item-info">
                          <span className="sr-item-name">{r.name}</span>
                          <span className="sr-item-meta">
                            {t.label}
                            {' · '}
                            {formatDistance(dist)}
                            {r.points?.length > 0 && ` · ${r.points.length} stops`}
                            {r.active === 'override' && r.override?.length > 1 && (
                              <span className="sr-item-ovr"> · Override active</span>
                            )}
                            {(r.source === 'auto' || r.path) && (
                              <span className="sr-item-auto"> · road-following</span>
                            )}
                          </span>
                        </span>
                        <span className="sr-item-eta">{formatWalkEta(dist)}</span>
                      </button>
                      <button
                        type="button"
                        className="sr-item-del"
                        title="Delete route"
                        onClick={() => handleDelete(r)}
                      >
                        <TrashIcon />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </aside>

          {/* Map preview — always visible */}
          <div className="sr-map-area">
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              className="sr-leaflet"
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.85} />
              <ZoomControl position="bottomright" />
              <CabuyaoLock />

              {/* Planned route — dashed if not active */}
              {selected && plannedGeom.length > 1 && (
                <>
                  <Polyline
                    positions={plannedGeom}
                    pathOptions={{
                      color: ROUTE_TYPES[selected.type]?.color || '#1a2a4a',
                      weight: 4,
                      opacity: activeVersion === 'planned' ? 0.9 : 0.35,
                      dashArray: activeVersion === 'planned' ? undefined : '2 9',
                      lineCap: 'round',
                    }}
                  />
                  {selected.points?.length > 0 && [
                    selected.points[0],
                    selected.points[selected.points.length - 1],
                  ].map((pt, i) => (
                    <Marker key={`pl-${i}`} position={pt} icon={waypointIcon(i === 0 ? 'A' : 'B', i === 0 ? 'start' : 'end')} />
                  ))}
                </>
              )}

              {/* Override route — gold, solid when active */}
              {selected && hasOverride && selected.override.length > 1 && (
                <>
                  <Polyline
                    positions={selected.override}
                    pathOptions={{
                      color: '#B8860B',
                      weight: 11,
                      opacity: 0.18,
                      lineCap: 'round',
                    }}
                  />
                  <Polyline
                    positions={selected.override}
                    pathOptions={{
                      color: '#B8860B',
                      weight: 4,
                      opacity: activeVersion === 'override' ? 0.95 : 0.45,
                      lineCap: 'round',
                    }}
                  />
                </>
              )}

              <FitBounds geom={activeGeom} />
              <CoordReadout onChange={setCoords} />
            </MapContainer>

            {/* Floating hint when no route is selected */}
            {!selected && (
              <div className="sr-hint">
                <MapIcon />
                <span>
                  {routes.length === 0
                    ? 'No saved routes yet'
                    : 'Select a route to preview'}
                </span>
                <small>
                  {routes.length === 0
                    ? 'Create one in Route Planning or Auto Route first.'
                    : `${routes.length} route${routes.length > 1 ? 's' : ''} saved · click one to preview it here`}
                </small>
              </div>
            )}

            {/* Route detail card */}
            {selected && (
              <div className="sr-detail">
                <div className="sr-detail-name">
                  <span className="sr-detail-dot" style={{ background: ROUTE_TYPES[selected.type]?.color }} />
                  {selected.name}
                </div>
                <div className="sr-detail-row">
                  <span>{ROUTE_TYPES[selected.type]?.label}</span>
                  <span>{formatDistance(pathLengthMeters(activeGeom))}</span>
                  <span>{selected.points?.length || 0} stops</span>
                  <span className="sr-detail-version">{activeVersion === 'override' ? 'Override active' : 'Planned'}</span>
                </div>
              </div>
            )}

            {/* Map key */}
            {selected && (
              <div className="sr-map-key">
                <span className="sr-key-item">
                  <span className="sr-key-line" style={{ background: ROUTE_TYPES[selected.type]?.color }} /> Planned
                </span>
                {hasOverride && (
                  <span className="sr-key-item">
                    <span className="sr-key-line" style={{ background: '#B8860B' }} /> Override
                  </span>
                )}
              </div>
            )}

            <div className="sr-coords">
              {coords
                ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E | Zoom: ${coords.zoom}`
                : 'Bundled OSM · Cabuyao City'}
            </div>
          </div>
        </div>

        <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    </AdminLayout>
  )
}

/* ── FitBounds: fly to fit the active geometry on route select ─────────────── */
import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

function FitBounds({ geom }) {
  const map = useMap()
  useEffect(() => {
    if (!geom || geom.length < 2) return
    const bounds = L.latLngBounds(geom)
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16, animate: true })
  }, [geom, map])
  return null
}

/* ── Icons ──────────────────────────────────────────────────────────────────── */
function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}
function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  )
}
