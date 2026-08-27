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

import { BARANGAY_CENTROIDS, barangayForPoint } from '../../data/cabuyaoBarangays.js'
import ROADS_BUNDLE from '../../data/cabuyaoRoads.json'

/* Cabuyao bounding box for Nominatim (viewbox = left,top,right,bottom). */
const VIEWBOX = '121.08,14.31,121.21,14.20'

/* Nominatim's usage policy asks non-personal deployments to identify
   themselves (the browser already sends the site's Referer; an `email`
   contact makes the traffic attributable if it ever needs throttling).
   Set VITE_NOMINATIM_EMAIL in the deploy environment — omitted when unset. */
const NOMINATIM_EMAIL = import.meta.env.VITE_NOMINATIM_EMAIL || ''

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

/* ── Streets, from the bundled network ───────────────────────────────────── */

/**
 * Every named street in the bundled road network, as searchable entries.
 *
 * Streets used to be reachable only through Nominatim — a network round trip
 * that fails exactly when it matters, in the field on a bad connection during
 * a flood. The city's whole road graph already ships with the app; it just was
 * not in the index. Now "Bailon" or "Southville" resolves instantly, offline.
 *
 * One entry per NAME, not per OSM way: a street is drawn as however many ways
 * OSM felt like splitting it into, and a dropdown listing "Caingin Road" nine
 * times is worse than not having it. The representative point is the midpoint
 * of the longest way carrying that name, which for a split street lands on the
 * main stretch rather than on a stub.
 *
 * Built once, lazily, on first use — parsing 4,853 ways is a few milliseconds,
 * but there is no reason to spend them before somebody opens a search box.
 */
let roadIndexCache = null

function buildRoadIndex() {
  if (roadIndexCache) return roadIndexCache

  const best = new Map() // name -> { name, source, span, lat, lng }
  for (const w of ROADS_BUNDLE.ways || []) {
    const name = w.n
    if (!name) continue
    const g = w.g || []
    if (g.length < 4) continue

    // Way length as a squared-degree proxy: only used to compare ways with the
    // same name, so the missing cos(lat) factor cannot change the ordering.
    let span = 0
    for (let i = 2; i < g.length; i += 2) {
      const dLat = g[i] - g[i - 2]
      const dLng = g[i + 1] - g[i - 1]
      span += dLat * dLat + dLng * dLng
    }

    const prev = best.get(name)
    if (prev && prev.span >= span) continue
    const mid = Math.floor(g.length / 4) * 2 // even index = a lat
    best.set(name, {
      name,
      source: w.ns || 'osm',
      span,
      lat: g[mid],
      lng: g[mid + 1],
    })
  }

  roadIndexCache = [...best.values()]
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
    .map((r) => {
      const brgy = barangayForPoint(r.lat, r.lng)
      return {
        id: `road-${r.name}`,
        label: r.name,
        /* Say where an inferred label came from rather than passing a
           subdivision context label off as a surveyed street name. */
        sub: r.source === 'area'
          ? `Roads inside ${r.name.replace(/ (service )?road$/i, '')}${brgy ? ` · Brgy. ${brgy}` : ''}`
          : `Street · ${brgy ? `Brgy. ${brgy}` : 'Cabuyao City'}`,
        type: 'road',
        lat: r.lat,
        lng: r.lng,
        zoom: 17,
      }
    })

  return roadIndexCache
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
  /* Streets last so a barangay, a shelter or a documented flood-prone area
     still outranks a street of the same name — those are the answers a person
     asking about a place usually wants. */
  out.push(...buildRoadIndex())
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
    `&viewbox=${VIEWBOX}&bounded=1&limit=6&polygon_geojson=1&addressdetails=1&countrycodes=ph` +
    (NOMINATIM_EMAIL ? `&email=${encodeURIComponent(NOMINATIM_EMAIL)}` : '')
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
