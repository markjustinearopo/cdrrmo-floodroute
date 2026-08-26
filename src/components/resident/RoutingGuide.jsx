import { useCallback, useEffect, useRef, useState } from 'react'
import './routingGuide.css'

/* ============================================================
   RoutingGuide — the "how do I use this?" walkthrough for residents.

   Every other screen in this system is used by someone trained on it. This one
   is used, once, by a person who has never opened it before and is opening it
   now because water is rising. So the guide is:

     • SHOWN, NOT BURIED. It opens by itself the first time a resident lands on
       Evacuation Routing, and is one tap away afterwards ("How to use").
     • DRAWN, NOT WRITTEN. Each step carries a diagram of the actual screen —
       the pin, the route bending around a flooded street, the maneuver banner.
       Someone skimming in a panic reads pictures.
     • BILINGUAL. English heading, Tagalog underneath, on every step. Cabuyao
       residents are not a monolingual audience and an evacuation instruction is
       the worst possible place to make someone translate.

   Dismissal is remembered per browser. "Show this again" lives on the routing
   page itself, so nobody is permanently locked out of the instructions.
   ============================================================ */

const SEEN_KEY = 'cdrrmo_resident_routing_guide_seen'

export function hasSeenRoutingGuide() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // storage blocked: don't nag on every page load
  }
}

export function markRoutingGuideSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* ignore */
  }
}

/**
 * Make the walkthrough open by itself again on the next visit. Not wired to
 * a control — the "How to use" button reopens it directly — but kept so
 * support can talk someone through re-arming it from the browser console.
 */
export function resetRoutingGuide() {
  try {
    localStorage.removeItem(SEEN_KEY)
  } catch {
    /* ignore */
  }
}

/* ── Step illustrations ───────────────────────────────────────────────────
   Small, flat, and specifically about THIS screen. A generic stock diagram
   would teach nothing; these show the controls the resident is about to press
   and the colours they are about to see. */

function ArtPin() {
  return (
    <svg viewBox="0 0 260 150" className="rguide-art" role="img" aria-label="A map with your location pinned">
      <rect x="0" y="0" width="260" height="150" rx="12" className="rg-bg" />
      <path d="M18 118 L74 74 L128 96 L186 44 L244 66" className="rg-road" />
      <path d="M40 30 L96 62 L108 128" className="rg-road rg-road--thin" />
      <path d="M196 20 L172 88 L232 122" className="rg-road rg-road--thin" />
      <g className="rg-pop">
        <circle cx="112" cy="88" r="26" className="rg-halo" />
        <circle cx="112" cy="88" r="9" className="rg-you" />
      </g>
      <g className="rg-chip" transform="translate(20 12)">
        <rect width="112" height="24" rx="12" />
        <text x="14" y="16">Find my location</text>
      </g>
    </svg>
  )
}

function ArtRoute() {
  return (
    <svg viewBox="0 0 260 150" className="rguide-art" role="img" aria-label="A safe route bending around a flooded street">
      <rect x="0" y="0" width="260" height="150" rx="12" className="rg-bg" />
      {/* The blocked direct line */}
      <path d="M40 104 L128 104 L212 104" className="rg-road rg-flooded" />
      <text x="118" y="126" className="rg-label rg-label--warn">flooded</text>
      {/* The route that avoids it */}
      <path d="M40 104 L74 104 L74 46 L182 46 L212 46 L212 104" className="rg-route" />
      <path d="M40 104 L74 104 L74 46 L182 46 L212 46 L212 104" className="rg-route-flow" />
      <circle cx="40" cy="104" r="8" className="rg-you" />
      <g transform="translate(200 92)">
        <path d="M0 20 L0 8 L12 0 L24 8 L24 20 Z" className="rg-shelter" />
      </g>
    </svg>
  )
}

