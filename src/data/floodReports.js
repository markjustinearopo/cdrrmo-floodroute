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

import { ftToM, formatMeters } from '../services/depth.js'

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

/**
 * "1.1 m" | "0.3 m" | null — the reported water depth, shown in metres.
 *
 * Residents submit and we still STORE feet (the resident form and its existing
 * rows are their own write path), so the conversion happens here at the display
 * edge. Metres is what the rest of the product speaks — see services/depth.js.
 */
export function formatReportDepth(depthFt) {
  return formatMeters(ftToM(depthFt))
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
