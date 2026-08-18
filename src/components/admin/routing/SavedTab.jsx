import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, Polyline, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import ConfirmDialog from '../../ConfirmDialog.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../mapHelpers.jsx'
import {
  ROUTE_TYPES,
  waypointIcon,
  pathLengthMeters,
  formatDistance,
  activeRouteGeometry,
  routeGeometry,
} from '../routingHelpers.jsx'
import { useSavedRoutes } from '../../../context/AdminDataContext.jsx'
import SavedRouteList, { SavedRouteFilters } from '../SavedRouteList.jsx'

/**
 * Routing → Saved (was the Saved Routes page).
 *
 * The library of every route saved from Generate, Draw or Override. All
 * portals read the same shared store, so barangay officials and residents see
 * whatever is published here. Click a route to preview it; the map fits to the
 * active version (planned vs. override).
 */
export default function SavedTab({ onToast, onGoToTab }) {
  const [routes, { removeRoute }] = useSavedRoutes()
  const [selectedId, setSelectedId] = useState(null)
  const [coords, setCoords] = useState(null)
  const [filter, setFilter] = useState('all') // 'all' | route type key
  const [confirmDelete, setConfirmDelete] = useState(null) // route pending deletion

  const selected = routes.find((r) => r.id === selectedId) || null

  function handleDelete(r) {
    removeRoute(r.id)
    if (selectedId === r.id) setSelectedId(null)
    setConfirmDelete(null)
    onToast(`Deleted "${r.name}".`)
  }

  const filtered = useMemo(
    () => (filter === 'all' ? routes : routes.filter((r) => r.type === filter)),
    [routes, filter],
  )

  const plannedGeom = selected ? routeGeometry(selected) : []
  const activeGeom = selected ? activeRouteGeometry(selected) : []
  const activeVersion = selected?.active || 'planned'
  const hasOverride = selected?.override?.length > 1

  return (
    <div className="sr-page rt-pane">
    <div className="sr-body">
      {/* Route list */}
      <aside className="sr-list-panel">
        <SavedRouteFilters routes={routes} value={filter} onChange={setFilter} />
        {/* Mount point 1 of the one canonical list */}
        <SavedRouteList
          routes={filtered}
          selectedId={selectedId}
          variant="page"
          showEta
          onSelect={(r) => setSelectedId(r.id === selectedId ? null : r.id)}
          onDelete={(r) => setConfirmDelete(r)}
          selectHint="Preview on the map"
          emptyText={
            routes.length === 0
              ? 'No saved routes yet. Create one on the Generate or Draw tab.'
              : 'No routes match this filter.'
          }
        />
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
                pathOptions={{ color: '#B8860B', weight: 11, opacity: 0.18, lineCap: 'round' }}
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
            <span>{routes.length === 0 ? 'No saved routes yet' : 'Select a route to preview'}</span>
            <small>
              {routes.length === 0 ? (
                <>
                  Create one on the{' '}
                  <button type="button" className="sr-inline-link" onClick={() => onGoToTab('generate')}>Generate</button>
                  {' '}tab first.
                </>
              ) : (
                `${routes.length} route${routes.length > 1 ? 's' : ''} saved · click one to preview it here`
              )}
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

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this saved route?"
          message={`Delete “${confirmDelete.name}”? It disappears from the shared route library, so barangay officials and residents lose it too. This cannot be undone.`}
          confirmLabel="Delete route"
          tone="danger"
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
    </div>
  )
}

/* ── FitBounds: fly to fit the active geometry on route select ─────────────── */
function FitBounds({ geom }) {
  const map = useMap()
  useEffect(() => {
    if (!geom || geom.length < 2) return
    const bounds = L.latLngBounds(geom)
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16, animate: true })
  }, [geom, map])
  return null
}

function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  )
}
