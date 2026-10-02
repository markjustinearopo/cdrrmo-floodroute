import { useEffect, useState } from 'react'

/* ============================================================
   Narrow-screen (phone) detection that keeps tracking.

   The map's floating overlay cards are meant to fold down to a chip so they
   never crowd a phone-sized map. That decision used to be taken once, from
   `window.innerWidth` at first render, which left the cards expanded over the
   map whenever the viewport got narrow *after* mount — the common case being a
   phone loaded in landscape (innerWidth ~844) and then turned to portrait
   (~390). Reading a media query and listening for changes fixes that.
   ============================================================ */

export const NARROW_QUERY = '(max-width: 760px)'

/** True while the viewport is phone-width. Updates on resize and rotation. */
export function useNarrowScreen(query = NARROW_QUERY) {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e) => setNarrow(e.matches)
    setNarrow(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return narrow
}

/**
 * Drives a collapsible map overlay: returns `[open, setOpen]`, forcing the
 * panel shut when the viewport becomes narrow and back open when it widens.
 *
 * It fires only when the breakpoint is actually *crossed*, so a deliberate tap
 * on the card's minimize/expand button still sticks — resizing within the same
 * breakpoint never overrides the reader.
 */
export function useOverlayOpen(query = '(max-width: 1180px)') {
  const narrow = useNarrowScreen(query)
  const [open, setOpen] = useState(!narrow)

  useEffect(() => {
    setOpen(!narrow)
  }, [narrow])

  return [open, setOpen]
}
