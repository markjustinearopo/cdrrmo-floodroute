import {
  ROUTE_TYPES,
  pathLengthMeters,
  formatDistance,
  formatWalkEta,
  activeRouteGeometry,
} from './routingHelpers.jsx'
import './SavedRouteList.css'

/**
 * The one canonical saved-routes list.
 *
 * Before this, the same list was rendered three different ways: the Saved
 * Routes page had one, Route Planning embedded a second in its side panel, and
 * Override Routes used a third as its route picker. Same data, three markups,
 * three sets of drift. All three now mount this component.
 *
 * props:
 *   routes          — the saved-route records
 *   selectedId      — id of the highlighted row (null for none)
 *   onSelect(route) — row click
 *   onDelete(route) — shows a trash button per row when provided
 *   variant         — 'panel' (dense, in a side panel) | 'page' (roomier)
 *   showEta         — trailing walk-ETA column (the Saved tab's list)
 *   emptyText       — what to say when there is nothing to show
 *   selectHint      — title/tooltip on each row
 */
export default function SavedRouteList({
  routes = [],
  selectedId = null,
  onSelect,
  onDelete,
  variant = 'panel',
  showEta = false,
  emptyText = 'No saved routes yet.',
  selectHint,
}) {
  if (routes.length === 0) {
    return <div className="srl-empty">{emptyText}</div>
  }

  return (
    <ul className={`srl ${variant === 'page' ? 'srl--page' : 'srl--panel'}`}>
      {routes.map((r) => {
        const t = ROUTE_TYPES[r.type] || ROUTE_TYPES.evacuation
        const geom = activeRouteGeometry(r)
        const dist = pathLengthMeters(geom)
        const isActive = r.id === selectedId
        const hasOverride = r.override?.length > 1
        return (
          <li key={r.id} className={`srl-row ${isActive ? 'active' : ''}`}>
            <button
              type="button"
              className="srl-main"
              title={selectHint}
              onClick={() => onSelect?.(r)}
            >
              <span className="srl-dot" style={{ background: t.color }} />
              <span className="srl-text">
                <span className="srl-name">{r.name}</span>
                <span className="srl-meta">
                  {t.label} · {formatDistance(dist)}
                  {r.points?.length > 0 && ` · ${r.points.length} stops`}
                  {(r.source === 'auto' || r.path) && ' · road-following'}
                </span>
              </span>
              {hasOverride && (
                <span className={`srl-tag ${r.active === 'override' ? 'on' : ''}`}>OVR</span>
              )}
              {showEta && <span className="srl-eta">{formatWalkEta(dist)}</span>}
            </button>
            {onDelete && (
              <button
                type="button"
                className="srl-del"
                title="Delete route"
                onClick={() => onDelete(r)}
              >
                <TrashIcon />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Type filter chips that pair with the list (used by the Saved tab). */
export function SavedRouteFilters({ routes = [], value = 'all', onChange }) {
  const breakdown = {}
  for (const r of routes) breakdown[r.type] = (breakdown[r.type] || 0) + 1

  return (
    <div className="srl-filters">
      <button
        type="button"
        className={`srl-chip ${value === 'all' ? 'active' : ''}`}
        onClick={() => onChange('all')}
      >
        All
      </button>
      {Object.entries(ROUTE_TYPES).filter(([k]) => breakdown[k]).map(([key, t]) => (
        <button
          key={key}
          type="button"
          className={`srl-chip ${value === key ? 'active' : ''}`}
          style={value === key ? { '--chip-color': t.color } : undefined}
          onClick={() => onChange(value === key ? 'all' : key)}
        >
          <span className="srl-chip-dot" style={{ background: t.color }} />
          {t.label}
          <span className="srl-chip-count">{breakdown[key]}</span>
        </button>
      ))}
    </div>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}
