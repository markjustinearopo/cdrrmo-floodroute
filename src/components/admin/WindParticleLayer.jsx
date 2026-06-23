/* ============================================================
   WindParticleLayer — Project-NOAH-style animated wind particles.

   A transparent full-size canvas overlaid on the 3D map, rendering ~800
   short-lived particles that stream in the ACTUAL live wind direction.
   The meteorological direction (degrees FROM which the wind blows, from
   Open-Meteo `winddirection_10m`) is converted to U/V vector components,
   and each frame advects the particles along that vector; a translucent
   dark wipe leaves comet trails behind them. `mix-blend-mode: screen`
   means the dark wipe is invisible over the basemap — only the bright
   trails composite, cyan-white in normal wind, orange-red in storm-force
   (>10 m/s) wind.

   Pure presentation: requestAnimationFrame, no React state per frame.
   ============================================================ */

import { useEffect, useRef } from 'react'

const PARTICLE_COUNT = 800 // at storm strength — density scales with wind speed
const PARTICLE_LIFE = 120 // frames

/**
 * props:
 *   windSpeed — m/s (live, from useLiveWeather → current.windKmh / 3.6)
 *   windDeg   — meteorological direction in degrees (wind blows FROM here)
 *   width     — canvas width in px (the map container's size)
 *   height    — canvas height in px
 */
export default function WindParticleLayer({ windSpeed = 0, windDeg = 0, width, height }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width || !height) return undefined
    const ctx = canvas.getContext('2d')

    // Met convention: 0° = wind FROM north, 90° = wind FROM east.
    const windRad = (windDeg * Math.PI) / 180
    const uComponent = -windSpeed * Math.sin(windRad) // east-west (+E)
    const vComponent = -windSpeed * Math.cos(windRad) // north-south (+N)

    // Particle density tracks the actual wind: a fresh breeze shows a sparse
    // drift, a storm fills the screen — never a permanent rain-like curtain.
    const count = Math.round(Math.min(1, windSpeed / 15) * PARTICLE_COUNT)

    // Initialize particles randomly across the canvas, ages staggered so the
    // field doesn't blink in unison.
    const particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      age: Math.floor(Math.random() * PARTICLE_LIFE),
      speed: 0.3 + Math.random() * 0.5,
    }))

    let animId

    function draw() {
      // Fade trail — semi-transparent dark wipe (invisible under screen blend).
      ctx.fillStyle = 'rgba(8, 15, 30, 0.18)'
      ctx.fillRect(0, 0, width, height)

      // Normalize U/V to screen pixels per frame; canvas y grows downward so
      // a northward (+v) wind moves particles UP the screen.
      const pxPerFrame = 1.8
      const dx = (uComponent / (windSpeed || 1)) * pxPerFrame * (windSpeed * 0.6 + 0.5)
      const dy = -(vComponent / (windSpeed || 1)) * pxPerFrame * (windSpeed * 0.6 + 0.5)

      // Color: cyan-white for normal wind, orange-red when strong (>10 m/s).
      const r = windSpeed > 10 ? 255 : 140
      const g = windSpeed > 10 ? 120 : 210
      const b = windSpeed > 10 ? 60 : 255

      ctx.lineWidth = 1.2

      particles.forEach((p) => {
        p.age++
        if (p.age > PARTICLE_LIFE || p.x < 0 || p.x > width || p.y < 0 || p.y > height) {
          p.x = Math.random() * width
          p.y = Math.random() * height
          p.age = 0
        }

        const prevX = p.x
        const prevY = p.y
        p.x += dx * p.speed
        p.y += dy * p.speed

        // Opacity over life — fade in, fade out.
        const lifeFrac = p.age / PARTICLE_LIFE
        const alpha = Math.sin(lifeFrac * Math.PI) * 0.65

        ctx.beginPath()
        ctx.moveTo(prevX, prevY)
        ctx.lineTo(p.x, p.y)
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`
        ctx.stroke()
      })

      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animId)
  }, [windSpeed, windDeg, width, height])

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
        mixBlendMode: 'screen', // bright trails only — blends onto the dark map
        zIndex: 10,
      }}
    />
  )
}
