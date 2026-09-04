/* ============================================================
   navigation.js — the turn-by-turn engine behind Guided Evacuation.

   Pure geometry and state: no React, no map library, no speech. Give it a
   planned route (the `coords` + `segments` that routeEngine's planRoute
   returns) and a stream of GPS fixes, and it answers the four questions a
   person walking out of a flood actually has:

     Where am I on this line?     → snapToRoute()
     What do I do next, and when? → buildSteps() + navigate()
     How far, how long?           → navigate().remainingM / etaSec
     Am I still on the route?     → navigate().offRouteM / offRoute

   WHY SNAPPING, NOT RAW GPS: a phone fix in a built-up barangay wanders 10–30 m
   and jitters every second. Drawing the raw dot makes the map twitch and makes
   "in 20 metres, turn left" fire at the wrong moment. Everything the navigator
   shows is measured from the position PROJECTED onto the route line, while the
   raw fix is kept only to decide whether the projection is still believable.

   WHY A SEARCH WINDOW: evacuation routes double back on themselves (out of a
   dead-end street, along the same road the other way). A global nearest-point
   search would teleport the user forward onto the returning leg and declare
   them nearly arrived. So the search starts from where they were last seen and
   only widens when it fails.
   ============================================================ */

/* ── Local planar geometry ───────────────────────────────────────────────────
   Cabuyao spans ~12 km. Over that, treating lat/lng as a flat grid scaled by
   the local metres-per-degree is accurate to well under a metre — far below GPS
   noise — and it turns every projection into two multiplications instead of a
   haversine. */
const M_PER_DEG_LAT = 110574
const D2R = Math.PI / 180

function mPerDegLng(lat) {
  return 111320 * Math.cos(lat * D2R)
}

/** Great-circle metres between two [lat, lng] points. */
export function distanceM(a, b) {
  const mLng = mPerDegLng((a[0] + b[0]) / 2)
  const dx = (b[1] - a[1]) * mLng
  const dy = (b[0] - a[0]) * M_PER_DEG_LAT
  return Math.hypot(dx, dy)
}

/** Compass bearing a → b, degrees clockwise from north (0–360). */
export function bearing(a, b) {
  const mLng = mPerDegLng((a[0] + b[0]) / 2)
  const dx = (b[1] - a[1]) * mLng
  const dy = (b[0] - a[0]) * M_PER_DEG_LAT
  const deg = Math.atan2(dx, dy) / D2R
  return (deg + 360) % 360
}

/** Signed smallest angle from bearing `from` to bearing `to`, in (-180, 180]. */
export function angleDelta(from, to) {
  let d = ((to - from + 540) % 360) - 180
  if (d === -180) d = 180
  return d
}

/** Cumulative distance-along-route for each vertex. cum[0] === 0. */
export function cumulative(coords) {
  const cum = new Float64Array(coords.length)
  for (let i = 1; i < coords.length; i++) {
    cum[i] = cum[i - 1] + distanceM(coords[i - 1], coords[i])
  }
  return cum
}

/** The point `alongM` metres into the route, interpolated inside its segment. */
export function pointAtAlong(coords, cum, alongM) {
  if (coords.length === 0) return null
  const total = cum[cum.length - 1]
  const target = Math.max(0, Math.min(total, alongM))
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= target) lo = mid
    else hi = mid
  }
  const segLen = cum[hi] - cum[lo]
  const t = segLen > 0 ? (target - cum[lo]) / segLen : 0
  return [
    coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t,
    coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t,
  ]
}

/**
 * Split the route line at `alongM` into the part already walked and the part
 * still ahead — the two polylines the map draws in different colours so the
 * route visibly drains as the resident moves.
 */
export function splitAtAlong(coords, cum, alongM) {
  if (coords.length < 2) return { traveled: [], remaining: coords }
  const total = cum[cum.length - 1]
  const target = Math.max(0, Math.min(total, alongM))
  const cut = pointAtAlong(coords, cum, target)
  let i = 0
  while (i < cum.length - 1 && cum[i + 1] <= target) i++
  const traveled = coords.slice(0, i + 1)
  traveled.push(cut)
  const remaining = [cut, ...coords.slice(i + 1)]
  return { traveled, remaining }
}

