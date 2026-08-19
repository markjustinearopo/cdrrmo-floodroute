/* ============================================================
   Flood-prone areas — Cabuyao City historical flood record.

   These are the CITY's documented flood-prone locations (Habagat rains,
   thunderstorms and tropical cyclones). Admins manage them exactly like
   road status: pin the location, set the depth and the cause, and the
   record appears live on every flood map and in the generated reports.

   Depths are stored in METRES (`depthM`), the same unit as the risk model and
   the System Configuration thresholds — see services/depth.js for why. The
   client supplied this historical record in feet, so the seed values below are
   the converted equivalents (3 ft = 0.91 m, 2 ft = 0.61 m, 1.5 ft = 0.46 m,
   1 ft = 0.30 m, 0.5 ft = 0.15 m) and the editor shows a live feet readout so
   an operator who measured on the ground can check their entry. Records
   written before the switch still carry `depthFt` and are converted on read.

   Coordinates were resolved from OpenStreetMap / Nominatim where a precise
   match existed (NIA Road, Cabuyao City Hospital, the lakeshore barangay
   interior points, …); the rest are anchored to the barangay's validated
   interior point. Admins can drag any pin to the exact spot.
   ============================================================ */

import { depthMeters, formatMeters } from '../services/depth.js'

/* ── Vocabularies ─────────────────────────────────────────────────────────── */
export const FLOOD_TYPES = [
  { value: 'flood', label: 'Standing Flood', hint: 'Water pools and stays — depth measured at its peak' },
  { value: 'flash_flood', label: 'Flash Flood', hint: 'Rises and drains fast — dangerous current' },
  { value: 'gutter', label: 'Gutter-deep', hint: 'Shallow street flooding (curb / gutter level)' },
]
export const FLOOD_TYPE_LABEL = Object.fromEntries(FLOOD_TYPES.map((t) => [t.value, t.label]))

/* Common rain drivers in Cabuyao (multi-select on the editor). */
export const FLOOD_CAUSES = ['Habagat', 'Thunderstorm', 'Tropical Cyclone', 'Lake Backflow', 'Clogged Drainage']

/* ── Severity (drives the marker colour + report badge) ───────────────────── */
export const FLOOD_SEVERITY_META = {
  high: { label: 'High', color: '#C0181B', fill: '#FCA5A5' },
  moderate: { label: 'Moderate', color: '#F97316', fill: '#FED7AA' },
  low: { label: 'Low', color: '#EAB308', fill: '#FEF08A' },
}

/* The severity bands are the original physical thresholds restated in metres,
   so no existing record changes band: 2 ft = 0.61 m, 1 ft = 0.30 m. This is the
   historical-record scale and stays distinct from the live model's risk bands
   in System Configuration, which grade a different quantity. */
export const FLOOD_SEVERITY_HIGH_M = 0.61
export const FLOOD_SEVERITY_MODERATE_M = 0.3

/**
 * Severity band for a flood-prone area. Flash floods are always treated as High
 * (fast water is dangerous regardless of pooled depth); otherwise it follows the
 * recorded depth.
 *   >= 0.61 m → High · >= 0.30 m → Moderate · shallower (incl. gutter) → Low
 */
export function floodSeverity(area) {
  if (!area) return 'low'
  if (area.type === 'flash_flood') return 'high'
  const m = depthMeters(area) || 0
  if (m >= FLOOD_SEVERITY_HIGH_M) return 'high'
  if (m >= FLOOD_SEVERITY_MODERATE_M) return 'moderate'
  return 'low'
}

/** Human depth label: "0.9 m", "0.15 m", "Gutter-deep", "Flash flood". */
export function formatFloodDepth(area) {
  if (!area) return '—'
  const m = depthMeters(area)
  if (area.type === 'flash_flood' && !m) return 'Flash flood'
  if (area.type === 'gutter' && !m) return 'Gutter-deep'
  return formatMeters(m) || (area.type === 'gutter' ? 'Gutter-deep' : '—')
}

const HIST = 'CDRRMO historical record'

/* ── Seed: the client's documented flood-prone areas ──────────────────────────
   Depths in METRES (converted from the client's feet record — the notes keep
   the original figure so the provenance stays readable). The single "Laguna
   Lake Lakeshore Barangays — 3 ft" line is expanded to one record per
   lakeshore barangay so each shows on its own map location with full detail. */
