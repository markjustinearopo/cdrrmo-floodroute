import { useEffect, useRef, useState } from 'react'
import { searchNominatim, reverseGeocode } from './searchTools.js'
import { barangayForPoint } from '../../data/cabuyaoBarangays.js'
import { parseCoordinates } from '../../utils/mapGeometry.js'
import './locationLookup.css'
export default function LocationLookup({ point, onPick }) {
  const [query, setQuery] = useState(''),
    [address, setAddress] = useState(''),
    [results, setResults] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const request = useRef(null)
  const lat = point?.[0],
    lng = point?.[1]
  useEffect(() => {
    setAddress('')
    if (lat == null || lng == null) return
    const ctl = new AbortController()
    const timer = setTimeout(
      () =>
        reverseGeocode([lat, lng], ctl.signal).then((label) => {
          if (!ctl.signal.aborted)
            setAddress(label || 'Address unavailable; verify the pin on the map.')
        }),
      1100,
    )
    return () => {
      clearTimeout(timer)
      ctl.abort()
    }
  }, [lat, lng])
  useEffect(() => () => request.current?.abort(), [])
  function choose(p) {
    if (!barangayForPoint(p[0], p[1])) {
      setError('Choose a location inside Cabuyao City.')
      return
    }
    setError('')
    setResults([])
    onPick(p)
  }
  async function search() {
    const p = parseCoordinates(query)
    if (p) return choose(p)
    if (query.trim().length < 3) return setError('Enter an address or latitude, longitude.')
    request.current?.abort()
    const ctl = new AbortController()
    request.current = ctl
    setBusy(true)
    setError('')
    setResults([])
    const rows = await searchNominatim(query, ctl.signal)
    if (ctl.signal.aborted) return
    setResults(rows)
    setBusy(false)
    if (!rows.length) setError('No address found. Try a nearby landmark or select the map.')
  }
  return (
    <div className="location-lookup">
      <label>
        Address or coordinates{' '}
        <span className="location-input-row">
          <input
            value={query}
            placeholder="Address or 14.2476, 121.1367"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                search()
              }
            }}
          />
          <button type="button" onClick={search} disabled={busy}>
            {busy ? 'Searching…' : 'Find'}
          </button>
        </span>
      </label>
      {results.map((r) => (
        <button
          type="button"
          className="location-result"
          key={r.id}
          onClick={() => choose([r.lat, r.lng])}
        >
          {r.label}
          <small>
            {r.sub} · {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
          </small>
        </button>
      ))}
      {point && (
        <div className="location-address">
          <b>
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </b>
          <span>{address || 'Looking up address…'}</span>
        </div>
      )}
      {error && (
        <div className="fr-error" role="status">
          {error}
        </div>
      )}
    </div>
  )
}