/**
 * Project a GPS fix onto the route line.
 *
 * `hintIdx` is the segment the user was on last fix; the search runs outward
 * from there and only falls back to a full scan when nothing within the window
 * is close enough. That is what keeps a route that doubles back from snapping
 * the walker onto the returning leg.
 *
 * Returns { index, t, point, offRouteM, alongM } — `index` is the segment
 * coords[index] → coords[index+1], `t` the fraction into it.
 */
export function snapToRoute(coords, cum, pos, hintIdx = 0, windowSegs = 40) {
  if (coords.length < 2) return null
  const lat0 = pos[0]
  const mLng = mPerDegLng(lat0)

  function scan(from, to) {
    let best = null
    for (let i = Math.max(0, from); i < Math.min(coords.length - 1, to); i++) {
      const a = coords[i]
      const b = coords[i + 1]
      const ax = (a[1] - pos[1]) * mLng
      const ay = (a[0] - lat0) * M_PER_DEG_LAT
      const bx = (b[1] - pos[1]) * mLng
      const by = (b[0] - lat0) * M_PER_DEG_LAT
      const vx = bx - ax
      const vy = by - ay
      const len2 = vx * vx + vy * vy
      let t = len2 > 0 ? -(ax * vx + ay * vy) / len2 : 0
      t = Math.max(0, Math.min(1, t))
      const px = ax + vx * t
      const py = ay + vy * t
      const d2 = px * px + py * py
      if (!best || d2 < best.d2) best = { i, t, d2 }
    }
    return best
  }

  // Bias slightly forward: the walker is far more likely to have advanced than
  // to have gone back, and a symmetric window lets noise pull them backwards.
  let best = scan(hintIdx - Math.round(windowSegs / 4), hintIdx + windowSegs)
  // Nothing plausible nearby (a real detour, or a first fix far from the line):
  // fall back to the whole route rather than reporting a wrong segment.
  if (!best || Math.sqrt(best.d2) > 120) {
    const global = scan(0, coords.length - 1)
    if (global && (!best || global.d2 < best.d2)) best = global
  }
  if (!best) return null

  const segLen = cum[best.i + 1] - cum[best.i]
  return {
    index: best.i,
    t: best.t,
    point: [
      coords[best.i][0] + (coords[best.i + 1][0] - coords[best.i][0]) * best.t,
      coords[best.i][1] + (coords[best.i + 1][1] - coords[best.i][1]) * best.t,
    ],
    offRouteM: Math.sqrt(best.d2),
    alongM: cum[best.i] + segLen * best.t,
  }
}

/* ── Turn-by-turn step list ─────────────────────────────────────────────── */

/* Maneuver kinds a step can carry, in the order a turn gets sharper:
   depart · straight · continue · slight-left/right · left/right ·
   sharp-left/right · uturn · arrive. Every one has an arrow in
   LiveNavigation's ARROWS table and a phrase in KIND_EN / KIND_FIL, so
   adding one means adding it in all three places. */

function turnKind(delta) {
  const a = Math.abs(delta)
  if (a >= 155) return 'uturn'
  if (a >= 115) return delta > 0 ? 'sharp-right' : 'sharp-left'
  if (a >= 45) return delta > 0 ? 'right' : 'left'
  if (a >= 20) return delta > 0 ? 'slight-right' : 'slight-left'
  return 'straight'
}

/**
 * Bearing of the route around vertex `idx`, measured over ~`span` metres so a
 * single 4-metre digitising wobble cannot masquerade as a turn.
 */
function smoothedBearing(coords, cum, idx, span, forward) {
  const here = coords[idx]
  const target = forward ? cum[idx] + span : cum[idx] - span
  const other = pointAtAlong(coords, cum, target)
  if (!other) return null
  if (distanceM(here, other) < 1) return null
  return forward ? bearing(here, other) : bearing(other, here)
}

