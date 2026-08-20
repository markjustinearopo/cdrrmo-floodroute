import { setWeatherOverride } from './weather.js'
import { invalidateFloodField } from '../components/admin/floodRisk.js'

/* ============================================================
   Drill mode — a scripted 90-second flood event.

   WHY THIS EXISTS, beyond the demo: defence day will probably be sunny. Every
   map reads safe, every queue is empty, the auto-alert watcher never fires, and
   a system built for the worst day of the year gets judged on its quietest.
   That is a real risk and an avoidable one.

   It is also a genuine training tool. A CDRRMO office can run this on a Tuesday
   morning and watch a new operator work a rising event — read the hazard map,
   approve a barangay's road closure, dispatch a route — without waiting for a
   typhoon to practise on. That is what a drill IS.

   HOW IT WORKS: it does NOT build a parallel system. It writes into the same
   AdminDataContext stores and the same weather snapshot the real feeds use, so
   every screen reacts naturally and nothing downstream knows the difference.
   The auto-alert watcher in particular is untouched — when it fires during a
   drill it is because the hazard model genuinely crossed the operator's own
   configured threshold. Watching the system act on its own is the point.

   SAFETY: while a drill is active, outbound email is hard-blocked at the
   send function itself (see emailAlert.js), not merely skipped by the caller.
   Every record the drill creates is tagged `drill: true` so Reset can remove
   exactly those and nothing else.
   ============================================================ */

export const DRILL_SECONDS = 90

/* The scripted event. Each step is a moment in a rising Habagat afternoon:
   rain climbs, residents report, roads close, and the thresholds go. The
   numbers are the ones a real event in Cabuyao produces — 30 mm/h and a
   discharge near the basin's flood reference — not values picked to look
   dramatic. */
export const SCRIPT = [
  { at: 0, rain: 2, gust: 25, discharge: 45, say: 'Drill started — light rain over the city.' },
  { at: 8, rain: 6, gust: 32, discharge: 58, say: 'Rain intensifying over the lakeshore barangays.' },
  {
    at: 16,
    rain: 11,
    gust: 40,
    discharge: 72,
    say: 'Resident flood report — Mamatid.',
    report: {
      barangay: 'Mamatid', level: 'moderate', depthFt: 1.5,
      description: 'Water rising fast along NIA Road, about knee-deep at the corner.',
      reporter: 'Drill Resident',
    },
  },
  {
    at: 26,
    rain: 16,
    gust: 48,
    discharge: 88,
    say: 'NIA Road reported impassable.',
    road: { name: 'NIA Road', barangay: 'Mamatid', status: 'caution', depthFt: 2, reason: 'Rising water along the irrigation corridor.' },
  },
  {
    at: 36,
    rain: 22,
    gust: 55,
    discharge: 104,
    say: 'Second report — Baclaran lakeshore.',
    report: {
      barangay: 'Baclaran', level: 'severe', depthFt: 3,
      description: 'Lake backflow at the shoreline, waist-deep on the access road.',
      reporter: 'Drill Resident',
    },
  },
  {
    at: 46,
    rain: 27,
    gust: 62,
    discharge: 118,
    say: 'Incident logged — stranded vehicle, Banlic.',
    incident: {
      type: 'Flooding', barangay: 'Banlic', location: 'Alimagno Compound',
      priority: 'high', description: 'Vehicle stranded in rising water, occupants on the roof.',
    },
  },
  {
    at: 56,
    rain: 31,
    gust: 68,
    discharge: 128,
    say: 'Flood-depth thresholds breached — automatic alerts may now fire on their own.',
  },
  {
    at: 66,
    rain: 34,
    gust: 72,
    discharge: 134,
    say: 'Banlic–Mamatid Road closed — the chokepoint the cutoff analysis flagged.',
    road: { name: 'Banlic - Mamatid Road', barangay: 'Banlic', status: 'closed', depthFt: 4, reason: 'Impassable — the last road out for five barangays.' },
  },
  {
    at: 76,
    rain: 36,
    gust: 76,
    discharge: 140,
    say: 'Peak intensity — lakeshore barangays at severe risk.',
    report: {
      barangay: 'Gulod', level: 'impassable', depthFt: 4.5,
      description: 'Chest-deep, no vehicle can pass. Residents moving to the school.',
      reporter: 'Drill Resident',
    },
  },
  { at: 86, rain: 33, gust: 70, discharge: 138, say: 'Rain easing slightly — event still active.' },
  { at: DRILL_SECONDS, rain: 30, gust: 64, discharge: 132, say: 'Drill complete — conditions held. Press Reset to restore.' },
]

