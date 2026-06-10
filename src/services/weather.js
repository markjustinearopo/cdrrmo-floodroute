/* ============================================================
   Live weather + hydrology feed for the whole system.

   One cached round-trip to Open-Meteo (keyless) standing in for the two
   external feeds the Conceptual Framework names:
     • Windy.com         → current rainfall, wind & gusts, the 8-hour
       rainfall history and the multi-day forecast.
     • Google Flood Hub  → river discharge near Cabuyao (Open-Meteo Flood
       API), the hydrological driver behind the hazard model.

   Everything the admin chrome shows live — the topbar Rainfall/Wind chips,
   the Dashboard rainfall card, the Flood Map rain bars & forecast — reads
   from the single snapshot here, so there's exactly one set of network
   calls per session no matter how many screens mount. Fail-soft: any feed
   that doesn't answer leaves its fields null and the UI shows "--".

   The Integrations screen is where the production Windy / Flood Hub API
   keys would be plugged in; until then these keyless endpoints supply the
   same shape of data.
   ============================================================ */

import { useCallback, useEffect, useState } from 'react'
import { CABUYAO_CENTER } from '../components/admin/mapHelpers.jsx'
import { hazardApi } from './api.js'

const REFRESH_MS = 5 * 60 * 1000 // re-pull every 5 min (Open-Meteo updates ~15 min)

/* ── WMO weather codes → friendly label + glyph ──────────────────────────── */
const WEATHER_CODES = {
  0: { label: 'Clear', emoji: '☀️' },
  1: { label: 'Mainly clear', emoji: '🌤️' },
  2: { label: 'Partly cloudy', emoji: '⛅' },
  3: { label: 'Overcast', emoji: '☁️' },
  45: { label: 'Fog', emoji: '🌫️' },
  48: { label: 'Rime fog', emoji: '🌫️' },
  51: { label: 'Light drizzle', emoji: '🌦️' },
  53: { label: 'Drizzle', emoji: '🌦️' },
  55: { label: 'Heavy drizzle', emoji: '🌧️' },
  61: { label: 'Light rain', emoji: '🌦️' },
  63: { label: 'Rain', emoji: '🌧️' },
  65: { label: 'Heavy rain', emoji: '🌧️' },
  66: { label: 'Freezing rain', emoji: '🌧️' },
  67: { label: 'Freezing rain', emoji: '🌧️' },
  71: { label: 'Light snow', emoji: '🌨️' },
  73: { label: 'Snow', emoji: '🌨️' },
  75: { label: 'Heavy snow', emoji: '❄️' },
  80: { label: 'Light showers', emoji: '🌦️' },
  81: { label: 'Showers', emoji: '🌧️' },
  82: { label: 'Violent showers', emoji: '⛈️' },
  95: { label: 'Thunderstorm', emoji: '⛈️' },
  96: { label: 'Storm w/ hail', emoji: '⛈️' },
  99: { label: 'Storm w/ hail', emoji: '⛈️' },
}

export function weatherInfo(code) {
  return WEATHER_CODES[code] || { label: '—', emoji: '·' }
}

/* ── Display helpers ─────────────────────────────────────────────────────── */
export function formatRain(mm) {
  if (mm == null) return '--'
  return `${mm.toFixed(mm < 10 ? 1 : 0)} mm`
}
export function formatWind(kmh) {
  if (kmh == null) return '--'
  return `${Math.round(kmh)} km/h`
}

// Rainfall intensity band (mm/h) for colour/label cues across the UI.
export function rainIntensity(mm) {
  if (mm == null) return { key: 'none', label: 'No data' }
  if (mm >= 15) return { key: 'torrential', label: 'Torrential' }
  if (mm >= 7.5) return { key: 'intense', label: 'Intense' }
  if (mm >= 2.5) return { key: 'heavy', label: 'Heavy' }
  if (mm > 0) return { key: 'light', label: 'Light' }
  return { key: 'dry', label: 'No rain' }
}

/* ── Compass label for a wind direction in degrees ───────────────────────── */
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
export function windCompass(deg) {
  if (deg == null) return '--'
  return COMPASS[Math.round(deg / 22.5) % 16]
}

