import { useEffect, useRef, useState } from 'react'
import './DepthGauge.css'

/* ============================================================
   How deep is "0.62 m", really?

   Every screen in this system reports flood depth as a number in metres, and
   a number in metres is the one thing a person standing in front of the water
   cannot use. 0.62 m does not tell a resident whether to walk it, and it does
   not tell a responder whether a pickup gets through.

   So: draw it. The modeled depth as water against a person and a car at true
   relative scale, with the thresholds that actually matter marked on the axis
   — ankle, knee, waist, chest — and a verdict in the language of the decision
   being made ("cars stall", "do not wade"). The water animates because water
   does; the level itself eases to any new reading so a rise is something you
   see happen rather than something you have to notice.

   The thresholds are the standard flood-safety ones used in PH disaster
   briefings: 15 cm of moving water takes an adult off their feet at speed,
   30 cm stalls most cars, 60 cm floats them.
   ============================================================ */

const SCALE_MAX = 2.0 // metres shown before the gauge clamps
const GROUND_Y = 134
const TOP_Y = 14
const PX_PER_M = (GROUND_Y - TOP_Y) / SCALE_MAX

const MARKS = [
  { m: 0.15, label: 'Ankle' },
  { m: 0.5, label: 'Knee' },
  { m: 1.0, label: 'Waist' },
  { m: 1.4, label: 'Chest' },
]

/** What this depth means for the person reading it. */
export function depthVerdict(m) {
  const d = Number(m) || 0
  if (d < 0.05) return { key: 'dry', head: 'No standing water', body: 'Roads are clear. Conditions are being monitored.' }
  if (d < 0.15) return { key: 'trace', head: 'Surface water', body: 'Passable on foot and by vehicle. Watch for slippery road markings.' }
  if (d < 0.3) return { key: 'ankle', head: 'Ankle deep', body: 'Passable on foot. Open drains and manholes are the real hazard — walk, do not run.' }
  if (d < 0.6) return { key: 'knee', head: 'Knee deep', body: 'Small cars stall and motorcycles cannot pass. Moving water at this depth can take an adult off their feet.' }
  if (d < 1.0) return { key: 'thigh', head: 'Thigh to waist deep', body: 'Impassable to most vehicles. Do not wade — you cannot see what the current has moved.' }
  return { key: 'over', head: 'Waist deep or more', body: 'Life-threatening. Do not cross on foot or by vehicle. Move to higher ground and wait for rescue.' }
}

/**
 * @param depth      modeled depth in metres
 * @param label      caption above the figure (e.g. "Brgy. Baclaran")
 * @param compact    hide the verdict paragraph — for a tight column
 */
