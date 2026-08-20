import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DRILL_SECONDS, getDrillState, startDrill, stopDrill, resumeDrill, subscribeDrill,
} from '../../services/drillMode.js'
import {
  useFloodReports, useIncidents, useRoadReports, useAlerts, useNotifications,
} from '../../context/AdminDataContext.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { BARANGAY_CENTROIDS } from '../../data/cabuyaoBarangays.js'
import './DrillMode.css'

/**
 * Drill mode — the banner, the controls, and the runner that writes the
 * scripted event into the real stores.
 *
 * The writing happens here rather than in drillMode.js because the stores are
 * React hooks. That split is deliberate: the service owns the script and the
 * clock and knows nothing about the app's data layer, and this component owns
 * the data layer and knows nothing about the script's contents.
 *
 * Everything created is tagged `drill: true`, which is what makes Reset exact —
 * it removes the drill's own records and cannot touch a real report that
 * happened to arrive while the drill was running.
 */
const DRILL_REPORTER = 'DRILL (simulated)'
const DRILL_PREFIX = '[DRILL] '

/* Does this record belong to a drill? Checks the markers that SURVIVE the
   database round-trip first. A plain drill:true flag does not: the row
   mappers only carry known columns, so after a reload the records came back
   untagged and Reset quietly left simulated reports behind. Writing the marker
   into text that persists also has the better property — a drill record is
   self-labelling wherever it is read, even if Reset is never pressed. */
function isDrillRecord(r) {
  if (!r) return false
  if (r.drill === true) return true
  if (typeof r.description === 'string' && r.description.startsWith(DRILL_PREFIX)) return true
  if (r.reporter === DRILL_REPORTER || r.reportedBy === DRILL_REPORTER) return true
  if (typeof r.reason === 'string' && r.reason.startsWith(DRILL_PREFIX)) return true
  return false
}

