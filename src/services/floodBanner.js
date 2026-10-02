/* ============================================================
   floodBanner.js — the one-line flood status every portal's topbar shows.

   WHY THIS EXISTS
   The banner used to be derived from the live risk field ALONE, and the field
   gates itself on current wetness: no rain falling right now → every barangay
   reads "safe". So during the aftermath of a storm — water still on the ground,
   an emergency alert issued, evacuation centres full, dozens of roads closed —
   all three portals calmly announced "No active flood issue reported."

   A warning channel that contradicts its own warnings is worse than no banner:
   it teaches people to ignore the one line that is supposed to be scanned in a
   second. So:

     AN ACTIVE, OPERATOR-ISSUED ALERT OUTRANKS THE MODEL, ALWAYS.

   A human at the command centre declaring a barangay in danger is a decision;
   the field is an estimate. The estimate is the FALLBACK — it still raises the
   banner when the model sees rising water nobody has issued an alert for yet,
   which is the case the model is genuinely better at.
   ============================================================ */

import { alertAppliesTo } from '../data/cabuyao.js'
import { barangayRiskSamples } from '../components/admin/floodRisk.js'
import { levelFromDepth } from './systemConfig.js'

/* Severity order, worst first. 'emergency' is the takeover tier. */
const RANK = { emergency: 4, high: 3, moderate: 2, low: 1, safe: 0 }
const rankOf = (lvl) => RANK[lvl] ?? 0

/* The banner only carries three visual tones (lvl-high / lvl-moderate /
   lvl-safe), so 'emergency' rides in as high and 'low' as moderate. */
const TONE = { emergency: 'high', high: 'high', moderate: 'moderate', low: 'moderate', safe: 'safe' }

/**
 * Resolve the topbar flood status.
 *
 * @param {object[]} alerts    every alert in the shared store
 * @param {object}   field     the live flood-risk field
 * @param {string?}  barangay  scope to one barangay, or null for the whole city
 * @returns {{ tone: 'high'|'moderate'|'safe', level: string, active: boolean,
 *             source: 'alert'|'model'|'none', names: string[], alert: object|null }}
 */
export function floodStatus(alerts = [], field = null, barangay = null, dataReady = true) {
  /* 1 — Issued alerts. Authoritative. An "all clear" (safe) is a real decision
     too, but it is not a warning, so it does not raise the banner. */
  const live = (alerts || []).filter(
    (a) => a.status === 'active' && rankOf(a.level) > 0 && (!barangay || alertAppliesTo(a, barangay)),
  )
  if (live.length) {
    const worst = live.reduce((best, a) => (rankOf(a.level) > rankOf(best.level) ? a : best), live[0])
    // City view names the barangays under warning; a barangay view is already
    // scoped, so naming itself back at the reader adds nothing.
    const names = barangay
      ? []
      : [...new Set(live.filter((a) => rankOf(a.level) >= rankOf(worst.level)).map((a) => a.barangay))]
    return { tone: TONE[worst.level] || 'moderate', level: worst.level, active: true, source: 'alert', names, alert: worst }
  }

  if (!dataReady || !field?.meta?.live) return { tone: 'moderate', level: 'unverified', active: false, source: 'unavailable', names: [], alert: null }

  /* 2 — Fall back to the model: nobody has issued anything, but the field may
     already see water arriving. Same wetness gate as before. */
  const wet = (field?.meta?.wetness ?? 0) >= 0.15
  if (!wet || !field) return { tone: 'safe', level: 'safe', active: false, source: 'none', names: [], alert: null }

  const samples = barangayRiskSamples(field)
  if (barangay) {
    const depth = samples.find((s) => s.name === barangay)?.floodDepth ?? 0
    const level = levelFromDepth(depth)
    const active = level === 'high' || level === 'moderate'
    return { tone: TONE[level] || 'safe', level, active, source: active ? 'model' : 'none', names: [], alert: null }
  }

  const elevated = samples.filter((s) => s.level === 'high' || s.level === 'moderate')
  if (!elevated.length) return { tone: 'safe', level: 'safe', active: false, source: 'none', names: [], alert: null }
  const level = elevated.some((s) => s.level === 'high') ? 'high' : 'moderate'
  return { tone: TONE[level], level, active: true, source: 'model', names: elevated.map((s) => s.name), alert: null }
}

/** Human sentence for the banner, given a floodStatus() result. */
export function floodBannerText(status, { barangay = null, audience = 'admin' } = {}) {
  const where = barangay ? `Brgy. ${barangay}` : 'Cabuyao City'
  if (status.source === 'unavailable') return `Current flood conditions in ${where} cannot be verified.`

  if (status.source === 'alert') {
    // Lead with what the operator actually said — it is more specific and more
    // actionable than anything that can be generated from a severity level.
    const title = status.alert?.title?.trim()
    if (title) {
      const scope = status.names.length > 1 ? ` (+${status.names.length - 1} more barangays)` : ''
      return `${title}${scope}`
    }
  }

  if (status.source === 'model' && !barangay && status.names.length) {
    const shown = status.names.slice(0, 4).join(', ')
    const more = status.names.length > 4 ? ` +${status.names.length - 4} more` : ''
    return `${shown}${more}: elevated modeled flood risk.`
  }

  const ACTION = {
    admin: { high: 'evacuation protocols in effect.', moderate: 'monitor conditions closely.' },
    barangay: { high: 'evacuate low-lying areas now.', moderate: 'monitor conditions closely.' },
    resident: { high: 'move to higher ground now.', moderate: 'stay alert and avoid flooded roads.' },
  }[audience] || {}

  if (status.tone === 'high') return `High flood risk in ${where} — ${ACTION.high || 'take precautions now.'}`
  if (status.tone === 'moderate') return `Elevated flood risk in ${where} — ${ACTION.moderate || 'stay alert.'}`
  return `No active flood issue reported in ${where}.`
}
