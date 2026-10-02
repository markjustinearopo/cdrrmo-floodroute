import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { profileFor, DEFAULT_ALPHA } from '../admin/routeEngine.js'
import { checkRouteSafety } from '../admin/routeSafety.js'
import { FlaggedRoadsLayer } from '../map/RoadConditionsLayer.jsx'
import { formatDistance } from '../../services/systemConfig.js'
import { getUserLanguage } from '../../services/i18n.js'
import useLiveTracking from '../../hooks/useLiveTracking.js'
import {
  prepareRoute,
  navigate,
  splitAtAlong,
  pointAtAlong,
  stepTitle,
  stepPhrase,
  formatEta,
  arrivalClock,
} from '../../services/navigation.js'
import * as speech from '../../services/speech.js'
import ErrorBoundary from '../ErrorBoundary.jsx'
import './liveNavigation.css'

/* Lazy: Mapbox GL is ~500 kB gzipped and most residents will never switch to
   the 3D view. Loading it only on the toggle keeps the 2D navigator — the one
   that always works — free of that weight. */
const LiveNavigation3D = lazy(() => import('./LiveNavigation3D.jsx'))

/* ============================================================
   LiveNavigation — guided, spoken, self-correcting evacuation navigation.

   This is the screen a resident actually uses while walking out of a flood, so
   it is built around three commitments:

     IT FOLLOWS YOU.      A GPS watch feeds a fix roughly every second. The map
                          camera, the puck, the shrinking route line and the
                          distance countdown are all driven from it, eased at
                          animation frame rate so movement reads as movement and
                          not as a dot teleporting once a second.

     IT RE-DECIDES.       Miss a turn, or walk into a street CDRRMO has just
                          flagged as flooded, and the route is re-planned from
                          where you are standing — flood-aware, against the same
                          A* engine the command centre uses. You are told, out
                          loud, that it happened.

     IT TALKS.            Nobody reads a screen while wading. Instructions are
                          spoken at 400 m, 150 m and at the junction itself, in
                          English or Filipino, following the system language.

   WHY THE MAP IS NORTH-UP, NOT HEADING-UP: Leaflet cannot rotate its tile
   layer, and faking rotation with CSS transforms breaks every marker's hit box
   and the tile grid at the edges. Instead the camera keeps north up and offsets
   the walker toward the bottom of the screen, so what is ahead of them fills
   the view. The puck itself rotates, which is what carries the sense of
   direction.

   WHY THE HEAVY WORK IS IMPERATIVE: React state at 60 fps would re-render the
   whole tree sixty times a second on a mid-range phone. Position, camera, line
   trimming and the countdown text are mutated directly on the Leaflet objects
   and DOM nodes inside one requestAnimationFrame loop; React only re-renders
   when something a person would actually notice changes — a new instruction, a
   reroute, arrival.
   ============================================================ */

/* Distances at which each instruction is spoken, in metres. */
const ANNOUNCE_FAR = 400
const ANNOUNCE_NEAR = 160
const ANNOUNCE_NOW = 38
/* A leg shorter than this never gets the "in 400 metres" call — there is no
   400 metres, and the early warning would arrive before the previous turn. */
const FAR_MIN_LEG = 520
/* Never re-plan more often than this; a reroute storm is worse than a detour. */
const REROUTE_COOLDOWN_MS = 9000
/* How far ahead a flagged flooded road is worth warning about. */
const HAZARD_LOOKAHEAD_M = 320

/* ── Maneuver arrows ─────────────────────────────────────────────────────── */
const ARROWS = {
  depart: 'M12 20V6M12 6l-5 5M12 6l5 5',
  straight: 'M12 20V5M12 5l-5 5M12 5l5 5',
  continue: 'M12 20V5M12 5l-5 5M12 5l5 5',
  'slight-left': 'M13 20v-6a5 5 0 0 0-5-5H7M7 9l4-4M7 9l4 4',
  'slight-right': 'M11 20v-6a5 5 0 0 1 5-5h1M17 9l-4-4M17 9l-4 4',
  left: 'M17 20v-7a4 4 0 0 0-4-4H6M6 9l5-5M6 9l5 5',
  right: 'M7 20v-7a4 4 0 0 1 4-4h7M18 9l-5-5M18 9l-5 5',
  'sharp-left': 'M16 20v-6a6 6 0 0 0-6-6H8M13 4L7 8l5 4',
  'sharp-right': 'M8 20v-6a6 6 0 0 1 6-6h2M11 4l6 4-5 4',
  uturn: 'M8 20V11a4 4 0 0 1 8 0v3M16 14l-3-3M16 14l3-3',
  arrive: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z M12 10h.01',
}

