/* ============================================================
   shelters.js — which evacuation centre to send someone to.

   WHY THIS EXISTS
   Two screens answered that question and answered it differently.

   The resident dashboard hand-rolled it:

       const open = evacuationCenters.filter((c) => c.status === 'open')
       return open.find((c) => c.barangay === myBrgy) || open[0] || null

   `open[0]` is whichever centre happens to sort first by name — the list
   comes back `.order('name')`. So a card headed "Nearest Evacuation Centre"
   was showing a centre chosen alphabetically, with no distance involved at
   all, and the resident-facing route button could then route them somewhere
   else entirely.

   Neither screen looked at how full the centre was. `status` is set by hand
   by an operator, so a centre at 499/500 that nobody has re-flagged yet is
   still 'open' — and both screens would happily send a family across the
   city to it during a flood.

   Everything here is deliberately cheap: straight-line distance, no road
   graph. The dashboard is a resident's landing page on a phone, possibly on
   mobile data during a typhoon; it must not pull in the routing engine to
   render a card. The routing page still runs the real flood-aware A* — it
   just picks its candidates from the same eligibility rules as this file,
   so the two screens can no longer disagree about which centres are usable.
   ============================================================ */

/* Deliberately NOT imported from components/admin/routingHelpers.jsx, which
   already exports this exact function. That module also imports
   cabuyaoRoads.json — the whole multi-megabyte road network — plus Leaflet,
   so importing one 8-line formula from it drags all of that onto the resident
   dashboard, which is the landing page for someone on mobile data during a
   typhoon. Duplicating a stable geometric constant is the cheaper trade. */
const R_EARTH = 6371000 // metres

function haversineMeters([lat1, lng1], [lat2, lng2]) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.sqrt(a))
}

/* A centre this full is treated as unusable, whatever its status says. Not
   100%: a shelter at capacity has no floor space, and arriving to be turned
   away in chest-deep water is worse than being sent somewhere farther in the
   first place. */
export const FULL_THRESHOLD = 0.95

/* Above this, still send people, but say it is filling up so they can decide
   for themselves whether to go farther. */
export const NEARLY_FULL_THRESHOLD = 0.85

/** Fraction of capacity in use, or null when capacity is unknown. */
export function occupancyRatio(centre) {
  const cap = Number(centre?.capacity || 0)
  if (!cap) return null
  return Math.max(0, Number(centre?.occupancy || 0)) / cap
}

/** How many more people this centre can take. null when capacity is unknown. */
export function remainingHeadroom(centre) {
  const cap = Number(centre?.capacity || 0)
  if (!cap) return null
  return Math.max(0, cap - Math.max(0, Number(centre?.occupancy || 0)))
}

/**
 * Can we send someone here right now?
 * Unknown capacity is treated as usable — most of the 29 seeded centres do
 * have a capacity, and refusing to recommend one because a field is blank
 * would be a worse failure than recommending it.
 */
export function isUsable(centre) {
  if (!centre || centre.status !== 'open') return false
  const ratio = occupancyRatio(centre)
  return ratio === null || ratio < FULL_THRESHOLD
}

/** True when it is usable but filling up — drives the "filling up" badge. */
export function isNearlyFull(centre) {
  const ratio = occupancyRatio(centre)
  return ratio !== null && ratio >= NEARLY_FULL_THRESHOLD && ratio < FULL_THRESHOLD
}

/**
 * The centres a resident may actually be sent to. Both the dashboard card
 * and the routing page start from this, so they cannot disagree.
 */
export function usableShelters(centres = []) {
  return centres.filter(isUsable)
}

/**
 * Rank usable centres for `origin` ([lat, lng]) and return the best, or null.
 *
 * Straight-line distance, adjusted by how much room is left: of two centres
 * at a similar distance, the emptier one wins. The adjustment is capped at
 * 25% so headroom can nudge the choice between comparable options without
 * ever sending someone materially farther for a marginally emptier building.
 *
 * A centre in the resident's own barangay gets a modest bonus — it is the
 * one they can most likely reach on foot, and the one they know.
 *
 * @param {Array} centres     evacuation centres (any status; filtered here)
 * @param {[number,number]|null} origin
 * @param {string} [ownBarangay]
 */
export function pickShelter(centres = [], origin, ownBarangay) {
  const usable = usableShelters(centres)
  if (!usable.length) return null

  // No origin to measure from (no pin, unknown barangay centroid): fall back
  // to the resident's own barangay, then to the emptiest centre — never to
  // "whichever sorted first", which is what this replaces.
  if (!origin) {
    const own = usable.find((c) => c.barangay === ownBarangay)
    if (own) return own
    return [...usable].sort(
      (a, b) => (occupancyRatio(a) ?? 1) - (occupancyRatio(b) ?? 1),
    )[0]
  }

  let best = null
  for (const centre of usable) {
    const coords = Array.isArray(centre.coords)
      ? centre.coords
      : (centre.lat != null && centre.lng != null ? [centre.lat, centre.lng] : null)
    if (!coords) continue

    const distanceM = haversineMeters(origin, coords)
    const ratio = occupancyRatio(centre) ?? 0
    // 1.00 when empty → 1.25 when at the full threshold.
    const crowdPenalty = 1 + Math.min(0.25, ratio * 0.25)
    const ownBonus = ownBarangay && centre.barangay === ownBarangay ? 0.85 : 1
    const score = distanceM * crowdPenalty * ownBonus

    if (!best || score < best.score) best = { centre, score, distanceM }
  }
  return best ? best.centre : null
}
