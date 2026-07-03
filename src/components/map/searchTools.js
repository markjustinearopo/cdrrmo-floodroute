/* ============================================================
   Smart location search toolkit for the flood maps.

   Two sources, merged into one suggestion list:
     • LOCAL — the data the system already knows (the 18 barangays,
       evacuation centres, documented flood-prone areas). Instant,
       offline, always first.
     • OPENSTREETMAP (Nominatim) — streets, subdivisions, schools,
       hospitals, landmarks inside the Cabuyao bounding box. Debounced
       by the caller; each request aborts the previous one.

   Also owns the persisted search history (recent + favourites) that
   the search bar shows before the user types.
   ============================================================ */

import { BARANGAY_CENTROIDS } from '../../data/cabuyaoBarangays.js'

/* Cabuyao bounding box for Nominatim (viewbox = left,top,right,bottom). */
const VIEWBOX = '121.08,14.31,121.21,14.20'

/* ── Result types → icon + accent used by the dropdown ───────────────────── */
export const RESULT_TYPES = {
  barangay: { label: 'Barangay', icon: 'pin' },
  evac: { label: 'Evacuation Centre', icon: 'home' },
  flood: { label: 'Flood-Prone Area', icon: 'drop' },
  road: { label: 'Road / Street', icon: 'road' },
  school: { label: 'School', icon: 'school' },
  hospital: { label: 'Hospital', icon: 'health' },
  place: { label: 'Place', icon: 'pin' },
}

/* ── Local index ─────────────────────────────────────────────────────────── */

/**
 * Build the instant (no-network) suggestion index from the live app data.
 * Rebuilt whenever the inputs change; each entry is one selectable result.
 */
export function buildLocalIndex({ evacCenters = [], floodAreas = [] } = {}) {
  const out = []
  BARANGAY_CENTROIDS.forEach((b) => {
    if (!Array.isArray(b.coords)) return
    out.push({
      id: `brgy-${b.name}`,
      label: `Barangay ${b.name}`,
      sub: 'Cabuyao City',
      type: 'barangay',
      lat: b.coords[0],
      lng: b.coords[1],
      zoom: 15,
    })
  })
  evacCenters.forEach((c) => {
    if (!Array.isArray(c.coords)) return
    out.push({
      id: `evac-${c.id}`,
      label: c.name,
      sub: `Evacuation centre · ${c.barangay || 'Cabuyao'} · ${c.status || 'open'}`,
      type: 'evac',
      lat: c.coords[0],
      lng: c.coords[1],
      zoom: 17,
    })
  })
  floodAreas.forEach((a) => {
    if (!Array.isArray(a.coords)) return
    out.push({
      id: `flood-${a.id}`,
      label: a.name,
      sub: `Flood-prone area · ${a.barangay || 'Cabuyao'}`,
      type: 'flood',
      lat: a.coords[0],
      lng: a.coords[1],
      zoom: 16,
    })
  })
  return out.filter((e) => e.lat != null && e.lng != null)
}

/** Rank local entries against the query: prefix > word-prefix > substring. */
export function searchLocal(index, query, limit = 5) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored = []
  index.forEach((e) => {
    const l = e.label.toLowerCase()
    let score = -1
    if (l.startsWith(q)) score = 0
    else if (l.split(/\s+/).some((w) => w.startsWith(q))) score = 1
    else if (l.includes(q)) score = 2
    else if ((e.sub || '').toLowerCase().includes(q)) score = 3
    if (score >= 0) scored.push([score, e])
  })
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, e]) => e)
}

/* ── OpenStreetMap (Nominatim) ───────────────────────────────────────────── */

function osmType(item) {
  const cls = item.category || item.class // jsonv2 renames class → category
  const type = item.type
  if (cls === 'highway') return 'road'
  if (type === 'school' || type === 'college' || type === 'university') return 'school'
  if (type === 'hospital' || type === 'clinic' || type === 'doctors') return 'hospital'
  return 'place'
}

/**
 * Geocode inside Cabuyao. Returns the same result shape as the local index
 * plus `geojson` (LineString for roads → drives the glow highlight) and
 * `bbox` for flyToBounds. Fail-soft: network errors return [].
 */
export async function searchNominatim(query, signal) {
  const q = query.trim()
  if (q.length < 2) return []
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2' +
    `&q=${encodeURIComponent(q)}` +
    `&viewbox=${VIEWBOX}&bounded=1&limit=6&polygon_geojson=1&addressdetails=1&countrycodes=ph`
  try {
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const data = await res.json()
    return (Array.isArray(data) ? data : []).map((item) => {
      const a = item.address || {}
      const parts = [a.road, a.village || a.suburb || a.neighbourhood, a.city || a.town]
        .filter(Boolean)
        .filter((p, i, arr) => arr.indexOf(p) === i)
      return {
        id: `osm-${item.osm_type}-${item.osm_id}`,
        label: item.name || (item.display_name || '').split(',')[0],
        sub: parts.join(', ') || 'Cabuyao City',
        type: osmType(item),
        lat: Number(item.lat),
        lng: Number(item.lon),
        zoom: item.class === 'highway' ? 17 : 16,
        geojson: item.geojson || null,
        bbox: item.boundingbox || null, // [latMin, latMax, lonMin, lonMax]
      }
    }).filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng) && e.label)
  } catch {
    return []
  }
}

/* ── Search history (recent + favourites, localStorage) ─────────────────── */

const HISTORY_KEY = 'cdrrmo-map-search-history-v1'
const MAX_RECENT = 10

export function loadSearchHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function persist(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
  } catch { /* storage full/blocked — history just won't persist */ }
  return list
}

/** Record a selected result (deduped, newest first, favourites never evicted). */
export function pushSearchHistory(entry) {
  const list = loadSearchHistory().filter((h) => h.id !== entry.id)
  // Never store the (possibly large) geojson blob in localStorage.
  const { geojson, ...slim } = entry
  list.unshift({ ...slim, ts: Date.now() })
  const favs = list.filter((h) => h.fav)
  const recents = list.filter((h) => !h.fav).slice(0, MAX_RECENT)
  return persist([...favs, ...recents].sort((a, b) => (b.ts || 0) - (a.ts || 0)))
}

export function toggleFavorite(id) {
  return persist(loadSearchHistory().map((h) => (h.id === id ? { ...h, fav: !h.fav } : h)))
}

export function removeSearchHistory(id) {
  return persist(loadSearchHistory().filter((h) => h.id !== id))
}

/* ── Geometry helpers ────────────────────────────────────────────────────── */

/** Great-circle distance in km. */
export function haversineKm(a, b) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}
