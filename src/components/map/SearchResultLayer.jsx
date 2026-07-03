/* ============================================================
   Renders the currently searched location on the Leaflet map:

     • Smooth flyTo / flyToBounds camera move (ease-in-out, no jump)
     • A drop-in marker with a Google-Maps-style popup: name, flood
       risk of the surrounding barangay, measured depth, recommended
       action and a Navigate shortcut into the route planner
     • If the result is a road (Nominatim LineString), an animated
       glowing highlight along the actual road geometry, coloured by
       the flood level of the barangay it runs through

   Must live inside <MapContainer>.
   ============================================================ */

import { useEffect, useMemo, useRef } from 'react'
import { Marker, Polyline, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useNavigate } from 'react-router-dom'
import { nearestBarangayName } from '../../data/cabuyaoBarangays.js'
import { RISK_META } from '../admin/mapHelpers.jsx'
import './mapUpgrade.css'

/* Flood level → highlight colour; safe roads glow Google-blue. */
const GLOW_COLORS = { safe: '#22C55E', low: '#EAB308', moderate: '#F97316', high: '#EF4444' }
const SAFE_BLUE = '#3B82F6'

const RISK_ACTION = {
  safe: 'Road is clear — safe to travel.',
  low: 'Minor flooding possible. Drive with care.',
  moderate: 'Flood-prone — avoid low sections, consider another route.',
  high: 'Dangerous flooding — do not pass. Use the route planner for a safe path.',
}

/** Red teardrop pin (divIcon, so it inherits CSS animations). */
const resultPin = L.divIcon({
  className: 'msr-pin-wrap',
  html: `
    <div class="msr-pin">
      <svg viewBox="0 0 24 24" fill="#C0181B" stroke="#fff" stroke-width="1.4">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3.4" fill="#fff" stroke="none"/>
      </svg>
    </div>
    <div class="msr-pin-shadow"></div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 32],
  popupAnchor: [0, -30],
})

/** [lat,lng] paths from a Nominatim road geometry (LineString/MultiLineString). */
function roadPaths(geojson) {
  if (!geojson) return []
  const flip = (coords) => coords.map(([lng, lat]) => [lat, lng])
  if (geojson.type === 'LineString') return [flip(geojson.coordinates)]
  if (geojson.type === 'MultiLineString') return geojson.coordinates.map(flip)
  return []
}

export default function SearchResultLayer({ result, barangays = [], navigateTo = '/resident/evacuation-routing' }) {
  const map = useMap()
  const markerRef = useRef(null)
  const navigate = useNavigate()

  /* Camera: glide to the result (bounds for roads/areas, point otherwise). */
  useEffect(() => {
    if (!result) return
    const fly = { duration: 1.4, easeLinearity: 0.22 }
    if (result.bbox?.length === 4) {
      const [s, n, w, e] = result.bbox.map(Number)
      map.flyToBounds([[s, w], [n, e]], { ...fly, padding: [56, 56], maxZoom: 17 })
    } else {
      map.flyTo([result.lat, result.lng], result.zoom || 16, fly)
    }
    // Open the popup once the camera settles so it doesn't fight the animation.
    const id = setTimeout(() => markerRef.current?.openPopup(), 1500)
    return () => clearTimeout(id)
  }, [map, result])

  /* Flood context of the surrounding barangay (live risk model). */
  const ctx = useMemo(() => {
    if (!result) return null
    const name = nearestBarangayName(result.lat, result.lng)
    const sample = barangays.find((b) => b.name === name)
    const level = sample?.level ?? 'safe'
    return {
      barangay: name,
      level,
      depth: sample?.floodDepth ?? 0,
      meta: RISK_META[level],
      action: RISK_ACTION[level],
    }
  }, [result, barangays])

  const paths = useMemo(() => roadPaths(result?.geojson), [result])

  if (!result || !ctx) return null

  const glowColor = ctx.level === 'safe' && paths.length ? SAFE_BLUE : GLOW_COLORS[ctx.level]

  return (
    <>
      {/* Animated glowing road highlight (halo underneath + bright core). */}
      {paths.map((p, i) => (
        <Polyline
          key={`halo-${result.id}-${i}`}
          positions={p}
          pathOptions={{ color: glowColor, weight: 14, opacity: 0.28, className: 'road-glow-halo', interactive: false }}
        />
      ))}
      {paths.map((p, i) => (
        <Polyline
          key={`core-${result.id}-${i}`}
          positions={p}
          pathOptions={{ color: glowColor, weight: 5, opacity: 0.95, className: 'road-glow-core', interactive: false }}
        />
      ))}

      <Marker position={[result.lat, result.lng]} icon={resultPin} ref={markerRef}>
        <Popup className="msr-popup" closeButton={false} maxWidth={280}>
          <div className="msr-card">
            <div className="msr-card-head">
              <div className="msr-card-title">{result.label}</div>
              <span className={`risk-badge ${ctx.level}`}>{ctx.meta.label}</span>
            </div>
            <div className="msr-card-sub">{result.sub}</div>

            <div className="msr-card-rows">
              <div className="msr-card-row">
                <span>Barangay</span>
                <b>{ctx.barangay || '—'}</b>
              </div>
              <div className="msr-card-row">
                <span>Road status</span>
                <b style={{ color: ctx.meta.color }}>
                  {ctx.level === 'high' ? 'Avoid — flooded' : ctx.level === 'safe' ? 'Passable' : 'Use caution'}
                </b>
              </div>
              <div className="msr-card-row">
                <span>Est. flood depth</span>
                <b>{ctx.depth >= 0.05 ? `~${ctx.depth.toFixed(2)} m` : 'None reported'}</b>
              </div>
            </div>

            <div className={`msr-card-action msr-card-action--${ctx.level}`}>{ctx.action}</div>

            <button
              type="button"
              className="msr-card-nav"
              onClick={() => navigate(navigateTo)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="3 11 22 2 13 21 11 13 3 11" />
              </svg>
              Navigate safely
            </button>
          </div>
        </Popup>
      </Marker>
    </>
  )
}
