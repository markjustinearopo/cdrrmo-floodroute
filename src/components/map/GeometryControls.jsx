import { barangayForPoint } from '../../data/cabuyaoBarangays.js'
import { geometryError } from '../../utils/mapGeometry.js'
import './locationLookup.css'
export default function GeometryControls({ mode, onMode, points, onPoints }) {
  const error = geometryError(points, mode)
  return (
    <div>
      <div className="geometry-tools">
        {[
          ['point', 'Single pin'],
          ['points', 'Multiple points'],
          ['area', 'Flood boundary'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={mode === key}
            onClick={() => {
              onMode(key)
              if (key === 'point') onPoints(points.slice(0, 1))
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="geometry-help">
        {mode === 'area'
          ? 'Tap boundary corners in order around the flooded area. Shading represents a reported extent, not a measured flood model.'
          : mode === 'points'
            ? 'Tap each affected location. Each numbered pin belongs to this report.'
            : 'Tap the map or find an address to place the pin.'}{' '}
        {points.length}/30 points
      </div>
      {mode !== 'point' && (
        <ol className="geometry-points">
          {points.map((p, i) => (
            <li key={p.join(',')}>
              {p[0].toFixed(5)}, {p[1].toFixed(5)} ·{' '}
              {barangayForPoint(p[0], p[1]) || 'Outside Cabuyao'}
              <button
                type="button"
                aria-label={'Remove point ' + (i + 1)}
                onClick={() => onPoints(points.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      {points.length > 0 && (
        <div className="geometry-tools">
          <button type="button" onClick={() => onPoints(points.slice(0, -1))}>
            Undo last point
          </button>
          <button type="button" onClick={() => onPoints([])}>
            Clear points
          </button>
        </div>
      )}
      {error && (
        <div className="geometry-help" role="status">
          {error}
        </div>
      )}
    </div>
  )
}
