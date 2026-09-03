import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import Map3D from '../admin/Map3D.jsx'
import {
  useMap3DSetup,
  addRouteLine3D,
  setRouteLine3D,
  setRouteLineStyle,
  toLngLat,
} from '../admin/routing3d.js'
import { addHazardRoadsLayer, updateHazardRoadsData } from '../admin/mapbox3dHelpers.js'

/* ============================================================
   LiveNavigation3D — the driving/walking view for guided evacuation.

   WHY THIS EXISTS ALONGSIDE THE LEAFLET VIEW
   The 2D navigator is deliberately north-up, because Leaflet cannot rotate a
   tile layer and faking it with CSS breaks every marker's hit box. North-up
   is the honest thing to ship on Leaflet, but it is not how anyone navigates
   on foot: you hold the phone in front of you and you want the road you are
   about to walk down pointing away from you.

   Mapbox can rotate and pitch, so the 3D view is heading-up, tilted, and the
   camera rides just behind the walker — the view every navigation app uses,
   for the reason they all use it: the next turn is legible without the reader
   having to mentally rotate the map while wading through water.

   WHAT IS ANIMATED, AND WHY EACH ONE EARNS ITS FRAME COST
     Camera        eased toward each fix rather than snapped. A jumping camera
                   at 1 Hz reads as the app glitching; smooth motion reads as
                   "it is following me", which is the entire promise here.
     Travelled vs  the route behind you dims and the route ahead stays bright,
     remaining     so "how much further" is answerable at a glance without
                   reading the distance readout.
     Turn pulse    the upcoming junction pulses as you close on it. It is the
                   one thing on screen that must not be missed, and motion is
                   what the eye catches when the screen is wet and jostling.

   All of it is presentation. Nothing here re-decides the route, changes a
   distance, or invents a position — the numbers come from the same navigation
   service the 2D view uses. If this component fails to load, the 2D navigator
   is still the source of truth.
   ============================================================ */

const ROUTE_AHEAD = 'nav3d-ahead'
const ROUTE_BEHIND = 'nav3d-behind'

