/* Compact on-map layer control: toggle each overlay independently (so the
   barangay risk classification and the inundation heat surface don't have to
   be shown at the same time) plus an intensity slider. Used on the Flood Map,
   which previously had no layer controls. */

import './mapControls.css'

export function MapLayerToggles({ layers, opacity, onOpacity }) {
  return (
    <div className="map-toggles" onClick={(e) => e.stopPropagation()}>
      <div className="map-toggles-title">Map Layers</div>
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
