import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, CircleMarker, Tooltip } from 'react-leaflet'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock } from './mapHelpers.jsx'
import { useIncidents } from '../../context/AdminDataContext.jsx'
import { PRIORITIES, RESPONSE_TEAMS } from '../../data/cabuyao.js'
import './IncidentReportsPanel.css'

/**
 * Flood Map → Incident Reports tab.
 *
 * A focused operational view of the live incident queue (shared
 * AdminDataContext store): every incident with a mapped location is a
 * priority-coloured marker on the Cabuyao map, with a side detail card and a
 * scrollable, filterable table below. Selecting a marker highlights its table
 * row and vice-versa, and the quick actions (Start / Resolve / Reassign) write
 * straight back to the store so the change is reflected everywhere at once.
 */

const PRIORITY_COLOR = { critical: '#dc2626', high: '#f97316', medium: '#eab308', low: '#3b82f6' }
const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.value, p.label]))
const STATUS_LABEL = { new: 'New', assigned: 'Assigned', 'in-progress': 'In Progress', resolved: 'Resolved' }

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'critical', label: 'Critical' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'all', label: 'All' },
]

export default function IncidentReportsPanel() {
  const { incidents, updateIncident } = useIncidents()
  const [filter, setFilter] = useState('open')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return incidents.filter((i) => {
      if (filter === 'open' && i.status === 'resolved') return false
      if (filter === 'critical' && i.priority !== 'critical') return false
      if (filter === 'unassigned' && i.team) return false
      if (q && !(`${i.type} ${i.barangay} ${i.location} ${i.team}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [incidents, filter, query])

  // Markers only need a mapped location; the table can show all filtered rows.
  const mapped = useMemo(() => filtered.filter((i) => Array.isArray(i.coords)), [filtered])
  const selected = selectedId ? incidents.find((i) => i.id === selectedId) : null

  const counts = useMemo(() => ({
    open: incidents.filter((i) => i.status !== 'resolved').length,
    critical: incidents.filter((i) => i.priority === 'critical' && i.status !== 'resolved').length,
    unassigned: incidents.filter((i) => !i.team && i.status !== 'resolved').length,
  }), [incidents])

  return (
    <div className="incpanel">
      <div className="incpanel-mapwrap">
        <MapContainer
          center={CABUYAO_CENTER}
          zoom={CABUYAO_ZOOM}
          zoomControl={false}
          attributionControl={false}
          className="incpanel-map"
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.85} />
          <ZoomControl position="bottomright" />
          <CabuyaoLock />

          {mapped.map((inc) => {
            const color = PRIORITY_COLOR[inc.priority] || '#3b82f6'
            const isSel = inc.id === selectedId
            return (
              <CircleMarker
                key={inc.id}
                center={inc.coords}
                radius={inc.priority === 'critical' ? 11 : isSel ? 9 : 7}
                pathOptions={{
                  color: isSel ? '#0f172a' : color,
                  weight: isSel ? 3 : 2,
                  fillColor: color,
                  fillOpacity: inc.status === 'resolved' ? 0.25 : 0.7,
                }}
                eventHandlers={{ click: () => setSelectedId(inc.id) }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  <b>{inc.type}</b><br />
                  {inc.barangay} · {PRIORITY_LABEL[inc.priority]}
                </Tooltip>
              </CircleMarker>
            )
          })}
        </MapContainer>

        {/* Priority legend */}
        <div className="incpanel-legend">
          {PRIORITIES.map((p) => (
            <span key={p.value}><i style={{ background: PRIORITY_COLOR[p.value] }} />{p.label}</span>
          ))}
        </div>

        {/* Detail card */}
        {selected && (
          <div className="incpanel-detail">
            <button type="button" className="incpanel-detail-close" onClick={() => setSelectedId(null)} aria-label="Close">×</button>
            <div className="incpanel-detail-type">
              <span className="incpanel-pri-dot" style={{ background: PRIORITY_COLOR[selected.priority] }} />
              {selected.type}
            </div>
            <div className="incpanel-detail-loc">{selected.location || selected.barangay}</div>
            <dl className="incpanel-detail-grid">
              <div><dt>Barangay</dt><dd>{selected.barangay}</dd></div>
              <div><dt>Priority</dt><dd>{PRIORITY_LABEL[selected.priority]}</dd></div>
              <div><dt>Status</dt><dd>{STATUS_LABEL[selected.status]}</dd></div>
              <div><dt>Reported</dt><dd>{selected.reported}</dd></div>
            </dl>

            <label className="incpanel-reassign">
              Team
              <select
                value={selected.team || ''}
                onChange={(e) => {
                  const team = e.target.value
                  updateIncident(selected.id, {
                    team,
                    status: team && selected.status === 'new' ? 'assigned'
                      : !team && selected.status === 'assigned' ? 'new'
                      : selected.status,
                  })
                }}
                disabled={selected.status === 'resolved'}
              >
                <option value="">— Unassigned —</option>
                {RESPONSE_TEAMS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>

            <div className="incpanel-detail-actions">
              {selected.status === 'assigned' && (
                <button type="button" className="incpanel-btn" onClick={() => updateIncident(selected.id, { status: 'in-progress' })}>Start</button>
              )}
              {selected.status !== 'resolved' ? (
                <button type="button" className="incpanel-btn primary" onClick={() => updateIncident(selected.id, { status: 'resolved' })}>Resolve</button>
              ) : (
                <button type="button" className="incpanel-btn" onClick={() => updateIncident(selected.id, { status: selected.team ? 'assigned' : 'new' })}>Reopen</button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Table of incidents */}
      <div className="incpanel-list">
        <div className="incpanel-list-head">
          <div className="incpanel-list-title">
            Incident Queue
            <span className="incpanel-list-pill">{counts.open} open</span>
            {counts.critical > 0 && <span className="incpanel-list-pill crit">{counts.critical} critical</span>}
          </div>
          <input
            type="search"
            className="incpanel-search"
            placeholder="Search type, barangay, team…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="incpanel-filters">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={`incpanel-chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="incpanel-table-scroll">
          {filtered.length === 0 ? (
            <div className="incpanel-empty">
              No incidents match this view. Report incidents on the Incidents screen — they appear here as live markers.
            </div>
          ) : (
            <table className="incpanel-table">
              <tbody>
                {filtered.slice(0, 50).map((i) => (
                  <tr
                    key={i.id}
                    className={i.id === selectedId ? 'active' : ''}
                    onClick={() => setSelectedId(i.id)}
                  >
                    <td><span className="incpanel-row-dot" style={{ background: PRIORITY_COLOR[i.priority] }} /></td>
                    <td>
                      <div className="incpanel-row-type">{i.type}</div>
                      <div className="incpanel-row-loc">{i.barangay}{i.location ? ` · ${i.location}` : ''}</div>
                    </td>
                    <td className="incpanel-row-team">{i.team || <span className="incpanel-muted">Unassigned</span>}</td>
                    <td><span className={`incpanel-badge ${i.status}`}>{STATUS_LABEL[i.status]}</span></td>
                    <td className="incpanel-row-actions">
                      {i.status === 'assigned' && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); updateIncident(i.id, { status: 'in-progress' }) }}>Start</button>
                      )}
                      {i.status !== 'resolved' && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); updateIncident(i.id, { status: 'resolved' }) }}>Resolve</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
