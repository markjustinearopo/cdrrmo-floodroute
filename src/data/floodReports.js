/* ============================================================
   Resident flood-report vocabulary — the single source of truth for
   the flood levels, their map colours, and the verification statuses.

   Shared by the resident submission form, the CDRRMO verification
   dashboard and every map layer that paints approved reports, so a
   report reads the same everywhere it appears.

   Marker colour ramp (per the system spec):
     No Flood        → Green   (safe)
     Low Flood       → Yellow  (warning)
     Moderate Flood  → Orange
     Severe Flood    → Red
     Impassable Road → Dark Red
   ============================================================ */

/** Ordered flood levels a resident can pick (drives the form + filters). */
export const FLOOD_LEVELS = [
  { value: 'none', label: 'No Flood' },
  { value: 'low', label: 'Low Flood' },
  { value: 'moderate', label: 'Moderate Flood' },
  { value: 'severe', label: 'Severe Flood' },
  { value: 'impassable', label: 'Impassable Road' },
]

export const FLOOD_LEVEL_LABEL = Object.fromEntries(FLOOD_LEVELS.map((l) => [l.value, l.label]))

/** Per-level display metadata: full label, short chip label + marker colour. */
export const FLOOD_LEVEL_META = {
  none:       { label: 'No Flood',        short: 'None',       color: '#22C55E', marker: 'Green' },
  low:        { label: 'Low Flood',       short: 'Low',        color: '#EAB308', marker: 'Yellow' },
  moderate:   { label: 'Moderate Flood',  short: 'Moderate',   color: '#F97316', marker: 'Orange' },
  severe:     { label: 'Severe Flood',    short: 'Severe',     color: '#EF4444', marker: 'Red' },
  impassable: { label: 'Impassable Road', short: 'Impassable', color: '#7F1D1D', marker: 'Dark Red' },
}

export function floodLevelMeta(level) {
  return FLOOD_LEVEL_META[level] || FLOOD_LEVEL_META.moderate
}

/** Verification-status metadata for badges across the portals. */
export const VERIFY_STATUS_META = {
  pending:  { label: 'Pending Verification', short: 'Pending',  color: '#D97706' },
  approved: { label: 'Approved',             short: 'Approved', color: '#16A34A' },
  rejected: { label: 'Rejected',             short: 'Rejected', color: '#DC2626' },
}

export function verifyStatusMeta(status) {
  return VERIFY_STATUS_META[status] || VERIFY_STATUS_META.pending
}

/** Marker radius grows with severity so worse floods read louder on the map. */
export function floodReportRadius(level) {
  return { none: 6, low: 7, moderate: 8, severe: 9, impassable: 10 }[level] || 7
}

/** "3.5 ft" | "4 ft" | null — optional water depth in feet. */
export function formatReportDepth(depthFt) {
  if (depthFt == null || depthFt === '') return null
  const ft = Number(depthFt)
  if (Number.isNaN(ft)) return null
  return `${ft % 1 === 0 ? ft : ft.toFixed(1)} ft`
}

/**
 * Levels that, once approved, should also flag the nearest road for the route
 * planner: a severe flood makes a road risky, an impassable one closes it.
 * Returns the painted road-status value ('flooded' | 'blocked') or null.
 */
export function roadStatusForLevel(level) {
  if (level === 'impassable') return 'blocked'
  if (level === 'severe') return 'flooded'
  return null
}
