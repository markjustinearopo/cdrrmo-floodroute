/* ============================================================
   Shared map layers built on the REAL Cabuyao barangay boundaries.

   • BarangayRiskLayer — the 18 barangay polygons, each filled by its live
     model risk (the authoritative "Affected Barangays" / inundation classifier).
     Clicking a barangay selects it (onSelect) for the focus view + detail card.
   • InundationGrid — the fine NOAH-style honeycomb flood-risk surface,
     clipped to land so the heat never bleeds past the shoreline.
   • FocusController — flies/locks the map to a barangay's bounds (focus view),
     and restores the city view when cleared.

   Presentation only; the risk numbers come from floodRisk.js.
   ============================================================ */

import { useEffect, useMemo, useRef } from 'react'
import { GeoJSON, Polygon, useMap } from 'react-leaflet'
import L from 'leaflet'
import { BARANGAY_FEATURES, CABUYAO_LAND_BOUNDS, barangayAt } from '../../data/cabuyaoBarangays.js'
import { buildFloodHexes, BAND_FILL } from './floodRisk.js'
import { RISK_META } from './mapHelpers.jsx'

// Per-class fill opacity — solid enough that yellow reads as yellow and the
// green doesn't dissolve into the basemap, while streets still show through.
const LEVEL_FILL = { high: 0.7, moderate: 0.64, low: 0.6, safe: 0.5 }

/**
 * Barangay polygons coloured by risk class.
 *  props.samples    — barangayRiskSamples(field): [{ name, risk, floodDepth, level }]
 *  props.opacity    — overlay opacity multiplier (0…1)
 *  props.interactive— hover highlight + tooltip + click-to-select (default true)
 *  props.onSelect   — (name) => void, fired on barangay click
 *  props.selected   — name of the currently-focused barangay (drawn emphasised)
 *  props.only       — restrict to a single barangay (jurisdiction view); others
 *                     are dropped so only the official's own polygon renders
 */
export function BarangayRiskLayer({ samples, opacity = 1, interactive = true, onSelect, selected, only = null }) {
  const byName = useMemo(() => {
    const m = {}
    for (const s of samples) m[s.name] = s
    return m
  }, [samples])

  const data = useMemo(
    () => (only
      ? { ...BARANGAY_FEATURES, features: BARANGAY_FEATURES.features.filter((f) => f.properties.name === only) }
      : BARANGAY_FEATURES),
    [only],
  )

  // <GeoJSON> doesn't re-evaluate style on prop change, so remount via a key
  // whenever the risk picture, opacity, or selection changes.
  const sig = useMemo(
    () => samples.map((s) => `${s.name}:${s.level}:${s.risk.toFixed(2)}`).join('|') + `@${opacity}#${selected || ''}~${only || ''}`,
    [samples, opacity, selected, only],
  )

  const styleFor = (feature) => {
    const name = feature.properties.name
    const s = byName[name]
    const level = s?.level || 'safe'
    const isSel = name === selected
    return {
      color: isSel ? '#0f172a' : '#ffffff',
      weight: isSel ? 3 : 1.2,
      fillColor: RISK_META[level].color,
      fillOpacity: Math.min(1, opacity * LEVEL_FILL[level] + (isSel ? 0.15 : 0)),
    }
  }

  const onEachFeature = (feature, layer) => {
    const name = feature.properties.name
    const s = byName[name]
    const body = s
      ? `<b>${name}</b><br/>${RISK_META[s.level].label} · ~${s.floodDepth.toFixed(2)} m<br/><i>Click for details</i>`
      : `<b>${name}</b>`
    layer.bindTooltip(body, { sticky: true, direction: 'top', opacity: 1, className: 'brgy-risk-tip' })
    if (!interactive) return
    layer.on('mouseover', () => {
      if (name !== selected) layer.setStyle({ weight: 2.5, color: '#ffffff', fillOpacity: Math.min(1, opacity * LEVEL_FILL[s?.level || 'safe'] + 0.18) })
      layer._map.getContainer().style.cursor = 'pointer'
    })
    layer.on('mouseout', () => {
      layer.setStyle(styleFor(feature))
      layer._map.getContainer().style.cursor = ''
    })
    layer.on('click', (e) => {
      e.originalEvent?.stopPropagation?.()
      onSelect?.(name)
    })
  }

  return (
    <GeoJSON
      key={sig}
      data={data}
      style={styleFor}
      onEachFeature={onEachFeature}
      interactive={interactive}
    />
  )
}

/**
 * Land-clipped flood-inundation surface: the live risk field rendered as a
 * fine NOAH-style honeycomb (buildFloodHexes — ~100 m hexagons, banded by
 * depth class so the colours always match the risk legend).
 *
 * All hexes are painted on a dedicated canvas renderer with a full-viewport
 * pad: one canvas regardless of the page's default renderer (the default SVG
 * renderer would create thousands of DOM nodes AND clip the surface to the
 * viewport, blanking the hazard colours at the edges mid-pan).
 *
 *  props.field   — the flood-risk field from useFloodRisk()
 *  props.opacity — overlay opacity multiplier (0…1)
 *  props.only    — clip the surface to a single barangay (jurisdiction view)
 */
export function InundationGrid({ field, opacity = 1, only = null }) {
  const hexes = useMemo(() => {
    const all = buildFloodHexes(field)
    return only ? all.filter((h) => barangayAt(h.center[0], h.center[1]) === only) : all
  }, [field, only])
  const renderer = useMemo(() => L.canvas({ padding: 1 }), [])
  return hexes.map((hex) => (
    <Polygon
      key={hex.key}
      positions={hex.ring}
      renderer={renderer}
      interactive={false}
      pathOptions={{
        stroke: false,
        fillColor: RISK_META[hex.band].color,
        fillOpacity: Math.min(0.92, opacity * BAND_FILL[hex.band]),
      }}
    />
  ))
}

/**
 * Drives the map's viewport for the focus view. When `bounds` is set, fit to it
 * (locking onto a barangay); when cleared, restore the whole-city view.
 */
export function FocusController({ bounds }) {
  const map = useMap()
  const first = useRef(true)
  useEffect(() => {
    // Don't override CabuyaoLock's initial fit on mount; only react to changes.
    if (first.current) {
      first.current = false
      if (!bounds) return undefined
    }
    if (bounds) map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 16, duration: 0.6 })
    else map.flyToBounds(CABUYAO_LAND_BOUNDS, { padding: [16, 16], duration: 0.6 })
    return undefined
  }, [bounds, map])
  return null
}
