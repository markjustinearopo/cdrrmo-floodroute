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
   Driven by the measured flood depth (m) the backend supplies
   per barangay — the single source of truth for the risk badge.
   Kept in sync with the Dashboard thresholds.
     SAFE     < 0.1 m
     LOW      0.1 – < 0.3 m
     MODERATE 0.3 – < 0.5 m
     HIGH     >= 0.5 m                                          */
export const DEPTH_THRESHOLDS = { low: 0.1, moderate: 0.3, high: 0.5 }

export function levelFromDepth(depth) {
  if (depth >= DEPTH_THRESHOLDS.high) return 'high'
  if (depth >= DEPTH_THRESHOLDS.moderate) return 'moderate'
  if (depth >= DEPTH_THRESHOLDS.low) return 'low'
  return 'safe'
}

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

/**
 * A starter set of known Cabuyao evacuation centres so the screen
 * is usable before the database feed lands. Occupancy starts at 0
 * (no active evacuation) and every field is editable in the UI.
 *
 * `coords` ([lat, lng]) are approximate positions within the city, used as
 * candidate destinations by the flood-aware Auto Route engine until the
 * surveyed facility coordinates arrive from the backend.
 */
export const SAMPLE_EVAC_CENTERS = [
  { id: 'ec-1', name: 'Cabuyao Central School', barangay: 'Poblacion Uno', capacity: 450, occupancy: 0, status: 'open', manager: '', contact: '', coords: [14.2766, 121.1245] },
  { id: 'ec-2', name: 'Pulo Elementary School', barangay: 'Pulo', capacity: 300, occupancy: 0, status: 'open', manager: '', contact: '', coords: [14.2567, 121.1430] },
  { id: 'ec-3', name: 'Mamatid Covered Court', barangay: 'Mamatid', capacity: 520, occupancy: 0, status: 'open', manager: '', contact: '', coords: [14.2389, 121.1556] },
  { id: 'ec-4', name: 'Marinig National High School', barangay: 'Marinig', capacity: 600, occupancy: 0, status: 'open', manager: '', contact: '', coords: [14.2632, 121.1583] },
  { id: 'ec-5', name: 'Banlic Multi-Purpose Hall', barangay: 'Banlic', capacity: 250, occupancy: 0, status: 'closed', manager: '', contact: '', coords: [14.2705, 121.1470] },
]
