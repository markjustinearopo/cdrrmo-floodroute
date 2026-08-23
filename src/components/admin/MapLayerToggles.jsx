/* Compact on-map layer control: toggle each overlay independently (so the
   barangay risk classification and the inundation heat surface don't have to
   be shown at the same time) plus an intensity slider. Used on the Flood Map,
   which previously had no layer controls. */

import { useOverlayOpen } from '../../hooks/useNarrowScreen.js'
import './mapControls.css'

/**
 * `collapsible` and `placement` are opt-in. The admin and barangay Flood Maps
 * opt into collapsing; the resident map keeps the always-open, top-left rail.
 *
 * placement: 'top-left' (default) | 'right' | 'left' — 'right' parks the rail
 * above Leaflet's bottom-right zoom control; 'left' renders it in flow inside
 * the host's own left rail, which does the positioning.
 * compact: tighter type, switches and spacing. The admin map carries eight
 * layers to the others' six, so at the default size its rail runs tall enough
 * to crowd the canvas.
 */
export function MapLayerToggles({ layers, opacity, onOpacity, collapsible = false, placement = 'top-left', compact = false }) {
  const PLACEMENT_CLASS = { right: ' map-toggles--right', left: ' map-toggles--rail', 'top-left': '' }
  const posClass = (PLACEMENT_CLASS[placement] ?? '') + (compact ? ' map-toggles--compact' : '')
  // Collapsible, like the other map overlays: the rail is ~190px tall and on a
  // phone it covered better than a fifth of the map. Starts folded on
  // phone-width screens, expanded on desktop.
  const [open, setOpen] = useOverlayOpen()
  const onCount = layers.filter((l) => l.on).length

  if (collapsible && !open) {
    return (
      <button
        type="button"
        className={`map-toggles-chip${posClass}`}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        // Icon only, so the count moves into the label and tooltip rather than
        // being lost.
        title={`Map layers (${onCount} of ${layers.length} on)`}
        aria-label={`Map layers, ${onCount} of ${layers.length} on. Show`}
      >
        <LayersIcon />
      </button>
    )
  }

  return (
    <div className={`map-toggles${posClass}`} onClick={(e) => e.stopPropagation()}>
      {collapsible ? (
        <div className="map-toggles-head">
          <span className="map-toggles-title">Map Layers</span>
          <button
            type="button"
            className="map-toggles-min"
            onClick={() => setOpen(false)}
            title="Minimize"
            aria-label="Minimize map layers"
          >
            —
          </button>
        </div>
      ) : (
        <div className="map-toggles-title">Map Layers</div>
      )}
      {layers.map((l) => (
        <button
          type="button"
          key={l.key}
          className={`map-toggle ${l.on ? 'on' : ''}`}
          onClick={l.onToggle}
          aria-pressed={l.on}
        >
          <span className="mt-sw"><span className="mt-knob" /></span>
          <span className="mt-dot" style={{ background: l.color }} />
          <span className="mt-label">{l.label}</span>
        </button>
      ))}
      {onOpacity && (
        <div className="map-toggle-op">
          <div className="mt-op-head">
            <span>Intensity</span>
            <span className="mt-op-val">{opacity}%</span>
          </div>
          <input
            type="range"
            min="20"
            max="100"
            value={opacity}
            onChange={(e) => onOpacity(Number(e.target.value))}
          />
        </div>
      )}
    </div>
  )
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mtc-icon" aria-hidden="true">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  )
}
