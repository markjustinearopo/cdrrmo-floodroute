import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFloodReports, useRoadRequests, useAlerts } from '../../context/AdminDataContext.jsx'
import { barangayRiskSamples } from './floodRisk.js'
import { levelFromDepth } from '../../services/systemConfig.js'
import './DecisionStrip.css'

/**
 * What needs a decision right now.
 *
 * The dashboard used to open with charts. Charts describe; they do not ask for
 * anything. An operator arriving at this screen during an event does not need
 * to be told it is raining — the topbar already says so — they need to know
 * what is sitting in a queue with their name on it.
 *
 * Three questions, each one a thing only a person can answer:
 *   • Reports a resident filed that nobody has verified.
 *   • Road changes a barangay proposed that nobody has approved or rejected.
 *   • Barangays the model puts over the alert threshold with no alert issued.
 *
 * That last one is the important one, and it is deliberately phrased as a
 * prompt rather than an accusation: the model is an estimate, so "no alert
 * issued" may well be the correct call. The strip surfaces the gap and leaves
 * the judgement where it belongs.
 *
 * When all three are clear it says so plainly instead of hiding — "nothing
 * waiting" is itself the answer an operator came for.
 */
export default function DecisionStrip({ field }) {
  const navigate = useNavigate()
  const { floodReports } = useFloodReports()
  const { roadChangeRequests } = useRoadRequests()
  const { alerts } = useAlerts()

  const pendingReports = useMemo(
    () => floodReports.filter((r) => r.status === 'pending'),
    [floodReports],
  )

  const pendingRoads = useMemo(
    () => roadChangeRequests.filter((r) => r.status === 'pending'),
    [roadChangeRequests],
  )

  /* Barangays the model grades at or above the alert threshold that have no
     active alert covering them. */
  const uncovered = useMemo(() => {
    if (!field) return []
    const active = new Set(
      alerts.filter((a) => a.status === 'active').map((a) => a.barangay),
    )
    return barangayRiskSamples(field)
      .filter((b) => {
        const lvl = levelFromDepth(b.floodDepth)
        return (lvl === 'high' || lvl === 'moderate') && !active.has(b.name)
      })
      .sort((a, b) => b.floodDepth - a.floodDepth)
  }, [field, alerts])

  const items = [
    {
      key: 'reports',
      n: pendingReports.length,
      label: pendingReports.length === 1 ? 'flood report to verify' : 'flood reports to verify',
      detail: pendingReports.slice(0, 2).map((r) => r.barangay).filter(Boolean).join(', '),
      tone: 'blue',
      to: '/admin/flood-reports',
      cta: 'Verify',
      icon: <DropIcon />,
    },
    {
      key: 'roads',
      n: pendingRoads.length,
      label: pendingRoads.length === 1 ? 'road change to approve' : 'road changes to approve',
      detail: pendingRoads.slice(0, 2).map((r) => r.roadName || r.barangay).filter(Boolean).join(', '),
      tone: 'amber',
      to: '/admin/road-status',
      cta: 'Review',
      icon: <RoadIcon />,
    },
    {
      key: 'alerts',
      n: uncovered.length,
      label: uncovered.length === 1 ? 'barangay over threshold, no alert' : 'barangays over threshold, no alert',
      detail: uncovered.slice(0, 3).map((b) => b.name).join(', '),
      tone: 'red',
      to: '/admin/alerts',
      cta: 'Issue alert',
      icon: <BellIcon />,
    },
  ]

  const open = items.filter((i) => i.n > 0)

  return (
    <section className="ds">
      <div className="ds-head">
        <span className="ds-title">Needs a decision</span>
        {open.length > 0 && <span className="ds-count">{open.reduce((n, i) => n + i.n, 0)}</span>}
      </div>

      {open.length === 0 ? (
        <div className="ds-clear">
          <CheckIcon />
          <div>
            <b>Nothing waiting.</b>
            <span>No unverified reports, no pending road changes, and every barangay over
              the threshold has an alert out.</span>
          </div>
        </div>
      ) : (
        <div className="ds-items">
          {open.map((i) => (
            <button
              key={i.key}
              type="button"
              className={`ds-item ds-item--${i.tone}`}
              onClick={() => navigate(i.to)}
            >
              <span className="ds-icon">{i.icon}</span>
              <span className="ds-body">
                <span className="ds-line">
                  <b>{i.n}</b> {i.label}
                </span>
                {i.detail && <span className="ds-detail">{i.detail}{i.n > 2 ? '…' : ''}</span>}
              </span>
              <span className="ds-cta">{i.cta} →</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function DropIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" /></svg>
}
function RoadIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 21L8 3" /><path d="M20 21L16 3" />
      <line x1="12" y1="5" x2="12" y2="8" /><line x1="12" y1="11" x2="12" y2="14" /><line x1="12" y1="17" x2="12" y2="20" />
    </svg>
  )
}
function BellIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}
function CheckIcon() {
  return <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
}
