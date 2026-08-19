/* ============================================================
   Flood depth — one canonical unit for the whole product.

   The system had two units for one physical quantity: the risk model and the
   System Configuration thresholds work in METRES, while every human-recorded
   depth (flood-prone areas, resident flood reports, road conditions) was
   captured and stored in FEET because that is how the city's historical record
   arrived. An operator reading "3 ft" on a pin and "0.3 m = High" on the
   settings screen had to convert in their head to know whether the two agreed.

   METRES is canonical. It matches the thresholds, the model and the rest of
   the product. Feet survive only at the two edges where they are genuinely
   useful: the editor shows a live feet conversion next to the metre input, so
   an operator who measured 3 ft on the ground can confirm they typed the right
   number.

   Storage: flood-prone areas now persist `depthM`. Resident flood reports and
   road conditions still WRITE feet — they have their own write paths (a
   resident form and the road_status.flood_depth_ft column) that a UI change
   has no business silently rewriting — so they are converted on read here
   instead. Either way what the operator sees is metres.
   ============================================================ */

export const FT_PER_M = 3.280839895
const M_PER_FT = 0.3048

/** Feet → metres. Returns null for blank/non-numeric input. */
export function ftToM(ft) {
  if (ft == null || ft === '') return null
  const n = Number(ft)
  return Number.isFinite(n) ? n * M_PER_FT : null
}

/** Metres → feet. Returns null for blank/non-numeric input. */
export function mToFt(m) {
  if (m == null || m === '') return null
  const n = Number(m)
  return Number.isFinite(n) ? n * FT_PER_M : null
}

/**
 * Canonical depth in metres for any record, whichever unit it was stored in.
 * `depthM` wins; a legacy `depthFt` is converted. This is the ONLY place that
 * knows a record might still be carrying feet.
 */
export function depthMeters(record) {
  if (!record) return null
  if (record.depthM != null && record.depthM !== '') {
    const n = Number(record.depthM)
    return Number.isFinite(n) ? n : null
  }
  return ftToM(record.depthFt)
}

/**
 * Display a depth in metres: "0.9 m", "0.15 m", or null when there is nothing
 * to show. Two decimals below 10 cm so shallow street flooding stays legible,
 * otherwise one — "0.90 m" reads as false precision for a pin dropped by eye.
 */
export function formatMeters(m) {
  if (m == null || m === '') return null
  const n = Number(m)
  if (!Number.isFinite(n) || n === 0) return null
  return `${n < 0.1 ? n.toFixed(2) : n.toFixed(1)} m`
}

/** The same value in feet, for the editor's confirmation hint: "≈ 3 ft". */
export function formatFeetHint(m) {
  const ft = mToFt(m)
  if (ft == null || ft === 0) return null
  const txt = Number.isInteger(ft) ? String(ft) : ft.toFixed(1)
  return `≈ ${txt} ft`
}