/**
 * Turn the planned path into the list of things a person is told to do.
 *
 * A step is emitted where the route actually asks for a decision: at a real
 * junction (3+ ways meet) that either bends noticeably or moves onto a
 * differently-named road. Everything else — the gentle curve of a barangay
 * road, the 40 OSM vertices that describe it — stays silent, which is the whole
 * difference between directions and a coordinate dump.
 *
 * @param {[number,number][]} coords route vertices
 * @param {Array} segments  routeEngine per-leg metadata (segments[i]: coords[i]→[i+1])
 * @param {{ destination?: string }} opts
 */
export function buildSteps(coords, segments = [], opts = {}) {
  if (!Array.isArray(coords) || coords.length < 2) return []
  const cum = cumulative(coords)
  const total = cum[cum.length - 1]
  const nameAt = (i) => segments[i]?.name || null

  // The road the route starts on: the first named segment within 150 m, so
  // "Head north on Mabini Street" beats "Head north" when the first few
  // vertices happen to be an unnamed driveway.
  let startName = null
  for (let i = 0; i < segments.length && cum[i] < 150; i++) {
    if (segments[i].name) { startName = segments[i].name; break }
  }

  const raw = [{
    at: 0,
    idx: 0,
    kind: 'depart',
    road: startName,
    heading: smoothedBearing(coords, cum, 0, 40, true),
    oneway: segments[0]?.oneway || 0,
    wrongWay: Boolean(segments[0]?.wrongWay),
  }]

  let currentName = nameAt(0)
  for (let k = 1; k < coords.length - 1; k++) {
    const seg = segments[k]
    if (!seg) continue
    const outName = seg.name
    // An unnamed stretch (alleys, service spurs) is treated as a continuation
    // of the road it left, not as a new road with no name.
    if (outName) {
      const before = smoothedBearing(coords, cum, k, 22, false)
      const after = smoothedBearing(coords, cum, k, 22, true)
      const delta = before != null && after != null ? angleDelta(before, after) : 0
      const kind = turnKind(delta)
      const junction = (seg.degree ?? 2) >= 3
      const renamed = currentName && outName !== currentName
      const named = !currentName

      /* What counts as an instruction.

         A slight bend while STAYING on the same road is not a decision — it is
         how roads are shaped, and "bear right onto Ruby Street" while already
         on Ruby Street teaches the listener to stop trusting the voice. So a
         same-road step has to be a real turn (45°+); a change of road can be
         announced at any angle, because the name is the information. */
      const worth =
        (junction && renamed && kind !== 'straight') ||
        (junction && (renamed || named)) ||
        (junction && !renamed && Math.abs(delta) >= 45) ||
        // A hairpin the network models without a junction node still has to be
        // called: the walker is being turned around.
        Math.abs(delta) >= 100

      if (worth) {
        raw.push({
          at: cum[k],
          idx: k,
          kind: kind === 'straight' ? (renamed || named ? 'continue' : 'straight') : kind,
          road: outName,
          delta,
          /* One-way state of the road being turned ONTO. Carried per step
             rather than announced per segment so the walker hears it once,
             at the junction where it becomes true, instead of every time the
             way id changes along the same street. */
          oneway: seg.oneway || 0,
          wrongWay: Boolean(seg.wrongWay),
        })
      }
      currentName = outName
    }
  }

  raw.push({
    at: total,
    idx: coords.length - 1,
    kind: 'arrive',
    road: opts.destination || null,
  })

  /* Collapse instructions that land on top of each other. Two turns 15 m apart
     cannot both be spoken in time; the sharper one is the one that matters, and
     the road name of the later one is what the walker ends up on. */
  const steps = []
  for (const s of raw) {
    const prev = steps[steps.length - 1]
    /* A turn in the first few metres is part of leaving, not a separate
       instruction — the departure line already put the walker on that road. */
    if (s.kind !== 'depart' && s.kind !== 'arrive' && s.at < 25) continue
    if (prev && s.kind !== 'arrive' && prev.kind !== 'depart' && s.at - prev.at < 22) {
      if (Math.abs(s.delta ?? 0) > Math.abs(prev.delta ?? 0)) {
        prev.kind = s.kind
        prev.delta = s.delta
      }
      prev.road = s.road || prev.road
      continue
    }
    steps.push({ ...s })
  }

  // Each step carries the length of the leg that FOLLOWS it, which is what the
  // banner counts down and what the voice uses for "in 200 metres".
  for (let i = 0; i < steps.length; i++) {
    steps[i].legM = (i < steps.length - 1 ? steps[i + 1].at : total) - steps[i].at
    steps[i].index = i
  }
  return steps
}

