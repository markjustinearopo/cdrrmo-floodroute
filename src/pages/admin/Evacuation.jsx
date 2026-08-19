import { useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import RecordList from '../../components/admin/RecordList.jsx'
import { BARANGAYS, EVAC_STATUSES } from '../../data/cabuyao.js'
import { useEvacCenters } from '../../context/AdminDataContext.jsx'
import EvacLocationPicker from '../../components/admin/EvacLocationPicker.jsx'
import './Manage.css'

/**
 * CDRRMO Admin — Evacuation.
 *
 * Directory of evacuation centres. Centres are known infrastructure, so the
 * table is seeded with a starter set; the assignment work is naming the
 * barangay each centre serves, recording a manager and contact, setting
 * capacity and updating live occupancy and open/full/closed status. Records
 * live in the shared AdminDataContext store, so the Flood Map markers and
 * the Auto Route destination list see every change instantly and the data
 * persists across refreshes.
 */

const STATUS_LABEL = Object.fromEntries(EVAC_STATUSES.map((s) => [s.value, s.label]))

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open', test: (c) => c.status === 'open' },
  { key: 'full', label: 'Full', test: (c) => c.status === 'full' },
  { key: 'closed', label: 'Closed', test: (c) => c.status === 'closed' },
]

function occClass(occupancy, capacity, status) {
  if (status === 'full') return 'full'
  if (!capacity) return ''
  const pct = occupancy / capacity
  if (pct >= 1) return 'full'
  if (pct >= 0.8) return 'warn'
  return ''
}

