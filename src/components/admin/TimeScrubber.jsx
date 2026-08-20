import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForecastHour } from '../../services/forecastHour.js'
import { hourlyAt, forecastHorizon, rainIntensity } from '../../services/weather.js'
import './TimeScrubber.css'

/**
 * The time scrubber — drag the whole screen forward through the forecast.
 *
 * Every hour on this strip is a real row of the Open-Meteo hourly series the
 * app was already fetching and discarding, so it costs no extra request.
 *
 * The bars are not decoration: each one is that hour's forecast rainfall,
 * coloured by intensity. The tall ones are where the model expects water, and
 * landing on one is what spreads the hazard bands and re-solves the route. So
 * the control tells you where to look before you touch it — you can see the
 * storm coming and go straight to it.
 *
 * Three ways in, because a slider alone reads as a setting rather than an
 * exploration: press play and it walks the forecast on its own, click any bar
 * to jump, or drag the handle. Keyboard users get the range input underneath.
 *
 * On honesty — a projection shown plainly IS a claim about the future:
 *   • Offset 0 is the live present and looks like it: green, no tint.
 *   • Past 0 the strip turns amber, the map gets a tinted frame and a badge,
 *     so a forecast can't be glanced at — or screenshotted — as current.
 *   • The source line is always visible. The detail (including which part of
 *     the model is NOT hourly) is one click away rather than a grey wall
 *     nobody reads.
 *   • The strip stops at the end of the real data. Nothing is extrapolated.
 */
