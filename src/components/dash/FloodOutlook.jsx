import { useMemo, useState } from 'react'
import { hourlyAt, forecastHorizon } from '../../services/weather.js'
import { useInView } from './dashHooks.js'
import './FloodOutlook.css'

/* ============================================================
   The next twelve hours, on one line.

   Every screen in this system could tell you what the rain is doing RIGHT NOW,
   and none of them could tell you what it is about to do — even though the
   Open-Meteo response the topbar already fetches carries seven days of hourly
   values that were being thrown away after index `now`.

   That is the question an operator, a barangay captain and a resident all
   actually have: not "is it raining" but "how much is coming, and when does it
   get bad". So: hourly rain as bars, the chance of rain as a curve over them,
   the running total as a filled area behind, and the worst hour called out by
   name.

   The colour bands are PAGASA's rainfall warning scale, not decoration —
   yellow at 7.5 mm/h, orange at 15, red at 30. An operator who has issued a
   warning under that scale reads this chart without being taught it.
   ============================================================ */

/* PAGASA rainfall-warning bands, in mm per hour.

   `color` fills a bar against white and can be as pale as the scale wants.
   `ink` is the same band dark enough to SET TYPE in — the two are not
   interchangeable, and using the fill for the headline figure put a 0.6 in
   #7dd3fc on white, which is a number nobody can read. */
const BANDS = [
  { min: 30, key: 'red', label: 'Red', color: '#dc2626', ink: '#991b1b', blurb: 'Serious flooding expected' },
  { min: 15, key: 'orange', label: 'Orange', color: '#f97316', ink: '#c2410c', blurb: 'Flooding threatening' },
  { min: 7.5, key: 'yellow', label: 'Yellow', color: '#eab308', ink: '#a16207', blurb: 'Flooding possible in low-lying areas' },
  { min: 2.5, key: 'moderate', label: 'Moderate', color: '#38bdf8', ink: '#0369a1', blurb: 'Moderate rain' },
  { min: 0.1, key: 'light', label: 'Light', color: '#7dd3fc', ink: '#0369a1', blurb: 'Light rain' },
  { min: -1, key: 'dry', label: 'Dry', color: '#cbd5e1', ink: '#4a5160', blurb: 'No rain expected' },
]

export function bandFor(mm) {
  const v = Number(mm) || 0
  return BANDS.find((b) => v > b.min) || BANDS[BANDS.length - 1]
}

/* Chart geometry. A fixed viewBox scaled by CSS keeps every portal's copy
   identical in proportion however wide its column happens to be. */
const W = 620
const H = 150
const PAD_L = 26
const PAD_R = 10
const PAD_T = 16
const PAD_B = 26

/**
 * @param hours       how many forecast hours to draw (default 12)
 * @param compact     drop the axis labels and shrink — for a phone / side column
 * @param title       heading text
 */
