import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, Marker, CircleMarker } from 'react-leaflet'
import L from 'leaflet'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../../components/admin/mapHelpers.jsx'
import { ClickToAddWaypoint } from '../../components/admin/routingHelpers.jsx'
import { FloodAreaMarkers, FloodAreaLegend } from '../../components/admin/FloodAreasLayer.jsx'
import { useFloodAreas } from '../../context/AdminDataContext.jsx'
import { BARANGAYS } from '../../data/cabuyao.js'
import {
  FLOOD_TYPES,
  FLOOD_TYPE_LABEL,
  FLOOD_CAUSES,
  FLOOD_SEVERITY_META,
  floodSeverity,
  formatFloodDepth,
} from '../../data/floodAreas.js'
import './Manage.css'
import './FloodAreas.css'

/**
 * CDRRMO Admin — Flood-Prone Areas.
 *
 * The city's documented flood record, managed exactly like Road Status: the
 * admin pins a location, records the depth IN FEET and the cause, and the area
 * appears live on every flood map (admin / barangay / resident) and in the
 * generated reports. Seeded with the historical flood-prone areas (Habagat
 * rains, thunderstorms, tropical cyclones) the client supplied.
 */
const editPinIcon = L.divIcon({
  className: 'fa-edit-pin-divicon',
  html: '<span class="fa-edit-pin"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

export default function FloodAreas() {
  const { floodAreas, addFloodArea, updateFloodArea, removeFloodArea } = useFloodAreas()
  const [editing, setEditing] = useState(null) // area object, 'new', or null
  const [selectedId, setSelectedId] = useState(null)
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [toast, setToast] = useState('')

  const stats = useMemo(() => {
    const c = { high: 0, moderate: 0, low: 0 }
    let deepest = 0
    floodAreas.forEach((a) => {
      c[floodSeverity(a)]++
      if (Number(a.depthFt) > deepest) deepest = Number(a.depthFt)
    })
    return { total: floodAreas.length, ...c, deepest }
  }, [floodAreas])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...floodAreas]
      .filter((a) => !q || `${a.name} ${a.barangay}`.toLowerCase().includes(q))
      .sort((a, b) => (Number(b.depthFt) || 0) - (Number(a.depthFt) || 0) || a.name.localeCompare(b.name))
  }, [floodAreas, query])

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  return (
    <AdminLayout mainClassName="main--flush">
      <div className="flood-areas">
        {/* ── Toolbar ── */}
        <div className="fa-toolbar">
          <div className="fa-title">
            <DropIcon />
            <span>Flood-Prone Areas</span>
          </div>
          <div className="fa-source">
            <span className="fa-source-dot" />
            {floodAreas.length} documented areas · depths in feet
          </div>
          <button type="button" className="fa-add-btn" onClick={() => setEditing('new')}>
            <PlusIcon /> Add Flood-Prone Area
          </button>
        </div>

        {/* ── Body: map + panel ── */}
        <div className="fa-body">
          <div className="fa-map-area">
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              className="fa-leaflet"
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.85} />
              <ZoomControl position="bottomright" />
              <CabuyaoLock />
              <FloodAreaMarkers areas={floodAreas} onSelect={(a) => { setSelectedId(a.id); setEditing(a) }} />
              <CoordReadout onChange={setCoords} />
            </MapContainer>

            <div className="fa-map-legend">
              <span className="fa-map-legend-title">Flood depth severity</span>
              <FloodAreaLegend />
            </div>

            <div className="fa-coords">
              {coords
                ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E | Zoom: ${coords.zoom}`
                : 'No map data'}
            </div>
          </div>

          {/* ── Right panel ── */}
          <aside className="fa-panel">
            <section className="fa-section">
              <h3 className="fa-section-title">Summary</h3>
              <div className="fa-summary">
                <div className="fa-sum fa-sum--high"><div className="fa-sum-val">{stats.high}</div><div className="fa-sum-lbl">High</div></div>
                <div className="fa-sum fa-sum--mod"><div className="fa-sum-val">{stats.moderate}</div><div className="fa-sum-lbl">Moderate</div></div>
                <div className="fa-sum fa-sum--low"><div className="fa-sum-val">{stats.low}</div><div className="fa-sum-lbl">Low</div></div>
              </div>
              <div className="fa-deepest">Deepest on record: <b>{stats.deepest ? `${stats.deepest} ft` : '—'}</b> · {stats.total} areas mapped</div>
            </section>

            <section className="fa-section">
              <div className="fa-search">
                <SearchIcon />
                <input
                  type="search"
                  placeholder="Search area or barangay…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </section>

            <section className="fa-section fa-section--grow">
              <h3 className="fa-section-title">
                Documented Areas
                {visible.length > 0 && <span className="fa-pill">{visible.length}</span>}
              </h3>
              {visible.length === 0 ? (
                <div className="fa-empty">No flood-prone areas match. Use “Add Flood-Prone Area”.</div>
              ) : (
                <ul className="fa-list">
                  {visible.map((a) => {
                    const sev = floodSeverity(a)
                    const meta = FLOOD_SEVERITY_META[sev]
                    return (
                      <li
                        key={a.id}
                        className={`fa-row ${selectedId === a.id ? 'sel' : ''}`}
                        onMouseEnter={() => setSelectedId(a.id)}
                      >
                        <span className="fa-row-dot" style={{ background: meta.color }} />
                        <div className="fa-row-main">
                          <div className="fa-row-name" title={a.name}>{a.name}</div>
                          <div className="fa-row-meta">
                            {a.barangay} · {FLOOD_TYPE_LABEL[a.type]}
                          </div>
                        </div>
                        <span className="fa-row-depth" style={{ color: meta.color }}>{formatFloodDepth(a)}</span>
                        <div className="fa-row-actions">
                          <button type="button" className="fa-link" onClick={() => setEditing(a)}>Edit</button>
                          <button type="button" className="fa-link subtle" onClick={() => setConfirmRemove(a)}>Remove</button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section className="fa-section fa-note">
              <SparkIcon />
              <span>
                Depths are recorded in feet from CDRRMO's ground observations. Edits
                appear instantly on every flood map and in generated reports.
              </span>
            </section>
          </aside>
        </div>
      </div>

      {editing && (
        <FloodAreaModal
          area={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(data, id) => {
            if (id) { updateFloodArea(id, data); flash(`${data.name} updated.`) }
            else { addFloodArea(data); flash(`${data.name} added — now on every flood map.`) }
            setEditing(null)
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Remove this flood-prone area?"
          tone="danger"
          confirmLabel="Remove"
          cancelLabel="Cancel"
          message={<>“{confirmRemove.name}” ({confirmRemove.barangay}) will be removed from every flood map and report.</>}
          onConfirm={() => { removeFloodArea(confirmRemove.id); setConfirmRemove(null); flash('Flood-prone area removed.') }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </AdminLayout>
  )
}

/* ============================================================
   Add / Edit modal — pin the location + record depth in feet.
   ============================================================ */
function FloodAreaModal({ area, onClose, onSave }) {
  const isNew = !area
  const [pin, setPin] = useState(Array.isArray(area?.coords) ? area.coords : null)
  const [type, setType] = useState(area?.type || 'flood')
  const [depthFt, setDepthFt] = useState(area?.depthFt ?? '')
  const [causes, setCauses] = useState(Array.isArray(area?.causes) ? area.causes : [])
  const [mapCoords, setMapCoords] = useState(null)

  const draft = { type, depthFt: depthFt === '' ? null : Number(depthFt) }
  const sev = floodSeverity(draft)
  const sevMeta = FLOOD_SEVERITY_META[sev]

  function toggleCause(c) {
    setCauses((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  function handleSave(e) {
    e.preventDefault()
    if (!pin) return
    const f = new FormData(e.currentTarget)
    const data = {
      name: f.get('name').trim(),
      barangay: f.get('barangay'),
      type,
      depthFt: depthFt === '' ? null : Math.max(0, Number(depthFt)),
      causes,
      sourceStorms: f.get('sourceStorms').trim(),
      notes: f.get('notes').trim(),
      coords: pin,
      reportedBy: area?.reportedBy || 'CDRRMO',
    }
    onSave(data, area?.id)
  }

  return (
    <div className="mng-overlay" onMouseDown={onClose}>
      <div className="mng-modal mng-modal--map" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mng-modal-head">
          <div>
            <div className="mng-modal-title">{area ? `Edit · ${area.name}` : 'Add Flood-Prone Area'}</div>
            <div className="mng-modal-sub">Click the map to pin the location · record the depth in feet</div>
          </div>
          <button type="button" className="mng-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="mng-modal-body">
          {/* Pin map */}
          <div className="mng-modal-mapcol">
            <div className="fa-picker">
              <MapContainer
                center={pin || CABUYAO_CENTER}
                zoom={pin ? 15 : CABUYAO_ZOOM}
                zoomControl={false}
                attributionControl={false}
                className="fa-picker-map"
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.9} />
                <ZoomControl position="bottomright" />
                <CabuyaoLock />
                <ClickToAddWaypoint onAdd={setPin} />
                {pin && (
                  <>
                    <CircleMarker center={pin} radius={11} pathOptions={{ color: '#fff', weight: 2, fillColor: sevMeta.color, fillOpacity: 0.9 }} />
                    <Marker position={pin} icon={editPinIcon} draggable eventHandlers={{ dragend: (e) => { const ll = e.target.getLatLng(); setPin([ll.lat, ll.lng]) } }} />
                  </>
                )}
                <CoordReadout onChange={setMapCoords} />
              </MapContainer>
              <div className="fa-picker-coords">
                {pin
                  ? `Pinned · ${pin[0].toFixed(5)} N, ${pin[1].toFixed(5)} E`
                  : mapCoords ? `${mapCoords.lat.toFixed(4)} N, ${mapCoords.lng.toFixed(4)} E` : 'Click the map to set the location'}
              </div>
            </div>
          </div>

          {/* Form */}
          <form className="mng-form" onSubmit={handleSave}>
            <label>
              Area / Road Name
              <input name="name" type="text" defaultValue={area?.name || ''} placeholder="e.g. NIA Road (Mamatid → Sala)" required />
            </label>
            <label>
              Barangay
              <select name="barangay" required defaultValue={area?.barangay || ''}>
                <option value="" disabled>Select Barangay</option>
                {BARANGAYS.map((b) => <option key={b}>{b}</option>)}
              </select>
            </label>

            <div className="mng-form-grid">
              <label>
                Flood Type
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {FLOOD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label>
                Depth (feet)
                <input
                  type="number" min="0" step="0.5"
                  value={depthFt}
                  onChange={(e) => setDepthFt(e.target.value)}
                  placeholder={type === 'flash_flood' ? 'optional' : 'e.g. 3'}
                />
              </label>
            </div>

            <div className="fa-sev-preview" style={{ '--sev': sevMeta.color }}>
              <span className="fa-sev-dot" />
              Severity: <b>{sevMeta.label}</b> · shows as <b>{formatFloodDepth(draft)}</b> on the map
            </div>

            <div className="fa-causes">
              <span className="fa-causes-lbl">Cause / Triggers</span>
              <div className="fa-cause-chips">
                {FLOOD_CAUSES.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`fa-cause-chip ${causes.includes(c) ? 'on' : ''}`}
                    onClick={() => toggleCause(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <label>
              Storms Recorded Under
              <input name="sourceStorms" type="text" defaultValue={area?.sourceStorms || ''} placeholder="e.g. Paeng, Ulysses, Habagat" />
            </label>
            <label>
              Notes / Details
              <textarea name="notes" rows={3} defaultValue={area?.notes || ''} placeholder="Landmark, drainage condition, how fast it rises…" />
            </label>

            <div className={`mng-pinned ${pin ? 'set' : ''}`}>
              {pin ? `Location pinned at ${pin[0].toFixed(5)}, ${pin[1].toFixed(5)}` : 'Pin the location on the map to enable saving.'}
            </div>

            <div className="mng-form-actions">
              <button type="button" className="mng-btn mng-btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="mng-btn" disabled={!pin}>{area ? 'Save Changes' : 'Add Area'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ── Icons ──────────────────────────────────────────────────────────────── */
function DropIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" /></svg>
}
function PlusIcon() {
  return <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
}
function SearchIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
}
function SparkIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
}