function ArtGuide() {
  return (
    <svg viewBox="0 0 260 150" className="rguide-art" role="img" aria-label="The navigation banner announcing a turn">
      <rect x="0" y="0" width="260" height="150" rx="12" className="rg-bg" />
      <rect x="26" y="14" width="208" height="52" rx="12" className="rg-banner" />
      <g transform="translate(40 24)" className="rg-pop">
        <rect width="32" height="32" rx="8" className="rg-banner-icon" />
        <path d="M22 26 v-11 a4 4 0 0 0 -4 -4 h-8 M10 11 l5 -5 M10 11 l5 5" className="rg-banner-arrow" />
      </g>
      <text x="84" y="40" className="rg-banner-big">120 m</text>
      <text x="84" y="56" className="rg-banner-small">Turn left onto Mabini St.</text>
      <g className="rg-voice" transform="translate(196 84)">
        <path d="M8 4 L2 9 H-4 v8 h6 l6 5 z" />
        <path d="M15 8 a6 6 0 0 1 0 10" className="rg-voice-wave" />
        <path d="M20 4 a11 11 0 0 1 0 18" className="rg-voice-wave rg-voice-wave--2" />
      </g>
      <path d="M22 118 L92 118 L92 92 L168 92" className="rg-route" />
      <circle cx="22" cy="118" r="7" className="rg-you" />
    </svg>
  )
}

function ArtReroute() {
  return (
    <svg viewBox="0 0 260 150" className="rguide-art" role="img" aria-label="The route redrawing itself after a wrong turn">
      <rect x="0" y="0" width="260" height="150" rx="12" className="rg-bg" />
      <path d="M28 116 L96 116 L96 52 L206 52" className="rg-route rg-route--ghost" />
      <path d="M28 116 L96 116 L96 92 L166 92 L166 52 L206 52" className="rg-route" />
      <path d="M28 116 L96 116 L96 92 L166 92 L166 52 L206 52" className="rg-route-flow" />
      <circle cx="96" cy="92" r="8" className="rg-you" />
      <g className="rg-chip rg-chip--dark" transform="translate(60 16)">
        <rect width="140" height="26" rx="13" />
        <circle cx="18" cy="13" r="5" className="rg-spin" />
        <text x="32" y="17">Rerouting…</text>
      </g>
    </svg>
  )
}

function ArtLegend() {
  return (
    <svg viewBox="0 0 260 150" className="rguide-art" role="img" aria-label="What the colours on the map mean">
      <rect x="0" y="0" width="260" height="150" rx="12" className="rg-bg" />
      <g className="rg-legend">
        <path d="M22 30 h56" className="rg-route" />
        <text x="90" y="34">Your safe route</text>

        <path d="M22 60 h56" className="rg-road rg-flooded" />
        <text x="90" y="64">Flooded road — avoid</text>

        <path d="M22 90 h56" className="rg-road rg-closed" />
        <text x="90" y="94">Closed road — impassable</text>

        <g transform="translate(38 108)">
          <path d="M0 20 L0 8 L12 0 L24 8 L24 20 Z" className="rg-shelter" />
        </g>
        <text x="90" y="124">Open evacuation centre</text>
      </g>
    </svg>
  )
}

