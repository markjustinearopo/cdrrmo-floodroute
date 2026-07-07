/* ============================================================
   pinIcons — the ONE map-marker design language for the system.

   Every point feature on every flood map uses the same teardrop pin,
   varied only along two axes:
     • COLOUR  = category / severity (flood-prone red ramp, incident
       priority, evacuation green, barangay risk class …)
     • SIZE    = importance (high severity reads largest)
   with a small white glyph naming the category (droplet = flood,
   warning triangle = incident / flash flood, house = evacuation,
   dot = generic / barangay marker).

   Replaces the ad-hoc mix of CircleMarker dots and per-feature
   divIcons that previously varied page by page. Leaflet divIcons are
   cached per (colour, glyph, size, selected) so re-renders reuse the
   same instance.
   ============================================================ */

import L from 'leaflet'
import './pinIcons.css'

/* Category glyphs (24×24 stroke icons, drawn white inside the pin head). */
const GLYPHS = {
  drop: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  alert:
    '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>' +
    '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  dot: '<circle cx="12" cy="12" r="3.5"/>',
}

/* Severity → pin size (px). High severity reads largest on the map. */
export const PIN_SIZE = { high: 30, moderate: 25, low: 21, base: 25 }

const cache = new Map()

/**
 * Build (and cache) a teardrop pin divIcon.
 *   color    — pin fill (category / severity colour)
 *   glyph    — 'drop' | 'alert' | 'home' | 'dot'
 *   size     — pin head diameter in px (see PIN_SIZE)
 *   selected — dark outline + slight enlargement for the focused pin
 */
export function pinIcon({ color = '#c0181b', glyph = 'dot', size = PIN_SIZE.base, selected = false } = {}) {
  const key = `${color}|${glyph}|${size}|${selected ? 1 : 0}`
  if (cache.has(key)) return cache.get(key)

  const s = selected ? Math.round(size * 1.15) : size
  // The teardrop tip lands ~0.21·size below the square head (45° rotation).
  const h = Math.ceil(s * 1.22)
  const icon = L.divIcon({
    className: 'cd-pin-wrap',
    html:
      `<span class="cd-pin ${selected ? 'cd-pin--selected' : ''}" style="--pin-c:${color};--pin-s:${s}px">` +
      `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[glyph] || GLYPHS.dot}</svg>` +
      `</span><span class="cd-pin-shadow"></span>`,
    iconSize: [s, h],
    iconAnchor: [s / 2, h],
    popupAnchor: [0, -h],
    tooltipAnchor: [0, -h],
  })
  cache.set(key, icon)
  return icon
}
