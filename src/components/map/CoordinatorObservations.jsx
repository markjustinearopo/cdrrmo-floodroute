import { nowLabel } from '../../context/AdminDataContext.jsx'
export default function CoordinatorObservations({ areas = [] }) {
  const records = areas
    .filter((a) => a.observation && a.observation !== 'unknown')
    .sort((a, b) => (b.observedAt || 0) - (a.observedAt || 0))
  return (
    <details className="coordinator-observations">
      <summary>Coordinator observations · {records.length}</summary>
      {!records.length && (
        <p className="map-first-help">No coordinator observation published yet.</p>
      )}
      {records.slice(0, 5).map((a) => (
        <div className="coordinator-observation" key={a.id}>
          <b>{a.name}</b>
          <span>
            {a.barangay} · Water {a.observation}
          </span>
          <small>
            {a.observedAt ? nowLabel(a.observedAt) + ' PHT' : 'Time not recorded'} ·{' '}
            {!a.observedAt || Date.now() - a.observedAt >= 3600000
              ? 'Needs recheck'
              : 'Observed within the last hour'}
          </small>
          {a.observedAt &&
            Date.now() - a.observedAt < 3600000 &&
            a.expectedClearAt &&
            a.expectedClearAt > Date.now() &&
            a.expectedClearAt - Date.now() <= 3600000 && (
              <small>Coordinator expects clearance within one hour — estimate only.</small>
            )}
        </div>
      ))}
      <p className="map-first-help">
        Follow active warnings and road closures. Receding water or an estimate does not confirm
        safe passage.
      </p>
    </details>
  )
}
