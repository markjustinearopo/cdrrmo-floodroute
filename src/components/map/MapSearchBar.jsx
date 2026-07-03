/* ============================================================
   Floating Google-Maps-style search bar for the flood maps.

   Glassmorphism pill with autocomplete: instant local matches
   (barangays, evacuation centres, flood-prone areas) merged with
   debounced OpenStreetMap results (streets, subdivisions, schools,
   hospitals, landmarks) bounded to Cabuyao. Keyboard navigable,
   with persisted recent searches + favourites shown before typing.
   ============================================================ */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  searchLocal,
  searchNominatim,
  loadSearchHistory,
  pushSearchHistory,
  toggleFavorite,
  removeSearchHistory,
  RESULT_TYPES,
} from './searchTools.js'
import './mapUpgrade.css'

const DEBOUNCE_MS = 350

export default function MapSearchBar({ localIndex, onSelect }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [osmResults, setOsmResults] = useState([])
  const [history, setHistory] = useState(loadSearchHistory)
  const [hi, setHi] = useState(-1) // highlighted row (keyboard)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  const localResults = useMemo(() => searchLocal(localIndex, q), [localIndex, q])

  // Merge: local first, then OSM rows the local set doesn't already cover.
  const results = useMemo(() => {
    const seen = new Set(localResults.map((r) => `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`))
    const merged = [...localResults]
    osmResults.forEach((r) => {
      const k = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`
      if (!seen.has(k)) {
        seen.add(k)
        merged.push(r)
      }
    })
    return merged.slice(0, 8)
  }, [localResults, osmResults])

  /* Debounced OSM lookup; each keystroke aborts the in-flight request. */
  useEffect(() => {
    if (q.trim().length < 2) {
      setOsmResults([])
      setLoading(false)
      return undefined
    }
    setLoading(true)
    const id = setTimeout(async () => {
      abortRef.current?.abort()
      const ctl = new AbortController()
      abortRef.current = ctl
      const rows = await searchNominatim(q, ctl.signal)
      if (!ctl.signal.aborted) {
        setOsmResults(rows)
        setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [q])

  /* Close on outside click. */
  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])

  const showHistory = open && !q.trim() && history.length > 0
  const rows = q.trim() ? results : history

  function choose(entry) {
    setHistory(pushSearchHistory(entry))
    setOpen(false)
    setQ(entry.label)
    setHi(-1)
    onSelect?.(entry)
  }

  function clear() {
    setQ('')
    setOsmResults([])
    setHi(-1)
    onSelect?.(null)
    inputRef.current?.focus()
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!rows.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHi((v) => (v + 1) % rows.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((v) => (v - 1 + rows.length) % rows.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(rows[Math.max(hi, 0)])
    }
  }

  return (
    <div className="msb" ref={wrapRef} role="search">
      <div className={`msb-bar ${open ? 'focused' : ''}`}>
        <SearchIcon className="msb-lead" />
        <input
          ref={inputRef}
          value={q}
          placeholder="Search Barangay, Subdivision, Street, Landmark..."
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
            setHi(-1)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label="Search the map"
        />
        {loading && <span className="msb-spin" aria-label="Searching" />}
        {q && !loading && (
          <button type="button" className="msb-icon-btn" onClick={clear} title="Clear" aria-label="Clear search">
            <XIcon />
          </button>
        )}
        <button
          type="button"
          className="msb-go"
          title="Search"
          aria-label="Search"
          onClick={() => {
            if (rows.length) choose(rows[0])
            else inputRef.current?.focus()
          }}
        >
          <SearchIcon />
        </button>
      </div>

      {open && (q.trim() ? results.length > 0 || loading : history.length > 0) && (
        <div className="msb-drop" role="listbox">
          {showHistory && <div className="msb-drop-head">Recent searches</div>}

          {rows.map((r, i) => (
            <div
              key={r.id}
              className={`msb-row ${i === hi ? 'hi' : ''}`}
              role="option"
              aria-selected={i === hi}
              onMouseEnter={() => setHi(i)}
              onClick={() => choose(r)}
            >
              <TypeIcon type={r.type} fav={r.fav} />
              <div className="msb-row-txt">
                <div className="msb-row-label">{r.label}</div>
                <div className="msb-row-sub">{r.sub || RESULT_TYPES[r.type]?.label || 'Place'}</div>
              </div>
              {showHistory && (
                <div className="msb-row-acts" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className={`msb-icon-btn ${r.fav ? 'fav' : ''}`}
                    title={r.fav ? 'Unfavourite' : 'Favourite'}
                    onClick={() => setHistory(toggleFavorite(r.id))}
                  >
                    <StarIcon filled={!!r.fav} />
                  </button>
                  <button
                    type="button"
                    className="msb-icon-btn"
                    title="Remove"
                    onClick={() => setHistory(removeSearchHistory(r.id))}
                  >
                    <XIcon />
                  </button>
                </div>
              )}
            </div>
          ))}

          {q.trim() && loading && results.length === 0 && (
            <div className="msb-empty">Searching OpenStreetMap…</div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Icons ───────────────────────────────────────────────────────────────── */

function TypeIcon({ type, fav }) {
  const cls = `msb-type msb-type--${type || 'place'} ${fav ? 'msb-type--fav' : ''}`
  return (
    <span className={cls}>
      {type === 'evac' ? <HomeIcon />
        : type === 'flood' ? <DropIcon />
        : type === 'road' ? <RoadIcon />
        : type === 'school' ? <SchoolIcon />
        : type === 'hospital' ? <HealthIcon />
        : <PinIcon />}
    </span>
  )
}

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function SearchIcon(props) {
  return (
    <svg {...svgProps} {...props}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  )
}
function XIcon() {
  return (
    <svg {...svgProps}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}
function StarIcon({ filled }) {
  return (
    <svg {...svgProps} fill={filled ? 'currentColor' : 'none'}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}
function PinIcon() {
  return (
    <svg {...svgProps}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
function HomeIcon() {
  return (
    <svg {...svgProps}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}
function DropIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>
  )
}
function RoadIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 21l6-18M20 21L14 3" />
      <path d="M12 8v2M12 14v2" />
    </svg>
  )
}
function SchoolIcon() {
  return (
    <svg {...svgProps}>
      <path d="M22 10L12 5 2 10l10 5 10-5z" />
      <path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" />
    </svg>
  )
}
function HealthIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <path d="M12 10v6M9 13h6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}