/* ── State ────────────────────────────────────────────────────────────────
   Persisted to sessionStorage, and the reason is a safety one rather than a
   convenience one. A drill leaves records behind — reports, closures, the
   alerts the system raised by itself — and those must never outlive the BANNER
   that explains them. If a reload ended the drill silently, the next person to
   look at the screen would find fifteen severe flood warnings and nothing at
   all saying they were simulated.

   So a reload resumes the drill instead: the banner comes back, the clock
   carries on, and Reset is still there to clean up. sessionStorage bounds it to
   the tab, so closing the tab genuinely ends it. */
const STORE_KEY = 'cdrrmo_drill_state'
const listeners = new Set()

const IDLE = {
  active: false,
  startedAt: 0,
  elapsed: 0,
  stepIndex: -1,
  log: [],        // [{ t, say }]
  finished: false,
}

function readPersisted() {
  try {
    const v = JSON.parse(sessionStorage.getItem(STORE_KEY))
    return v && v.active ? { ...IDLE, ...v } : { ...IDLE }
  } catch {
    return { ...IDLE }
  }
}

let state = readPersisted()
let timer = null

function persist() {
  try {
    if (state.active) sessionStorage.setItem(STORE_KEY, JSON.stringify(state))
    else sessionStorage.removeItem(STORE_KEY)
  } catch { /* private mode — the in-memory state still holds */ }
}

function emit() {
  state = { ...state }
  persist()
  for (const fn of listeners) fn(state)
}

export function getDrillState() {
  return state
}

/**
 * The one question the outbound paths ask. Kept as a bare function rather than
 * a hook so a non-React module (emailAlert) can gate on it.
 */
export function isDrillActive() {
  return state.active
}

export function subscribeDrill(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Push the scripted weather into the shared snapshot and rebuild the field. */
function applyWeather(step) {
  setWeatherOverride({
    current: {
      rain: step.rain,
      windKmh: Math.round(step.gust * 0.72),
      gustKmh: step.gust,
      code: step.rain >= 20 ? 95 : step.rain >= 7 ? 65 : 61,
    },
    discharge: step.discharge,
    live: true,
  })
  invalidateFloodField()
}

/**
 * Start the drill. `onStep` is handed each step so a React runner can write
 * into the stores with hooks — this module deliberately holds no store access
 * of its own.
 */
export function startDrill(onStep, { resume = false } = {}) {
  if (state.active && !resume) return
  if (!resume) {
    state = { active: true, startedAt: Date.now(), elapsed: 0, stepIndex: -1, log: [], finished: false }
  }
  emit()

  const tick = () => {
    const elapsed = Math.min(DRILL_SECONDS, Math.round((Date.now() - state.startedAt) / 1000))
    let idx = state.stepIndex
    while (idx + 1 < SCRIPT.length && SCRIPT[idx + 1].at <= elapsed) {
      idx++
      const step = SCRIPT[idx]
      applyWeather(step)
      state.log = [...state.log, { t: step.at, say: step.say }]
      try { onStep?.(step) } catch (e) { console.error('[drill] step failed', e) }
    }
    state.elapsed = elapsed
    state.stepIndex = idx
    if (elapsed >= DRILL_SECONDS) {
      state.finished = true
      clearInterval(timer)
      timer = null
    }
    emit()
  }

  tick()
  timer = setInterval(tick, 1000)
}

/**
 * End the drill and hand back the live feed. Records the drill created are
 * removed by the runner, which owns the store handles.
 */
export function stopDrill() {
  if (timer) { clearInterval(timer); timer = null }
  setWeatherOverride(null)
  invalidateFloodField()
  state = { ...IDLE }
  emit()
}

/**
 * Pick a reloaded drill back up. Re-applies the weather of the step it had
 * reached — without replaying the earlier steps, which already wrote their
 * records — and lets the clock run on if there is time left.
 */
export function resumeDrill(onStep) {
  if (!state.active) return false
  const reached = SCRIPT[Math.max(0, state.stepIndex)]
  if (reached) applyWeather(reached)
  if (state.finished || state.elapsed >= DRILL_SECONDS) {
    emit()
    return true
  }
  startDrill(onStep, { resume: true })
  return true
}
