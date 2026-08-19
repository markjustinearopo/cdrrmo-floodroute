import { useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, Marker, CircleMarker } from 'react-leaflet'
import L from 'leaflet'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from './mapHelpers.jsx'
import { ClickToAddWaypoint } from './routingHelpers.jsx'
import { BARANGAYS } from '../../data/cabuyao.js'
import {
  FLOOD_TYPES,
  FLOOD_CAUSES,
  FLOOD_SEVERITY_META,
  floodSeverity,
  formatFloodDepth,
} from '../../data/floodAreas.js'
import { formatFeetHint, depthMeters } from '../../services/depth.js'
import '../../pages/admin/FloodAreas.css'

/**
 * Add / edit a flood-prone area — pin the location, record the peak depth and
 * the cause.
 *
 * This was the only genuinely unique half of the Flood-Prone Areas page; the
 * other half was a worse copy of the Flood Map. The page is gone and this
 * editor now opens in place from a pin on the Flood Map, so the record is
 * edited on the map that shows it.
 *
 * Depth is entered and stored in METRES (see services/depth.js). A live feet
 * readout sits under the input because CDRRMO measures on the ground in feet —
 * an operator who saw three feet of water can confirm they typed 0.91.
 */
const editPinIcon = L.divIcon({
  className: 'fa-edit-pin-divicon',
  html: '<span class="fa-edit-pin"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

export default function FloodAreaEditor({ area, onClose, onSave }) {
  const [pin, setPin] = useState(Array.isArray(area?.coords) ? area.coords : null)
  const [type, setType] = useState(area?.type || 'flood')
  // Existing records may still carry the pre-migration `depthFt`.
  const [depthM, setDepthM] = useState(() => {
    const m = depthMeters(area)
    return m == null ? '' : String(+m.toFixed(2))
  })
  const [causes, setCauses] = useState(Array.isArray(area?.causes) ? area.causes : [])
  const [mapCoords, setMapCoords] = useState(null)

  const draft = { type, depthM: depthM === '' ? null : Number(depthM) }
  const sev = floodSeverity(draft)
  const sevMeta = FLOOD_SEVERITY_META[sev]
  const feetHint = formatFeetHint(draft.depthM)

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
      depthM: depthM === '' ? null : Math.max(0, Number(depthM)),
      // Drop any legacy feet value so a record is never carrying both units.
      depthFt: undefined,
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
            <div className="mng-modal-sub">Click the map to pin the location · record the peak depth in metres</div>
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
                Peak Depth (metres)
                <input
                  type="number" min="0" step="0.05"
                  value={depthM}
                  onChange={(e) => setDepthM(e.target.value)}
                  placeholder={type === 'flash_flood' ? 'optional' : 'e.g. 0.9'}
                />
                <span className="fa-depth-hint">
                  {feetHint || 'Measured on the ground in feet? The equivalent shows here.'}
                </span>
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