/** Bearing from a→b in degrees, for a heading-up camera. */
function bearingOf([lat1, lng1], [lat2, lng2]) {
  const toRad = (d) => (d * Math.PI) / 180
  const toDeg = (r) => (r * 180) / Math.PI
  const dLng = toRad(lng2 - lng1)
  const y = Math.sin(dLng) * Math.cos(toRad(lat2))
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Shortest signed angle between two bearings, so the camera never spins
 *  the long way round when the heading crosses north. */
function angleDelta(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180
}

/**
 * Is this a usable [lat, lng] pair?
 *
 * toLngLat destructures an ARRAY. Hand it undefined, or an object shaped
 * {lat, lng}, and it silently produces [undefined, undefined]; Mapbox then
 * throws deep inside LngLat.convert, which unmounts this component — and,
 * before the ErrorBoundary in LiveNavigation.jsx, the whole app with it.
 *
 * The inputs here are genuinely allowed to be absent: turnPoint is null on
 * the last leg, and pointAtAlong returns undefined when the walked distance
 * runs past the end of the route. Those are ordinary states, not faults, so
 * they are checked rather than caught.
 */
function isLatLng(p) {
  return Array.isArray(p) && p.length >= 2
    && Number.isFinite(p[0]) && Number.isFinite(p[1])
}

export default function LiveNavigation3D({
  position,        // [lat, lng] — current fix
  heading = null,  // degrees, when the device reports one
  ahead = [],      // [[lat,lng], …] route still to walk
  behind = [],     // [[lat,lng], …] route already walked
  turnPoint = null, // [lat,lng] of the next junction
  hazard = null,   // { roads, statusMap } — flooded/closed roads
  follow = true,   // false while the user is panning the map themselves
}) {
  const bearingRef = useRef(0)
  const puckRef = useRef(null)
  const turnRef = useRef(null)
  const rafRef = useRef(null)

  const initRef = useRef({})
  initRef.current = { ahead, behind, hazard }

  const { onMapLoad, mapRef, ready } = useMap3DSetup((map) => {
    const v = initRef.current

    if (v.hazard) {
      addHazardRoadsLayer(map, v.hazard.roads, v.hazard.statusMap, true)
    }

    // Behind first so the bright "ahead" line always draws over it.
    addRouteLine3D(map, ROUTE_BEHIND, {
      color: '#94a3b8', halo: false, width: 5, opacity: 0.45,
    })
    addRouteLine3D(map, ROUTE_AHEAD, {
      color: '#16a34a', halo: true, flow: true, width: 6.5, opacity: 0.98,
    })
    setRouteLine3D(map, ROUTE_BEHIND, v.behind)
    setRouteLine3D(map, ROUTE_AHEAD, v.ahead)

    /* No initial fitBounds here on purpose. It looks like it is needed — the
       map would otherwise open on the whole of Cabuyao — but `position` is
       never actually absent: LiveNavigation falls back to the route's first
       coordinate when there is no GPS fix, so the camera effect below always
       has somewhere to go and takes the view to street level immediately.
       A fit would be unreachable code that reads like a safety net. */
  })

  /* The walker's puck.
     Created here rather than in the setup callback above, deliberately: that
     callback runs once on map load and closes over the props as they were at
     mount. The first GPS fix usually lands AFTER that, so a puck created up
     there would be pinned to a stale position (or to a hardcoded fallback)
     until something else moved it. Creating it lazily in the effect that
     already has the fresh position removes that ordering dependency
     entirely. */
  function ensurePuck(map, lngLat) {
    if (puckRef.current) return puckRef.current
    const el = document.createElement('div')
    el.className = 'nav3d-puck'
    el.innerHTML = '<span class="nav3d-puck-pulse"></span><span class="nav3d-puck-dot"></span>'
    // A DOM marker rather than a symbol layer so the pulse is pure CSS —
    // cheaper than repainting a GL layer every frame, and it keeps animating
    // while the map is busy easing the camera.
    puckRef.current = new mapboxgl.Marker({
      element: el, pitchAlignment: 'map', rotationAlignment: 'map',
    })
      /* setLngLat BEFORE addTo, and that order is the whole bug this used to
         have. addTo() immediately calls Marker._update(), which hands the
         marker's position to smartWrap() — and smartWrap reads `.lng` off it
         with no guard. A marker added before it has a position throws
         "Cannot read properties of undefined (reading 'lng')" from inside
         Mapbox, which took the entire 3D navigation view down every single
         time a resident switched to it. */
      .setLngLat(lngLat)
      .addTo(map)
    return puckRef.current
  }

  // ── Route geometry ───────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    setRouteLine3D(map, ROUTE_AHEAD, ahead)
    setRouteLine3D(map, ROUTE_BEHIND, behind)
  }, [ahead, behind, ready, mapRef])

  // ── Hazard overlay follows the shared road-status store ──────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !hazard) return
    updateHazardRoadsData(map, hazard.roads, hazard.statusMap)
  }, [hazard, ready, mapRef])

  // ── The next turn, pulsing ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return

    // Also covers pointAtAlong returning undefined past the end of the route.
    if (!isLatLng(turnPoint)) {
      turnRef.current?.remove()
      turnRef.current = null
      return
    }
    const at = toLngLat(turnPoint)
    if (!turnRef.current) {
      const el = document.createElement('div')
      el.className = 'nav3d-turn'
      el.innerHTML = '<span class="nav3d-turn-ring"></span>'
      // Positioned before it is added, for the same reason as the puck above.
      turnRef.current = new mapboxgl.Marker({ element: el, pitchAlignment: 'map' })
        .setLngLat(at)
        .addTo(map)
      return
    }
    turnRef.current.setLngLat(at)
  }, [turnPoint, ready, mapRef])

  // ── Camera: ride behind the walker, heading-up, eased ────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !isLatLng(position)) return

    const here = toLngLat(position)
    ensurePuck(map, here).setLngLat(here)
    if (!follow) return

    /* Prefer the device heading; fall back to the direction of the route
       ahead, which is steadier than a compass on a phone being carried. */
    let target = bearingRef.current
    if (Number.isFinite(heading)) target = heading
    else if (ahead.length >= 2) target = bearingOf(ahead[0], ahead[1])

    // Ease the rotation rather than snapping: a compass jitters, and a map
    // that snaps to every jitter is unreadable while walking.
    const next = bearingRef.current + angleDelta(bearingRef.current, target) * 0.25
    bearingRef.current = (next + 360) % 360

    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      map.easeTo({
        center: here,
        bearing: bearingRef.current,
        pitch: 62,          // enough tilt to read the street ahead, not so much
        zoom: 17.4,         // that the horizon eats the screen
        duration: 900,      // ≈ the GPS interval, so motion is continuous
        easing: (t) => t * (2 - t), // ease-out: fast response, soft landing
        essential: true,    // keep animating under prefers-reduced-motion —
                            // this is wayfinding, not decoration
      })
    })
    return () => cancelAnimationFrame(rafRef.current)
  }, [position, heading, ahead, follow, ready, mapRef])

  // Dim the whole route once the walker stops following, so a map they are
  // panning by hand does not look like live guidance.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    setRouteLineStyle(map, ROUTE_AHEAD, { opacity: follow ? 0.98 : 0.6 })
  }, [follow, ready, mapRef])

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    puckRef.current?.remove()
    turnRef.current?.remove()
  }, [])

  return <Map3D onMapLoad={onMapLoad} basemap="navigation" />
}