// Today's date in Cabuyao (Asia/Manila) as "YYYY-MM-DD" — anchors the forecast
// so day 0 is genuinely today, not yesterday (Open-Meteo past_days shifts the
// daily array back by one).
function manilaToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

/* ── The single cached fetch ─────────────────────────────────────────────── */
async function fetchForecast() {
  const [lat, lng] = CABUYAO_CENTER
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,` +
    `weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&hourly=precipitation,precipitation_probability` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,` +
    `precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max` +
    `&past_days=1&forecast_days=7&timezone=Asia%2FManila`
  const res = await fetch(url)
  if (!res.ok) throw new Error('forecast unavailable')
  return res.json()
}

// Last 8 hourly precipitation values up to (and including) the current hour.
function buildRainHistory(data) {
  const times = data?.hourly?.time
  const precip = data?.hourly?.precipitation
  if (!Array.isArray(times) || !Array.isArray(precip)) return Array(8).fill(0)
  const nowKey = (data?.current?.time || '').slice(0, 13) // "YYYY-MM-DDTHH"
  let idx = times.findIndex((t) => t.slice(0, 13) === nowKey)
  if (idx < 0) idx = precip.length - 1
  const out = []
  for (let i = idx - 7; i <= idx; i++) out.push(i >= 0 ? Number(precip[i]) || 0 : 0)
  return out
}

// Forecast days starting at TODAY (skips the past_days entry). Returns 5 days.
function buildForecast(data) {
  const d = data?.daily
  if (!d?.time) return []
  const todayKey = manilaToday()
  let start = d.time.findIndex((t) => t >= todayKey)
  if (start < 0) start = 0
  const round = (v) => (v != null ? Math.round(v) : null)
  return d.time.slice(start, start + 5).map((iso, k) => {
    const i = start + k
    const date = new Date(`${iso}T00:00:00`)
    const info = weatherInfo(d.weather_code?.[i])
    return {
      day: k === 0 ? 'Today' : date.toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'Asia/Manila' }),
      date: iso,
      code: d.weather_code?.[i],
      label: info.label,
      emoji: info.emoji,
      tmax: round(d.temperature_2m_max?.[i]),
      tmin: round(d.temperature_2m_min?.[i]),
      rainSum: d.precipitation_sum?.[i] != null ? +Number(d.precipitation_sum[i]).toFixed(1) : null,
      pop: round(d.precipitation_probability_max?.[i]), // % chance of precip
      windKmh: round(d.wind_speed_10m_max?.[i]),
    }
  })
}

// Today's headline figures (sunrise/sunset/UV/rain-sum) from the daily block.
function buildToday(data) {
  const d = data?.daily
  if (!d?.time) return {}
  const todayKey = manilaToday()
  let i = d.time.findIndex((t) => t === todayKey)
  if (i < 0) i = d.time.findIndex((t) => t >= todayKey)
  if (i < 0) i = 0
  const hhmm = (iso) => (iso ? iso.slice(11, 16) : null)
  return {
    rainSum: d.precipitation_sum?.[i] != null ? +Number(d.precipitation_sum[i]).toFixed(1) : null,
    pop: d.precipitation_probability_max?.[i] ?? null,
    tmax: d.temperature_2m_max?.[i] != null ? Math.round(d.temperature_2m_max[i]) : null,
    tmin: d.temperature_2m_min?.[i] != null ? Math.round(d.temperature_2m_min[i]) : null,
    sunrise: hhmm(d.sunrise?.[i]),
    sunset: hhmm(d.sunset?.[i]),
    uv: d.uv_index_max?.[i] != null ? +Number(d.uv_index_max[i]).toFixed(1) : null,
  }
}

const EMPTY = {
  current: {
    tempC: null, feelsLikeC: null, humidity: null, rain: null, windKmh: null,
    gustKmh: null, windDir: null, cloud: null, pressureHpa: null, code: null,
  },
  today: {},
  rainHistory: Array(8).fill(0),
  forecast: [],
  discharge: null,
  updatedAt: null,
  live: false,
}

