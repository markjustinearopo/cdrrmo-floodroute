import { useCallback, useEffect, useRef, useState } from 'react'
import { cumulative, pointAtAlong, bearing, distanceM } from '../services/navigation.js'

/* ============================================================
   useLiveTracking — a continuous stream of the device's real position.

   useGeolocation() answers "where am I?" once, on a button press. Guided
   navigation needs the other thing entirely: a fix every second or two, for as
   long as the walk lasts, without re-prompting. That is `watchPosition`, and it
   comes with three problems this hook exists to absorb.

   1. FIXES ARE NOISY AND UNEVENLY SPACED. A phone in a barangay street
      alternates between a 6 m GPS fix and an 800 m cell-tower guess. Feeding
      the 800 m one to the navigator teleports the walker across the city and
      triggers a spurious reroute. Fixes whose accuracy is far worse than what
      we have been getting are dropped.

   2. THE FIRST FIX IS OFTEN THE WORST. Browsers answer instantly from a cached
      network position, then refine. We accept it (so the map moves at once)
      but mark it coarse.

   3. YOU CANNOT DEMONSTRATE THIS INDOORS. A navigator that only works while
      physically walking through a flood cannot be shown to anyone — not to a
      panel, not to the CDRRMO staff who have to trust it. SIMULATION MODE
      drives a virtual walker along the planned route at a chosen pace, through
      the exact same code path as a real GPS fix: same snapping, same
      instructions, same voice, same rerouting. It is clearly labelled on
      screen, and `status` says which one is feeding the map ('live' vs
      'simulated'), because a navigator that cannot tell you whether it is
      watching a real person is worse than no navigator.
   ============================================================ */

/** Simulated walking pace, metres per second (~4.5 km/h). */
export const SIM_WALK_MPS = 1.25

export function useLiveTracking({ active = false, simulation = null } = {}) {
  const [fix, setFix] = useState(null)
  const [error, setError] = useState(null)
  // 'idle' | 'acquiring' | 'live' | 'simulated' | 'denied' | 'unavailable'
  const [status, setStatus] = useState('idle')

  const watchRef = useRef(null)
  const bestAccuracyRef = useRef(Infinity)
  const lastFixRef = useRef(null)

  /* ── Real device tracking ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!active || simulation) return undefined
    if (!('geolocation' in navigator)) {
      setStatus('unavailable')
      setError('This device cannot report its location.')
      return undefined
    }

    setStatus('acquiring')
    setError(null)
    bestAccuracyRef.current = Infinity

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy ?? 9999
        const best = bestAccuracyRef.current
        /* Reject a fix that is dramatically vaguer than what this device has
           already proven it can do — that is the network-location fallback
           kicking in, not the walker moving. Always accept the first one, and
           let the bar decay so a genuine move indoors is not locked out. */
        if (Number.isFinite(best) && acc > Math.max(60, best * 4)) {
          bestAccuracyRef.current = best * 1.15
          return
        }
        bestAccuracyRef.current = Math.min(best, Math.max(acc, 4))

        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: acc,
          // Both are null on most laptops and present on phones.
          speed: typeof pos.coords.speed === 'number' ? pos.coords.speed : null,
          heading: typeof pos.coords.heading === 'number' ? pos.coords.heading : null,
          at: pos.timestamp || Date.now(),
          coarse: acc > 45,
        }
        /* Some browsers report speed as null forever. Derive it from successive
           fixes so the ETA still reflects how fast this person is really
           moving, rather than an assumed pace. */
        const prev = lastFixRef.current
        if (next.speed == null && prev) {
          const dt = (next.at - prev.at) / 1000
          if (dt > 0.4 && dt < 30) {
            const d = distanceM([prev.lat, prev.lng], [next.lat, next.lng])
            if (d > (acc || 0) * 0.5) next.speed = Math.min(12, d / dt)
          }
        }
        lastFixRef.current = next
        setStatus('live')
        setError(null)
        setFix(next)
      },
      (err) => {
        const msg = err.code === err.PERMISSION_DENIED
          ? 'Location permission was denied. Guided navigation needs it to follow you.'
          : err.code === err.POSITION_UNAVAILABLE
            ? 'Your location is unavailable right now — move to an open area if you can.'
            : 'Still trying to get a GPS fix…'
        setError(msg)
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'acquiring')
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
    watchRef.current = id

    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
      lastFixRef.current = null
      setStatus('idle')
    }
  }, [active, simulation])

  /* ── Simulated walker ─────────────────────────────────────────────────── */
  const simRef = useRef({ alongM: 0, drift: 0 })

  useEffect(() => {
    if (!active || !simulation?.coords || simulation.coords.length < 2) return undefined
    const coords = simulation.coords
    const cum = cumulative(coords)
    const total = cum[cum.length - 1]
    const speed = simulation.speedMps ?? SIM_WALK_MPS
    simRef.current.alongM = simulation.startAtM ?? 0
    setStatus('simulated')
    setError(null)

    let last = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      const dt = Math.min(3, (now - last) / 1000)
      last = now
      const s = simRef.current
      s.alongM = Math.min(total, s.alongM + speed * dt)
      const base = pointAtAlong(coords, cum, s.alongM)
      if (!base) return
      const ahead = pointAtAlong(coords, cum, Math.min(total, s.alongM + 12))
      const head = ahead && distanceM(base, ahead) > 1 ? bearing(base, ahead) : 0

      /* Lateral offset: a little GPS-like jitter always, plus whatever
         deliberate detour the operator dialled in to demonstrate rerouting.
         Applied perpendicular to the direction of travel, which is how a real
         wrong turn looks to the snapper. */
      const jitter = (Math.random() - 0.5) * 6
      const offset = s.drift + jitter
      const perp = (head + 90) * (Math.PI / 180)
      const dLat = (offset * Math.cos(perp)) / 110574
      const dLng = (offset * Math.sin(perp)) / (111320 * Math.cos(base[0] * (Math.PI / 180)))

      setFix({
        lat: base[0] + dLat,
        lng: base[1] + dLng,
        accuracy: 8,
        speed: speed * (0.85 + Math.random() * 0.3),
        heading: head,
        at: Date.now(),
        coarse: false,
        simulated: true,
      })
    }, 1000)

    return () => {
      clearInterval(id)
      setStatus('idle')
    }
  }, [active, simulation])

  /** Push the simulated walker sideways off the line, to prove rerouting. */
  const nudgeOffRoute = useCallback((metres = 90) => {
    simRef.current.drift = metres
  }, [])

  /** Put the simulated walker back on the line. */
  const clearDrift = useCallback(() => {
    simRef.current.drift = 0
  }, [])

  /** Restart the simulated walk from the top of a (possibly new) route. */
  const resetSim = useCallback((atM = 0) => {
    simRef.current.alongM = atM
    simRef.current.drift = 0
  }, [])

  return { fix, error, status, nudgeOffRoute, clearDrift, resetSim }
}

export default useLiveTracking
