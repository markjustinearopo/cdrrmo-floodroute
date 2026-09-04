/* ============================================================
   Pure geometry — no React, no Leaflet, no road bundle.

   WHY THIS FILE EXISTS
   These two functions used to live in routingHelpers.jsx, which also exports
   Leaflet map layers and imports the 914 kB bundled road network. Anything
   that wanted a distance in metres dragged all of that in with it:

     * routeEngine.js — pure graph search — could not be loaded or tested
       outside a browser at all, because importing it initialised Leaflet,
       which needs `window`;
     * services/evacuationPlan.js and the resident screens pulled the road
       bundle onto pages that never draw a road;
     * data/shelters.js gave up and inlined its own copy of haversine to stay
       off that path, which is a duplicate nobody would think to keep in step.

   routingHelpers.jsx re-exports both names, so every existing import keeps
   working and nothing had to be rewritten to move them here.
   ============================================================ */

const R_EARTH = 6371000 // metres

/** Great-circle distance between two [lat, lng] points, in metres. */
export function haversineMeters([lat1, lng1], [lat2, lng2]) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.sqrt(a))
}

/** Total length of a [lat, lng][] polyline, in metres. */
export function pathLengthMeters(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += haversineMeters(points[i - 1], points[i])
  return total
}
