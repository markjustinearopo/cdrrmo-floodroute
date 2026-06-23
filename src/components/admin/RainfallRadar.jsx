/* ============================================================
   RainfallRadar — rotating radar-sweep canvas overlay.

   A weather-radar-style sweep centred on the map: faint concentric range
   rings plus a wedge that rotates 360° every 4 s. The sweep colour tracks
   the LIVE rainfall intensity (mm/h from useLiveWeather) through the
   PAGASA-style bands — green (light) → yellow (moderate) → red (heavy) —
   and its brightness scales with intensity, so a dry day shows only a
   faint green idle sweep while a torrential cell burns red.

   Pure presentation; `mix-blend-mode: screen` over the dark basemap.
   ============================================================ */

import { useEffect, useRef } from 'react'

const SWEEP_MS = 4000 // full rotation every 4 seconds
const SWEEP_WIDTH = 1.4 // radians of trailing wedge

// Rainfall bands (mm/h) → sweep colour. Mirrors rainIntensity() in weather.js.
function radarColor(mm) {
  if (mm >= 7.5) return [239, 68, 68] // intense/torrential — red
  if (mm >= 2.5) return [234, 179, 8] // heavy — yellow
  return [34, 197, 94] // light / none — green
}

function drawRadar(ctx, cx, cy, radius, angle, rainIntensity) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  const [r, g, b] = radarColor(rainIntensity)
  const intensity = Math.min(rainIntensity / 20, 1) // normalised to 0–20 mm/h
  const sweepAlpha = 0.1 + intensity * 0.25

  // Concentric range rings.
  ctx.lineWidth = 1
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.12)`
  ;[0.25, 0.5, 0.75, 1.0].forEach((f) => {
    ctx.beginPath()
    ctx.arc(cx, cy, radius * f, 0, Math.PI * 2)
    ctx.stroke()
  })

  // Trailing sweep wedge — conic gradient when the browser supports it
  // (fades up to the leading edge), flat translucent wedge otherwise.
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, radius, angle - SWEEP_WIDTH, angle)
  ctx.closePath()
  if (typeof ctx.createConicGradient === 'function') {
    const grad = ctx.createConicGradient(angle - SWEEP_WIDTH, cx, cy)
    const frac = SWEEP_WIDTH / (Math.PI * 2)
    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`)
    grad.addColorStop(frac, `rgba(${r}, ${g}, ${b}, ${sweepAlpha})`)
    grad.addColorStop(Math.min(1, frac + 0.001), `rgba(${r}, ${g}, ${b}, 0)`)
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
    ctx.fillStyle = grad
  } else {
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${sweepAlpha * 0.7})`
  }
  ctx.fill()

  // Bright leading edge.
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.35 + intensity * 0.4})`
  ctx.lineWidth = 1.5
  ctx.stroke()
}

/**
 * props:
 *   rainfall — live rainfall intensity in mm/h (useLiveWeather → current.rain)
 *   width    — canvas width in px
 *   height   — canvas height in px
 */
export default function RainfallRadar({ rainfall = 0, width, height }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width || !height) return undefined
    const ctx = canvas.getContext('2d')

    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) * 0.42

    let animId
    const t0 = performance.now()

    function frame(now) {
      const angle = (((now - t0) % SWEEP_MS) / SWEEP_MS) * Math.PI * 2
      drawRadar(ctx, cx, cy, radius, angle, rainfall)
      animId = requestAnimationFrame(frame)
    }

    animId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(animId)
  }, [rainfall, width, height])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        mixBlendMode: 'screen',
        zIndex: 9, // beneath the wind particles
      }}
    />
  )
}
