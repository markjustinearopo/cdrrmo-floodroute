/* Detailed live weather panel (Open-Meteo / Windy-class data) for the Flood Map
   right rail. Replaces the thin rainfall+forecast strip with current conditions,
   today's headline figures, an 8-hour rainfall chart, and a 5-day outlook that
   now starts on the CORRECT day. */

import { weatherInfo, rainIntensity, windCompass } from '../../services/weather.js'
import './weatherPanel.css'

const RAIN_TICKS = ['-8h', '-7', '-6', '-5', '-4', '-3', '-2', 'Now']

export function WeatherPanel({ weather, discharge }) {
  const c = weather.current || {}
  const t = weather.today || {}
  const info = weatherInfo(c.code)
  const intensity = rainIntensity(c.rain)
  const rainHistory = weather.rainHistory || []
  const maxRain = Math.max(...rainHistory, 1)
  const forecast = weather.forecast || []
  const dischargeText = discharge == null ? '--' : `${discharge.toFixed(1)} m³/s`

  return (
    <div className="wx">
      {/* Current conditions hero */}
      <div className="wx-hero">
        <div className="wx-hero-emoji">{info.emoji}</div>
        <div className="wx-hero-main">
          <div className="wx-temp">{c.tempC != null ? `${c.tempC}°` : '--'}</div>
          <div className="wx-cond">{info.label}</div>
          <div className="wx-feels">{c.feelsLikeC != null ? `Feels like ${c.feelsLikeC}°C` : ''}</div>
        </div>
      </div>

      {/* Current-conditions grid */}
      <div className="wx-grid">
        <WxCell icon={<DropIcon />} label="Rain now" value={c.rain != null ? `${c.rain.toFixed(1)}` : '--'} unit="mm/h" sub={intensity.label} />
        <WxCell icon={<HumidIcon />} label="Humidity" value={c.humidity != null ? `${c.humidity}` : '--'} unit="%" />
        <WxCell icon={<WindIcon />} label="Wind" value={c.windKmh != null ? `${Math.round(c.windKmh)}` : '--'} unit="km/h" sub={c.windDir != null ? `${windCompass(c.windDir)} · gust ${c.gustKmh != null ? Math.round(c.gustKmh) : '--'}` : ''} />
        <WxCell icon={<CloudIcon />} label="Cloud" value={c.cloud != null ? `${c.cloud}` : '--'} unit="%" />
        <WxCell icon={<GaugeIcon />} label="Pressure" value={c.pressureHpa != null ? `${c.pressureHpa}` : '--'} unit="hPa" />
        <WxCell icon={<DischargeIcon />} label="River discharge" value={dischargeText} sub="Flood Hub" />
      </div>

      {/* Today's headline */}
      <div className="wx-today">
        <WxPill label="Rain chance" value={t.pop != null ? `${t.pop}%` : '--'} />
        <WxPill label="Rain today" value={t.rainSum != null ? `${t.rainSum} mm` : '--'} />
        <WxPill label="UV index" value={t.uv != null ? `${t.uv}` : '--'} />
        <WxPill label="Sun" value={t.sunrise && t.sunset ? `${t.sunrise}–${t.sunset}` : '--'} />
      </div>

      {/* Rainfall last 8h */}
      <div className="wx-sec-head">
        <span>Rainfall intensity</span>
        <span className="wx-sec-val">{c.rain != null ? `${c.rain.toFixed(1)} mm/hr` : '--'}</span>
      </div>
      <div className="wx-sub">Last 8 hours (mm/hr)</div>
      <div className="wx-rain-bars">
        {rainHistory.map((v, i) => (
          <div
            key={i}
            className={`wx-rain-bar ${i === rainHistory.length - 1 ? 'now' : ''}`}
            style={{ height: v > 0 ? `${Math.max(8, (v / maxRain) * 100)}%` : '4px' }}
            title={`${v} mm/hr`}
          />
        ))}
      </div>
      <div className="wx-rain-ticks">{RAIN_TICKS.map((x) => <span key={x}>{x}</span>)}</div>

      {/* 5-day outlook */}
      <div className="wx-sec-head"><span>5-day outlook</span></div>
      <div className="wx-forecast">
        {forecast.map((f, i) => (
          <div key={f.date || i} className={`wx-day ${i === 0 ? 'today' : ''}`}>
            <div className="wx-day-name">{f.day}</div>
            <div className="wx-day-emoji" title={f.label}>{f.emoji}</div>
            <div className="wx-day-temp">
              <b>{f.tmax != null ? `${f.tmax}°` : '--'}</b>
              <span>{f.tmin != null ? `${f.tmin}°` : ''}</span>
            </div>
            <div className="wx-day-pop">{f.pop != null ? `💧${f.pop}%` : ''}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function WxCell({ icon, label, value, unit, sub }) {
  return (
    <div className="wx-cell">
      <div className="wx-cell-top">{icon}<span className="wx-cell-label">{label}</span></div>
      <div className="wx-cell-val">{value}{unit && <span className="wx-cell-unit">{unit}</span>}</div>
      {sub ? <div className="wx-cell-sub">{sub}</div> : null}
    </div>
  )
}

function WxPill({ label, value }) {
  return (
    <div className="wx-pill">
      <div className="wx-pill-val">{value}</div>
      <div className="wx-pill-lbl">{label}</div>
    </div>
  )
}

/* Icons */
function DropIcon() { return (<svg viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" /></svg>) }
function HumidIcon() { return (<svg viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" /><line x1="8" y1="16" x2="16" y2="9" /></svg>) }
function WindIcon() { return (<svg viewBox="0 0 24 24"><path d="M9.6 4.6A2 2 0 1 1 11 8H2" /><path d="M12.6 19.4A2 2 0 1 0 14 16H2" /><path d="M17.7 7.5A2.5 2.5 0 1 1 19.5 12H2" /></svg>) }
function CloudIcon() { return (<svg viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>) }
function GaugeIcon() { return (<svg viewBox="0 0 24 24"><path d="M12 14l4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg>) }
function DischargeIcon() { return (<svg viewBox="0 0 24 24"><path d="M2 12s3-6 10-6 10 6 10 6-3 6-10 6-10-6-10-6z" /></svg>) }
