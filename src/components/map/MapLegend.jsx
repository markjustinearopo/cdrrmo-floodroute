import './mapLegend.css'
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
              <i style={{ background: '#22c55e' }} />
              No flood <i style={{ background: '#eab308' }} />
              Low <i style={{ background: '#F97316' }} />
              Moderate <i style={{ background: '#EF4444' }} />
              Severe <i style={{ background: '#7f1d1d' }} />
              Impassable
            </span>
          </div>
        )}
        {layers.evac && (
          <div>
            <b>Shelters</b>
            <span>
              <i style={{ background: '#16a34a' }} />
              Open <i style={{ background: '#f97316' }} />
              Full <i style={{ background: '#dc2626' }} />
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
              <i style={{ background: '#dc2626' }} />
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
