/* ============================================================
   Barangay detail card — the focused pop-up shown when a barangay is
   clicked on the Flood Map / Hazard Layer. Pulls together everything the
   system knows about that one barangay:

     • live model risk: class, estimated flood depth, susceptibility
     • terrain: ground elevation (the driver behind susceptibility) + land area
     • evacuation centres located inside it
     • a LIVE 7-day rainfall + modeled-risk trend (Open-Meteo), the seed of the
       barangay history/analytics the unit will build out

   Presentation only; numbers come from floodRisk.js + the live weather feed.
   ============================================================ */

import { useEffect, useMemo, useState } from 'react'
import { RISK_META, levelFromDepth } from './mapHelpers.jsx'
import {
  elevationAt,
  susceptibilityAt,
  riskFromDailyRain,
  estDepthFromRisk,
} from './floodRisk.js'
import { barangayAreaKm2, barangayAt } from '../../data/cabuyaoBarangays.js'
import { fetchBarangayRainHistory } from '../../services/weather.js'
import { SAMPLE_EVAC_CENTERS } from '../../data/cabuyao.js'
import './barangayDetail.css'

export function BarangayDetailCard({ sample, onClose }) {
  const [hist, setHist] = useState(null)
  const [loadingHist, setLoadingHist] = useState(true)

  const [lat, lng] = sample.coords

  useEffect(() => {
    let active = true
    setLoadingHist(true)
    setHist(null)
    fetchBarangayRainHistory(lat, lng).then((h) => {
      if (active) {
        setHist(h)
        setLoadingHist(false)
      }
    })
    return () => { active = false }
  }, [sample.name, lat, lng])

  const elevation = useMemo(() => elevationAt(lat, lng), [lat, lng])
  const susceptibility = useMemo(() => Math.round(susceptibilityAt(lat, lng) * 100), [lat, lng])
  const area = useMemo(() => barangayAreaKm2(sample.name), [sample.name])
  const evac = useMemo(
    () =>
      SAMPLE_EVAC_CENTERS.filter(
        (c) => c.barangay === sample.name || (c.coords && barangayAt(c.coords[0], c.coords[1]) === sample.name),
      ),
    [sample.name],
  )

  const trend = useMemo(() => {
    if (!hist) return []
    return hist.map((d) => {
      const risk = riskFromDailyRain(lat, lng, d.rainMm)
      const depth = estDepthFromRisk(risk)
      return { ...d, risk, depth, level: levelFromDepth(depth) }
    })
  }, [hist, lat, lng])

  const maxRain = Math.max(1, ...trend.map((d) => d.rainMm))
  const meta = RISK_META[sample.level]

  return (
    <div className="bdc" role="dialog" aria-label={`${sample.name} flood detail`}>
      <div className={`bdc-head ${sample.level}`}>
        <div className="bdc-head-main">
          <div className="bdc-name">{sample.name}</div>
          <div className="bdc-sub">Cabuyao City · barangay flood profile</div>
        </div>
        <span className={`bdc-badge ${sample.level}`}>{meta.label}</span>
        <button type="button" className="bdc-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="bdc-body">
        {/* Headline metrics */}
        <div className="bdc-metrics">
          <Metric label="Est. flood depth" value={sample.floodDepth.toFixed(2)} unit="m" tone={sample.level} />
          <Metric label="Ground elevation" value={`${elevation}`} unit="m" />
          <Metric label="Susceptibility" value={`${susceptibility}`} unit="%" />
          <Metric label="Land area" value={`${area}`} unit="km²" />
        </div>

        <p className="bdc-explain">
          {elevation <= 8
            ? `Low-lying lakeshore ground (${elevation} m) — water pools here first, so the inherent flood susceptibility is high.`
            : elevation >= 40
            ? `Elevated western ground (${elevation} m) — it drains well, keeping inherent flood risk low.`
            : `Mid-elevation ground (${elevation} m) — moderate inherent flood susceptibility.`}
        </p>

        {/* Evacuation centres in this barangay */}
        <div className="bdc-section-title">Evacuation centres here</div>
        {evac.length ? (
          <div className="bdc-evac-list">
            {evac.map((c) => (
              <div className="bdc-evac" key={c.id}>
                <span className={`bdc-dot ${c.status}`} />
                <span className="bdc-evac-name">{c.name}</span>
                <span className="bdc-evac-meta">{c.status} · cap. {c.capacity}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="bdc-empty">No evacuation centre inside this barangay — nearest open shelters are city-wide.</div>
        )}

        {/* Live 7-day rainfall + risk trend */}
        <div className="bdc-section-title">
          7-day rainfall &amp; risk trend
          <span className="bdc-live">● live</span>
        </div>
        {loadingHist ? (
          <div className="bdc-empty">Loading recent rainfall…</div>
        ) : trend.length ? (
          <>
            <div className="bdc-trend">
              {trend.map((d) => (
                <div className="bdc-trend-col" key={d.date} title={`${d.label}: ${d.rainMm} mm → ${RISK_META[d.level].label}`}>
                  <div className="bdc-bar-wrap">
                    <div
                      className="bdc-bar"
                      style={{ height: `${Math.max(6, (d.rainMm / maxRain) * 100)}%`, background: RISK_META[d.level].color }}
                    />
                  </div>
                  <div className="bdc-trend-mm">{d.rainMm}</div>
                  <div className="bdc-trend-day">{d.label}</div>
                </div>
              ))}
            </div>
            <div className="bdc-trend-legend">
              Bars = daily rainfall (mm); colour = modeled flood-risk class that day.
            </div>
          </>
        ) : (
          <div className="bdc-empty">Recent rainfall unavailable — retry when the network is back.</div>
        )}

        <div className="bdc-foot">
          Incident &amp; evacuation history for this barangay will accumulate here as events are logged.
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, unit, tone }) {
  return (
    <div className={`bdc-metric ${tone ? `tone-${tone}` : ''}`}>
      <div className="bdc-metric-val">
        {value}
        {unit && <span className="bdc-metric-unit">{unit}</span>}
      </div>
      <div className="bdc-metric-lbl">{label}</div>
    </div>
  )
}