function ManeuverArrow({ kind, className = '' }) {
  return (
    <svg className={`lnav-arrow ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={ARROWS[kind] || ARROWS.straight} />
    </svg>
  )
}

/* ── The imperative half: everything that moves every frame ──────────────── */

/**
 * Owns the Leaflet objects that animate: the route lines, the walker puck and
 * the camera. Reads the live navigation result out of a ref so a new GPS fix
 * never re-renders React — it just moves what is on the screen.
 */
function NavLayer({ route, nav, navRef, onUserPan, chaseRef }) {
  const map = useMap()
  const layersRef = useRef(null)
  const animRef = useRef({ alongM: 0, lat: null, lng: null, heading: 0, started: false })

  /* Build the layers once per route (a reroute swaps the whole thing). */
  useEffect(() => {
    if (!route?.coords?.length) return undefined
    const group = L.layerGroup().addTo(map)

    const traveled = L.polyline([], {
      color: '#94a3b8', weight: 7, opacity: 0.55, lineCap: 'round', lineJoin: 'round',
      interactive: false,
    }).addTo(group)
    const halo = L.polyline(route.coords, {
      color: '#0f766e', weight: 18, opacity: 0.18, lineCap: 'round', lineJoin: 'round',
      interactive: false,
    }).addTo(group)
    const core = L.polyline(route.coords, {
      color: '#10b981', weight: 8, opacity: 0.98, lineCap: 'round', lineJoin: 'round',
      interactive: false,
    }).addTo(group)
    const flow = L.polyline(route.coords, {
      color: '#ecfdf5', weight: 3, opacity: 0.85, dashArray: '10 22', lineCap: 'round',
      className: 'lnav-flow', interactive: false,
    }).addTo(group)

    // The junction the walker is being sent to, pulsing on the line ahead.
    const maneuver = L.circleMarker(route.coords[0], {
      radius: 9, color: '#ffffff', weight: 3, fillColor: '#f59e0b', fillOpacity: 1,
      className: 'lnav-maneuver-dot', interactive: false,
    }).addTo(group)

    const dest = L.marker(route.coords[route.coords.length - 1], {
      icon: L.divIcon({
        className: 'lnav-dest',
        html: '<span class="lnav-dest-ring"></span><span class="lnav-dest-core"></span>',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
      interactive: false,
    }).addTo(group)

    const accuracy = L.circle(route.coords[0], {
      radius: 0, color: '#2563eb', weight: 1, opacity: 0.35,
      fillColor: '#3b82f6', fillOpacity: 0.12, interactive: false,
    }).addTo(group)

    const puck = L.marker(route.coords[0], {
      icon: L.divIcon({
        className: 'lnav-puck',
        html:
          '<span class="lnav-puck-pulse"></span>' +
          '<span class="lnav-puck-cone"></span>' +
          '<span class="lnav-puck-dot"></span>',
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      }),
      zIndexOffset: 1000,
      interactive: false,
    }).addTo(group)

    layersRef.current = { group, traveled, halo, core, flow, maneuver, dest, accuracy, puck }
    animRef.current = { alongM: 0, lat: null, lng: null, heading: 0, started: false }

    return () => {
      map.removeLayer(group)
      layersRef.current = null
    }
  }, [map, route])

  /* Turning the camera loose the moment the user drags is the difference
     between a map they can inspect and a map that fights them. */
  useEffect(() => {
    function onDrag() { onUserPan?.() }
    map.on('dragstart', onDrag)
    return () => { map.off('dragstart', onDrag) }
  }, [map, onUserPan])

  /* Apply each fix directly, the moment it lands.

     The animation loop below is what makes movement look continuous, but it
     is a REFINEMENT, not the source of truth. requestAnimationFrame does not
     run in a backgrounded tab — a resident who switches to their messages
     mid-evacuation and comes back would otherwise find a frozen map showing
     where they were, not where they are. Everything the walker relies on is
     therefore written here too, at fix rate, and the loop only eases between
     these values. */
  useEffect(() => {
    const layers = layersRef.current
    if (!layers || !nav || !route?.coords?.length) return
    const a = animRef.current
    if (!a.started) {
      a.alongM = nav.alongM
      a.lat = nav.snapped[0]
      a.lng = nav.snapped[1]
      a.heading = nav.heading
      a.started = true
    }
    /* A jump this big is not walking — it is a reroute, a first fix, or the
       tab waking up. Easing across it would slide the puck through the
       neighbourhood for a second; snap instead. */
    if (Math.abs(nav.alongM - a.alongM) > 120) {
      a.alongM = nav.alongM
      a.lat = nav.snapped[0]
      a.lng = nav.snapped[1]
      a.heading = nav.heading
    }
    layers.puck.setLatLng(nav.snapped)
    const el = layers.puck.getElement()
    if (el) el.style.setProperty('--lnav-heading', `${nav.heading.toFixed(1)}deg`)
    layers.accuracy.setLatLng(nav.raw || nav.snapped)
    layers.accuracy.setRadius(Math.min(60, Math.max(0, nav.accuracy || 0)))
    const { traveled, remaining } = splitAtAlong(route.coords, route.cum, nav.alongM)
    if (traveled.length > 1) layers.traveled.setLatLngs(traveled)
    layers.core.setLatLngs(remaining)
    layers.halo.setLatLngs(remaining)
    layers.flow.setLatLngs(remaining)
    const stepPoint = nav.step ? pointAtAlong(route.coords, route.cum, nav.step.at) : null
    if (stepPoint && nav.step?.kind !== 'arrive') layers.maneuver.setLatLng(stepPoint)
    if (chaseRef.current.follow) {
      const size = map.getSize()
      const target = map.project(nav.snapped, map.getZoom())
      target.y -= size.y * 0.18
      map.setView(map.unproject(target, map.getZoom()), map.getZoom(), { animate: false })
    }
  }, [map, nav, route, chaseRef])

  /* The one animation loop. */
  useEffect(() => {
    let raf = 0
    let lastFrame = performance.now()

    function frame(now) {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.1, (now - lastFrame) / 1000)
      lastFrame = now
      const layers = layersRef.current
      const nav = navRef.current
      if (!layers || !nav || !route?.coords?.length) return
      const a = animRef.current

      /* Ease toward the truth rather than snapping to it. The time constant is
         tuned so a 1 Hz fix stream looks continuous without the puck lagging
         visibly behind a fast walker. */
      const k = 1 - Math.exp(-dt * 3.4)
      if (!a.started) {
        a.alongM = nav.alongM
        a.lat = nav.snapped[0]
        a.lng = nav.snapped[1]
        a.heading = nav.heading
        a.started = true
      } else {
        a.alongM += (nav.alongM - a.alongM) * k
        a.lat += (nav.snapped[0] - a.lat) * k
        a.lng += (nav.snapped[1] - a.lng) * k
        // Interpolate the short way round the compass, so 350° → 10° does not
        // spin the arrow the long way home.
        let d = ((nav.heading - a.heading + 540) % 360) - 180
        a.heading += d * k
      }

      const eased = pointAtAlong(route.coords, route.cum, a.alongM) || [a.lat, a.lng]
      /* The puck sits on the SNAPPED position, not the raw fix: the walker is
         on the road, and showing them 15 m into someone's yard every other
         second destroys confidence in everything else on the screen. */
      const shown = [a.lat ?? eased[0], a.lng ?? eased[1]]
      layers.puck.setLatLng(shown)
      const el = layers.puck.getElement()
      if (el) el.style.setProperty('--lnav-heading', `${a.heading.toFixed(1)}deg`)

      layers.accuracy.setLatLng(nav.raw || shown)
      layers.accuracy.setRadius(Math.min(60, Math.max(0, nav.accuracy || 0)))

      const { traveled, remaining } = splitAtAlong(route.coords, route.cum, a.alongM)
      if (traveled.length > 1) layers.traveled.setLatLngs(traveled)
      layers.core.setLatLngs(remaining)
      layers.halo.setLatLngs(remaining)
      layers.flow.setLatLngs(remaining)

      const stepPoint = nav.step ? pointAtAlong(route.coords, route.cum, nav.step.at) : null
      if (stepPoint && nav.step?.kind !== 'arrive') layers.maneuver.setLatLng(stepPoint)
      layers.maneuver.setStyle({ opacity: nav.step?.kind === 'arrive' ? 0 : 1, fillOpacity: nav.step?.kind === 'arrive' ? 0 : 1 })

      /* Camera. The walker is parked a third of the way up from the bottom so
         the road ahead — the part they need — owns the screen. */
      if (chaseRef.current.follow) {
        const size = map.getSize()
        const target = map.project(shown, map.getZoom())
        target.y -= size.y * 0.18
        const center = map.unproject(target, map.getZoom())
        const cur = map.getCenter()
        if (Math.abs(cur.lat - center.lat) > 1e-7 || Math.abs(cur.lng - center.lng) > 1e-7) {
          map.setView(center, map.getZoom(), { animate: false })
        }
      }

      /* Countdown text, written straight to the DOM. At 60 fps through React
         this alone would dominate the frame budget. */
      const cd = document.getElementById('lnav-countdown')
      if (cd && nav.step) {
        const live = Math.max(0, (nav.step.at ?? 0) - a.alongM)
        cd.textContent = live >= 950
          ? `${(live / 1000).toFixed(1)} km`
          : `${Math.max(0, Math.round(live / 5) * 5)} m`
      }
      const bar = document.getElementById('lnav-progress-fill')
      if (bar && route.total > 0) {
        bar.style.width = `${Math.min(100, (a.alongM / route.total) * 100).toFixed(2)}%`
      }
      const left = document.getElementById('lnav-remaining')
      if (left) left.textContent = formatDistance(Math.max(0, route.total - a.alongM))
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [map, route, navRef, chaseRef])

  return null
}

/* ── The screen ──────────────────────────────────────────────────────────── */

export default function LiveNavigation({
  open,
  graph,
  riskAt,
  statusMap,
  blockedEdges,
  floodedEdges,
  onUnsafe,
  destination,
  initialCoords,
  initialSegments,
  onExit,
}) {
  const lang = getUserLanguage()
  const [route, setRoute] = useState(null)
  const [nav, setNav] = useState(null)
  const [phase, setPhase] = useState('starting') // starting | live | rerouting | arrived
  const [muted, setMutedState] = useState(() => speech.isMuted())
  const [follow, setFollow] = useState(true)
  /* 2D is the default and the fallback. The 3D view is the nicer one to walk
     with, but it needs Mapbox tiles and a GPU, and a resident mid-evacuation
     is the last person who should discover their phone cannot handle it. */
  const [view3D, setView3D] = useState(false)
  const [toast, setToast] = useState(null)
  const [simOn, setSimOn] = useState(false)
  const [simSpeed, setSimSpeed] = useState(1.25)
  const [showDemo, setShowDemo] = useState(false)
  const [hazardAhead, setHazardAhead] = useState(null)

  const navRef = useRef(null)
  const chaseRef = useRef({ follow: true })
  const spokenRef = useRef({ step: -1, phases: new Set(), departed: false, hazards: new Set() })
  const lastRerouteRef = useRef(0)
  const rerouteBusyRef = useRef(false)
  const rerouteTimerRef = useRef(null)
  const unsafeRef = useRef(onUnsafe)
  unsafeRef.current = onUnsafe
  const mapRef = useRef(null)

  chaseRef.current.follow = follow

  /* Build the navigable route from whatever the routing page already computed,
     so starting navigation is instant rather than a second full A*. */
  useEffect(() => {
    if (!open || !initialCoords || initialCoords.length < 2) return
    setRoute(prepareRoute(initialCoords, initialSegments || [], {
      destination: destination?.name,
    }))
    spokenRef.current = { step: -1, phases: new Set(), departed: false, hazards: new Set() }
    setPhase('starting')
    setNav(null)
    navRef.current = null
  }, [open, initialCoords, initialSegments, destination?.name])

  /* Simulation follows the CURRENT route, so a reroute redirects the demo
     walker onto the new line exactly as a real person would be. */
  const simulation = useMemo(
    () => (simOn && route?.coords?.length > 1
      ? { coords: route.coords, speedMps: simSpeed }
      : null),
    [simOn, route, simSpeed],
  )

  const { fix, error: trackError, status: trackStatus, nudgeOffRoute, clearDrift, resetSim } =
    useLiveTracking({ active: open, simulation })

  /* ── Re-plan from where the walker is actually standing ───────────────── */
  const reroute = useCallback((from, reason) => {
    if (!graph || !destination?.coords || rerouteBusyRef.current) return
    if (reason !== 'hazard' && Date.now() - lastRerouteRef.current < REROUTE_COOLDOWN_MS) return
    rerouteBusyRef.current = true
    lastRerouteRef.current = Date.now()
    setPhase('rerouting')
    setToast({
      kind: 'rerouting',
      text: reason === 'hazard'
        ? (lang === 'fil' ? 'May bahang daan sa unahan — naghahanap ng bagong ruta…' : 'Flooded road ahead — finding a new way…')
        : (lang === 'fil' ? 'Lumihis ka sa ruta — nagre-reroute…' : 'You left the route — rerouting…'),
    })
    speech.speak(
      reason === 'hazard'
        ? (lang === 'fil' ? 'May bahang daan sa unahan. Naghahanap ng ibang ruta.' : 'Flooded road ahead. Finding another way.')
        : (lang === 'fil' ? 'Lumihis ka sa ruta. Nagre-reroute.' : 'You have left the route. Rerouting.'),
      { lang, urgent: true },
    )

    /* Give the browser a frame to paint the toast before A* takes the thread —
       the search is a few tens of milliseconds on this network, but the user
       must see that the system reacted the instant it did. */
    rerouteTimerRef.current = setTimeout(() => {
      try {
        const verdict = checkRouteSafety(graph, from, destination.coords, {
          riskAt, statusMap, blockedEdges, floodedEdges, alpha: DEFAULT_ALPHA, compare: false,
          ...profileFor('evacuation'), // the resident is walking
        })
        if (verdict.verdict !== 'safe') {
          speech.cancel()
          unsafeRef.current?.(verdict, from)
          return
        }
        const plan = verdict.plan
        if (plan?.ok && plan.safe.coords.length > 1) {
          const next = prepareRoute(plan.safe.coords, plan.safe.segments, {
            destination: destination?.name,
          })
          setRoute(next)
          spokenRef.current = { step: -1, phases: new Set(), departed: true, hazards: new Set() }
          navRef.current = null
          setNav(null)
          resetSim(0)
          setPhase('live')
          setFollow(true)
          setToast({
            kind: 'rerouted',
            text: lang === 'fil'
              ? `Bagong ligtas na ruta — ${formatDistance(next.total)} papunta sa ${destination?.name || 'evacuation center'}.`
              : `New safe route — ${formatDistance(next.total)} to ${destination?.name || 'the evacuation center'}.`,
          })
          speech.speak(
            lang === 'fil'
              ? `Bagong ruta. ${Math.round(next.total)} metro na lang.`
              : `New route found. ${formatDistance(next.total)} to go.`,
            { lang },
          )
        } else {
          speech.cancel()
          unsafeRef.current?.({ verdict: 'unavailable', reason: 'route-geometry' }, from)
        }
      } catch (e) {
        console.error('[LiveNavigation] reroute failed', e)
        speech.cancel()
        unsafeRef.current?.({ verdict: 'unavailable', reason: 'routing-error' }, from)
      } finally {
        rerouteBusyRef.current = false
      }
    }, 60)
  }, [graph, destination, riskAt, statusMap, blockedEdges, floodedEdges, lang, resetSim])

  useEffect(() => {
    const from = navRef.current?.raw || initialCoords?.[0]
    if (open && from) reroute(from, 'hazard')
    return () => {
      clearTimeout(rerouteTimerRef.current)
      rerouteBusyRef.current = false
    }
  }, [open, riskAt, statusMap, blockedEdges, floodedEdges])

  /* ── Every fix: advance the navigation state, speak what is due ───────── */
  useEffect(() => {
    if (!open || !route || !fix || phase === 'rerouting') return
    const next = navigate(route, fix, navRef.current)
    if (!next) return
    navRef.current = next
    setNav(next)

    if (phase === 'starting') setPhase('live')

    const sp = spokenRef.current

    // Departure line, once, as soon as we have a believable first fix.
    if (!sp.departed) {
      sp.departed = true
      speech.speak(stepPhrase(route.steps[0], 0, lang, 'near'), { lang })
    }

    // A new instruction is in play — reset which of its calls have been made.
    if (next.stepIndex !== sp.step) {
      sp.step = next.stepIndex
      sp.phases = new Set()
    }

    const step = next.step
    if (step) {
      const d = next.distToStep
      const legM = route.steps[Math.max(0, next.stepIndex - 1)]?.legM ?? 0
      if (d <= ANNOUNCE_NOW && !sp.phases.has('now')) {
        sp.phases.add('now'); sp.phases.add('near'); sp.phases.add('far')
        if (step.kind !== 'arrive') speech.speak(stepPhrase(step, d, lang, 'now'), { lang, urgent: true })
      } else if (d <= ANNOUNCE_NEAR && !sp.phases.has('near')) {
        sp.phases.add('near'); sp.phases.add('far')
        speech.speak(stepPhrase(step, d, lang, 'near'), { lang })
      } else if (d <= ANNOUNCE_FAR && legM >= FAR_MIN_LEG && !sp.phases.has('far')) {
        sp.phases.add('far')
        speech.speak(stepPhrase(step, d, lang, 'far'), { lang })
      }
    }

    /* Flooded road ahead. The route was planned around the conditions as they
       stood; conditions move. If CDRRMO flags a road that is now in front of
       the walker, that is a re-plan, not a footnote. */
    let hazard = null
    if (route.segments?.length) {
      let acc = 0
      for (let i = next.index; i < route.segments.length && acc < HAZARD_LOOKAHEAD_M; i++) {
        const seg = route.segments[i]
        const live = statusMap?.[seg.wayId]
        if (live === 'flooded' || live === 'blocked') {
          hazard = { wayId: seg.wayId, name: seg.name, status: live, distM: Math.max(0, route.cum[i] - next.alongM) }
          break
        }
        acc += seg.d
      }
    }
    setHazardAhead(hazard)
    if (hazard && !sp.hazards.has(hazard.wayId)) {
      sp.hazards.add(hazard.wayId)
      if (hazard.distM < HAZARD_LOOKAHEAD_M) reroute(next.snapped, 'hazard')
    }

    // Wrong turn.
    if (next.offRoute && !next.arrived) reroute(next.raw, 'off-route')

    if (next.arrived && phase !== 'arrived') {
      setPhase('arrived')
      speech.speak(stepPhrase({ kind: 'arrive', road: destination?.name }, 0, lang, 'now'), {
        lang, urgent: true,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix, route, open])

  /* Toasts clear themselves; a stuck "rerouting…" would be a lie. */
  useEffect(() => {
    if (!toast || toast.kind === 'rerouting') return undefined
    const id = setTimeout(() => setToast(null), toast.kind === 'failed' ? 9000 : 5000)
    return () => clearTimeout(id)
  }, [toast])

  useEffect(() => {
    if (!open) return undefined
    document.body.classList.add('lnav-open')
    return () => {
      document.body.classList.remove('lnav-open')
      speech.shutdown()
    }
  }, [open])

  const toggleMute = useCallback(() => {
    const next = !muted
    speech.setMuted(next)
    setMutedState(next)
    if (!next) {
      speech.prime()
      speech.speak(lang === 'fil' ? 'Naka-on na ang boses na gabay.' : 'Voice guidance on.', { lang })
    }
  }, [muted, lang])

  const recenter = useCallback(() => {
    setFollow(true)
    const map = mapRef.current
    if (map && navRef.current) map.setView(navRef.current.snapped, 18, { animate: true })
  }, [])

  const overview = useCallback(() => {
    setFollow(false)
    const map = mapRef.current
    if (map && route?.coords?.length > 1) {
      map.fitBounds(L.latLngBounds(route.coords), { padding: [60, 140], animate: true })
    }
  }, [route])

  if (!open) return null

  const center = route?.coords?.[0] || destination?.coords || [14.2726, 121.1256]

  /* Derived once here and handed to the 3D view, so both renderers read the
     same split of the route rather than each computing their own idea of how
     far along the walker is. */
  const navSplit = route && nav
    ? splitAtAlong(route.coords, route.cum, nav.alongM)
    : { traveled: [], remaining: route?.coords || [] }
  const navPosition = nav ? [nav.lat, nav.lng] : center
  const turnPoint = route && nav
    ? pointAtAlong(route.coords, route.cum, (nav.alongM || 0) + (nav.distToStep || 0))
    : null
  /* No flagged-roads overlay in 3D, deliberately: drawing it means importing
     the 4,853-way road bundle into this screen, which is the 914 kB chunk the
     code-splitting work just got off the resident's critical path. The route
     the engine returned already steers around flooded roads — the overlay is
     context, and context is not worth a megabyte on a phone mid-evacuation. */
  const hazard3D = null

  const step = nav?.step || route?.steps?.[0]
  const nextStep = route?.steps?.[(nav?.stepIndex ?? 0) + 1]
  const urgent = (nav?.distToStep ?? 999) <= ANNOUNCE_NOW && step?.kind !== 'arrive'
  const soon = (nav?.distToStep ?? 999) <= ANNOUNCE_NEAR

  return (
    <div className="lnav" role="dialog" aria-label="Guided evacuation navigation">
      {view3D ? (
        /* Heading-up, tilted, camera riding behind the walker. Everything it
           draws comes from the same `nav` result the 2D view uses — it is a
           different presentation of one navigation state, never a second
           source of truth. */
        /* Boundaried: a fault in the 3D renderer used to unmount the whole
           app and leave a resident mid-evacuation staring at a white screen,
           with the 2D map and turn list that were working fine taken down
           with it. Now it drops back to 2D and the walk continues. resetKey
           lets a later 3D attempt start clean instead of staying tripped. */
        <ErrorBoundary
          label="LiveNavigation3D"
          resetKey={view3D}
          onError={() => setView3D(false)}
          fallback={<div className="lnav-map lnav-map-loading">3D unavailable — switching to the standard map…</div>}
        >
          <Suspense fallback={<div className="lnav-map lnav-map-loading">Loading 3D view…</div>}>
            <LiveNavigation3D
              position={navPosition}
              heading={nav?.heading}
              ahead={navSplit.remaining}
              behind={navSplit.traveled}
              turnPoint={turnPoint}
              hazard={hazard3D}
              follow={follow}
            />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <MapContainer
          center={center}
          zoom={18}
          zoomControl={false}
          attributionControl={false}
          className="lnav-map"
          ref={mapRef}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.92} />
          {/* Only the flagged roads, not the whole 4,853-way network: during
              navigation the screen has one job, and the frame budget is spent on
              movement. */}
          <FlaggedRoadsLayer />
          {route && (
            <NavLayer
              route={route}
              nav={nav}
              navRef={navRef}
              chaseRef={chaseRef}
              onUserPan={() => setFollow(false)}
            />
          )}
        </MapContainer>
      )}

      {/* 2D ⇄ 3D. Off by default: 3D costs a Mapbox tile budget and a lot more
          GPU on a cheap phone, and the 2D view is the one that always works. */}
      <button
        type="button"
        className="lnav-3d-toggle"
        onClick={() => setView3D((v) => !v)}
        aria-pressed={view3D}
        title={view3D ? 'Switch to the flat map' : 'Switch to the 3D view'}
      >
        {view3D ? '2D' : '3D'}
      </button>

      {/* ── Maneuver banner ── */}
      <div className={`lnav-banner ${urgent ? 'urgent' : soon ? 'soon' : ''} ${phase === 'rerouting' ? 'rerouting' : ''}`}>
        <button type="button" className="lnav-close" onClick={onExit} aria-label="End navigation">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
        <div className="lnav-banner-main">
          <div className="lnav-arrow-wrap" key={`${step?.kind}-${nav?.stepIndex}`}>
            <ManeuverArrow kind={step?.kind || 'straight'} />
          </div>
          <div className="lnav-banner-text">
            <div className="lnav-countdown-row">
              <span className="lnav-countdown" id="lnav-countdown">
                {nav ? `${Math.round((nav.distToStep || 0) / 5) * 5} m` : '--'}
              </span>
              {nextStep && step?.kind !== 'arrive' && (
                <span className="lnav-then">
                  <span className="lnav-then-label">then</span>
                  <ManeuverArrow kind={nextStep.kind} className="lnav-arrow--sm" />
                </span>
              )}
            </div>
            <div className="lnav-instruction">{stepTitle(step, lang)}</div>
            {/* One-way, on screen as well as spoken — someone who has the
                phone muted, or who glanced down a moment after the voice,
                still needs to know which way the traffic runs. */}
            {step?.oneway ? (
              <div className="lnav-oneway">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 19V5M12 5l-5 5M12 5l5 5" />
                </svg>
                <span>
                  {step.wrongWay
                    ? (lang === 'fil' ? 'Isang direksyon — paharap sa iyo ang trapiko' : 'One-way — traffic towards you')
                    : (lang === 'fil' ? 'Isang direksyon — trapiko mula sa likod' : 'One-way — traffic from behind')}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        {hazardAhead && (
          <div className="lnav-hazard">
            <svg viewBox="0 0 24 24">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>
              {hazardAhead.status === 'blocked' ? 'Road closed' : 'Flooded road'}
              {hazardAhead.name ? ` — ${hazardAhead.name}` : ''} · {formatDistance(hazardAhead.distM)} ahead
            </span>
          </div>
        )}
      </div>

      {/* ── Status / reroute toast ── */}
      {toast && (
        <div className={`lnav-toast ${toast.kind}`} role="status">
          {toast.kind === 'rerouting' && <span className="lnav-spinner" />}
          {toast.kind === 'rerouted' && (
            <svg viewBox="0 0 24 24" className="lnav-toast-icon"><path d="M20 6 9 17l-5-5" /></svg>
          )}
          {toast.kind === 'failed' && (
            <svg viewBox="0 0 24 24" className="lnav-toast-icon"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* ── GPS state ── */}
      <div className={`lnav-gps ${trackStatus}`}>
        <span className="lnav-gps-dot" />
        {trackStatus === 'simulated'
          ? 'Simulated walk — demonstration'
          : trackStatus === 'live'
            ? `Live GPS${nav?.accuracy ? ` · ±${Math.round(nav.accuracy)} m` : ''}`
            : trackStatus === 'acquiring'
              ? 'Getting your position…'
              : trackStatus === 'denied'
                ? 'Location blocked'
                : 'Location off'}
      </div>
      {trackError && trackStatus !== 'live' && trackStatus !== 'simulated' && (
        <div className="lnav-gps-error">{trackError}</div>
      )}

      {/* ── Side controls ── */}
      <div className="lnav-side">
        <button
          type="button"
          className={`lnav-fab ${muted ? 'off' : 'on'}`}
          onClick={toggleMute}
          title={muted ? 'Turn voice guidance on' : 'Mute voice guidance'}
          aria-pressed={!muted}
        >
          {muted ? (
            <svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
          ) : (
            <svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>
          )}
        </button>
        <button
          type="button"
          className={`lnav-fab ${follow ? 'on' : ''}`}
          onClick={recenter}
          title="Re-centre on me"
        >
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" /></svg>
        </button>
        <button type="button" className="lnav-fab" onClick={overview} title="See the whole route">
          <svg viewBox="0 0 24 24"><polygon points="1 6 8 3 16 6 23 3 23 18 16 21 8 18 1 21 1 6" /><line x1="8" y1="3" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="21" /></svg>
        </button>
        <button
          type="button"
          className={`lnav-fab ${showDemo ? 'on' : ''}`}
          onClick={() => setShowDemo((v) => !v)}
          title="Demonstration controls"
        >
          <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        </button>
      </div>

      {/* ── Demonstration panel ────────────────────────────────────────────
          Kept behind a toggle and labelled without euphemism. A navigator you
          can only test by wading through an actual flood is a navigator nobody
          ever tests. */}
      {showDemo && (
        <div className="lnav-demo">
          <div className="lnav-demo-head">
            <strong>Demonstration mode</strong>
            <button type="button" onClick={() => setShowDemo(false)} aria-label="Close">
              <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <p className="lnav-demo-note">
            Drives a simulated walker along this exact route through the same
            tracking, snapping, voice and rerouting code as a real GPS fix. The
            status chip says “Simulated” the whole time it is running.
          </p>
          <label className="lnav-demo-row">
            <input
              type="checkbox"
              checked={simOn}
              onChange={(e) => { setSimOn(e.target.checked); resetSim(0); if (e.target.checked) speech.prime() }}
            />
            <span>Simulate walking this route</span>
          </label>
          <label className="lnav-demo-row lnav-demo-range">
            <span>Pace</span>
            <input
              type="range" min="0.8" max="12" step="0.2"
              value={simSpeed}
              onChange={(e) => setSimSpeed(Number(e.target.value))}
            />
            <b>{simSpeed < 2 ? 'walking' : simSpeed < 5 ? 'jogging' : 'vehicle'} · {(simSpeed * 3.6).toFixed(1)} km/h</b>
          </label>
          <div className="lnav-demo-actions">
            <button type="button" disabled={!simOn} onClick={() => nudgeOffRoute(95)}>
              Take a wrong turn
            </button>
            <button type="button" disabled={!simOn} onClick={clearDrift}>
              Back on route
            </button>
          </div>
        </div>
      )}

      {/* ── Bottom trip strip ── */}
      <div className="lnav-bottom">
        {/* width is rendered from the fix and then refined 60x a second by
            the animation loop — so it is correct even when that loop is not
            running, and smooth when it is. */}
        <div className="lnav-progress">
          <span
            id="lnav-progress-fill"
            className="lnav-progress-fill"
            style={{ width: `${((nav?.progress ?? 0) * 100).toFixed(2)}%` }}
          />
        </div>
        <div className="lnav-trip">
          <div className="lnav-trip-item">
            <span className="lnav-trip-val">{nav ? formatEta(nav.etaSec) : '--'}</span>
            <span className="lnav-trip-lbl">arrive in</span>
          </div>
          <div className="lnav-trip-item">
            <span className="lnav-trip-val" id="lnav-remaining">
              {nav ? formatDistance(nav.remainingM) : route ? formatDistance(route.total) : '--'}
            </span>
            <span className="lnav-trip-lbl">remaining</span>
          </div>
          <div className="lnav-trip-item">
            <span className="lnav-trip-val">{nav ? arrivalClock(nav.etaSec) : '--:--'}</span>
            <span className="lnav-trip-lbl">ETA</span>
          </div>
          <div className="lnav-trip-dest">
            <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
            <span>{destination?.name || 'Evacuation centre'}</span>
          </div>
        </div>
      </div>

      {/* ── Arrival ── */}
      {phase === 'arrived' && (
        <div className="lnav-arrived">
          <div className="lnav-arrived-card">
            <div className="lnav-arrived-badge">
              <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
              <span className="lnav-ring lnav-ring-1" />
              <span className="lnav-ring lnav-ring-2" />
            </div>
            <h2>You have arrived</h2>
            <p>
              {destination?.name || 'The evacuation centre'}
              {destination?.barangay ? ` · Brgy. ${destination.barangay}` : ''}
            </p>
            <p className="lnav-arrived-note">
              Report to the responders on site so your household is counted. Stay
              inside until CDRRMO issues the all-clear.
            </p>
            <button type="button" className="lnav-arrived-btn" onClick={onExit}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
