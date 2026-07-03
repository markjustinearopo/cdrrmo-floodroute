/* ============================================================
   Floating live weather card (compact, Google-Maps-widget style).

   Reads the shared Open-Meteo snapshot (useLiveWeather — real data,
   auto-refreshing every 5 min) and shows temperature, rain, humidity,
   wind and a live PHT clock. Collapsible to a small chip so it never
   crowds the map on phones.
   ============================================================ */

import { useEffect, useState } from 'react'
import { useLiveWeather, weatherInfo } from '../../services/weather.js'
import { formatPHT } from '../admin/mapHelpers.jsx'
import './mapUpgrade.css'

export default function WeatherCard() {
  const { weather, loading } = useLiveWeather()
  const [now, setNow] = useState(formatPHT())
  const [openState, setOpen] = useState(() => window.innerWidth > 760)

  useEffect(() => {
    const id = setInterval(() => setNow(formatPHT()), 30_000)
    return () => clearInterval(id)
  }, [])

  const cur = weather.current
  const info = weatherInfo(cur.code)

  if (!openState) {
    return (
      <button type="button" className="wxc wxc--chip" onClick={() => setOpen(true)} title="Show weather">
        <span className="wxc-emoji">{info.emoji}</span>
        <b>{cur.tempC != null ? `${cur.tempC}°` : '--'}</b>
      </button>
    )
  }

  return (
    <div className="wxc">
      <button type="button" className="wxc-min" onClick={() => setOpen(false)} title="Minimize" aria-label="Minimize weather card">
        —
      </button>
      <div className="wxc-top">
        <span className="wxc-emoji">{loading ? '⏳' : info.emoji}</span>
        <div>
          <div className="wxc-temp">{cur.tempC != null ? `${cur.tempC}°C` : '--'}</div>
          <div className="wxc-cond">{info.label}</div>
        </div>
        <div className="wxc-clock">
          <div>{now}</div>
          <small>PHT · Cabuyao</small>
        </div>
      </div>
      <div className="wxc-grid">
        <div className="wxc-cell">
          <small>Rain</small>
          <b>{cur.rain != null ? `${cur.rain.toFixed(1)} mm` : '--'}</b>
        </div>
        <div className="wxc-cell">
          <small>Humidity</small>
          <b>{cur.humidity != null ? `${cur.humidity}%` : '--'}</b>
        </div>
        <div className="wxc-cell">
          <small>Wind</small>
          <b>{cur.windKmh != null ? `${Math.round(cur.windKmh)} km/h` : '--'}</b>
        </div>
      </div>
    </div>
  )
}