export default function TimeScrubber({ weather, projecting = false }) {
  const [offset, setOffset, isForecast] = useForecastHour()
  const [playing, setPlaying] = useState(false)
  const [hovered, setHovered] = useState(null)
  const [showDetail, setShowDetail] = useState(false)

  // Never offer more hours than the feed returned; cap at 48 because an hourly
  // rainfall forecast beyond that is already a weak claim.
  const horizon = Math.min(48, forecastHorizon(weather))
  const hour = hourlyAt(weather, offset)

  const bars = useMemo(() => {
    if (!horizon) return []
    const out = []
    for (let i = 0; i <= horizon; i++) {
      const h = hourlyAt(weather, i)
      if (h) out.push({ i, mm: h.precipMm ?? 0, label: h.label, dayLabel: h.dayLabel, iso: h.iso })
    }
    return out
  }, [weather, horizon])

  const peak = useMemo(() => bars.reduce((m, b) => Math.max(m, b.mm), 0), [bars])
  const wettest = useMemo(
    () => (bars.length ? bars.reduce((a, b) => (b.mm > a.mm ? b : a), bars[0]) : null),
    [bars],
  )

  // Playback: walk the forecast on its own, stop at the end, and never wrap —
  // looping back to "now" mid-glance is exactly how someone misreads which
  // hour they are looking at.
  const stop = useCallback(() => setPlaying(false), [])
  useEffect(() => {
    if (!playing) return undefined
    const id = setInterval(() => {
      setOffset((cur) => {
        if (cur >= horizon) {
          setPlaying(false)
          return cur
        }
        return cur + 1
      })
    }, 420)
    return () => clearInterval(id)
  }, [playing, horizon, setOffset])

  // Any manual move takes over from playback.
  const jumpTo = useCallback((i) => {
    stop()
    setOffset(i)
  }, [setOffset, stop])

  if (!horizon || !hour) {
    return (
      <div className="ts ts--offline">
        <ClockIcon />
        <span>Hourly forecast unavailable — showing live conditions only.</span>
      </div>
    )
  }

  const shown = hovered != null ? bars[hovered] : null
  const readoutHour = shown || hour
  const readoutMm = shown ? shown.mm : hour.precipMm
  const intensity = rainIntensity(readoutMm)

  return (
    <div className={`ts ${isForecast ? 'ts--forecast' : ''}`}>
      <div className="ts-main">
        {/* Play / pause — the affordance that says "this moves". */}
        <button
          type="button"
          className={`ts-play ${playing ? 'on' : ''}`}
          onClick={() => (playing ? stop() : setPlaying(true))}
          disabled={offset >= horizon && !playing}
          title={playing ? 'Pause' : 'Play the next 48 hours'}
          aria-label={playing ? 'Pause forecast playback' : 'Play forecast'}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        {/* When */}
        <div className="ts-when">
          <div className="ts-when-top">
            <span className={`ts-pill ${isForecast ? '' : 'ts-pill--live'}`}>
              {isForecast ? `FORECAST +${offset}h` : 'LIVE NOW'}
            </span>
            {projecting && <span className="ts-working">recalculating…</span>}
          </div>
          <div className="ts-clock">
            {readoutHour.label}
            <span className="ts-day">{readoutHour.dayLabel}</span>
          </div>
        </div>

        {/* Rain */}
        <div className="ts-rainbox">
          <div className={`ts-rain ts-rain--${intensity.key}`}>
            {readoutMm.toFixed(1)}
            <span className="ts-unit">mm/h</span>
          </div>
          <div className="ts-rain-lbl">{intensity.label}</div>
        </div>

        <div className="ts-spacer" />

        {wettest && wettest.mm > 0 && (
          <button type="button" className="ts-jump" onClick={() => jumpTo(wettest.i)}>
            <RainIcon />
            Peak {wettest.label}
            <b>{wettest.mm.toFixed(1)} mm</b>
          </button>
        )}
        <button
          type="button"
          className="ts-now"
          onClick={() => jumpTo(0)}
          disabled={offset === 0}
        >
          Now
        </button>
      </div>

      {/* ── The strip: one clickable bar per forecast hour ── */}
      <div className="ts-strip" onMouseLeave={() => setHovered(null)}>
        {bars.map((b) => {
          const k = rainIntensity(b.mm).key
          const h = peak > 0 ? Math.max(6, (b.mm / peak) * 100) : 6
          const newDay = b.i > 0 && b.dayLabel !== bars[b.i - 1].dayLabel
          return (
            <button
              key={b.i}
              type="button"
              className={`ts-bar ts-bar--${k} ${b.i === offset ? 'on' : ''} ${newDay ? 'newday' : ''}`}
              style={{ '--h': `${h}%` }}
              onClick={() => jumpTo(b.i)}
              onMouseEnter={() => setHovered(b.i)}
              title={`${b.dayLabel} ${b.label} · ${b.mm.toFixed(1)} mm/h`}
              aria-label={`${b.dayLabel} ${b.label}, ${b.mm.toFixed(1)} millimetres per hour`}
            >
              <span className="ts-bar-fill" />
            </button>
          )
        })}

        {/* Playhead rides above the bars at the selected hour. */}
        <div
          className="ts-head"
          style={{ left: `${(offset / horizon) * 100}%` }}
          aria-hidden="true"
        >
          <span className="ts-head-knob" />
        </div>

        {/* Keyboard + drag, laid over the bars. */}
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

      <div className="ts-axis">
        <span>Now</span>
        <span>+{Math.round(horizon / 4)}h</span>
        <span>+{Math.round(horizon / 2)}h</span>
        <span>+{Math.round((horizon * 3) / 4)}h</span>
        <span>+{horizon}h</span>
      </div>

      {/* Source line always visible; the caveats one click away. */}
      <div className="ts-foot">
        <button
          type="button"
          className="ts-info"
          onClick={() => setShowDetail((v) => !v)}
          aria-expanded={showDetail}
        >
          <InfoIcon />
          Open-Meteo model estimate — not a measurement
          <ChevronIcon open={showDetail} />
        </button>
        {showDetail && (
          <p className="ts-detail">
            These are modelled hourly values, not readings from a gauge in Cabuyao, and a
            forecast is not a guarantee. River discharge is only published daily, so it is
            held flat across these hours — a fast-rising river is under-represented here.
            Terrain susceptibility is measured; the weather on top of it is predicted.
            Verify on the ground before acting on a projected hour.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The badge that sits on the map itself while the scrubber is off "now".
 *
 * Separate from the scrubber on purpose: the scrubber is a control at the edge
 * of the screen and is easy to look past, while this rides on top of the thing
 * being misread. Together with the tinted frame it means a projected map can't
 * be mistaken for current conditions even in a screenshot.
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
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  )
}
function PlayIcon() {
  return <svg viewBox="0 0 24 24" className="ts-icon"><polygon points="6 4 20 12 6 20 6 4" /></svg>
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="ts-icon">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}
function RainIcon() {
  return (
    <svg viewBox="0 0 24 24" className="ts-icon">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  )
}
function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="ts-icon">
      <circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}
function ChevronIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" className={`ts-icon ts-chev ${open ? 'open' : ''}`}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
