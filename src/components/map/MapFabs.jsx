/* ============================================================
   Floating action buttons (right edge of the map, above zoom).

   Google-Maps-style circular buttons with hover labels:
     📍 My Location   🧭 Find Route   🗺 Layers
     ⚠ Report Flood   🌙 Dark Mode    ⟲ Reset View
   The page supplies the handlers; this component is pure chrome.
   ============================================================ */

import './mapUpgrade.css'

export default function MapFabs({
  onLocate,
  locating = false,
  onRoute,
  onLayers,
  layersOn = true,
  onReport,
  dark = false,
  onToggleDark,
  onReset,
  onSearch,
  searchOn = false,
}) {
  return (
    <div className="fabs" role="toolbar" aria-label="Map actions">
      {/* Optional: pages without an always-on search bar expose it here. */}
      {onSearch && (
        <Fab label={searchOn ? 'Hide Search' : 'Search Location'} onClick={onSearch} active={searchOn}>
          <svg {...svg}>
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
        </Fab>
      )}
      <Fab label="My Location" onClick={onLocate} busy={locating} accent="blue">
        <svg {...svg}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          <circle cx="12" cy="12" r="8" />
        </svg>
      </Fab>
      <Fab label="Find Safe Route" onClick={onRoute} accent="green">
        <svg {...svg}>
          <polygon points="3 11 22 2 13 21 11 13 3 11" />
        </svg>
      </Fab>
      <Fab label={layersOn ? 'Hide Layers' : 'Show Layers'} onClick={onLayers} active={layersOn}>
        <svg {...svg}>
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      </Fab>
      <Fab label="Report Flood" onClick={onReport} accent="red">
        <svg {...svg}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </Fab>
      <Fab label={dark ? 'Light Mode' : 'Dark Mode'} onClick={onToggleDark} active={dark}>
        {dark ? (
          <svg {...svg}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
        ) : (
          <svg {...svg}>
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </Fab>
      <Fab label="Reset View" onClick={onReset}>
        <svg {...svg}>
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      </Fab>
    </div>
  )
}

const svg = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function Fab({ label, onClick, children, accent = '', active = false, busy = false }) {
  return (
    <button
      type="button"
      className={`fab ${accent ? `fab--${accent}` : ''} ${active ? 'fab--active' : ''} ${busy ? 'fab--busy' : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
      <span className="fab-label">{label}</span>
    </button>
  )
}
