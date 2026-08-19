import { useMemo, useState } from 'react'
import { BARANGAYS, levelFromDepth } from '../../../data/cabuyao.js'
import { useBarangayAssignments } from '../../../context/AdminDataContext.jsx'
import { useFloodRisk, barangayRiskSamples } from '../floodRisk.js'
import { SettingsNote, TabHead } from '../SettingsKit.jsx'
import RecordList from '../RecordList.jsx'

/**
 * Settings → Barangays (was the Barangay page under Manage).
 *
 * Roster of Cabuyao's 18 barangays. The list itself is fixed reference data,
 * so the work here is assignment: naming each barangay's captain and
 * evacuation coordinator, recording a contact number and setting an
 * operational status — which is administration, not day-to-day monitoring,
 * so it belongs beside the other rosters in Settings. Assignments live in the
 * shared AdminDataContext store (persisted, visible system-wide). The
 * flood-status badge is derived live from the flood-risk field
 * (safeness = flood depth) and is read-only.
 *
 * First screen onto RecordList. It gained filter chips in the move — not a new
 * feature so much as the one it should always have had: every sibling roster
 * had them, this one just never did.
 */

const OPS_STATUSES = [
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'standby', label: 'On Standby' },
  { value: 'active', label: 'Active Response' },
]
const STATUS_LABEL = Object.fromEntries(OPS_STATUSES.map((s) => [s.value, s.label]))
const RISK_LABEL = { high: 'High', moderate: 'Moderate', low: 'Low', safe: 'Safe' }

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unassigned', label: 'Unassigned', test: (b) => !b.captain.trim() },
  { key: 'atrisk', label: 'At Risk', test: (b) => ['high', 'moderate'].includes(levelFromDepth(b.floodDepth)) },
  { key: 'active', label: 'Active Response', test: (b) => b.status === 'active' },
]

export default function BarangaysTab({ onToast }) {
  const { barangayAssignments, assignBarangay } = useBarangayAssignments()
  const { field } = useFloodRisk()
  const [editing, setEditing] = useState(null) // barangay name being assigned

  // Fixed roster × saved assignments × live flood depth from the risk field.
  const rows = useMemo(() => {
    const depthByName = new Map(barangayRiskSamples(field).map((s) => [s.name, s.floodDepth]))
    return BARANGAYS.map((name) => ({
      name,
      floodDepth: depthByName.get(name) ?? 0,
      captain: '', contact: '', coordinator: '', status: 'monitoring',
      ...(barangayAssignments[name] || {}),
    }))
  }, [barangayAssignments, field])

  const stats = useMemo(() => [
    { color: 'blue', value: rows.length, label: 'Barangays' },
    { color: 'green', value: rows.filter((b) => b.captain.trim()).length, label: 'Captain Assigned' },
    { color: 'amber', value: rows.filter((b) => !b.captain.trim()).length, label: 'Unassigned' },
    {
      color: 'red',
      value: rows.filter((b) => ['high', 'moderate'].includes(levelFromDepth(b.floodDepth))).length,
      label: 'At-Risk (Flood)',
    },
  ], [rows])

  const columns = useMemo(() => [
    { key: 'name', header: 'Barangay', className: 'mng-strong', render: (b) => b.name },
    {
      key: 'risk',
      header: 'Flood Status',
      render: (b) => {
        const risk = levelFromDepth(b.floodDepth)
        return <span className={`mng-badge ${risk}`}>{RISK_LABEL[risk]}</span>
      },
    },
    { key: 'captain', header: 'Captain', render: (b) => b.captain || <span className="mng-muted">— Unassigned</span> },
    { key: 'coordinator', header: 'Coordinator', render: (b) => b.coordinator || <span className="mng-muted">—</span> },
    { key: 'contact', header: 'Contact', className: 'mng-num', render: (b) => b.contact || <span className="mng-muted">—</span> },
    { key: 'status', header: 'Status', render: (b) => <span className={`mng-badge ${b.status}`}>{STATUS_LABEL[b.status]}</span> },
  ], [])

  const current = editing ? rows.find((b) => b.name === editing) : null

  function handleSave(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    assignBarangay(editing, {
      captain: f.get('captain').trim(),
      contact: f.get('contact').trim(),
      coordinator: f.get('coordinator').trim(),
      status: f.get('status'),
    })
    onToast(`${editing} assignment saved.`)
    setEditing(null)
  }

  return (
    <div className="set">
      <TabHead
        icon={(
          <svg viewBox="0 0 24 24">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        )}
        title="Barangays"
        sub="Assign captains, evacuation coordinators and contacts for all 18 barangays"
      />

      <RecordList
        rows={rows}
        rowKey={(b) => b.name}
        rowLabel={(b) => b.name}
        stats={stats}
        filters={FILTERS}
        searchKeys={(b) => `${b.name} ${b.captain} ${b.coordinator}`}
        searchPlaceholder="Search barangay, captain or coordinator…"
        columns={columns}
        onEdit={(b) => setEditing(b.name)}
        editLabel={(b) => (b.captain ? 'Edit' : 'Assign')}
        empty={{ title: 'No barangay matches this view', sub: 'Try a different filter or clear your search.' }}
      />

      <SettingsNote>
        Flood status follows the live depth from the hazard feed and cannot be edited here. Assignments are shared
        system-wide and persist across refreshes.
      </SettingsNote>

      {/* Assign / edit modal */}
      {current && (
        <div className="mng-overlay" onMouseDown={() => setEditing(null)}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label={`Assign ${current.name}`} onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">Assign · {current.name}</div>
                <div className="mng-modal-sub">Barangay officials and operational status</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setEditing(null)} aria-label="Close">×</button>
            </div>
            <form className="mng-form" onSubmit={handleSave}>
              <label>
                Barangay Captain
                <input name="captain" type="text" defaultValue={current.captain} placeholder="e.g. Hon. Juan Dela Cruz" />
              </label>
              <div className="mng-form-grid">
                <label>
                  Evacuation Coordinator
                  <input name="coordinator" type="text" defaultValue={current.coordinator} placeholder="e.g. Maria Santos" />
                </label>
                <label>
                  Contact Number
                  <input name="contact" type="tel" defaultValue={current.contact} placeholder="0917 000 0000" />
                </label>
              </div>
              <label>
                Operational Status
                <select name="status" defaultValue={current.status}>
                  {OPS_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit" className="mng-btn">Save Assignment</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