/* ── Compass + phrasing ──────────────────────────────────────────────────── */

const COMPASS_EN = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
const COMPASS_FIL = ['hilaga', 'hilagang-silangan', 'silangan', 'timog-silangan', 'timog', 'timog-kanluran', 'kanluran', 'hilagang-kanluran']

export function compassName(deg, lang = 'en') {
  if (deg == null || Number.isNaN(deg)) return ''
  const i = Math.round(((deg % 360) + 360) % 360 / 45) % 8
  return (lang === 'fil' ? COMPASS_FIL : COMPASS_EN)[i]
}

const KIND_EN = {
  depart: 'Head',
  straight: 'Continue straight',
  continue: 'Continue',
  'slight-left': 'Bear left',
  'slight-right': 'Bear right',
  left: 'Turn left',
  right: 'Turn right',
  'sharp-left': 'Sharp left',
  'sharp-right': 'Sharp right',
  uturn: 'Make a U-turn',
  arrive: 'Arrive',
}

const KIND_FIL = {
  depart: 'Maglakad',
  straight: 'Dumiretso lang',
  continue: 'Magpatuloy',
  'slight-left': 'Bahagyang kumaliwa',
  'slight-right': 'Bahagyang kumanan',
  left: 'Kumaliwa',
  right: 'Kumanan',
  'sharp-left': 'Matulis na kaliwa',
  'sharp-right': 'Matulis na kanan',
  uturn: 'Umikot pabalik',
  arrive: 'Dumating',
}

/** Short label for the maneuver banner (no distance, no destination). */
export function stepTitle(step, lang = 'en') {
  if (!step) return ''
  const fil = lang === 'fil'
  const table = fil ? KIND_FIL : KIND_EN
  if (step.kind === 'depart') {
    const dir = compassName(step.heading, lang)
    if (fil) return step.road ? `Maglakad pa-${dir} sa ${step.road}` : `Maglakad pa-${dir}`
    return step.road ? `Head ${dir} on ${step.road}` : `Head ${dir}`
  }
  if (step.kind === 'arrive') {
    if (fil) return step.road ? `Dumating sa ${step.road}` : 'Dumating sa evacuation center'
    return step.road ? `Arrive at ${step.road}` : 'Arrive at the evacuation center'
  }
  const verb = table[step.kind] || table.continue
  if (!step.road) return verb
  return fil ? `${verb} sa ${step.road}` : `${verb} onto ${step.road}`
}

/** Distance phrased the way it is spoken, not the way it is stored. */
export function spokenDistance(m, lang = 'en') {
  const fil = lang === 'fil'
  if (m >= 950) {
    const km = (m / 1000).toFixed(m < 9500 ? 1 : 0)
    return fil ? `${km} kilometro` : `${km} kilometers`
  }
  // Round to something a person can act on. "In 187 metres" is noise.
  const step = m > 400 ? 100 : m > 100 ? 50 : m > 30 ? 10 : 5
  const r = Math.max(step, Math.round(m / step) * step)
  return fil ? `${r} metro` : `${r} meters`
}

/**
 * The sentence the voice says.
 * `phase` is how urgent it is: 'far' (~400 m), 'near' (~150 m), 'now' (~30 m).
 */
