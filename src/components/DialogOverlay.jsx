import { useEffect } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap.js'

/**
 * The backdrop every modal in this app already renders — with the three
 * behaviours they were all missing.
 *
 * WHY THIS EXISTS
 * Two shared dialogs (ConfirmDialog, Modal) were built properly. The other
 * nineteen modals in the product were written one at a time and each one
 * hand-rolled its own `<div className="…-overlay">`. Every one of them had
 * the same three gaps, because nobody decided on them — they simply never
 * got written:
 *
 *   1. **No focus trap.** Opening the dialog left focus on the button behind
 *      it, so a screen reader carried on reading the page underneath as if
 *      nothing had opened, and Tab walked out of the dialog into a page that
 *      is covered by a backdrop the user cannot see past.
 *   2. **No Escape.** Nineteen dialogs could only be closed by finding and
 *      hitting a specific button with a mouse.
 *   3. **No scroll lock.** Scrolling over the backdrop scrolled the page
 *      behind it, so the dialog drifted around over moving content.
 *
 * This renders exactly one div — the same div each caller rendered before, in
 * the same place with the same class. No wrapper, no extra node: the CSS that
 * centres `.x-overlay > .x-modal` still sees the child it expects.
 *
 * It is a component rather than a hook on purpose. Several screens render two
 * or three different modals from one file, conditionally; a hook would have to
 * be called unconditionally at the top of the component with a separate
 * "is this one open" flag for each. A component just goes where the dialog is.
 *
 * props
 *   className  — the caller's own overlay class, unchanged
 *   onDismiss  — close handler. Wired to BOTH the backdrop click and Escape.
 *                Omit it for a dialog that must not be escapable (the
 *                first-login password change, which is the whole point of
 *                that screen).
 *   children   — the dialog card
 *   ...rest    — forwarded to the div (style, aria-*, data-*)
 */
/* Every overlay currently mounted, innermost last.
   Dialogs nest for real in this app — the notifications panel opens a
   notification's detail on top of itself, and the flood map opens a
   confirmation over an editor. Each overlay listening for Escape on its own
   would close ALL of them at once, or (since capture-phase listeners on the
   same target fire in registration order) close the OUTERMOST one and leave
   the inner dialog floating over nothing. Only the top of this stack reacts. */
const stack = []

export default function DialogOverlay({ className, onDismiss, children, ...rest }) {
  const ref = useFocusTrap(true)

  useEffect(() => {
    const token = {}
    stack.push(token)
    return () => {
      const at = stack.indexOf(token)
      if (at !== -1) stack.splice(at, 1)
    }
  }, [])

  useEffect(() => {
    if (!onDismiss) return undefined
    const token = stack[stack.length - 1]
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (stack[stack.length - 1] !== token) return // something is open on top
      e.stopPropagation()
      onDismiss()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onDismiss])

  useEffect(() => {
    /* Only the outermost overlay touches body overflow. A nested dialog that
       captured the value on mount would read the already-hidden value and
       "restore" the page to un-scrollable when it closed. */
    if (stack.length > 1) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={className}
      /* mousedown, not click: a click that STARTS inside the dialog and ends
         on the backdrop (dragging to select text in a field, releasing past
         the edge) would otherwise close the dialog and lose what was typed. */
      onMouseDown={onDismiss}
      {...rest}
    >
      {children}
    </div>
  )
}
