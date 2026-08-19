import { useMemo } from 'react'
import { useForecastHour } from '../../services/forecastHour.js'
import { hourlyAt, forecastHorizon, rainIntensity } from '../../services/weather.js'
import './TimeScrubber.css'

/**
 * The time scrubber — drag the whole screen forward through the forecast.
 *
 * Every hour on this slider is a real row of the Open-Meteo hourly series the
 * app was already fetching and discarding, so this costs no extra request. The
 * rainfall bars are the actual forecast values, not decoration: the tall ones
 * are where the model expects the water, and dragging onto one is what makes
 * the hazard bands spread and the route re-solve around them.
 *
 * On honesty, which matters more here than anywhere else in the product,
 * because a projection shown plainly IS a claim about the future:
 *   • Offset 0 is the live present and is styled as such — no tint, no chip.
 *   • Anything past 0 puts a persistent "FORECAST" chip and a tinted frame
 *     around the map, so a projection can never be screenshotted or glanced at
 *     as if it were current conditions.
 *   • The footnote names the source and calls it a model estimate, and says
 *     which part of the model is NOT hourly (river discharge).
 *   • The track stops at the end of the real data. There is no extrapolation
 *     past the feed's horizon.
 */
export default function TimeScrubber({ weather, projecting = false }) {
  const [offset, setOffset, isForecast] = useForecastHour()

  // Never offer more hours than the feed actually returned; cap at 48 because
  // an hourly rainfall forecast that far out is already a weak claim.
  const horizon = Math.min(48, forecastHorizon(weather))
  const hour = hourlyAt(weather, offset)

  // Rainfall bars across the whole scrubbable window.
  const bars = useMemo(() => {
    if (!horizon) return []
    const out = []
    for (let i = 0; i <= horizon; i++) {
      const h = hourlyAt(weather, i)
      out.push({ i, mm: h?.precipMm ?? 0 })
    }
    return out
  }, [weather, horizon])

  const peak = useMemo(() => bars.reduce((m, b) => Math.max(m, b.mm), 0), [bars])

  // The wettest hour ahead — the one an operator actually wants to jump to.
  const worst = useMemo(() => {
    if (!bars.length) return null
    return bars.reduce((a, b) => (b.mm > a.mm ? b : a), bars[0])
  }, [bars])

  if (!horizon || !hour) {
    return (
      <div className="ts ts--offline">
        <ClockIcon />
        <span>Hourly forecast unavailable — showing live conditions only.</span>
      </div>
    )
  }

  const intensity = rainIntensity(hour.precipMm)

  return (
    <div className={`ts ${isForecast ? 'ts--forecast' : ''}`}>
      <div className="ts-head">
        <div className="ts-when">
          <ClockIcon />
          {isForecast ? (
            <>
              <span className="ts-chip">FORECAST</span>
              <span className="ts-time">{hour.dayLabel} {hour.label}</span>
              <span className="ts-delta">+{offset}h</span>
            </>
          ) : (
            <>
              <span className="ts-chip ts-chip--live">LIVE</span>
              <span className="ts-time">Now · {hour.label}</span>
            </>
          )}
          {projecting && <span className="ts-working">recalculating…</span>}
        </div>

        <div className="ts-readout">
          <span className={`ts-rain ts-rain--${intensity.key}`}>
            {hour.precipMm.toFixed(1)} mm/h
          </span>
          <span className="ts-rain-lbl">{intensity.label}</span>
          {hour.pop != null && <span className="ts-pop">{hour.pop}% chance</span>}
        </div>

        <div className="ts-actions">
          {worst && worst.mm > 0 && worst.i !== offset && (
            <button
              type="button"
              className="ts-btn"
              onClick={() => setOffset(worst.i)}
              title={`Jump to the wettest hour ahead (${worst.mm.toFixed(1)} mm/h)`}
            >
              Peak rain
            </button>
          )}
          <button
            type="button"
            className="ts-btn ts-btn--now"
            onClick={() => setOffset(0)}
            disabled={offset === 0}
          >
            Back to now
          </button>
        </div>
      </div>

      {/* Rainfall profile behind the slider — the shape of the storm ahead. */}
      <div className="ts-track">
        <div className="ts-bars" aria-hidden="true">
          {bars.map((b) => (
            <span
              key={b.i}
              className={`ts-bar ${b.i === offset ? 'on' : ''}`}
              style={{ height: `${peak > 0 ? Math.max(4, (b.mm / peak) * 100) : 4}%` }}
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
          onChange={(e) => setOffset(Number(e.target.value))}
          aria-label="Forecast hour"
          aria-valuetext={isForecast ? `${hour.dayLabel} ${hour.label}, forecast` : `Now, ${hour.label}`}
        />
        <div className="ts-ticks">
          <span>Now</span>
          <span>+{Math.round(horizon / 2)}h</span>
          <span>+{horizon}h</span>
        </div>
      </div>

      <div className="ts-note">
        Model estimate from Open-Meteo's hourly forecast — not a measurement, and
        not a guarantee. River discharge is a daily figure held flat across these
        hours, so a rising river is under-represented. Verify on the ground before
        acting on a projected hour.
      </div>
    </div>
  )
}

/**
 * The badge that sits on the map itself while the scrubber is off "now".
 *
 * Separate from the scrubber on purpose: the scrubber is a control at the edge
 * of the screen and is easy to look past, while this rides on top of the thing
 * being misread. Together with the tinted frame it means a projected map
 * cannot be mistaken for current conditions even in a screenshot.
 */
export function ForecastBadge({ hour, offset }) {
  if (!offset) return null
  return (
    <div className="forecast-badge" role="status">
      <ClockIcon />
      FORECAST · {hour ? `${hour.dayLabel} ${hour.label}` : `+${offset}h`}
      <span style={{ opacity: 0.8, fontWeight: 600 }}>· model estimate</span>
    </div>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="ts-icon">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  )
}
