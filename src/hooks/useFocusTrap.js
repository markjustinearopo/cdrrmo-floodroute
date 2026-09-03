import { useEffect, useRef } from 'react'

/**
 * Keep keyboard focus inside an open dialog, and give it back on close.
 *
 * WHY THIS EXISTS
 * Both shared dialog components handled Escape and locked background
 * scrolling, but neither touched focus. Three things followed from that, and
 * all three are the difference between "has a dialog" and "has a usable
 * dialog":
 *
 *   1. Opening one left focus on the button behind it. A screen reader went
 *      on reading the page underneath as though nothing had happened — the
 *      dialog was, to that user, invisible.
 *   2. Tab walked straight out of the dialog and into the page behind it,
 *      which is still covered by a backdrop. Focus went somewhere the person
 *      cannot see and cannot click.
 *   3. Closing it dropped focus to <body>, so the next Tab restarted from the
 *      top of the document — after every confirmation, in every portal.
 *
 * This matters most on the dialog this system exists for: the "are you sure?"
 * before resolving an alert or deleting an evacuation centre.
 *
 * Returns a ref to put on the dialog container.
 *
 * @param {boolean} active whether the dialog is currently open
 */
export function useFocusTrap(active = true) {
  const containerRef = useRef(null)
  const restoreToRef = useRef(null)

  useEffect(() => {
    if (!active) return undefined
    const node = containerRef.current
    if (!node) return undefined

    // Remember where focus came from so it can be handed back on close.
    restoreToRef.current = document.activeElement

    const FOCUSABLE = [
      'a[href]', 'button:not([disabled])', 'input:not([disabled])',
      'select:not([disabled])', 'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')

    const focusable = () =>
      [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null)

    /* Move focus in. Prefer the first control over the container itself so a
       screen reader announces something actionable rather than just the
       dialog's name. Falls back to the container, which the caller makes
       focusable with tabIndex={-1}. */
    const first = focusable()[0]
    ;(first || node).focus?.({ preventScroll: true })

    function onKeyDown(e) {
      if (e.key !== 'Tab') return
      const items = focusable()
      if (!items.length) {
        e.preventDefault()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]

      // Wrap at both ends, and pull focus back in if it has escaped entirely
      // (which happens when the element that had it is removed mid-dialog).
      if (!node.contains(document.activeElement)) {
        e.preventDefault()
        firstEl.focus()
        return
      }
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)

      /* Hand focus back to whatever opened this — but on the NEXT frame, not
         synchronously here. This cleanup runs before React has finished
         tearing the overlay out of the DOM, and removing the element that
         currently holds focus resets it to <body>. Restoring first and
         letting React clobber it a moment later is exactly the bug this is
         meant to fix, and it measured as "focus went to body" until the
         restore was deferred past the unmount. */
      const back = restoreToRef.current
      if (!back) return
      requestAnimationFrame(() => {
        if (document.contains(back)) back.focus?.({ preventScroll: true })
      })
    }
  }, [active])

  return containerRef
}

export default useFocusTrap
