import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCutoffAnalysis, IMPASSABLE_M, MAX_LEVEL_M } from '../../services/cutoffAnalysis.js'
import './CutoffPanel.css'

/**
 * "Banlic loses its last road out at 0.50 m — and it is Banlic–Mamatid Road."
 *
 * The ranked output of the cutoff sweep. Every figure is computed from data
 * already on the client: the OSM road graph, the bundled terrain, and the real
 * evacuation centres. Nothing new is fetched.
 *
 * THE GAUGE. Each row draws one shared depth scale from 0 to the deepest
 * cutoff, with a marker where that barangay goes. The first version filled a
 * bar proportional to the cutoff, which read backwards — a long bar looked like
 * a bad thing when it actually meant the barangay held out longest. A shared
 * scale with a marker cannot be misread that way: markers on the left go first,
 * and the distance from the current water line to the marker IS the headroom.
 *
 * On reading it honestly: the ORDER is the finding. The depths come out of a
 * uniform-rise model with no drainage and no bridge heights, so "0.50" means
 * "sooner than 0.62, later than 0.33" — not a survey result. The panel says so
 * rather than letting two decimal places imply more than they have earned.
 */
export default function CutoffPanel({ roads, centres, statusMap, currentLevelM = 0 }) {
  const navigate = useNavigate()
  const [showAll, setShowAll] = useState(false)
  const [showMethod, setShowMethod] = useState(false)

  const analysis = useMemo(
    () => (roads && centres?.length ? getCutoffAnalysis({ roads, centres, statusMap }) : null),
    [roads, centres, statusMap],
  )

  const rows = analysis?.rows || []
  const withCutoff = rows.filter((r) => r.cutoffM != null)
  const visible = showAll ? rows : rows.slice(0, 6)

  // The shared scale everything is drawn against.
  const scaleMax = useMemo(() => {
    const deepest = withCutoff.length ? withCutoff[withCutoff.length - 1].cutoffM : 1
    return Math.max(0.6, Math.min(MAX_LEVEL_M, deepest * 1.15))
  }, [withCutoff])
  const pos = (m) => `${Math.max(0, Math.min(100, (m / scaleMax) * 100))}%`

  // One road being the last way out for several barangays is the single most
  // actionable thing this analysis produces, so it leads rather than hides.
  const chokepoint = useMemo(() => {
    const tally = new Map()
    for (const r of rows) {
      const road = r.criticalRoads[0]
      if (!road) continue
      tally.set(road.name, [...(tally.get(road.name) || []), r.barangay])
    }
    let best = null
    for (const [name, brgys] of tally) {
      if (brgys.length > 1 && (!best || brgys.length > best.brgys.length)) best = { name, brgys }
    }
    return best
  }, [rows])

  const first = withCutoff[0]

  if (!analysis) {
    return (
      <div className="section-card cut">
        <div className="cut-hd"><CutIcon /> Cutoff Analysis</div>
        <div className="cut-loading">Loading the road network…</div>
      </div>
    )
  }

  return (
    <div className="section-card cut">
      <div className="cut-hd">
        <span className="cut-hd-t"><CutIcon /> Cutoff Analysis</span>
        <span className="cut-hd-s">
          At what water level each barangay loses every route to an evacuation centre
        </span>
      </div>

      {/* The headline finding, said in one sentence. */}
      {first && (
        <div className="cut-lead">
          <div className="cut-lead-num">
            {first.cutoffM.toFixed(2)}<i>m</i>
          </div>
          <div className="cut-lead-txt">
            <b>{first.barangay}</b> is cut off first
            {first.criticalRoads[0] && <> — its last road out is <b>{first.criticalRoads[0].name}</b></>}.
            <span>{withCutoff.length} of {rows.length} barangays lose every route below {scaleMax.toFixed(1)} m.</span>
          </div>
        </div>
      )}

      {chokepoint && (
        <div className="cut-choke">
          <WarnIcon />
          <div>
            <b>{chokepoint.name}</b> is the last way out for {chokepoint.brgys.length} barangays
            — {chokepoint.brgys.join(', ')}. One road closing isolates all of them.
          </div>
        </div>
      )}

      {/* Shared scale header — every row below is drawn against this. */}
      <div className="cut-scale" aria-hidden="true">
        <span>0 m</span>
        <span>{(scaleMax / 2).toFixed(1)} m</span>
        <span>{scaleMax.toFixed(1)} m</span>
      </div>

      <ul className="cut-rows">
        {visible.map((r, i) => {
          const never = r.cutoffM == null
          const band = never ? 'safe' : r.cutoffM <= 0.35 ? 'high' : r.cutoffM <= 0.5 ? 'mod' : 'low'
          const headroom = never ? null : r.cutoffM - currentLevelM
          return (
            <li className={`cut-row cut-row--${band}`} key={r.barangay}>
              <button
                type="button"
                className="cut-btn"
                onClick={() => navigate(`/admin/routing?from=${encodeURIComponent(r.barangay)}`)}
                title={`Plan a route out of ${r.barangay}`}
              >
                <span className="cut-rank">{i + 1}</span>

                <span className="cut-name">
                  {r.barangay}
                  {r.criticalRoads[0] && (
                    <em>via {r.criticalRoads[0].name}{r.criticalRoads.length > 1 ? ` +${r.criticalRoads.length - 1}` : ''}</em>
                  )}
                  {!r.criticalRoads[0] && !never && <em>no named road on its final route</em>}
                </span>

                <span className="cut-gauge">
                  <span className="cut-track" />
                  {currentLevelM > 0 && (
                    <span className="cut-water" style={{ width: pos(currentLevelM) }} />
                  )}
                  {!never && (
                    <>
                      <span className="cut-fill" style={{ width: pos(r.cutoffM) }} />
                      <span className="cut-mark" style={{ left: pos(r.cutoffM) }} />
                    </>
                  )}
                </span>

                <span className="cut-val">
                  {never ? <em>holds</em> : `${r.cutoffM.toFixed(2)} m`}
                  {headroom != null && currentLevelM > 0 && (
                    <i className={headroom <= 0.1 ? 'tight' : ''}>
                      {headroom <= 0 ? 'cut off now' : `+${headroom.toFixed(2)} left`}
                    </i>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="cut-ft">
        {rows.length > 6 && (
          <button type="button" className="cut-more" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show top 6' : `Show all ${rows.length} barangays`}
          </button>
        )}
        <button
          type="button"
          className="cut-how"
          onClick={() => setShowMethod((v) => !v)}
          aria-expanded={showMethod}
        >
          How this is calculated
        </button>
      </div>

      {showMethod && (
        <p className="cut-note">
          A uniform rise of X metres is spread over the city by terrain — low ground takes more
          of it — and a road is treated as impassable once the water over it reaches{' '}
          {IMPASSABLE_M} m. The sweep raises X until no route survives from the barangay to any
          open evacuation centre. There is no drainage, no culverts and no bridge deck heights
          in this model, so read the <b>order</b> as the finding and the individual depths as
          rough. Roads you have closed on Road Status are honoured at every level.
        </p>
      )}
    </div>
  )
}

function CutIcon() {
  return <svg viewBox="0 0 24 24"><path d="M3 12h5l2-5 4 10 2-5h5" /></svg>
}
function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
