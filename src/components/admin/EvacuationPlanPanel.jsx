import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { computeEvacuationPlan } from '../../services/evacuationPlan.js'
import { formatDistance } from './routingHelpers.jsx'
import './EvacuationPlanPanel.css'

/**
 * The evacuation plan: which barangay goes to which centre, along which
 * flood-aware route, and where the overflow goes when the nearest fills.
 *
 * Computed on demand rather than on mount: ~72 flood-weighted A* searches take
 * a few seconds, and an operator opening the centre roster to fix a phone
 * number should not pay for a plan they did not ask for.
 *
 * The compute is deliberately deferred a tick rather than run inline. It is
 * synchronous and holds the main thread, so computing it during render froze
 * the page with the button still reading "Compute plan" — no spinner, no
 * feedback, just a dead UI. Yielding first lets the "Working…" state paint, so
 * the wait is visible for what it is.
 */
export default function EvacuationPlanPanel({ roads, centres, assignments, statusMap, field }) {
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState(null)

  useEffect(() => {
    if (!open || !roads) { setPlan(null); return undefined }
    setPlan(null)
    let alive = true
    const id = window.setTimeout(() => {
      const result = computeEvacuationPlan({ roads, centres, assignments, statusMap, field })
      if (alive) setPlan(result)
    }, 40)
    return () => { alive = false; window.clearTimeout(id) }
  }, [open, roads, centres, assignments, statusMap, field])

  return (
    <section className="ep">
      <div className="ep-head">
        <div>
          <div className="ep-title">Evacuation Plan</div>
          <div className="ep-sub">
            Nearest centre with room for each barangay, by flood-aware road distance
          </div>
        </div>
        <button type="button" className="mng-btn" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide plan' : 'Compute plan'}
        </button>
      </div>

      {open && !plan && (
        <div className="ep-empty">
          <span className="ep-spinner" aria-hidden="true" />
          Routing every barangay to its nearest centres…
        </div>
      )}

      {open && plan && (
        <>
          {!plan.hasPopulations && (
            <div className="ep-note">
              <b>No barangay populations recorded.</b> Each barangay is still matched to its
              nearest reachable centre and route below — that needs no population figure — but
              the plan cannot say how many people each centre must hold, or where the overflow
              goes, until the numbers are entered. Add them under{' '}
              <Link to="/admin/settings?tab=barangays">Settings → Barangays</Link>. Nothing here
              is estimated in the meantime.
            </div>
          )}

          {plan.totals && (
            <div className="ep-totals">
              <Tot label="Open centres" value={plan.totals.centres} />
              <Tot label="Total capacity" value={plan.totals.capacity.toLocaleString()} />
              <Tot label="Currently sheltered" value={plan.totals.occupied.toLocaleString()} />
              <Tot
                label="Population to move"
                value={plan.totals.demand != null ? plan.totals.demand.toLocaleString() : '—'}
                muted={plan.totals.demand == null}
              />
              <Tot
                label="Unplaced"
                value={plan.totals.demand != null ? plan.totals.shortfall.toLocaleString() : '—'}
                tone={plan.totals.shortfall > 0 ? 'bad' : 'good'}
                muted={plan.totals.demand == null}
              />
            </div>
          )}

          <div className="mng-card">
            <table className="mng-table ep-table">
              <thead>
                <tr>
                  <th>Barangay</th>
                  <th>People</th>
                  <th>Assigned centre</th>
                  <th>Route</th>
                  <th>Overflow</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.barangay}>
                    <td className="mng-strong">{r.barangay}</td>
                    <td className="mng-num">
                      {r.population != null
                        ? r.population.toLocaleString()
                        : <span className="mng-muted">not set</span>}
                    </td>
                    <td>
                      <span className="ep-centre">{r.primary.centre.name}</span>
                      {r.primary.people != null && (
                        <span className="ep-people"> · {r.primary.people.toLocaleString()} people</span>
                      )}
                    </td>
                    <td className="mng-num">
                      {formatDistance(r.primary.distanceM)}
                      {r.primary.viaRoads.length > 0 && (
                        <span className="ep-via"> via {r.primary.viaRoads.join(', ')}</span>
                      )}
                    </td>
                    <td>
                      {r.overflow.length === 0 && r.shortfall === 0 && <span className="mng-muted">—</span>}
                      {r.overflow.map((o) => (
                        <div className="ep-of" key={o.centre.id}>
                          {o.centre.name}
                          {o.people != null && ` · ${o.people.toLocaleString()}`}
                        </div>
                      ))}
                      {r.shortfall > 0 && (
                        <div className="ep-short">{r.shortfall.toLocaleString()} unplaced</div>
                      )}
                    </td>
                  </tr>
                ))}
                {plan.rows.length === 0 && (
                  <tr><td colSpan={5} className="mng-empty">
                    <span className="mng-empty-strong">No plan could be built</span>
                    No open centre is reachable on the current road network.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {plan.unassigned.length > 0 && (
            <div className="ep-unassigned">
              <b>{plan.unassigned.length} barangay{plan.unassigned.length === 1 ? '' : 's'} could not be placed:</b>
              {plan.unassigned.map((u) => (
                <div key={u.name}>{u.name} — {u.reason}</div>
              ))}
            </div>
          )}

          <div className="ep-foot">
            Distances are routed, not straight-line: the closest centre on a map is often
            not the closest one you can reach when the lakeshore roads are under water.
            Routes avoid flood-prone segments and honour roads you have closed on Road Status.
          </div>
        </>
      )}
    </section>
  )
}

function Tot({ label, value, tone, muted }) {
  return (
    <div className={`ep-tot ${tone || ''} ${muted ? 'muted' : ''}`}>
      <div className="ep-tot-val">{value}</div>
      <div className="ep-tot-lbl">{label}</div>
    </div>
  )
}
