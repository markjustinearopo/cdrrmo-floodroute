/* ============================================================
   Shared map layers built on the REAL Cabuyao barangay boundaries.

   • BarangayRiskLayer — the 18 barangay polygons, each filled by its live
     model risk (the authoritative "Affected Barangays" / inundation classifier).
     Clicking a barangay selects it (onSelect) for the focus view + detail card.
   • InundationGrid — the fine NOAH-style flood-risk surface, clipped to land
     (interior cells only) so the heat never bleeds past the shoreline.
   • FocusController — flies/locks the map to a barangay's bounds (focus view),
     and restores the city view when cleared.

   Presentation only; the risk numbers come from floodRisk.js.
   ============================================================ */

import { useEffect, useMemo, useRef } from 'react'
import { GeoJSON, Rectangle, useMap } from 'react-leaflet'
import { BARANGAY_FEATURES, CABUYAO_LAND_BOUNDS } from '../../data/cabuyaoBarangays.js'
import { riskColor } from './floodRisk.js'
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
 */
export function BarangayRiskLayer({ samples, opacity = 1, interactive = true, onSelect, selected }) {
  const byName = useMemo(() => {
    const m = {}
    for (const s of samples) m[s.name] = s
    return m
  }, [samples])

  // <GeoJSON> doesn't re-evaluate style on prop change, so remount via a key
  // whenever the risk picture, opacity, or selection changes.
  const sig = useMemo(
    () => samples.map((s) => `${s.name}:${s.level}:${s.risk.toFixed(2)}`).join('|') + `@${opacity}#${selected || ''}`,
    [samples, opacity, selected],
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
      data={BARANGAY_FEATURES}
      style={styleFor}
      onEachFeature={onEachFeature}
      interactive={interactive}
    />
  )
}

/**
 * Land-clipped flood-risk heat surface (the modeled inundation field).
 *  props.cells   — field.cells from floodRisk.js (each carries onLand / interior)
 *  props.opacity — overlay opacity multiplier (0…1)
 *  props.mode    — 'interior' (cells fully on land, zero lake bleed) | 'onLand'
 */
export function InundationGrid({ cells = [], opacity = 1, mode = 'interior' }) {
  const visible = cells.filter((c) => (mode === 'interior' ? c.interior : c.onLand))
  return visible.map((cell) => (
    <Rectangle
      key={cell.key}
      bounds={cell.bounds}
      pathOptions={{
        stroke: false,
        // Stronger than before so the surface reads clearly even at low risk.
        fillColor: riskColor(cell.risk),
        fillOpacity: Math.min(0.92, opacity * (0.3 + 0.55 * cell.risk)),
        interactive: false,
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
