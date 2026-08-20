import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForecastHour } from '../../services/forecastHour.js'
import { hourlyAt, forecastHorizon, rainIntensity } from '../../services/weather.js'
import './TimeScrubber.css'

/**
 * The time scrubber — drag the whole screen forward through the forecast.
 *
 * Every hour on this strip is a real row of the Open-Meteo hourly series the
 * app was already fetching and discarding, so it costs no extra request.
 *
 * Treated as an INSTRUMENT rather than a form control. It sits on a dark panel
 * because it is not part of the page's content — it is the clock the content is
 * being read at, and it has to look like a different kind of object or an
 * operator will not notice they have moved it. The rainfall curve is the actual
 * forecast, drawn as an area so the shape of the storm is legible at a glance:
 * you can see the peak coming before you touch anything.
 *
 * The readout answers "so what" as well as "how much": alongside the rainfall
 * it shows how many barangays the model puts at High for that hour, so
 * scrubbing shows a consequence and not just a number going up.
 *
 * Three ways in, because a slider alone reads as a setting: press play and it
 * walks the forecast, click anywhere on the curve to jump, or drag the
 * playhead. Keyboard users get the range input underneath.
 *
 * On honesty — a projection shown plainly IS a claim about the future:
 *   • Offset 0 is the live present and looks like it: green, calm.
 *   • Past 0 the panel turns amber and the map gets a tinted frame and badge,
 *     so a forecast cannot be glanced at — or screenshotted — as current.
 *   • The source line is always visible; the caveats are one click away
 *     rather than a grey wall nobody reads.
 *   • The curve stops at the end of the real data. Nothing is extrapolated.
 */
