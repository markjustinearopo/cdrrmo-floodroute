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
export const ALERT_LEVELS = [
  { value: 'high', label: 'High' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'safe', label: 'Safe / All Clear' },
]

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
