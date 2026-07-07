/* ============================================================
   AutoAlertWatcher — makes "Automatic Alerts" on Alert Settings real.

   Mounted once inside the admin shell. When the operator enables
   auto-issue, this watches the live barangay flood model and raises a
   hazard alert on its own the moment a barangay crosses the configured
   trigger level — respecting the same knobs the settings screen shows:

     • Trigger From Level  — High only, or Moderate & above
     • Quiet Hours         — hold back MODERATE overnight (High always goes)
     • Max per barangay/hr — throttle so a fast-changing event can't spam
     • Re-alert Interval   — don't re-issue a barangay within this window

   It only fires on genuine wetness (real rain / elevated discharge), so a
   dry day never auto-alerts even though low-lying barangays stay coloured.
   Alerts use the operator's message TEMPLATE, so an automatic alert reads
   exactly like a hand-written one. Off by default — nothing happens until
   an operator turns it on.
   ============================================================ */

import { useEffect, useRef } from 'react'
import { barangayRiskSamples } from './floodRisk.js'
import { levelFromDepth } from '../../services/systemConfig.js'
import {
  useAlerts, loadAlertSettings, fillAlertTemplate,
} from '../../context/AdminDataContext.jsx'

const LEDGER_KEY = 'cdrrmo_auto_alert_log' // { [barangay]: [issuedAtMs, …] }
const RANK = { safe: 0, low: 1, moderate: 2, high: 3 }
const CHECK_MS = 60_000 // re-evaluate every minute

function readLedger() {
  try {
    const v = JSON.parse(localStorage.getItem(LEDGER_KEY))
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
function writeLedger(l) {
  try { localStorage.setItem(LEDGER_KEY, JSON.stringify(l)) } catch { /* storage full — skip */ }
}

/** Is the current Manila time inside the [from,to] quiet window (HH:mm)? */
function inQuietHours(from, to) {
  const now = new Date().toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' })
  if (!from || !to) return false
  // Window may wrap past midnight (e.g. 22:00 → 05:00).
  return from <= to ? now >= from && now < to : now >= from || now < to
}

export default function AutoAlertWatcher({ field }) {
  const { alerts, addAlert } = useAlerts()
  // Latest alerts readable inside the interval without re-subscribing it.
  const alertsRef = useRef(alerts)
  alertsRef.current = alerts

  useEffect(() => {
    function evaluate() {
      const cfg = loadAlertSettings()
      if (!cfg.autoIssue || !field) return

      // Only auto-issue on real wetness — inherent lowland susceptibility alone
      // (a dry day) must never raise an alert.
      if ((field.meta?.wetness ?? 0) < 0.15) return

      const minRank = cfg.triggerLevel === 'moderate' ? RANK.moderate : RANK.high
      const interval = Math.max(5, Number(cfg.reissueInterval) || 30) * 60_000
      const maxPerHour = Math.max(1, Number(cfg.maxPerHour) || 4)
      const now = Date.now()
      const ledger = readLedger()
      let changed = false

      for (const b of barangayRiskSamples(field)) {
        const level = levelFromDepth(b.floodDepth)
        if (RANK[level] < minRank) continue

        // Quiet hours hold back MODERATE only; HIGH always goes out.
        if (level === 'moderate' && cfg.quietHours && inQuietHours(cfg.quietFrom, cfg.quietTo)) continue

        // Skip if this barangay already has an active alert at/above this level.
        const covered = alertsRef.current.some(
          (a) => a.status === 'active' && a.barangay === b.name && RANK[a.level] >= RANK[level],
        )
        if (covered) continue

        // Throttle: prune this barangay's log to the last hour + re-alert window.
        const recent = (ledger[b.name] || []).filter((t) => now - t < 60 * 60_000)
        const lastAt = recent.length ? Math.max(...recent) : 0
        if (now - lastAt < interval) { ledger[b.name] = recent; continue }
        if (recent.length >= maxPerHour) { ledger[b.name] = recent; continue }

        addAlert({
          level,
          barangay: b.name,
          title: level === 'high' ? 'Automatic Severe Flood Warning' : 'Automatic Flood Advisory',
          message: fillAlertTemplate(level, { barangay: b.name, depth: b.floodDepth }),
          auto: true,
        })
        ledger[b.name] = [...recent, now]
        changed = true
      }

      if (changed) writeLedger(ledger)
    }

    evaluate() // run immediately on mount / field change
    const id = setInterval(evaluate, CHECK_MS)
    return () => clearInterval(id)
  }, [field, addAlert])

  return null
}