const STEPS = [
  {
    key: 'where',
    art: ArtPin,
    title: 'Tell the map where you are',
    tagalog: 'Ipaalam sa mapa kung nasaan ka.',
    body: (
      <>
        Tap <b>Find my location</b> and allow your browser to share it. If the pin
        lands a street off, tap <b>Pin my location</b> and touch the exact spot,
        or drag the blue pin. Every route starts from this pin.
      </>
    ),
    tip: 'No GPS signal indoors? Place the pin by hand — it works exactly the same.',
  },
  {
    key: 'route',
    art: ArtRoute,
    title: 'Generate your safe route',
    tagalog: 'Kumuha ng ligtas na ruta papunta sa evacuation center.',
    body: (
      <>
        Tap <b>Generate safe route</b>. The system finds the nearest evacuation
        centre that is <b>open</b>, then works out the way there that avoids
        roads CDRRMO has flagged as flooded or closed — even when that means a
        longer walk.
      </>
    ),
    tip: 'The panel tells you the distance, the walking time, and whether any part of the route is still risky.',
  },
  {
    key: 'navigate',
    art: ArtGuide,
    title: 'Start guided navigation',
    tagalog: 'Simulan ang gabay — may boses na magsasabi ng bawat liko.',
    body: (
      <>
        Tap <b>Start guided navigation</b>. The map follows your position live,
        counts down the metres to your next turn, and <b>says each instruction
        out loud</b> so you can keep your eyes on the water instead of the
        screen.
      </>
    ),
    tip: 'Tap the speaker button any time to mute or unmute the voice.',
  },
  {
    key: 'reroute',
    art: ArtReroute,
    title: 'It corrects itself',
    tagalog: 'Kusang magbabago ang ruta kapag lumihis ka o binaha ang daan.',
    body: (
      <>
        Take a wrong turn and the route is re-planned from where you are
        standing. If CDRRMO flags a road ahead of you as flooded while you are
        walking, the route changes too — and you are told out loud that it
        happened.
      </>
    ),
    tip: 'Keep walking while it recalculates. It never leaves you without an instruction.',
  },
  {
    key: 'legend',
    art: ArtLegend,
    title: 'Know the colours',
    tagalog: 'Alamin ang kahulugan ng mga kulay sa mapa.',
    body: (
      <>
        Green is your route. Orange dashes are roads reported <b>flooded</b>.
        Solid red is <b>closed</b> — impassable, not merely wet. Green houses are
        evacuation centres that are currently open.
      </>
    ),
    tip: 'Conditions change fast. Always follow responders and barangay officials on the ground over anything on this screen.',
  },
]

export default function RoutingGuide({ open, onClose }) {
  const [i, setI] = useState(0)

  /* onClose is written inline at the call site, so it is a NEW function on
     every render of the routing page — and that page re-renders on its own
     several times a minute (the shared data store polls, the map reports its
     centre). Depending on it here made the effect below re-run on each of
     those renders, which meant `setI(0)` fired constantly and the reader was
     silently dragged back to step 1 every few seconds. Keeping the latest
     callback in a ref makes the handler stable without going stale. */
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const close = useCallback(() => {
    markRoutingGuideSeen()
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
      if (e.key === 'ArrowRight') setI((v) => Math.min(STEPS.length - 1, v + 1))
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const step = STEPS[i]
  const Art = step.art
  const last = i === STEPS.length - 1

  return (
    <div className="rguide-backdrop" role="dialog" aria-modal="true" aria-label="How to use evacuation routing">
      <div className="rguide">
        <button type="button" className="rguide-x" onClick={close} aria-label="Close guide">
          <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>

        <div className="rguide-head">
          <span className="rguide-kicker">How to use · Paano gamitin</span>
          <span className="rguide-count">{i + 1} / {STEPS.length}</span>
        </div>

        <div className="rguide-stage" key={step.key}>
          <Art />
        </div>

        <div className="rguide-body" key={`${step.key}-text`}>
          <h3>{step.title}</h3>
          <p className="rguide-fil">{step.tagalog}</p>
          <p className="rguide-text">{step.body}</p>
          <p className="rguide-tip">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
            <span>{step.tip}</span>
          </p>
        </div>

        <div className="rguide-dots">
          {STEPS.map((s, idx) => (
            <button
              key={s.key}
              type="button"
              className={`rguide-dot ${idx === i ? 'on' : ''} ${idx < i ? 'done' : ''}`}
              onClick={() => setI(idx)}
              aria-label={`Step ${idx + 1}: ${s.title}`}
            />
          ))}
        </div>

        <div className="rguide-actions">
          <button type="button" className="rguide-skip" onClick={close}>
            {last ? 'Close' : 'Skip'}
          </button>
          <div className="rguide-nav">
            {i > 0 && (
              <button type="button" className="rguide-btn ghost" onClick={() => setI(i - 1)}>Back</button>
            )}
            <button
              type="button"
              className="rguide-btn"
              onClick={() => (last ? close() : setI(i + 1))}
            >
              {last ? "Got it — let's go" : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
