import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import {
  CABUYAO_CENTER,
  CABUYAO_ZOOM,
  formatPHT,
} from '../admin/mapHelpers.jsx'
import { barangayForPoint } from '../../data/cabuyaoBarangays.js'
import { useGeolocation } from '../../hooks/useGeolocation.js'
import { FLOOD_LEVELS, FLOOD_LEVEL_META } from '../../data/floodReports.js'
import { useFloodReports } from '../../context/AdminDataContext.jsx'
import { getResidentBarangay } from '../../data/resident.js'
import api from '../../services/api.js'
import './FloodReportModal.css'

/**
 * Resident "Report Flood Status" modal.
 *
 * A citizen pins WHERE the flooding is (their real GPS position or a tap on the
 * map), picks HOW BAD it is, optionally records the water depth, a description
 * and a photo, and submits. The report is filed as "Pending Verification" — it
 * only reaches the public map once CDRRMO approves it (see the admin Flood
 * Reports dashboard). Reusable: mounted from the Flood Map, the dashboard and
 * the dedicated Flood Reports page.
 */

// Evidence photos are downscaled before storing (base64 in the DB row).
const PHOTO_MAX_PX = 900

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, PHOTO_MAX_PX / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.7))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('unreadable image'))
    }
    img.src = url
  })
}

// Small pin icon for the chosen report location (divIcon — no image assets).
const pinIcon = L.divIcon({
  className: 'fr-pin-divicon',
  html: '<span class="fr-pin"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 20],
})

/** Drops / moves the report pin wherever the resident taps the map. */
function ClickToPlace({ onPick }) {
  useMapEvents({ click: (e) => onPick([e.latlng.lat, e.latlng.lng]) })
  return null
}

/** Imperatively flies the map when the GPS fix or picked point changes. */
function FlyTo({ coords }) {
  const map = useMapEvents({})
  const last = useRef(null)
  useEffect(() => {
    if (!coords) return
    const key = `${coords[0]},${coords[1]}`
    if (last.current === key) return
    last.current = key
    map.setView(coords, Math.max(map.getZoom(), 16), { animate: true })
  }, [coords, map])
  return null
}

export default function FloodReportModal({ onClose, onSubmitted }) {
  const { submitFloodReport } = useFloodReports()
  const { locate, loading: locating, error: geoError } = useGeolocation()

  const user = api.getUser?.()
  const [point, setPoint] = useState(null) // [lat, lng]
  const [level, setLevel] = useState('moderate')
  const [depth, setDepth] = useState('')
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState(null)
  const [photoError, setPhotoError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [stamp, setStamp] = useState(formatPHT())

  // Live "reported at" stamp so the resident sees the time being recorded.
  useEffect(() => {
    const id = setInterval(() => setStamp(formatPHT()), 30_000)
    return () => clearInterval(id)
  }, [])

  const barangay = useMemo(
    () => (point ? barangayForPoint(point[0], point[1]) : getResidentBarangay()),
    [point],
  )

  async function useMyLocation() {
    try {
      const c = await locate()
      setPoint([c.lat, c.lng])
    } catch {
      /* geoError surfaces the message inline */
    }
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0]
    setPhotoError('')
    if (!file) return setPhoto(null)
    try {
      setPhoto(await compressImage(file))
    } catch {
      setPhoto(null)
      setPhotoError('Could not read that image — try a different file.')
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!point || submitting) return
    setSubmitting(true)
    submitFloodReport({
      userId: user?.id ?? null,
      reporter: user?.fullName || user?.username || user?.email || 'Resident',
      barangay,
      coords: point,
      level,
      depthFt: depth === '' ? null : Number(depth),
      description: description.trim(),
      photo: photo || null,
    })
    onSubmitted?.()
    onClose?.()
  }

  return (
    <div className="fr-overlay" onMouseDown={onClose}>
      <div
        className="fr-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Report Flood Status"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="fr-head">
          <div>
            <div className="fr-title">Report Flood Status</div>
            <div className="fr-sub">Help CDRRMO by reporting flooding near you. Reports are verified before appearing on the map.</div>
          </div>
          <button type="button" className="fr-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form className="fr-form" onSubmit={handleSubmit}>
          {/* ── Location ── */}
          <div className="fr-field">
            <div className="fr-label-row">
              <span className="fr-label">Location</span>
              <button type="button" className="fr-loc-btn" onClick={useMyLocation} disabled={locating}>
                <LocateIcon />
                {locating ? 'Locating…' : 'Use my location'}
              </button>
            </div>
            <div className="fr-map">
              <MapContainer
                center={point || CABUYAO_CENTER}
                zoom={CABUYAO_ZOOM}
                zoomControl={false}
                attributionControl={false}
                className="fr-leaflet"
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.9} />
                <ClickToPlace onPick={setPoint} />
                <FlyTo coords={point} />
                {point && <Marker position={point} icon={pinIcon} />}
              </MapContainer>
              {!point && <div className="fr-map-hint">Tap the map or use your location to drop a pin</div>}
            </div>
            <div className="fr-coord">
              {point
                ? <>Brgy. <b>{barangay}</b> · {point[0].toFixed(5)}, {point[1].toFixed(5)}</>
                : 'No location selected yet'}
            </div>
            {geoError && <div className="fr-error">{geoError}</div>}
          </div>

          {/* ── Flood level ── */}
          <div className="fr-field">
            <span className="fr-label">Flood level / status</span>
            <div className="fr-levels">
              {FLOOD_LEVELS.map((l) => {
                const meta = FLOOD_LEVEL_META[l.value]
                const active = level === l.value
                return (
                  <button
                    type="button"
                    key={l.value}
                    className={`fr-level ${active ? 'active' : ''}`}
                    style={active ? { borderColor: meta.color, background: `${meta.color}14`, color: meta.color } : undefined}
                    onClick={() => setLevel(l.value)}
                  >
                    <span className="fr-level-dot" style={{ background: meta.color }} />
                    {l.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Depth + description ── */}
          <div className="fr-field">
            <span className="fr-label">Water depth <span className="fr-optional">(optional)</span></span>
            <div className="fr-depth">
              <input
                type="number"
                min="0"
                step="0.5"
                inputMode="decimal"
                placeholder="e.g. 2.5"
                value={depth}
                onChange={(e) => setDepth(e.target.value)}
              />
              <span className="fr-depth-unit">feet</span>
            </div>
          </div>

          <div className="fr-field">
            <span className="fr-label">Description / remarks <span className="fr-optional">(optional)</span></span>
            <textarea
              rows={3}
              placeholder="What's happening? e.g. Water rising fast along the highway, knee-deep near the market."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* ── Photo ── */}
          <div className="fr-field">
            <span className="fr-label">Photo evidence <span className="fr-optional">(optional)</span></span>
            <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} />
            {photoError && <div className="fr-error">{photoError}</div>}
            {photo && (
              <div className="fr-photo">
                <img src={photo} alt="Flood evidence preview" />
                <button type="button" className="fr-link" onClick={() => setPhoto(null)}>Remove photo</button>
              </div>
            )}
          </div>

          <div className="fr-stamp">Date &amp; time: <b>{stamp} PHT</b> · today</div>

          <div className="fr-actions">
            <button type="button" className="fr-btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="fr-btn" disabled={!point || submitting}>
              {submitting ? 'Submitting…' : 'Submit Report'}
            </button>
          </div>
          {!point && <div className="fr-need">Drop a pin on the map to submit your report.</div>}
        </form>
      </div>
    </div>
  )
}

function LocateIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  )
}