export default function Evacuation() {
  const { evacuationCenters: centers, addEvacCenter, updateEvacCenter, removeEvacCenter } = useEvacCenters()
  const [editing, setEditing] = useState(null) // center object, 'new', or null
  const [toast, setToast] = useState('')

  const stats = useMemo(() => [
    { color: 'blue', value: centers.length, label: 'Centres' },
    { color: 'green', value: centers.filter((c) => c.status === 'open').length, label: 'Open' },
    { color: 'slate', value: centers.reduce((s, c) => s + Number(c.capacity || 0), 0).toLocaleString(), label: 'Total Capacity' },
    { color: 'amber', value: centers.reduce((s, c) => s + Number(c.occupancy || 0), 0).toLocaleString(), label: 'Current Evacuees' },
  ], [centers])

  const columns = useMemo(() => [
    { key: 'name', header: 'Evacuation Centre', className: 'mng-strong', render: (c) => c.name },
    { key: 'barangay', header: 'Barangay (Location)', render: (c) => c.barangay },
    {
      key: 'occ',
      header: 'Occupancy',
      render: (c) => {
        const pct = c.capacity ? Math.min(100, (c.occupancy / c.capacity) * 100) : 0
        return (
          <div className="mng-occ">
            <div className="mng-occ-track">
              <div className={`mng-occ-fill ${occClass(c.occupancy, c.capacity, c.status)}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="mng-occ-txt">{c.occupancy.toLocaleString()}/{c.capacity.toLocaleString()}</span>
          </div>
        )
      },
    },
    { key: 'manager', header: 'Manager', render: (c) => c.manager || <span className="mng-muted">— Unassigned</span> },
    { key: 'status', header: 'Status', render: (c) => <span className={`mng-badge ${c.status}`}>{STATUS_LABEL[c.status]}</span> },
  ], [])

  const current = editing && editing !== 'new' ? editing : null

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  // RecordList owns the confirmation — this only runs after the user says yes.
  function remove(center) {
    removeEvacCenter(center.id)
    flash(`${center.name} removed.`)
  }

  return (
    <AdminLayout>
      <div className="mng">
        <div className="mng-head">
          <div className="mng-head-titles">
            <div className="mng-head-icon">
              <svg viewBox="0 0 24 24">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div>
              <div className="mng-title">Evacuation</div>
              <div className="mng-sub">Register city-wide evacuation centres — pin location, track capacity &amp; occupancy</div>
            </div>
          </div>
          <button type="button" className="mng-btn" onClick={() => setEditing('new')}>
            <PlusIcon /> Add Centre
          </button>
        </div>

        <RecordList
          rows={centers}
          rowLabel={(c) => c.name}
          stats={stats}
          filters={FILTERS}
          searchKeys={(c) => `${c.name} ${c.barangay} ${c.manager}`}
          searchPlaceholder="Search centre, barangay or manager…"
          columns={columns}
          onEdit={(c) => setEditing(c)}
          editLabel={() => 'Manage'}
          onDelete={remove}
          deleteLabel={() => 'Remove'}
          deleteConfirm={(c) => ({
            title: 'Remove this evacuation centre?',
            message: `Delete “${c.name}” (${c.barangay})? It will disappear from every map and from the Auto Route destination list. This cannot be undone.`,
            confirmLabel: 'Remove centre',
          })}
          emptyAll={{ title: 'No evacuation centres yet', sub: 'Use “Add Centre” to register an evacuation centre.' }}
          empty={{ title: 'No centres match this filter', sub: 'Try a different filter or clear your search.' }}
        />

        <div className="mng-note">
          <SparkIcon />
          <span>Centres are city-wide — any resident may shelter at any centre, regardless of barangay. They appear as markers on the Flood Map and as Auto Route destinations, and changes persist across refreshes.</span>
        </div>
      </div>

      {/* Add / manage modal — with a pin-the-location map */}
      {editing && (
        <EvacCentreModal
          center={current}
          addEvacCenter={addEvacCenter}
          updateEvacCenter={updateEvacCenter}
          onClose={() => setEditing(null)}
          onSaved={(name, isNew) => {
            setEditing(null)
            flash(isNew ? `${name} added — now visible on every map.` : `${name} updated.`)
          }}
        />
      )}


      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </AdminLayout>
  )
}

/* ============================================================
   Add / Manage Evacuation Centre — modal with a "drop the pin" map.

   The admin pins the centre's EXACT location on the map (centres are
   city-wide, so the map is locked to the whole city, not one barangay)
   and fills in the details. Saving goes through the shared store, so the
   centre appears instantly on the Flood Map and as an Auto Route
   destination for every portal.
   ============================================================ */
function EvacCentreModal({ center, addEvacCenter, updateEvacCenter, onClose, onSaved }) {
  const isNew = !center
  const [pin, setPin] = useState(Array.isArray(center?.coords) ? center.coords : null)
  const [status, setStatus] = useState(center?.status || 'open')

  function handleSave(e) {
    e.preventDefault()
    if (!pin) return // map location is required
    const f = new FormData(e.currentTarget)
    const data = {
      name: f.get('name').trim(),
      barangay: f.get('barangay'),
      capacity: Math.max(0, Number(f.get('capacity')) || 0),
      occupancy: Math.max(0, Number(f.get('occupancy')) || 0),
      status,
      manager: f.get('manager').trim(),
      contact: f.get('contact').trim(),
      coords: pin,
    }
    if (center) updateEvacCenter(center.id, data)
    else addEvacCenter(data)
    onSaved(data.name, isNew)
  }

  return (
    <div className="mng-overlay" onMouseDown={onClose}>
      <div
        className="mng-modal mng-modal--map"
        role="dialog"
        aria-modal="true"
        aria-label={center ? 'Manage centre' : 'Add centre'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mng-modal-head">
          <div>
            <div className="mng-modal-title">{center ? `Manage · ${center.name}` : 'Add Evacuation Centre'}</div>
            <div className="mng-modal-sub">Click the map to pin its exact location · city-wide centre</div>
          </div>
          <button type="button" className="mng-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="mng-modal-body">
          {/* Pin-the-location map (shared picker) */}
          <div className="mng-modal-mapcol">
            <EvacLocationPicker value={pin} onChange={setPin} status={status} />
          </div>

          {/* Centre details */}
          <form className="mng-form" onSubmit={handleSave}>
            <label>
              Centre Name
              <input name="name" type="text" defaultValue={center?.name || ''} placeholder="e.g. Cabuyao Central School" required />
            </label>
            <label>
              Barangay (Location)
              <select name="barangay" required defaultValue={center?.barangay || ''}>
                <option value="" disabled>Select Barangay</option>
                {BARANGAYS.map((b) => <option key={b}>{b}</option>)}
              </select>
            </label>
            <div className="mng-form-grid">
              <label>
                Capacity
                <input name="capacity" type="number" min="0" step="10" defaultValue={center?.capacity ?? 0} required />
              </label>
              <label>
                Current Occupancy
                <input name="occupancy" type="number" min="0" step="1" defaultValue={center?.occupancy ?? 0} required />
              </label>
            </div>
            <div className="mng-form-grid">
              <label>
                Centre Manager
                <input name="manager" type="text" defaultValue={center?.manager || ''} placeholder="e.g. Maria Santos" />
              </label>
              <label>
                Contact Number
                <input name="contact" type="tel" defaultValue={center?.contact || ''} placeholder="0917 000 0000" />
              </label>
            </div>
            <label>
              Status
              <select name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {EVAC_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>

            <div className={`mng-pinned ${pin ? 'set' : ''}`}>
              {pin
                ? `Location pinned at ${pin[0].toFixed(5)}, ${pin[1].toFixed(5)}`
                : 'Pin the location on the map to enable saving.'}
            </div>

            <div className="mng-form-actions">
              <button type="button" className="mng-btn mng-btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="mng-btn" disabled={!pin}>{center ? 'Save Changes' : 'Add Centre'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
  )
}
function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
  )
}