export default function TimeScrubber({ weather, projecting = false, highCount = null }) {
  const [offset, setOffset, isForecast] = useForecastHour()
  const [playing, setPlaying] = useState(false)
  const [hover, setHover] = useState(null)

  const horizon = Math.min(48, forecastHorizon(weather))
  const hour = hourlyAt(weather, offset)

  const bars = useMemo(() => {
    if (!horizon) return []
    const out = []
    for (let i = 0; i <= horizon; i++) {
      const h = hourlyAt(weather, i)
      if (h) out.push({ i, mm: h.precipMm ?? 0, label: h.label, dayLabel: h.dayLabel, pop: h.pop })
    }
    return out
  }, [weather, horizon])

  const peak = useMemo(() => Math.max(0.5, ...bars.map((b) => b.mm)), [bars])
  const wettest = useMemo(
    () => (bars.length ? bars.reduce((a, b) => (b.mm > a.mm ? b : a), bars[0]) : null),
    [bars],
  )

  // Playback walks the forecast and stops at the end. It never wraps — looping
  // back to "now" mid-glance is exactly how someone misreads which hour they
  // are looking at.
  const stop = useCallback(() => setPlaying(false), [])
  useEffect(() => {
    if (!playing) return undefined
    const id = setInterval(() => {
      setOffset((cur) => {
        if (cur >= horizon) { setPlaying(false); return cur }
        return cur + 1
      })
    }, 380)
    return () => clearInterval(id)
  }, [playing, horizon, setOffset])

  const jumpTo = useCallback((i) => { stop(); setOffset(i) }, [setOffset, stop])

  if (!horizon || !hour) {
    return (
      <div className="ts ts--offline">
        <ClockIcon />
        <span>Hourly forecast unavailable — showing live conditions only.</span>
      </div>
    )
  }

  const shownIdx = hover != null ? hover : offset
  const shown = bars[shownIdx] || bars[0]
  const intensity = rainIntensity(shown.mm)

  /* ── The curve ──
     One smooth area over the whole window. Points are hour centres, so the
     playhead and the hit-zones line up with the values exactly. */
  const W = 1000
  const H = 100
  const x = (i) => (horizon === 0 ? 0 : (i / horizon) * W)
  const y = (mm) => H - Math.max(3, (mm / peak) * (H - 8))
  const line = bars.map((b, k) => `${k === 0 ? 'M' : 'L'}${x(b.i).toFixed(1)},${y(b.mm).toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`

  return (
    <div className={`ts ${isForecast ? 'ts--forecast' : ''}`}>
      {/* ── Readout row ── */}
      <div className="ts-bar">
        <button
          type="button"
          className={`ts-play ${playing ? 'on' : ''}`}
          onClick={() => (playing ? stop() : setPlaying(true))}
          disabled={offset >= horizon && !playing}
          aria-label={playing ? 'Pause forecast playback' : 'Play forecast'}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <div className="ts-state">
          <span className={`ts-dot ${isForecast ? '' : 'live'}`} />
          {isForecast ? `FORECAST +${offset}h` : 'LIVE'}
        </div>

        <div className="ts-clock">
          <b>{shown.label}</b>
          <span>{shown.dayLabel}</span>
        </div>

        <div className="ts-metrics">
          <div className={`ts-metric ts-metric--${intensity.key}`}>
            <b>{shown.mm.toFixed(1)}<i>mm/h</i></b>
            <span>{intensity.label}</span>
          </div>
          {shown.pop != null && (
            <div className="ts-metric">
              <b>{shown.pop}<i>%</i></b>
              <span>chance</span>
            </div>
          )}
          {/* The consequence, not just the input. */}
          {highCount != null && (
            <div className={`ts-metric ${highCount > 0 ? 'ts-metric--alarm' : ''}`}>
              <b>{highCount}</b>
              <span>brgy at high</span>
            </div>
          )}
        </div>

        {projecting && <span className="ts-working">recalculating…</span>}

        <div className="ts-actions">
          {wettest && wettest.mm > 0 && wettest.i !== offset && (
            <button type="button" className="ts-chip" onClick={() => jumpTo(wettest.i)}>
              Peak {wettest.label} · {wettest.mm.toFixed(1)}mm
            </button>
          )}
          <button type="button" className="ts-chip ts-chip--now" onClick={() => jumpTo(0)} disabled={offset === 0}>
            Now
          </button>
        </div>
      </div>

      {/* ── The forecast curve ── */}
      <div className="ts-plot" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="ts-svg" aria-hidden="true">
          <defs>
            <linearGradient id="tsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ts-accent)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--ts-accent)" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {/* Midnight dividers, so "+30h" reads as a real time of day. */}
          {bars.map((b, k) => (
            k > 0 && b.dayLabel !== bars[k - 1].dayLabel ? (
              <line key={`d${b.i}`} className="ts-day" x1={x(b.i)} y1="0" x2={x(b.i)} y2={H} />
            ) : null
          ))}

          <path d={area} fill="url(#tsFill)" />
          <path d={line} className="ts-line" />

          <line className="ts-playhead" x1={x(offset)} y1="0" x2={x(offset)} y2={H} />
          <circle className="ts-knob" cx={x(offset)} cy={y(bars[offset]?.mm ?? 0)} r="4.5" />
        </svg>

        {/* Hit zones — one per hour, so a click lands on the hour you aimed at. */}
        <div className="ts-hits">
          {bars.map((b) => (
            <button
              key={b.i}
              type="button"
              className={`ts-hit ${b.i === offset ? 'on' : ''}`}
              onClick={() => jumpTo(b.i)}
              onMouseEnter={() => setHover(b.i)}
              aria-label={`${b.dayLabel} ${b.label}, ${b.mm.toFixed(1)} millimetres per hour`}
            />
          ))}
        </div>

        <input
          type="range"
          className="ts-range"
          min="0"
          max={horizon}
          step="1"
          value={offset}
          onChange={(e) => jumpTo(Number(e.target.value))}
          aria-label="Forecast hour"
          aria-valuetext={isForecast ? `${hour.dayLabel} ${hour.label}, forecast` : `Now, ${hour.label}`}
        />
      </div>

      <div className="ts-foot">
        <div className="ts-axis">
          <span>Now</span>
          <span>+{Math.round(horizon / 4)}h</span>
          <span>+{Math.round(horizon / 2)}h</span>
          <span>+{Math.round((horizon * 3) / 4)}h</span>
          <span>+{horizon}h</span>
        </div>
        <details className="ts-src">
          <summary>Open-Meteo model estimate — not a measurement</summary>
          <p>
            Modelled hourly values, not readings from a gauge in Cabuyao, and a forecast is
            not a guarantee. River discharge is published daily and is held flat across these
            hours, so a fast-rising river is under-represented. Terrain susceptibility is
            measured; the weather on top of it is predicted. Verify on the ground before
            acting on a projected hour.
          </p>
        </details>
      </div>
    </div>
  )
}

/**
 * The badge that rides on the map itself while the scrubber is off "now".
 * Separate from the scrubber on purpose: the scrubber sits at the edge of the
 * screen and is easy to look past, while this sits on top of the thing being
 * misread. With the tinted frame it means a projected map cannot be mistaken
 * for current conditions even in a screenshot.
 */
export function ForecastBadge({ hour, offset }) {
  if (!offset) return null
  return (
    <div className="forecast-badge" role="status">
      <ClockIcon />
      <span>FORECAST · {hour ? `${hour.dayLabel} ${hour.label}` : `+${offset}h`}</span>
      <em>model estimate</em>
    </div>
  )
}

/* ── Icons ──────────────────────────────────────────────────────────────── */
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="ts-icon">
      <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
    </svg>
  )
}
function PlayIcon() {
  return <svg viewBox="0 0 24 24" className="ts-icon ts-icon--solid"><polygon points="7 4 20 12 7 20 7 4" /></svg>
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="ts-icon ts-icon--solid">
      <rect x="6" y="4" width="4.5" height="16" rx="1.2" />
      <rect x="13.5" y="4" width="4.5" height="16" rx="1.2" />
    </svg>
  )
}
