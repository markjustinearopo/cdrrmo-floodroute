import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCutoffAnalysis, IMPASSABLE_M } from '../../services/cutoffAnalysis.js'
import './CutoffPanel.css'

/**
 * "Banlic loses its last road out at 0.50 m — and it is Banlic–Mamatid Road."
 *
 * The ranked output of the cutoff sweep. Every figure here is computed from
 * data already on the client: the OSM road graph, the bundled terrain, and the
 * real evacuation centres. Nothing new is fetched.
 *
 * The bar next to each barangay is its headroom — how much further the water
 * can rise before that barangay has no way out. Short bar, little room.
 *
 * On reading it honestly: the ORDER is the finding. The individual depths come
 * out of a uniform-rise model with no drainage and no bridge heights, so "0.50"
 * should be read as "sooner than 0.62 and later than 0.33", not as a survey
 * result. The panel says so rather than leaving the precision to imply more
 * than it has earned.
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
  const visible = showAll ? rows : rows.slice(0, 6)
  const worst = rows.filter((r) => r.cutoffM != null)
  const deepest = worst.length ? worst[worst.length - 1].cutoffM : 1

  // One road appearing across several barangays is the single most actionable
  // thing this analysis produces, so it gets called out rather than buried.
  const chokepoint = useMemo(() => {
    const tally = new Map()
    for (const r of rows) {
      for (const road of r.criticalRoads.slice(0, 1)) {
        const cur = tally.get(road.name) || []
        cur.push(r.barangay)
        tally.set(road.name, cur)
      }
    }
    let best = null
    for (const [name, brgys] of tally) {
      if (brgys.length > 1 && (!best || brgys.length > best.brgys.length)) best = { name, brgys }
    }
    return best
  }, [rows])

  if (!analysis) {
    return (
      <div className="section-card cut-card">
        <div className="cut-hdr"><CutIcon /> Cutoff Analysis</div>
        <div className="cut-empty">Loading the road network…</div>
      </div>
    )
  }

  return (
    <div className="section-card cut-card">
      <div className="cut-hdr">
        <span className="cut-hdr-title"><CutIcon /> Cutoff Analysis</span>
        <span className="cut-hdr-sub">{rows.length} barangays ranked by how soon they lose every road out</span>
      </div>

      {chokepoint && (
        <div className="cut-choke">
          <WarnIcon />
          <div>
            <b>{chokepoint.name}</b> is the last way out for{' '}
            <b>{chokepoint.brgys.length} barangays</b> — {chokepoint.brgys.join(', ')}.
            One road closing isolates all of them.
          </div>
        </div>
      )}

      <ul className="cut-list">
        {visible.map((r) => {
          const never = r.cutoffM == null
          const headroom = never ? null : Math.max(0, r.cutoffM - currentLevelM)
          const pct = never ? 100 : Math.min(100, (r.cutoffM / (deepest || 1)) * 100)
          const band = never ? 'safe' : r.cutoffM <= 0.35 ? 'high' : r.cutoffM <= 0.5 ? 'mod' : 'low'
          return (
            <li className={`cut-row cut-row--${band}`} key={r.barangay}>
              <button
                type="button"
                className="cut-main"
                onClick={() => navigate(`/admin/routing?from=${encodeURIComponent(r.barangay)}`)}
                title={`Plan a route out of ${r.barangay}`}
              >
                <span className="cut-name">{r.barangay}</span>
                <span className="cut-bar" aria-hidden="true">
                  <span className="cut-bar-fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="cut-depth">
                  {never ? <em>no cutoff</em> : `${r.cutoffM.toFixed(2)} m`}
                </span>
              </button>
              <div className="cut-meta">
                {never ? (
                  <span className="cut-muted">Stays connected up to the 2.5 m ceiling of this sweep.</span>
                ) : (
                  <>
                    {r.criticalRoads.length > 0 ? (
                      <span className="cut-road">
                        Last road out: <b>{r.criticalRoads[0].name}</b>
                        {r.criticalRoads.length > 1 && (
                          <span className="cut-muted"> +{r.criticalRoads.length - 1} more</span>
                        )}
                      </span>
                    ) : (
                      <span className="cut-muted">No named road on its final route.</span>
                    )}
                    {headroom != null && (
                      <span className={`cut-head ${headroom <= 0.1 ? 'tight' : ''}`}>
                        {headroom <= 0 ? 'cut off now' : `${headroom.toFixed(2)} m headroom`}
                      </span>
                    )}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <div className="cut-foot">
        {rows.length > 6 && (
          <button type="button" className="cut-more" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show top 6' : `Show all ${rows.length}`}
          </button>
        )}
        <button
          type="button"
          className="cut-method"
          onClick={() => setShowMethod((v) => !v)}
          aria-expanded={showMethod}
        >
          How this is calculated
        </button>
      </div>

      {showMethod && (
        <p className="cut-note">
          A uniform rise of X metres is spread over the city by terrain — low ground takes
          more of it — and a road is treated as impassable once the water over it reaches{' '}
          {IMPASSABLE_M} m. The sweep raises X until no route survives from the barangay to
          any open evacuation centre. There is no drainage, no culverts and no bridge deck
          heights in this model, so read the <b>order</b> as the finding and the individual
          depths as rough. Roads you have closed on Road Status are honoured at every level.
        </p>
      )}
    </div>
  )
}

function CutIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M3 12h5l2-5 4 10 2-5h5" />
    </svg>
  )
}
function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