export const SEED_FLOOD_AREAS = [
  {
    id: 'fa-nia-mamatid-sala', name: 'NIA Road (Mamatid → Sala)', barangay: 'Mamatid',
    coords: [14.2357, 121.1446], type: 'flood', depthM: 0.91,
    causes: ['Habagat', 'Tropical Cyclone', 'Thunderstorm'], sourceStorms: 'Paeng, Ulysses, Habagat',
    notes: 'NIA irrigation road corridor — floods to about 3 ft along the Mamatid–Sala stretch during sustained rains.',
    reportedBy: HIST,
  },
  {
    id: 'fa-pulo-diezmo-road', name: 'Pulo–Diezmo Road', barangay: 'Pulo',
    coords: [14.2389, 121.1152], type: 'flood', depthM: 0.3,
    causes: ['Habagat', 'Thunderstorm'], sourceStorms: '',
    notes: 'Reaches roughly 1 ft on the Pulo–Diezmo road during heavy rain.',
    reportedBy: HIST,
  },
  {
    id: 'fa-san-isidro-riles', name: 'San Isidro Riles (Railroad)', barangay: 'San Isidro',
    coords: [14.2520, 121.1505], type: 'flood', depthM: 0.46,
    causes: ['Habagat', 'Thunderstorm'], sourceStorms: '',
    notes: 'Low-lying stretch along the PNR railroad ("riles") — about 1.5 ft.',
    reportedBy: HIST,
  },
  {
    id: 'fa-sala-tarikan', name: 'Sala–Tarikan', barangay: 'Sala',
    coords: [14.2690, 121.1320], type: 'flood', depthM: 0.61,
    causes: ['Habagat', 'Tropical Cyclone'], sourceStorms: '',
    notes: 'Sitio Tarikan area — floods to about 2 ft.',
    reportedBy: HIST,
  },

  /* Laguna Lake lakeshore barangays — 3 ft (Baclaran, Gulod, Mamatid, Marinig, Bigaa, Butong).
     These six expand ONE barangay-wide line in the client's record, so they are
     flagged `estimated: true` — the popup labels them an estimated band rather
     than a precisely observed incident, so the map doesn't overstate precision. */
  {
    id: 'fa-lakeshore-baclaran', name: 'Laguna Lakeshore — Baclaran', barangay: 'Baclaran', estimated: true,
    coords: [14.24489, 121.16814], type: 'flood', depthM: 0.91,
    causes: ['Tropical Cyclone', 'Habagat', 'Lake Backflow'], sourceStorms: 'Paeng, Ulysses',
    notes: 'Lakeshore barangay on Laguna de Bay — up to 3 ft during lake rise and sustained rains.',
    reportedBy: HIST,
  },
  {
    id: 'fa-lakeshore-gulod', name: 'Laguna Lakeshore — Gulod', barangay: 'Gulod', estimated: true,
    coords: [14.25419, 121.16268], type: 'flood', depthM: 0.91,
    causes: ['Tropical Cyclone', 'Habagat', 'Lake Backflow'], sourceStorms: 'Paeng, Ulysses',
    notes: 'Lakeshore barangay on Laguna de Bay — up to 3 ft during lake rise and sustained rains.',
    reportedBy: HIST,
  },
  {
    id: 'fa-lakeshore-mamatid', name: 'Laguna Lakeshore — Mamatid', barangay: 'Mamatid', estimated: true,
    coords: [14.23954, 121.15623], type: 'flood', depthM: 0.91,
    causes: ['Tropical Cyclone', 'Habagat', 'Lake Backflow'], sourceStorms: 'Paeng, Ulysses',
    notes: 'Lakeshore barangay on Laguna de Bay — up to 3 ft during lake rise and sustained rains.',
    reportedBy: HIST,
  },
  {
    id: 'fa-lakeshore-marinig', name: 'Laguna Lakeshore — Marinig', barangay: 'Marinig', estimated: true,
    coords: [14.27153, 121.14969], type: 'flood', depthM: 0.91,
    causes: ['Tropical Cyclone', 'Habagat', 'Lake Backflow'], sourceStorms: 'Paeng, Ulysses',
    notes: 'Lakeshore barangay on Laguna de Bay — up to 3 ft during lake rise and sustained rains.',
    reportedBy: HIST,
  },
  {
    id: 'fa-lakeshore-bigaa', name: 'Laguna Lakeshore — Bigaa', barangay: 'Bigaa', estimated: true,
    coords: [14.28346, 121.12973], type: 'flood', depthM: 0.91,
    causes: ['Tropical Cyclone', 'Habagat', 'Lake Backflow'], sourceStorms: 'Paeng, Ulysses',
    notes: 'Lakeshore barangay on Laguna de Bay — up to 3 ft during lake rise and sustained rains.',
    reportedBy: HIST,
  },
  {
    id: 'fa-lakeshore-butong', name: 'Laguna Lakeshore — Butong', barangay: 'Butong', estimated: true,
    coords: [14.28783, 121.13696], type: 'flood', depthM: 0.91,
    causes: ['Tropical Cyclone', 'Habagat', 'Lake Backflow'], sourceStorms: 'Paeng, Ulysses',
    notes: 'Lakeshore barangay on Laguna de Bay — up to 3 ft during lake rise and sustained rains.',
    reportedBy: HIST,
  },

  {
    id: 'fa-banlic-alimagno', name: 'Banlic — Alimagno Compound', barangay: 'Banlic',
    coords: [14.2330, 121.1400], type: 'flash_flood', depthM: null,
    causes: ['Thunderstorm', 'Habagat'], sourceStorms: '',
    notes: 'Flash-flood prone at Alimagno Compound — water rises and drains quickly.',
    reportedBy: HIST,
  },
  {
    id: 'fa-poblacion-uno', name: 'Poblacion Uno', barangay: 'Poblacion Uno',
    coords: [14.28044, 121.12480], type: 'flash_flood', depthM: null,
    causes: ['Thunderstorm'], sourceStorms: '',
    notes: 'Flash-flood prone during intense downpours.',
    reportedBy: HIST,
  },
  {
    id: 'fa-poblacion-tres', name: 'Poblacion Tres (Santa Rosa–Cabuyao Boundary)', barangay: 'Poblacion Tres',
    coords: [14.2790, 121.1230], type: 'flash_flood', depthM: null,
    causes: ['Thunderstorm'], sourceStorms: '',
    notes: 'Flash flooding along the Santa Rosa–Cabuyao boundary.',
    reportedBy: HIST,
  },
  {
    id: 'fa-sala-rotonda', name: 'Sala Rotonda', barangay: 'Sala',
    coords: [14.2700, 121.1280], type: 'flood', depthM: 0.61,
    causes: ['Habagat', 'Thunderstorm'], sourceStorms: '',
    notes: 'Roundabout area — about 2 ft.',
    reportedBy: HIST,
  },
  {
    id: 'fa-niugan-southville', name: 'Niugan (Southville)', barangay: 'Niugan',
    coords: [14.2670, 121.1370], type: 'gutter', depthM: 0.15,
    causes: ['Thunderstorm'], sourceStorms: '',
    notes: 'Gutter-deep street flooding in the Southville area.',
    reportedBy: HIST,
  },
  {
    id: 'fa-banaybanay-lakeside', name: 'Banay-Banay (Lakeside)', barangay: 'Banay-Banay',
    coords: [14.2560, 121.1420], type: 'gutter', depthM: 0.15,
    causes: ['Lake Backflow', 'Habagat'], sourceStorms: '',
    notes: 'Gutter-deep flooding on the lakeside portion of Banay-Banay.',
    reportedBy: HIST,
  },
  {
    id: 'fa-city-hospital', name: 'Cabuyao City Hospital', barangay: 'San Isidro',
    coords: [14.2585, 121.1482], type: 'flood', depthM: 0.15,
    causes: ['Thunderstorm', 'Habagat'], sourceStorms: '',
    notes: 'About 0.5 ft around the hospital grounds and approach road.',
    reportedBy: HIST,
  },
  {
    id: 'fa-fortezza', name: 'Fortezza (Pulo–San Isidro)', barangay: 'Pulo',
    coords: [14.2480, 121.1430], type: 'flood', depthM: 0.46,
    causes: ['Habagat', 'Thunderstorm'], sourceStorms: '',
    notes: 'Fortezza subdivision between Pulo and San Isidro — about 1.5 ft.',
    reportedBy: HIST,
  },
  {
    id: 'fa-calle-onse-daang-marinig', name: 'Calle Onse – Daang Marinig', barangay: 'Marinig',
    coords: [14.2720, 121.1480], type: 'flood', depthM: 0.61,
    causes: ['Habagat', 'Tropical Cyclone'], sourceStorms: '',
    notes: 'About 2 ft along Calle Onse / Daang Marinig.',
    reportedBy: HIST,
  },
  {
    id: 'fa-zion-road-cabs', name: 'Zion Road near CABS', barangay: 'Sala',
    coords: [14.2700, 121.1300], type: 'flood', depthM: 0.15,
    causes: ['Thunderstorm'], sourceStorms: '',
    notes: 'About 0.5 ft along Zion Road near CABS.',
    reportedBy: HIST,
  },
]