async function loadWeather() {
  const [forecastRes, discharge] = await Promise.all([
    fetchForecast().catch(() => null),
    hazardApi.getRiverDischarge(CABUYAO_CENTER[0], CABUYAO_CENTER[1]).catch(() => null),
  ])

  if (!forecastRes) {
    return { ...EMPTY, discharge, updatedAt: Date.now(), live: discharge != null }
  }

  const cur = forecastRes.current || {}
  const num = (v) => (v != null ? Number(v) : null)
  return {
    current: {
      tempC: cur.temperature_2m != null ? Math.round(cur.temperature_2m) : null,
      feelsLikeC: cur.apparent_temperature != null ? Math.round(cur.apparent_temperature) : null,
      humidity: cur.relative_humidity_2m != null ? Math.round(cur.relative_humidity_2m) : null,
      rain: Number(cur.precipitation ?? cur.rain ?? 0) || 0,
      windKmh: num(cur.wind_speed_10m),
      gustKmh: num(cur.wind_gusts_10m),
      windDir: num(cur.wind_direction_10m),
      cloud: cur.cloud_cover != null ? Math.round(cur.cloud_cover) : null,
      pressureHpa: cur.surface_pressure != null ? Math.round(cur.surface_pressure) : null,
      code: cur.weather_code ?? null,
    },
    today: buildToday(forecastRes),
    rainHistory: buildRainHistory(forecastRes),
    forecast: buildForecast(forecastRes),
    discharge,
    updatedAt: Date.now(),
    live: true,
  }
}

/* ── Per-barangay recent rainfall (detail card analytics) ────────────────── */
const histCache = new Map()

/**
 * Last 7 days of daily rainfall at a point (the barangay centroid), from the
 * same keyless Open-Meteo feed. Returns [{ date, label, rainMm }] oldest→newest,
 * cached per rounded coordinate. Real data — drives the barangay risk trend.
 */
export async function fetchBarangayRainHistory(lat, lng) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`
  if (histCache.has(key)) return histCache.get(key)
  const p = (async () => {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&daily=precipitation_sum&past_days=7&forecast_days=1&timezone=Asia%2FManila`
    const res = await fetch(url)
    if (!res.ok) throw new Error('history unavailable')
    const data = await res.json()
    const times = data?.daily?.time || []
    const sums = data?.daily?.precipitation_sum || []
    const todayKey = manilaToday()
    return times
      .map((iso, i) => ({ iso, rainMm: +Number(sums[i] ?? 0).toFixed(1) }))
      .filter((d) => d.iso <= todayKey)
      .slice(-7)
      .map((d) => ({
        date: d.iso,
        label: new Date(`${d.iso}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'short', timeZone: 'Asia/Manila' }),
        rainMm: d.rainMm,
      }))
  })().catch(() => null)
  histCache.set(key, p)
  return p
}

let cache = null
let promise = null

export function fetchWeather() {
  if (cache) return Promise.resolve(cache)
  if (promise) return promise
  promise = loadWeather()
    .then((w) => {
      cache = w
      return w
    })
    .catch((err) => {
      promise = null
      throw err
    })
  return promise
}

// Force a fresh pull (used by the auto-refresh interval + manual refresh).
export function reloadWeather() {
  cache = null
  promise = null
  return fetchWeather()
}

/**
 * Live weather hook. Returns { weather, loading, error, refresh }. The cached
 * snapshot is shared across every mounted screen and auto-refreshes every few
 * minutes so the topbar and dashboards stay current without extra fetches.
 */
export function useLiveWeather() {
  const [weather, setWeather] = useState(cache)
  const [loading, setLoading] = useState(!cache)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    if (!cache) setLoading(true)
    fetchWeather()
      .then((w) => active && (setWeather(w), setLoading(false), setError(false)))
      .catch(() => active && (setError(true), setLoading(false)))

    const id = setInterval(() => {
      reloadWeather()
        .then((w) => active && setWeather(w))
        .catch(() => {})
    }, REFRESH_MS)

    return () => {
      active = false
      clearInterval(id)
    }
  }, [])

  const refresh = useCallback(() => {
    setLoading(true)
    reloadWeather()
      .then((w) => (setWeather(w), setLoading(false)))
      .catch(() => setLoading(false))
  }, [])

  return { weather: weather || EMPTY, loading, error, refresh }
}