export default function DepthGauge({ depth = 0, label, compact = false }) {
  const target = Math.max(0, Number(depth) || 0)
  const shown = useEasedDepth(target)
  const clamped = Math.min(shown, SCALE_MAX)
  const waterY = GROUND_Y - clamped * PX_PER_M
  const verdict = depthVerdict(target)
  const over = target > SCALE_MAX

  return (
    <div className={`dg ${verdict.key} ${compact ? 'compact' : ''}`}>
      <div className="dg-stage">
        <svg viewBox="0 0 230 150" className="dg-svg" role="img"
          aria-label={`Estimated flood depth ${target.toFixed(2)} metres — ${verdict.head}`}>
          <defs>
            <linearGradient id="dgWater" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.72" />
              <stop offset="100%" stopColor="#0369a1" stopOpacity="0.9" />
            </linearGradient>
            <clipPath id="dgClip">
              <rect x="0" y="0" width="230" height={GROUND_Y} />
            </clipPath>
          </defs>

          {/* Depth axis — the marks that carry the decision. */}
          {MARKS.map((mk) => {
            const y = GROUND_Y - mk.m * PX_PER_M
            return (
              <g key={mk.label} className={`dg-mark ${clamped >= mk.m ? 'reached' : ''}`}>
                <line x1="34" x2="222" y1={y} y2={y} />
                <text x="30" y={y + 3}>{mk.label}</text>
              </g>
            )
          })}

          {/* Ground. */}
          <line className="dg-ground" x1="34" x2="222" y1={GROUND_Y} y2={GROUND_Y} />

          {/* A car and a person at true relative scale, drawn BEFORE the water
              so the water washes over them. */}
          <g className="dg-figures">
            {/* Sedan: roof 1.45 m, sill 0.55 m, wheels on the ground. */}
            <path
              className="dg-car"
              d={`M 52 ${GROUND_Y - 0.35 * PX_PER_M}
                  L 52 ${GROUND_Y - 0.85 * PX_PER_M}
                  Q 52 ${GROUND_Y - 0.95 * PX_PER_M} 62 ${GROUND_Y - 0.98 * PX_PER_M}
                  L 74 ${GROUND_Y - 1.45 * PX_PER_M}
                  L 100 ${GROUND_Y - 1.45 * PX_PER_M}
                  L 112 ${GROUND_Y - 0.98 * PX_PER_M}
                  Q 124 ${GROUND_Y - 0.95 * PX_PER_M} 124 ${GROUND_Y - 0.82 * PX_PER_M}
                  L 124 ${GROUND_Y - 0.35 * PX_PER_M} Z`}
            />
            <circle className="dg-wheel" cx="66" cy={GROUND_Y - 0.32 * PX_PER_M} r={0.32 * PX_PER_M} />
            <circle className="dg-wheel" cx="110" cy={GROUND_Y - 0.32 * PX_PER_M} r={0.32 * PX_PER_M} />

            {/* Adult, 1.65 m: head, torso, legs. */}
            <circle className="dg-person" cx="176" cy={GROUND_Y - 1.53 * PX_PER_M} r={0.11 * PX_PER_M} />
            <path
              className="dg-person"
              d={`M 176 ${GROUND_Y - 1.42 * PX_PER_M}
                  L 176 ${GROUND_Y - 0.88 * PX_PER_M}`}
            />
            <path
              className="dg-person-line"
              d={`M 163 ${GROUND_Y - 1.28 * PX_PER_M} L 189 ${GROUND_Y - 1.28 * PX_PER_M}`}
            />
            <path
              className="dg-person-line"
              d={`M 176 ${GROUND_Y - 0.88 * PX_PER_M} L 167 ${GROUND_Y}
                  M 176 ${GROUND_Y - 0.88 * PX_PER_M} L 185 ${GROUND_Y}`}
            />
          </g>

          {/* The water itself. */}
          <g clipPath="url(#dgClip)">
            <rect
              className="dg-water"
              x="34" y={waterY} width="188" height={Math.max(0, GROUND_Y - waterY)}
              fill="url(#dgWater)"
            />
            {clamped > 0.02 && (
              <>
                <path className="dg-wave a" d={wavePath(waterY, 0)} />
                <path className="dg-wave b" d={wavePath(waterY + 1.5, 30)} />
              </>
            )}
          </g>

          {/* The reading, on the water line. */}
          {clamped > 0.02 && (
            <g className="dg-reading" style={{ '--y': `${waterY}px` }}>
              <line x1="34" x2="222" y1={waterY} y2={waterY} />
            </g>
          )}
        </svg>

        <div className="dg-value" style={{ bottom: `${((GROUND_Y - waterY) / 150) * 100}%` }}>
          <b>{over ? '>2' : target.toFixed(2)}</b><em>m</em>
        </div>
      </div>

      <div className="dg-text">
        {label && <div className="dg-label">{label}</div>}
        <div className="dg-head">{verdict.head}</div>
        {!compact && <div className="dg-body">{verdict.body}</div>}
      </div>
    </div>
  )
}

/** One period of a gentle surface wave across the gauge. */
function wavePath(y, phase) {
  const amp = 2.2
  const w = 47
  let d = `M 34 ${(y + amp).toFixed(1)}`
  for (let x = 34; x < 222; x += w) {
    d += ` Q ${(x + w / 4).toFixed(1)} ${(y - amp + phase * 0.02).toFixed(1)}`
      + ` ${(x + w / 2).toFixed(1)} ${(y + amp * 0.2).toFixed(1)}`
      + ` Q ${(x + (w * 3) / 4).toFixed(1)} ${(y + amp * 1.6).toFixed(1)}`
      + ` ${(x + w).toFixed(1)} ${(y + amp * 0.2).toFixed(1)}`
  }
  d += ` L 222 ${GROUND_Y} L 34 ${GROUND_Y} Z`
  return d
}

/**
 * Ease the drawn level toward the reading instead of jumping to it.
 * A flood that rises 20 cm between polls should be visible as a rise.
 */
function useEasedDepth(target, duration = 900) {
  const [value, setValue] = useState(0)
  const currentRef = useRef(0)

  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      currentRef.current = target
      setValue(target)
      return undefined
    }
    const from = currentRef.current
    if (from === target) return undefined
    let raf
    const t0 = performance.now()
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration)
      const eased = 1 - (1 - p) ** 3
      const next = from + (target - from) * eased
      currentRef.current = next
      setValue(next)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return value
}