/**
 * The one-way warning appended to a spoken instruction, or '' when there is
 * nothing to say.
 *
 * WHY A PEDESTRIAN IS TOLD AT ALL
 * A one-way street is one-way for vehicles, so an evacuating resident on foot
 * is routed along it in either direction (see routeEngine's ONE-WAY block).
 * That is the right routing decision and it is NOT the whole duty of care:
 * the walker still needs to know which way the cars will be coming, at night,
 * in rain, possibly in the roadway because the footpath is under water.
 *
 * The two cases carry genuinely different advice, and getting them the wrong
 * way round would be worse than saying nothing:
 *
 *   against the flow — traffic approaches head-on. You can see it. This is
 *                      the safer of the two, and it is the direction road
 *                      safety advice tells pedestrians to walk.
 *   with the flow    — traffic comes from BEHIND. You cannot see it coming,
 *                      which is the case worth warning about.
 *
 * Spoken only at the junction itself ('now'), and only when turning onto the
 * street — repeating it at every distance callout would train the listener to
 * tune the voice out, which costs more than it gains.
 */
export function onewayNote(step, lang = 'en', phase = 'near') {
  if (!step?.oneway || phase !== 'now') return ''
  const fil = lang === 'fil'
  if (step.wrongWay) {
    return fil
      ? ' Isang direksyon lang ang kalsadang ito — paharap sa iyo ang mga sasakyan.'
      : ' This is a one-way street — traffic will be coming towards you.'
  }
  return fil
    ? ' Isang direksyon lang ang kalsadang ito — manggagaling sa likuran mo ang mga sasakyan.'
    : ' This is a one-way street — traffic comes from behind you.'
}

export function stepPhrase(step, distM, lang = 'en', phase = 'near') {
  if (!step) return ''
  const fil = lang === 'fil'
  if (step.kind === 'depart') {
    const dir = compassName(step.heading, lang)
    return (fil
      ? `Simulan ang paglikas. Maglakad pa-${dir}${step.road ? ` sa ${step.road}` : ''}.`
      : `Starting your evacuation route. Head ${dir}${step.road ? ` on ${step.road}` : ''}.`)
      + onewayNote(step, lang, 'now')
  }
  if (step.kind === 'arrive') {
    if (phase === 'now') {
      return fil
        ? `Narating mo na ang ${step.road || 'evacuation center'}. Mag-report sa mga responder.`
        : `You have arrived at ${step.road || 'the evacuation center'}. Report to the responders on site.`
    }
    return fil
      ? `Sa ${spokenDistance(distM, lang)}, darating ka sa ${step.road || 'evacuation center'}.`
      : `In ${spokenDistance(distM, lang)}, you will arrive at ${step.road || 'the evacuation center'}.`
  }
  const verb = (fil ? KIND_FIL : KIND_EN)[step.kind] || (fil ? KIND_FIL.continue : KIND_EN.continue)
  const onto = step.road ? (fil ? ` sa ${step.road}` : ` onto ${step.road}`) : ''
  const note = onewayNote(step, lang, phase)
  if (phase === 'now') {
    return (fil ? `${verb} ngayon${onto}.` : `Now, ${verb.toLowerCase()}${onto}.`) + note
  }
  return (fil
    ? `Sa ${spokenDistance(distM, lang)}, ${verb.toLowerCase()}${onto}.`
    : `In ${spokenDistance(distM, lang)}, ${verb.toLowerCase()}${onto}.`) + note
}

/* ── Live navigation state ──────────────────────────────────────────────── */

/** Walking pace used before the device reports a believable speed (m/s). */
export const WALK_MPS = 1.25
/** Within this distance of the end, the trip is over. */
export const ARRIVE_M = 25
/** Sustained perpendicular error that counts as leaving the route. */
export const OFF_ROUTE_M = 40

/**
 * Fold one GPS fix into the navigation state.
 *
 * @param {{coords, cum, steps, total}} route  prepared by prepareRoute()
 * @param {{lat, lng, accuracy, speed, heading}} fix
 * @param {object} prev  the previous return value (or null on the first fix)
 */
