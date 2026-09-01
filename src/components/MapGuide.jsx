import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './mapGuide.css'

/* ============================================================
   MapGuide — the illustrated "how do I use this map?" walkthrough.

   Every map in this system is dense: layers, hazard bands, a forecast clock,
   colour-coded roads. The resident routing screen has had a walkthrough for a
   while; CDRRMO staff and barangay officials work the harder screens and had
   nothing, on the assumption that they would be trained. They are not always
   trained, and the person on shift at 2 a.m. may be seeing the screen for the
   first time. So the same walkthrough is now available everywhere.

   The rules it keeps:

     • DRAWN, NOT WRITTEN. Every step carries a diagram of the actual screen —
       the layer switches, the hazard bands, the route bending around a flooded
       street. Someone skimming under pressure reads pictures.
     • BILINGUAL. English heading, Tagalog underneath. Barangay officials and
       residents are not a monolingual audience, and neither are night-shift
       operators.
     • ALWAYS ONE CLICK AWAY. On the operator screens it never opens by itself
       and it is never dismissed for good — it is a Tutorial button in the
       toolbar that can be pressed as often as needed.

   This file is the shell only: the dialog, the paging, the keyboard handling
   and the button that opens it. What each screen actually says lives in
   mapGuideSteps.jsx; the resident walkthrough keeps its own steps (and its
   first-run behaviour) in components/resident/RoutingGuide.jsx.
   ============================================================ */

/**
 * The walkthrough dialog.
 *
 * @param open      whether it is showing
 * @param onClose   called on Escape, the X, Skip, and the final button
 * @param steps     [{ key, art, title, tagalog, body, tip }]
 * @param label     accessible name for the dialog
 * @param doneLabel text of the button on the last step
 */
export default function MapGuide({ open, onClose, steps, label = 'How to use this map', doneLabel = 'Got it' }) {
  const [i, setI] = useState(0)

  /* onClose is usually written inline at the call site, so it is a NEW function
     on every render of a page that re-renders on its own several times a minute
     (the shared store polls, the map reports its centre). Depending on it in
     the effects below made them re-run on each of those renders, which dragged
     the reader back to step 1 every few seconds. Keeping the latest callback in
     a ref makes the handler stable without going stale. */
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const close = useCallback(() => {
    onCloseRef.current?.()
  }, [])

  // Start at the beginning each time it is OPENED — and only then.
  useEffect(() => {
    if (open) setI(0)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') setI((v) => Math.min(steps.length - 1, v + 1))
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, steps.length])

  if (!open || !steps?.length) return null

  const step = steps[Math.min(i, steps.length - 1)]
  const Art = step.art
  const last = i === steps.length - 1

  /* Rendered into <body>, not where it was written.

     MapGuideButton is dropped into map toolbars, and toolbars are exactly the
     elements that carry `white-space: nowrap`, `overflow: hidden` and
     transforms. `position: fixed` escapes the layout but NOT inherited text
     properties — mounted inside the sub-tab bar, every paragraph in the dialog
     inherited nowrap and ran off the side of the card. A transform on any
     ancestor would break the fixed positioning outright. A portal makes the
     dialog independent of whichever toolbar opened it. */
  return createPortal(
    <div className="mguide-backdrop" role="dialog" aria-modal="true" aria-label={label}>
      <div className="mguide">
        <button type="button" className="mguide-x" onClick={close} aria-label="Close guide">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>

        <div className="mguide-head">
          <span className="mguide-kicker">How to use · Paano gamitin</span>
          <span className="mguide-count">{i + 1} / {steps.length}</span>
        </div>

        <div className="mguide-stage" key={step.key}>
          {Art ? <Art /> : null}
        </div>

        <div className="mguide-body" key={`${step.key}-text`}>
          <h3>{step.title}</h3>
          {step.tagalog && <p className="mguide-fil">{step.tagalog}</p>}
          <p className="mguide-text">{step.body}</p>
          {step.tip && (
            <p className="mguide-tip">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
              <span>{step.tip}</span>
            </p>
          )}
        </div>

        <div className="mguide-dots">
          {steps.map((s, idx) => (
            <button
              key={s.key}
              type="button"
              className={`mguide-dot ${idx === i ? 'on' : ''} ${idx < i ? 'done' : ''}`}
              onClick={() => setI(idx)}
              aria-label={`Step ${idx + 1}: ${s.title}`}
            />
          ))}
        </div>

        <div className="mguide-actions">
          <button type="button" className="mguide-skip" onClick={close}>
            {last ? 'Close' : 'Skip'}
          </button>
          <div className="mguide-nav">
            {i > 0 && (
              <button type="button" className="mguide-btn ghost" onClick={() => setI(i - 1)}>Back</button>
            )}
            <button
              type="button"
              className="mguide-btn"
              onClick={() => (last ? close() : setI(i + 1))}
            >
              {last ? doneLabel : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Drop-in toolbar control: the Tutorial button and the dialog it opens, in one
 * element, so adding the walkthrough to a screen is a single line.
 *
 * It deliberately does NOT remember having been seen. On the operator screens
 * this is a reference someone comes back to — hiding it after one read would
 * take the manual away from exactly the person who needed it twice.
 */
export function MapGuideButton({ steps, label = 'Tutorial', title = 'How to use this map', doneLabel = 'Got it' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="mguide-trigger"
        onClick={() => setOpen(true)}
        title={title}
        aria-haspopup="dialog"
      >
        <GuideIcon />
        <span className="mguide-trigger-label">{label}</span>
      </button>
      <MapGuide open={open} onClose={() => setOpen(false)} steps={steps} label={title} doneLabel={doneLabel} />
    </>
  )
}

/* An open book rather than a question mark: "?" reads as support/FAQ, and this
   is a walkthrough of the screen in front of them. */
function GuideIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H10a2 2 0 0 1 2 2v14a1.6 1.6 0 0 0-1.6-1.6H4.5A2.5 2.5 0 0 1 2 15V5.5Z" />
      <path d="M22 5.5A2.5 2.5 0 0 0 19.5 3H14a2 2 0 0 0-2 2v14a1.6 1.6 0 0 1 1.6-1.6h6A2.5 2.5 0 0 0 22 15V5.5Z" />
    </svg>
  )
}
