/* ============================================================
   Shared Cabuyao City reference data & enums.

   Pulled out of the individual admin screens so the Manage pages
   (Alerts, Barangay, Incidents, Evacuation) share one source of
   truth. Live records still come from the Node/Express + database
   backend (Conceptual Framework) — these are the fixed lookups
   (barangay list, severity levels) plus a small set of seed rows
   so the assignment screens have something to act on before the
   API is wired in.
   ============================================================ */

// The 18 official barangays of Cabuyao City (alphabetical).
export const BARANGAYS = [
  'Baclaran', 'Banay-Banay', 'Banlic', 'Bigaa', 'Butong', 'Casile',
  'Diezmo', 'Gulod', 'Mamatid', 'Marinig', 'Niugan', 'Pittland',
  'Poblacion Dos', 'Poblacion Tres', 'Poblacion Uno', 'Pulo', 'Sala',
  'San Isidro',
]

/**
 * Representative ([lat, lng]) point for each barangay, used to sample the live
 * flood-risk field (floodRisk) so every barangay gets a model-derived risk
 * level. These are no longer hand-placed guesses: each point is the
 * pole-of-inaccessibility of the barangay's REAL administrative boundary
 * (OpenStreetMap + PSA), so it always sits inside the barangay on actual land.
 * Sourced + validated in ./cabuyaoBarangays.js and the scripts/ build.
 */
export { BARANGAY_CENTROIDS as BARANGAY_POINTS } from './cabuyaoBarangays.js'

/* ── Hazard alert levels ──────────────────────────────────── */
/* The tier above High takes over every screen and sounds a siren, so it is
   deliberately NOT in the ordinary level picker — it has its own guarded flow
   on the Alerts screen, open to CDRRMO administrators only. See EMERGENCY_LEVEL
   and components/EmergencyAlert.jsx. */
export const ALERT_LEVELS = [
  { value: 'high', label: 'High' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'safe', label: 'Safe / All Clear' },
]

export const EMERGENCY_LEVEL = 'emergency'

/* ── City-wide alerts ──────────────────────────────────────────────────────
   An alert targets one barangay by name, or the whole city with this marker.

   Every portal used to filter alerts with `a.barangay === myBrgy`, which meant
   a city-wide alert reached NOBODY: no resident's barangay is literally "All
   Barangays", so the row existed, looked issued on the admin's screen, and was
   invisible to every person it was for. That is the worst way for a warning
   channel to fail — silently, while appearing to work.

   One rule, used by every portal, so the question "does this alert apply to
   me" has exactly one answer in the codebase. */
export const CITY_WIDE = 'All Barangays'

export function alertAppliesTo(alert, barangay) {
  if (!alert) return false
  /* Checks the WHOLE target list, not just the first entry. An alert aimed
     at five lakeshore barangays must reach all five — reading only
     barangays[0] meant four of them never saw it, which is why operators
     fell back to tagging everything city-wide. Falls back to the legacy
     singular field for any caller still constructing alerts by hand. */
  const targets = Array.isArray(alert.barangays) && alert.barangays.length
    ? alert.barangays
    : [alert.barangay]
  return targets.some((t) => t === CITY_WIDE || t === 'All' || t === barangay)
}

/* ── Alert ordering ────────────────────────────────────────────────────────
   Severity first, then newest.

   There was no sort call on ANY alert list in this codebase — every portal
   rendered them in whatever order the database returned, which is `id`
   order. So a FORCED EVACUATION for the reader's own barangay could sit
   below three advisories simply because it was issued earlier, and on a
   phone (which shows only the newest two) it could fall off the card
   entirely. A warning nobody sees is the same as a warning never sent.

   Emergency outranks high, which outranks moderate, and so on; 'safe' is an
   all-clear and sorts last among active alerts. Ties break on issue time,
   newest first. Use this everywhere a list of alerts is rendered. */
const ALERT_SEVERITY_RANK = {
  emergency: 0,
  high: 1,
  moderate: 2,
  low: 3,
  safe: 4,
}

export function compareAlerts(a, b) {
  const rank = (x) => ALERT_SEVERITY_RANK[x?.level] ?? 5
  const bySeverity = rank(a) - rank(b)
  if (bySeverity !== 0) return bySeverity
  return (b?.issuedAt ?? 0) - (a?.issuedAt ?? 0)
}

/** Convenience: filter to one barangay's active alerts, most urgent first. */
export function sortAlerts(alerts = []) {
  return [...alerts].sort(compareAlerts)
}

/* ── Barangay safeness ─────────────────────────────────────
   Graded from the modeled flood depth (m) per barangay using the
   OPERATOR-configurable thresholds on System Configuration (read live
   from the shared systemConfig service, so every screen agrees). The
   constant below is the shipped default the operator starts from.
     SAFE     < 0.1 m
     LOW      0.1 – < 0.3 m
     MODERATE 0.3 – < 0.5 m
     HIGH     >= 0.5 m                                          */
export const DEPTH_THRESHOLDS = { low: 0.1, moderate: 0.3, high: 0.5 }

export { levelFromDepth } from '../services/systemConfig.js'

/* ── Incident enums ───────────────────────────────────────── */
export const INCIDENT_TYPES = [
  'Flooding',
  'Road Blockage',
  'Stranded Residents',
  'Medical Emergency',
  'Infrastructure Damage',
  'Power Outage',
  'Other',
]

export const PRIORITIES = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

export const INCIDENT_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
]

// Response teams an incident can be assigned to.
export const RESPONSE_TEAMS = [
  'Rescue Team Alpha',
  'Rescue Team Bravo',
  'Medical Unit',
  'Engineering / Public Works',
  'BDRRMC Volunteers',
]

/* ── Evacuation centre enums ──────────────────────────────── */
export const EVAC_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'full', label: 'Full' },
  { value: 'closed', label: 'Closed' },
]

/*
 * Evacuation centres are no longer seeded in code. Every map and screen reads
 * the live records from the shared store (AdminDataContext → Supabase), so a
 * centre added once is the SAME centre everywhere — 2D and 3D, every portal.
 * Manage them on the Evacuation screen or Route Planning's "Add Centre".
 */