export default function FloodOutlook({ weather, hours = 12, compact = false, title = 'Next 12 Hours' }) {
  const [hover, setHover] = useState(null)
  const [wrapRef, seen] = useInView()

  const horizon = forecastHorizon(weather)
  const span = Math.max(0, Math.min(hours, horizon))

  const rows = useMemo(() => {
    const out = []
    for (let i = 0; i < span; i++) {
      const h = hourlyAt(weather, i)
      if (!h) break
      out.push(h)
    }
    return out
  }, [weather, span])

  const model = useMemo(() => {
    if (!rows.length) return null
    const peakMm = Math.max(...rows.map((r) => Number(r.precipMm) || 0))
    // Keep the axis honest but never flatten a light-rain day into a flat line.
    const scaleMax = Math.max(4, Math.ceil(peakMm * 1.25))
    let running = 0
    const cume = rows.map((r) => {
      running += Number(r.precipMm) || 0
      return running
    })
    const total = running
    const peakIndex = rows.reduce(
      (best, r, i) => ((Number(r.precipMm) || 0) > (Number(rows[best].precipMm) || 0) ? i : best),
      0,
    )
    // The first hour the forecast crosses into a PAGASA warning band.
    const onsetIndex = rows.findIndex((r) => (Number(r.precipMm) || 0) >= 7.5)
    return { peakMm, scaleMax, cume, total, peakIndex, onsetIndex }
  }, [rows])

  if (!rows.length || !model) {
    return (
      <div className={`fo-card ${compact ? 'compact' : ''}`}>
        <div className="fo-head">
          <span className="fo-title"><CloudRainIcon />{title}</span>
        </div>
        <div className="fo-offline">
          <CloudOffIcon />
          <div>
            <b>Forecast unavailable</b>
            <em>The Open-Meteo hourly feed could not be reached. Live readings on this page are unaffected.</em>
          </div>
        </div>
      </div>
    )
  }

  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const step = innerW / rows.length
  const barW = Math.max(6, Math.min(26, step * 0.56))

  const xAt = (i) => PAD_L + step * (i + 0.5)
  const yRain = (mm) => PAD_T + innerH - (Math.min(mm, model.scaleMax) / model.scaleMax) * innerH
  const yCume = (v) => PAD_T + innerH - (model.total > 0 ? (v / model.total) * innerH * 0.82 : 0)
  const yPop = (p) => PAD_T + innerH - ((Number(p) || 0) / 100) * innerH

  // Running-total area, behind everything: the shape of "how wet does it get".
  const cumePath = `M ${xAt(0)} ${PAD_T + innerH} `
    + model.cume.map((v, i) => `L ${xAt(i).toFixed(1)} ${yCume(v).toFixed(1)}`).join(' ')
    + ` L ${xAt(rows.length - 1)} ${PAD_T + innerH} Z`

  // Chance-of-rain curve, smoothed so it reads as a trend not a sawtooth.
  const popPts = rows.map((r, i) => [xAt(i), yPop(r.pop)])
  const popPath = smoothPath(popPts)
  const hasPop = rows.some((r) => r.pop != null)

  const active = hover != null ? rows[hover] : null
  const peak = rows[model.peakIndex]
  const peakBand = bandFor(peak.precipMm)
  const onset = model.onsetIndex >= 0 ? rows[model.onsetIndex] : null

  return (
    <div className={`fo-card ${compact ? 'compact' : ''} ${seen ? 'in' : ''}`} ref={wrapRef}>
      <div className="fo-head">
        <span className="fo-title"><CloudRainIcon />{title}</span>
        <span className="fo-src" title="Hourly forecast from the Open-Meteo public feed — a model, not a gauge reading">
          Open-Meteo · forecast
        </span>
      </div>

      {/* Headline: the two numbers worth reading before the chart. */}
      <div className="fo-summary">
        <div className="fo-sum-item">
          <span className="fo-sum-val">{model.total.toFixed(1)}<em>mm</em></span>
          <span className="fo-sum-lbl">expected over {rows.length} h</span>
        </div>
        <div className="fo-sum-item">
          <span className="fo-sum-val" style={{ color: peakBand.ink }}>
            {(Number(peak.precipMm) || 0).toFixed(1)}<em>mm/h</em>
          </span>
          <span className="fo-sum-lbl">heaviest, {peak.label}</span>
        </div>
        <span className={`fo-band ${peakBand.key}`} title={`PAGASA rainfall warning scale — ${peakBand.blurb}`}>
          {peakBand.label}
        </span>
      </div>

      <div className="fo-plot">
        <svg viewBox={`0 0 ${W} ${H}`} className="fo-svg" preserveAspectRatio="none" role="img"
          aria-label={`Hourly rainfall forecast for the next ${rows.length} hours`}>
          <defs>
            <linearGradient id="foCume" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* PAGASA thresholds, drawn only where they fall inside the axis. */}
          {[7.5, 15, 30].map((mm) => (
            mm <= model.scaleMax ? (
              <g key={mm}>
                <line
                  className={`fo-thresh t${String(mm).replace('.', '')}`}
                  x1={PAD_L} x2={W - PAD_R} y1={yRain(mm)} y2={yRain(mm)}
                />
                <text className="fo-thresh-lbl" x={PAD_L - 4} y={yRain(mm) + 3}>{mm}</text>
              </g>
            ) : null
          ))}

          {/* Running total behind the bars. */}
          <path className="fo-cume" d={cumePath} fill="url(#foCume)" />

          {/* The hourly bars themselves. */}
          {rows.map((r, i) => {
            const mm = Number(r.precipMm) || 0
            const band = bandFor(mm)
            const y = yRain(mm)
            const h = Math.max(mm > 0 ? 2 : 1.5, PAD_T + innerH - y)
            return (
              <g key={r.iso}>
                <rect
                  className="fo-hit"
                  x={PAD_L + step * i} y={PAD_T} width={step} height={innerH}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover((v) => (v === i ? null : v))}
                />
                <rect
                  className={`fo-bar ${band.key} ${hover === i ? 'on' : ''}`}
                  x={xAt(i) - barW / 2}
                  y={y}
                  width={barW}
                  height={h}
                  rx={Math.min(3, barW / 3)}
                  fill={band.color}
                  style={{ '--d': `${i * 45}ms`, '--full': `${h.toFixed(1)}px`, '--y': `${y.toFixed(1)}px` }}
                />
              </g>
            )
          })}

          {/* Chance of rain, over the top. */}
          {hasPop && <path className="fo-pop" d={popPath} />}

          {/* "Now" — the left edge is the current hour, and it is worth saying so. */}
          <line className="fo-now" x1={xAt(0)} x2={xAt(0)} y1={PAD_T - 4} y2={PAD_T + innerH} />
          <circle className="fo-now-dot" cx={xAt(0)} cy={yRain(rows[0].precipMm)} r="3.5" />

          {/* Hour ticks. */}
          {!compact && rows.map((r, i) => (
            (rows.length <= 8 || i % 2 === 0) ? (
              <text key={r.iso} className={`fo-x ${i === 0 ? 'now' : ''}`} x={xAt(i)} y={H - 8}>
                {i === 0 ? 'Now' : shortHour(r.label)}
              </text>
            ) : null
          ))}
        </svg>

        {/* Readout for whichever hour the pointer is over. */}
        {active && (
          <div
            className="fo-readout"
            style={{ left: `${((xAt(hover) / W) * 100).toFixed(2)}%` }}
          >
            <b>{hover === 0 ? 'Now' : `${active.dayLabel} ${active.label}`}</b>
            <span>{(Number(active.precipMm) || 0).toFixed(1)} mm/h</span>
            {active.pop != null && <span>{Math.round(active.pop)}% chance</span>}
            {active.windKmh != null && <span>{Math.round(active.windKmh)} km/h wind</span>}
          </div>
        )}
      </div>

      {/* What the chart means, in a sentence a person can act on. */}
      <div className="fo-verdict">
        {onset ? (
          <>
            <span className={`fo-dot ${bandFor(onset.precipMm).key}`} />
            Rain reaches <b>{bandFor(onset.precipMm).label.toLowerCase()}-warning</b> intensity
            {model.onsetIndex === 0 ? ' now' : ` around ${onset.label}`} — {bandFor(onset.precipMm).blurb.toLowerCase()}.
          </>
        ) : model.total >= 15 ? (
          <>
            <span className="fo-dot moderate" />
            Steady rain, no warning-level hour forecast — watch the running total on low-lying streets.
          </>
        ) : (
          <>
            <span className="fo-dot dry" />
            No warning-level rainfall in the next {rows.length} hours.
          </>
        )}
      </div>
    </div>
  )
}

/** "3:00 PM" -> "3 PM" — the minutes are always :00 and only cost width. */
function shortHour(label) {
  return String(label).replace(':00', '')
}

/** Catmull-Rom through the points, emitted as cubic Béziers. */
function smoothPath(p) {
  if (p.length < 2) return ''
  let d = `M ${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i]
    const p1 = p[i]
    const p2 = p[i + 1]
    const p3 = p[i + 2] || p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  return d
}

function CloudRainIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
      <line x1="8" y1="19" x2="8" y2="21" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="16" y1="19" x2="16" y2="21" />
    </svg>
  )
}

function CloudOffIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6" />
      <path d="M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}
