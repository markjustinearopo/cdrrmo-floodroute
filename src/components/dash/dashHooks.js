import { useEffect, useRef, useState } from 'react'

/* ============================================================
   Small hooks the three dashboards share.

   Admin, barangay and resident all show live numbers, live clocks and live
   "how long ago" stamps. Each portal had grown its own copy (or gone without),
   so a stat card counted up on the command centre and snapped on the barangay
   screen. One implementation, three portals.
   ============================================================ */

/** True when the reader has asked their OS to keep motion still. */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Ease a number toward its new value instead of snapping.
 *
 * Counts up from zero on first paint, then animates between updates, so a
 * figure that changes while somebody is looking at it announces itself.
 * Non-numbers pass straight through untouched — the same card shows "HIGH"
 * and 17 on different portals.
 */
export function useCountUp(value, duration = 700) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(0)

  useEffect(() => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      setDisplay(value)
      return undefined
    }
    if (prefersReducedMotion()) {
      fromRef.current = value
      setDisplay(value)
      return undefined
    }
    const from = typeof fromRef.current === 'number' ? fromRef.current : 0
    if (from === value) {
      setDisplay(value)
      return undefined
    }
    let raf
    const t0 = performance.now()
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration)
      const eased = 1 - (1 - p) ** 3
      setDisplay(from + (value - from) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      fromRef.current = value
    }
  }, [value, duration])

  return display
}

/**
 * A ticking clock, re-rendering on the given interval.
 *
 * Default is one second: a command centre whose clock is frozen looks like a
 * screenshot, and an operator cannot tell a stalled dashboard from a quiet one.
 */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** "just now" · "4 min ago" · "2 h ago" · "3 d ago". */
export function relativeTime(ts, now = Date.now()) {
  const t = typeof ts === 'number' ? ts : Date.parse(ts)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

/** Manila wall-clock time, to the second. */
export function manilaClock(now = Date.now()) {
  return new Date(now).toLocaleTimeString('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  })
}

/** "Thursday, 28 August 2026" in Manila. */
export function manilaDate(now = Date.now()) {
  return new Date(now).toLocaleDateString('en-PH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  })
}

/**
 * Fire a callback once the element scrolls into view, so a card can play its
 * entrance where the reader can actually see it rather than off-screen while
 * the page is still loading.
 *
 * Returns [ref, seen]. Degrades to "always seen" without IntersectionObserver.
 */
export function useInView(rootMargin = '0px 0px -10% 0px') {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return undefined
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          obs.disconnect()
        }
      },
      { rootMargin },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [rootMargin])

  return [ref, seen]
}
