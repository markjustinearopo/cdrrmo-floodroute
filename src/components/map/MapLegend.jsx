import './mapLegend.css'
import { pinIcon } from './pinIcons.js'

function LegendPin({ color, glyph }) {
  const html = pinIcon({ color, glyph, size: 18 }).options.html
  return <span className="legend-marker" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
}
const RISK = [
  ['#EAB308', 'Low'],
  ['#F97316', 'Moderate'],
  ['#EF4444', 'High'],
]
function RiskColors({ lowDepth = false }) {
  return (
    <span>
      {lowDepth && (
        <span>
          <i style={{ background: '#22c55e' }} />
          Low depth
        </span>
      )}
      {RISK.map(([color, label]) => (
        <span key={label}>
          <i style={{ background: color }} />
          {label}
        </span>
      ))}
    </span>
  )
}
export default function MapLegend({ layers = {}, route = null }) {
  return (
    <section className="flood-map-key" aria-label="Map legend">
      <strong>Map legend</strong>
      <div className="flood-map-key-items">
        {layers.noah && (
          <div>
            <b>NOAH hazard</b>
            <RiskColors />
          </div>
        )}
        {layers.floodAreas && (
          <div>
            <b>Flood-prone areas</b>
            <RiskColors />
          </div>
        )}
        {(layers.inundation || layers.barangays) && (
          <div>
            <b>Modelled risk</b>
            <RiskColors lowDepth />
          </div>
        )}
        {layers.reports && (
          <div>
            <b>Verified reports</b>
            <span>
              <LegendPin color="#22c55e" glyph="drop" />
              No flood <LegendPin color="#eab308" glyph="drop" />
              Low <LegendPin color="#F97316" glyph="drop" />
              Moderate <LegendPin color="#EF4444" glyph="drop" />
              Severe <LegendPin color="#7f1d1d" glyph="drop" />
              Impassable
            </span>
          </div>
        )}
        {layers.evac && (
          <div>
            <b>Evacuation centers</b>
            <span>
              <LegendPin color="#16a34a" glyph="home" />
              Open <LegendPin color="#f97316" glyph="home" />
              Full <LegendPin color="#dc2626" glyph="home" />
              Closed
            </span>
          </div>
        )}
        {layers.roads && (
          <div>
            <b>Roads</b>
            <span>
              <i style={{ background: '#dc2626' }} />
              Closed — avoid <i style={{ background: '#f97316' }} />
              Flooded — caution
            </span>
          </div>
        )}
        {layers.incidents && (
          <div>
            <b>Incidents</b>
            <span>
              <LegendPin color="#dc2626" glyph="alert" />
              Active response
            </span>
          </div>
        )}
        {layers.blindSpots && (
          <div>
            <b>Cut-off areas</b>
            <span>
              <i style={{ background: '#7f1d1d' }} />
              Simulated isolation
            </span>
          </div>
        )}
        {route && (
          <div>
            <b>Route</b>
            <span>
              <i style={{ background: route.color }} />
              {route.label}
              <i style={{ background: '#2563eb' }} />
              Your location
            </span>
          </div>
        )}
        {!route && !Object.values(layers).some(Boolean) && <div>No overlays selected.</div>}
      </div>
      <small>
        {layers.noah ? 'NOAH = flood susceptibility. ' : ''}
        {layers.inundation || layers.barangays ? 'Modelled risk = estimate. ' : ''}Follow official
        warnings and road closures.
      </small>
    </section>
  )
}
