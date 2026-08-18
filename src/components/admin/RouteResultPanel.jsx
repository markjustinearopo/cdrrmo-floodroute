import {
  TRAFFIC_STATUS,
  formatDistance,
  formatMins,
  formatWalkEta,
} from './routingHelpers.jsx'
import { riskLevel, RISK_LEVEL_META } from './floodRisk.js'
import './RouteResultPanel.css'

export const SHORTEST_COLOR = '#94A3B8' // slate — the "fastest" comparison ghost

/**
 * The result/summary panel for a generated route.
 *
 * Auto Route owned the only complete version of this — distance / ETA / risk
 * metrics, the exposure line, the congestion readout, the safest-vs-shortest
 * comparison and the turn sheet — while Route Planning and Override Routes
 * each showed a thinner, differently-worded subset of the same numbers. One
 * component now serves every routing tab.
 *
 * "Avoid this road" lives here rather than on a separate screen: excluding a
 * road is a constraint on the route you are looking at, so the control belongs
 * next to the road it excludes. The parent owns the avoided set and feeds it
 * back into the solve as blocked roads.
 *
 * props:
 *   plan       — the planRoute() result ({ ok, safe, fast, identical, detourM })
 *   color      — route-type colour for the safe line
 *   walkEta    — true for on-foot trips (evacuation), false for vehicle trips
 *   avoided    — Set of wayIds currently excluded (optional)
 *   onAvoid(wayIds, name)   — exclude a named stretch (optional; shows the control)
 *   onUnavoid(wayIds, name) — put it back
 *   maxVia     — how many roads of the turn sheet to list before collapsing
 */
export default function RouteResultPanel({
  plan,
  color,
  walkEta = true,
  avoided = null,
  onAvoid,
  onUnavoid,
  maxVia = 7,
}) {
  if (!plan?.ok) return null
  const safe = plan.safe
  const fast = plan.fast
  const lvl = riskLevel(safe.meanRisk)
  const etaLabel = walkEta ? 'Walk ETA' : 'Drive ETA'
  const etaValue = walkEta ? formatWalkEta(safe.distanceM) : formatMins(safe.driveMins)
  const canAvoid = Boolean(onAvoid)

  return (
    <div className="rrp">
      <div className="rrp-metrics">
        <Metric value={formatDistance(safe.distanceM)} label="Distance" />
        <Metric value={etaValue} label={etaLabel} />
        <Metric
          value={`${Math.round(safe.meanRisk * 100)}%`}
          label="Flood Risk"
          accent={RISK_LEVEL_META[lvl].color}
        />
      </div>

      <div className={`rrp-riskline ${lvl}`}>
        <span className="rrp-riskdot" style={{ background: RISK_LEVEL_META[lvl].color }} />
        {RISK_LEVEL_META[lvl].label} flood exposure along this route
        {safe.floodedSegments > 0 && (
          <b>&nbsp;· {safe.floodedSegments} flagged segment{safe.floodedSegments > 1 ? 's' : ''}</b>
        )}
      </div>

      {/* Congestion readout — vehicle routes only (β > 0 there, 0 on foot). */}
      {!walkEta && (safe.trafficDelayMins >= 0.5 || safe.congestedSegments > 0) && (
        <div className="rrp-trafficline">
          <span
            className="rrp-trafficdot"
            style={{ background: TRAFFIC_STATUS[safe.worstTraffic]?.swatch || '#94A3B8' }}
          />
          {safe.trafficDelayMins >= 0.5
            ? <>+{Math.round(safe.trafficDelayMins)} min lost to traffic</>
            : <>Routed clear of congestion</>}
          {safe.worstTraffic && safe.worstTrafficRoad && (
            <b>&nbsp;· {TRAFFIC_STATUS[safe.worstTraffic].label.toLowerCase()} near {safe.worstTrafficRoad}</b>
          )}
        </div>
      )}

      {/* Safest vs shortest */}
      <div className="rrp-compare">
        {plan.identical ? (
          <div className="rrp-compare-note">Already the shortest path — no safer detour was needed.</div>
        ) : (
          <>
            <div className="rrp-compare-row">
              <span className="rrp-compare-dot" style={{ background: color }} /> Safest
              <span className="rrp-compare-val">{formatDistance(safe.distanceM)}</span>
            </div>
            <div className="rrp-compare-row">
              <span className="rrp-compare-dot" style={{ background: SHORTEST_COLOR }} /> Shortest
              <span className="rrp-compare-val">{formatDistance(fast.distanceM)}</span>
            </div>
            <div className="rrp-compare-delta">
              +{formatDistance(plan.detourM)} detour to cut exposure from{' '}
              <b>{Math.round(fast.meanRisk * 100)}%</b> → <b>{Math.round(safe.meanRisk * 100)}%</b>
            </div>
          </>
        )}
      </div>

      {/* Turn sheet: the named roads the route follows, in order. Each row can
          be excluded, which re-solves around it. */}
      {safe.viaRoads.length > 0 && (
        <div className="rrp-via">
          <div className="rrp-via-title">
            <RouteIcon /> Follows
            {canAvoid && <span className="rrp-via-hint">tap a road to avoid it</span>}
          </div>
          <ol className="rrp-via-list">
            {safe.viaRoads.slice(0, maxVia).map((v, i) => (
              <li className="rrp-via-row" key={`${v.name}-${i}`}>
                {canAvoid ? (
                  <button
                    type="button"
                    className="rrp-via-avoid"
                    title={`Re-route around ${v.name}`}
                    onClick={() => onAvoid(v.wayIds || [], v.name)}
                  >
                    <span className="rrp-via-name">{v.name}</span>
                    <span className="rrp-via-x">avoid</span>
                  </button>
                ) : (
                  <span className="rrp-via-name" title={v.name}>{v.name}</span>
                )}
                <span className="rrp-via-dist">{formatDistance(v.m)}</span>
              </li>
            ))}
          </ol>
          {safe.viaRoads.length > maxVia && (
            <div className="rrp-via-more">+{safe.viaRoads.length - maxVia} more roads</div>
          )}
        </div>
      )}

      {/* Roads the operator has excluded from the solve. */}
      {avoided && avoided.size > 0 && (
        <div className="rrp-avoided">
          <div className="rrp-avoided-title">
            Avoiding {avoided.size} road{avoided.size > 1 ? 's' : ''}
          </div>
          <div className="rrp-avoided-rows">
            {[...avoided.entries()].map(([name, wayIds]) => (
              <button
                type="button"
                key={name}
                className="rrp-avoided-chip"
                title="Allow this road again"
                onClick={() => onUnavoid?.(wayIds, name)}
              >
                {name}
                <span className="rrp-avoided-x">×</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ value, label, accent }) {
  return (
    <div className="rrp-metric">
      <div className="rrp-metric-val" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="rrp-metric-lbl">{label}</div>
    </div>
  )
}

function RouteIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <circle cx="18" cy="5" r="3" />
    </svg>
  )
}
