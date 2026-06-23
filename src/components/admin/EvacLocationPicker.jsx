/* ============================================================
   EvacLocationPicker — "drop the pin" map for an evacuation centre.

   A self-contained Cabuyao map the admin / barangay official clicks to
   set a centre's EXACT location. Shared by every place a centre is
   created or edited (Route Planning · Evacuation manage screens) so the
   pin-the-location experience is identical everywhere.

   Evacuation centres are CITY-WIDE facilities — any resident may shelter
   at any centre regardless of barangay — so the picker is locked to the
   whole city boundary, not a single barangay.
   ============================================================ */

import { useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, Marker } from 'react-leaflet'
import L from 'leaflet'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from './mapHelpers.jsx'
import { ClickToAddWaypoint } from './routingHelpers.jsx'
import './EvacLocationPicker.css'

/* House-glyph centre pin, tinted by status — matches the Flood Map marker. */
export const EVAC_STATUS_COLOR = { open: '#16a34a', full: '#f97316', closed: '#dc2626' }
const evacIconCache = {}
export function evacPinIcon(status = 'open') {
  if (evacIconCache[status]) return evacIconCache[status]
  const color = EVAC_STATUS_COLOR[status] || '#16a34a'
  const icon = L.divIcon({
    className: 'evac-pin-divicon',
    html: `<span class="evac-pin" style="background:${color}">
      <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    </span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
  evacIconCache[status] = icon
  return icon
}

/**
 * @param {[number,number]|null} value  current pin [lat, lng]
 * @param {(latlng:[number,number]) => void} onChange  called on map click
 * @param {string} status  centre status, tints the pin
 */
export default function EvacLocationPicker({ value, onChange, status = 'open' }) {
  const [coords, setCoords] = useState(null)

  return (
    <div className="evac-picker">
      <MapContainer
        center={value || CABUYAO_CENTER}
        zoom={CABUYAO_ZOOM}
        zoomControl={false}
        attributionControl={false}
        className="evac-picker-map"
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.9} />
        <ZoomControl position="bottomright" />
        <CabuyaoLock />
        <ClickToAddWaypoint onAdd={onChange} />
        {value && <Marker position={value} icon={evacPinIcon(status)} />}
        <CoordReadout onChange={setCoords} />
      </MapContainer>

      {!value && (
        <div className="evac-picker-hint">
          <svg viewBox="0 0 24 24"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /></svg>
          <span>Click the centre's location</span>
        </div>
      )}

      <div className="evac-picker-coords">
        {value
          ? `Pinned · ${value[0].toFixed(5)} N, ${value[1].toFixed(5)} E`
          : coords
            ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E`
            : 'No location set'}
      </div>
    </div>
  )
}