export default function DrillMode() {
  const [state, setState] = useState(getDrillState)
  const [confirmReset, setConfirmReset] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const { floodReports, submitFloodReport, removeFloodReport } = useFloodReports()
  const { incidents, addIncident, removeIncident } = useIncidents()
  const { roadReports, reportRoad, removeRoadReport } = useRoadReports()
  const { alerts, removeAlert } = useAlerts()
  const { notify } = useNotifications()

  useEffect(() => subscribeDrill(setState), [])

  // Live store handles for the step callback, which is created once at start.
  const storesRef = useRef({})
  storesRef.current = { submitFloodReport, addIncident, reportRoad, notify }

  const runStep = useCallback((step) => {
    const s = storesRef.current
    if (step.report) {
      // flood_reports requires a real lat/lng — the resident form always pins
      // one, so the drill has to as well or the row is rejected by the
      // database and only the optimistic copy survives.
      const at = BARANGAY_CENTROIDS.find((b) => b.name === step.report.barangay)?.coords
      s.submitFloodReport({
        ...step.report,
        coords: at,
        reporter: DRILL_REPORTER,
        description: DRILL_PREFIX + step.report.description,
        drill: true,
      })
    }
    if (step.road) {
      s.reportRoad({
        ...step.road,
        reason: DRILL_PREFIX + step.road.reason,
        reportedBy: DRILL_REPORTER,
        drill: true,
      })
    }
    if (step.incident) {
      s.addIncident({
        ...step.incident,
        description: DRILL_PREFIX + step.incident.description,
        status: 'new',
        team: '',
        drill: true,
      })
    }
    if (step.say) s.notify(step.rain >= 27 ? 'high' : 'moderate', 'Drill', step.say)
  }, [])

  const begin = useCallback(() => startDrill(runStep), [runStep])

  /* Reset: hand the feed back, then remove exactly what the drill created. */
  const reset = useCallback(() => {
    stopDrill()
    for (const r of floodReports) if (isDrillRecord(r)) removeFloodReport(r.id)
    for (const i of incidents) if (isDrillRecord(i)) removeIncident(i.id)
    for (const r of roadReports) if (isDrillRecord(r)) removeRoadReport(r.id)
    // Alerts the watcher raised during the drill: they are real records the
    // system genuinely decided to issue, so they are removed too — leaving
    // them would mean a simulated event left live warnings behind.
    for (const a of alerts) if (a.auto && a.issuedAt >= state.startedAt) removeAlert(a.id)
    setConfirmReset(false)
  }, [floodReports, incidents, roadReports, alerts, state.startedAt,
    removeFloodReport, removeIncident, removeRoadReport, removeAlert])

  /* Pick up a drill that was running before a reload. Its records are still in
     the stores, so the banner explaining them has to come back with them —
     ending the drill quietly on unload would leave a screen full of severe
     warnings and nothing saying they were simulated. */
  useEffect(() => { resumeDrill(runStep) }, [runStep])

  if (!state.active) return <DrillLauncher onStart={begin} />

  const pct = Math.min(100, (state.elapsed / DRILL_SECONDS) * 100)
  const latest = state.log[state.log.length - 1]

  return (
    <>
      <div className={`drill-bar ${collapsed ? 'is-collapsed' : ''}`} role="alert">
        <div className="drill-bar-main">
          <span className="drill-tag">
            <SirenIcon />
            DRILL MODE
          </span>
          <span className="drill-headline">
            Simulated event — <b>no real alerts are being sent</b>
          </span>

          <span className="drill-clock">
            {String(Math.floor(state.elapsed / 60)).padStart(2, '0')}:
            {String(state.elapsed % 60).padStart(2, '0')}
            <em> / {DRILL_SECONDS}s</em>
          </span>

          <button type="button" className="drill-btn drill-btn--ghost" onClick={() => setCollapsed((v) => !v)}>
            {collapsed ? 'Show log' : 'Hide log'}
          </button>
          <button type="button" className="drill-btn" onClick={() => setConfirmReset(true)}>
            Reset
          </button>
        </div>

        <div className="drill-progress" aria-hidden="true">
          <span className="drill-progress-fill" style={{ width: `${pct}%` }} />
        </div>

        {!collapsed && (
          <div className="drill-log">
            {latest && <div className="drill-latest">{latest.say}</div>}
            <ol className="drill-steps">
              {[...state.log].reverse().slice(0, 4).map((l) => (
                <li key={l.t}><span className="drill-t">+{l.t}s</span>{l.say}</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {confirmReset && (
        <ConfirmDialog
          title="End the drill and clear it?"
          tone="danger"
          confirmLabel="End & reset"
          message={
            <>
              The live weather feed comes back, and every record this drill created is
              removed — its flood reports, road closures, the logged incident, and any
              alert the system raised on its own while it ran. Real records filed during
              the drill are untouched.
            </>
          }
          onConfirm={reset}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </>
  )
}

/** The start control, tucked away so it can't be hit by accident. */
function DrillLauncher({ onStart }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <button
        type="button"
        className="drill-launch"
        onClick={() => setConfirm(true)}
        title="Run a 90-second simulated flood event"
      >
        <SirenIcon />
        Drill
      </button>
      {confirm && (
        <ConfirmDialog
          title="Run a 90-second drill?"
          tone="default"
          confirmLabel="Start drill"
          message={
            <>
              <p style={{ margin: '0 0 10px' }}>
                A scripted flood event feeds the real screens: rainfall climbs, resident
                reports arrive, roads close, and if you have Automatic Alerts switched on
                the system will issue alerts by itself once the thresholds go.
              </p>
              <p style={{ margin: 0 }}>
                Outbound email is blocked for the duration, and Reset removes everything
                the drill created.
              </p>
            </>
          }
          onConfirm={() => { setConfirm(false); onStart() }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </>
  )
}

function SirenIcon() {
  return (
    <svg viewBox="0 0 24 24" className="drill-icon">
      <path d="M12 3a5 5 0 0 0-5 5v5h10V8a5 5 0 0 0-5-5z" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <line x1="12" y1="3" x2="12" y2="1" />
      <line x1="4.5" y1="6.5" x2="3" y2="5" />
      <line x1="19.5" y1="6.5" x2="21" y2="5" />
    </svg>
  )
}