export function navigate(route, fix, prev = null) {
  const { coords, cum, steps, total } = route
  const pos = [fix.lat, fix.lng]
  const snap = snapToRoute(coords, cum, pos, prev?.index ?? 0)
  if (!snap) return prev

  /* Progress may not run backwards on noise. A walker who stops still produces
     fixes that wander a few metres either way, and a progress bar that slides
     backwards reads as the system losing track of them. Real backward movement
     (more than 25 m) is honoured — they turned round. */
  let alongM = snap.alongM
  if (prev && alongM < prev.alongM && prev.alongM - alongM < 25) alongM = prev.alongM

  const remainingM = Math.max(0, total - alongM)

  // Off-route has to persist: one bad fix behind a wall is not a wrong turn.
  const tolerance = Math.max(OFF_ROUTE_M, Math.min(90, (fix.accuracy || 0) * 1.4))
  const strayed = snap.offRouteM > tolerance
  const strayCount = strayed ? (prev?.strayCount ?? 0) + 1 : 0

  // Which instruction are we working on? The next step whose maneuver point is
  // still ahead of us.
  let stepIndex = 0
  while (stepIndex < steps.length - 1 && steps[stepIndex].at <= alongM + 1) stepIndex++
  const step = steps[stepIndex] || steps[steps.length - 1]
  const distToStep = Math.max(0, (step?.at ?? total) - alongM)

  /* Speed: the device's own reading when it is moving and believable, else the
     average it has actually managed on this trip, else a walking pace. Using a
     measured pace matters — an ETA that assumes 1.25 m/s for someone wading is
     a promise the system cannot keep. */
  let speed = WALK_MPS
  if (typeof fix.speed === 'number' && fix.speed > 0.35 && fix.speed < 15) {
    speed = prev?.speed ? prev.speed * 0.6 + fix.speed * 0.4 : fix.speed
  } else if (prev?.speed) {
    speed = prev.speed * 0.85 + WALK_MPS * 0.15
  }

  const etaSec = remainingM / Math.max(0.5, speed)
  const arrived = remainingM <= ARRIVE_M || distanceM(pos, coords[coords.length - 1]) <= ARRIVE_M

  // Heading for the puck: the device compass when moving, else the direction
  // the route itself points, so the arrow never spins idly at a standstill.
  const routeHeading = smoothedBearing(coords, cum, snap.index, 30, true)
  const heading = typeof fix.heading === 'number' && !Number.isNaN(fix.heading) && speed > 0.6
    ? fix.heading
    : (routeHeading ?? prev?.heading ?? 0)

  return {
    index: snap.index,
    snapped: snap.point,
    raw: pos,
    accuracy: fix.accuracy ?? null,
    alongM,
    remainingM,
    progress: total > 0 ? Math.min(1, alongM / total) : 0,
    offRouteM: snap.offRouteM,
    strayCount,
    offRoute: strayCount >= 3,
    stepIndex,
    step,
    distToStep,
    speed,
    etaSec,
    heading,
    arrived,
    at: fix.at ?? Date.now(),
  }
}

/** Bundle a raw coordinate list into the shape navigate() consumes. */
export function prepareRoute(coords, segments, opts = {}) {
  const cum = cumulative(coords)
  return {
    coords,
    cum,
    total: cum[cum.length - 1] || 0,
    steps: buildSteps(coords, segments, opts),
    segments,
  }
}

/** "8 min" / "1 hr 5 min" — ETA as a person reads it. */
export function formatEta(sec) {
  if (!Number.isFinite(sec)) return '--'
  const mins = Math.round(sec / 60)
  if (mins < 1) return 'under a min'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  return `${h} hr ${mins % 60} min`
}

/** Clock time of arrival in PHT, which is what people actually plan around. */
export function arrivalClock(sec) {
  if (!Number.isFinite(sec)) return '--:--'
  return new Date(Date.now() + sec * 1000).toLocaleTimeString('en-PH', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
  })
}
