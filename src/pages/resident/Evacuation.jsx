import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ResidentLayout from '../../components/resident/ResidentLayout.jsx'
import { EVAC_STATUSES } from '../../data/cabuyao.js'
import { residentBarangayLabel, getResidentBarangay } from '../../data/resident.js'
import { useEvacCenters } from '../../context/AdminDataContext.jsx'
import './Resident.css'

/**
 * CDRRMO Resident — Evacuation (find a shelter).
 *
 * A read-only directory of the city's evacuation centres so a resident can see
 * which are open, how full they are and where, then get a route. Centres are
 * the SAME ones barangay officials / CDRRMO register in the shared store —
 * residents only browse (city-wide, so a neighbouring open shelter is findable).
 */

const STATUS_LABEL = Object.fromEntries(EVAC_STATUSES.map((s) => [s.value, s.label]))

function occClass(occupancy, capacity, status) {
  if (status === 'full') return 'full'
  if (!capacity) return ''
  const pct = occupancy / capacity
  if (pct >= 1) return 'full'
  if (pct >= 0.8) return 'warn'
  return ''
}

export default function Evacuation() {
  const navigate = useNavigate()
  const brgyLabel = residentBarangayLabel()
  const myBrgy = getResidentBarangay()

  const { evacuationCenters: centers } = useEvacCenters()
  const [filter, setFilter] = useState('open')
  const [query, setQuery] = useState('')

  const FILTERS = [
    { key: 'open', label: 'Open Now' },
    { key: 'mine', label: `Brgy. ${brgyLabel}` },
    { key: 'all', label: 'All' },
  ]

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return centers
      .filter((c) => {
        if (filter === 'open' && c.status !== 'open') return false
        if (filter === 'mine' && c.barangay !== myBrgy) return false
        if (q && !(`${c.name} ${c.barangay}`.toLowerCase().includes(q))) return false
        return true
      })
      // Open centres first, then by how much room is left.
      .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1))
  }, [centers, filter, query, myBrgy])

  return (
    <ResidentLayout>
      <div className="res">
        <div className="res-head">
          <div className="res-head-icon">
            <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
          </div>
          <div>
            <div className="res-head-title">Evacuation Centres</div>
            <div className="res-head-sub">Find an open shelter near you and get a safe route</div>
          </div>
        </div>

        <div className="res-filter-bar">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`res-filter-tab ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <input
            type="search"
            placeholder="Search shelter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ marginLeft: 'auto', maxWidth: 220, padding: '7px 12px', border: '1px solid #e5e2dd', borderRadius: 8, fontSize: '0.8125rem' }}
          />
        </div>

        {visible.length === 0 ? (
          <div className="res-side-card">
            <div className="res-empty">
              <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
              <div className="res-empty-title">
                {centers.length === 0 ? 'No evacuation centres listed yet' : 'No centres match this filter'}
              </div>
              <div className="res-empty-sub">
                {centers.length === 0
                  ? 'Open shelters will appear here once CDRRMO and your barangay publish them.'
                  : 'Try the "All" tab or a different search.'}
              </div>
            </div>
          </div>
        ) : (
          <div className="res-shelter-grid">
            {visible.map((c) => {
              const capacity = Number(c.capacity || 0)
              const occupancy = Number(c.occupancy || 0)
              const pct = capacity ? Math.min(100, (occupancy / capacity) * 100) : 0
              return (
                <div className="res-shelter-card" key={c.id}>
                  <div className="res-shelter-head">
                    <div>
                      <div className="res-shelter-name">{c.name}</div>
                      <div className="res-shelter-brgy">Brgy. {c.barangay}</div>
                    </div>
                    <span className={`res-shelter-status ${c.status}`}>{STATUS_LABEL[c.status] || c.status}</span>
                  </div>
                  <div className="res-occ">
                    <div className="res-occ-track">
                      <div className={`res-occ-fill ${occClass(occupancy, capacity, c.status)}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="res-occ-txt">{occupancy.toLocaleString()}/{capacity.toLocaleString()}</span>
                  </div>
                  <div className="res-shelter-foot">
                    <span className="res-shelter-meta">{capacity ? `${Math.max(capacity - occupancy, 0).toLocaleString()} spaces left` : 'Capacity —'}</span>
                    <button type="button" className="res-dir-btn" onClick={() => navigate('/resident/evacuation-routing', { state: { destId: c.id } })}>
                      <svg viewBox="0 0 24 24"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>
                      Directions
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="res-note">
          <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
          <span>Shelter capacity and status are published by CDRRMO and your barangay, and update live from the database.</span>
        </div>
      </div>
    </ResidentLayout>
  )
}
