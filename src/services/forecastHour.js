import { useCallback, useEffect, useState } from 'react'

/* ============================================================
   Where the time scrubber is pointing — one value, shared.

   The scrubber is not a control on a map; it is the clock the whole screen is
   being read at. The hazard bands, the road colours, the barangay badges and
   the route the engine returns all have to agree about which hour they are
   describing, or the screen quietly starts mixing "now" with "3 PM" and the
   operator has no way to tell.

   So the offset lives here, outside any component, and every consumer
   subscribes. 0 always means the current hour — the live present — and nothing
   is allowed to make 0 mean anything else.

   Deliberately NOT persisted. A scrub position is a question you are asking
   right now, not a preference; reloading into "+7h" with a tinted map and no
   memory of having dragged anything is how someone mistakes a forecast for
   current conditions.
   ============================================================ */

let offset = 0
const listeners = new Set()

export function getForecastOffset() {
  return offset
}

/**
 * Accepts a value or an updater, matching the useState contract callers
 * reasonably expect. Without the updater form, playback — which has to advance
 * from wherever the scrub currently is — silently coerced its own callback to
 * NaN and snapped back to 0 every tick.
 */
export function setForecastOffset(next) {
  const raw = typeof next === 'function' ? next(offset) : next
  const clamped = Math.max(0, Math.round(Number(raw) || 0))
  if (clamped === offset) return
  offset = clamped
  for (const fn of listeners) fn(offset)
}

/** Back to live. Used by the scrubber's "Now" button and on unmount of a view. */
export function resetForecastOffset() {
  setForecastOffset(0)
}

/**
 * Subscribe to the shared scrub position.
 * Returns [offset, setOffset, isForecast] — `isForecast` is the one boolean
 * every surface uses to decide whether to show the forecast treatment.
 */
export function useForecastHour() {
  const [value, setValue] = useState(offset)

  useEffect(() => {
    listeners.add(setValue)
    setValue(offset) // catch anything that moved between render and subscribe
    return () => listeners.delete(setValue)
  }, [])

  const set = useCallback((next) => setForecastOffset(next), [])

  return [value, set, value > 0]
}
