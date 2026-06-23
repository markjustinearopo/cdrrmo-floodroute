import { useMemo, useState } from 'react'
import BarangayLayout from '../../components/barangay/BarangayLayout.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import { levelFromDepth, RISK_META } from '../../components/admin/mapHelpers.jsx'
import { useFloodRisk, barangayRiskSamples } from '../../components/admin/floodRisk.js'
import { officialBarangayLabel, getOfficialBarangay } from '../../data/barangay.js'
import { useBarangayAssignments, useAlerts, useEvacCenters } from '../../context/AdminDataContext.jsx'
import './Barangay.css'
import '../admin/Manage.css'

/**
 * CDRRMO Barangay — Barangay Operations (Manage).
 *
 * The single-barangay command hub: the barangay profile, its key officials and
 * emergency contacts, response-team / resource readiness, and a flood-status
 * summary for the jurisdiction. Profile + contacts + readiness live in the SAME
 * shared store the command center reads (under this barangay's assignment), so
 * the captain/coordinator/contact an official sets here appear on the admin
 * Barangay roster. The flood-status figures are read-only — they follow the
 * measured depth from the hazard feed, the system-wide source of truth.
 */

const PROFILE_FIELDS = [
  { key: 'captain', label: 'Barangay Captain', placeholder: 'e.g. Hon. Juan Dela Cruz' },
  { key: 'coordinator', label: 'BDRRMC Coordinator', placeholder: 'e.g. Maria Santos' },
  { key: 'population', label: 'Population', placeholder: 'e.g. 12,400', type: 'text' },
  { key: 'puroks', label: 'Puroks / Sitios', placeholder: 'e.g. 7', type: 'text' },
  { key: 'landArea', label: 'Land Area', placeholder: 'e.g. 3.2 km²', type: 'text' },
  { key: 'contact', label: 'Hotline / Contact', placeholder: '0917 000 0000', type: 'tel' },
]

// Standard BDRRMC readiness items (reference structure). Their state starts at
// "standby" (none ready) until the official marks them ready.
const READINESS_ITEMS = [
  { key: 'team-rescue', label: 'Rescue Team', sub: 'Trained personnel on call' },
  { key: 'team-medical', label: 'Medical / First Aid Unit', sub: 'Responders & supplies' },
  { key: 'team-volunteers', label: 'BDRRMC Volunteers', sub: 'Community responders' },
  { key: 'res-boat', label: 'Rescue Boat / Vehicle', sub: 'Transport for evacuation' },
  { key: 'res-power', label: 'Generator & Lights', sub: 'Backup power at the centre' },
  { key: 'res-relief', label: 'Relief Goods Stock', sub: 'Food & water packs' },
]

export default function Operations() {
  const brgyLabel = officialBarangayLabel()
  const myBrgy = getOfficialBarangay()

  const { barangayAssignments, assignBarangay } = useBarangayAssignments()
  const { alerts } = useAlerts()
  const { evacuationCenters } = useEvacCenters()
  const { field } = useFloodRisk()

  // The barangay's shared assignment record holds its profile, contacts and
  // readiness — the same record the admin Barangay roster reads.
  const record = useMemo(() => barangayAssignments[myBrgy] || {}, [barangayAssignments, myBrgy])
  const profile = record
  const contacts = record.contacts || []
  const readiness = record.readiness || {}

  // Read-only figures, scoped to this barangay, from the shared system.
  const floodDepth = useMemo(
    () => barangayRiskSamples(field).find((b) => b.name === myBrgy)?.floodDepth ?? 0,
    [field, myBrgy],
  )
  const activeAlerts = useMemo(
    () => alerts.filter((a) => a.barangay === myBrgy && a.status === 'active').length,
    [alerts, myBrgy],
  )
  const openShelters = useMemo(
    () => evacuationCenters.filter((c) => c.barangay === myBrgy && c.status === 'open').length,
    [evacuationCenters, myBrgy],
  )

  const [editingProfile, setEditingProfile] = useState(false)
  const [editingContact, setEditingContact] = useState(null) // contact, 'new', or null
  const [confirmDelContact, setConfirmDelContact] = useState(null) // contact pending removal
  const [toast, setToast] = useState('')

  const level = useMemo(() => levelFromDepth(floodDepth), [floodDepth])
  const readyCount = useMemo(() => READINESS_ITEMS.filter((i) => readiness[i.key]).length, [readiness])

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  function saveProfile(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const next = {}
    PROFILE_FIELDS.forEach(({ key }) => { next[key] = (f.get(key) || '').trim() })
    assignBarangay(myBrgy, next)
    setEditingProfile(false)
    flash('Barangay profile saved.')
  }

  const currentContact = editingContact && editingContact !== 'new' ? editingContact : null
  function saveContact(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const data = {
      name: (f.get('name') || '').trim(),
      role: (f.get('role') || '').trim(),
      contact: (f.get('contact') || '').trim(),
    }
    const next = currentContact
      ? contacts.map((c) => (c.id === currentContact.id ? { ...c, ...data } : c))
      : [{ id: `ct-${Date.now()}`, ...data }, ...contacts]
    assignBarangay(myBrgy, { contacts: next })
    flash(currentContact ? 'Contact updated.' : 'Contact added.')
    setEditingContact(null)
  }
  function removeContact(id) {
    assignBarangay(myBrgy, { contacts: contacts.filter((c) => c.id !== id) })
    flash('Contact removed.')
  }

  function toggleReady(key) {
    assignBarangay(myBrgy, { readiness: { ...readiness, [key]: !readiness[key] } })
  }

  function initials(name) {
    const parts = (name || '?').trim().split(/\s+/)
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
  }

  return (
    <BarangayLayout>
      <div className="bq">
        {/* Header */}
        <div className="mng-head">
          <div className="mng-head-titles">
            <div className="mng-head-icon">
              <svg viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div>
              <div className="mng-title">Barangay Operations</div>
              <div className="mng-sub">Command hub for Brgy. {brgyLabel} — profile, contacts &amp; response readiness</div>
            </div>
          </div>
        </div>

        {/* Profile + flood status */}
        <div className="bq-ops-grid">
          <div className="bq-panel">
            <div className="bq-panel-head">
              <div className="bq-panel-title"><IdIcon /> Barangay Profile</div>
              <button type="button" className="bq-mini-btn" onClick={() => setEditingProfile(true)}>
                <PenIcon /> Edit
              </button>
            </div>
            <div className="bq-kv-grid">
              {PROFILE_FIELDS.map(({ key, label }) => (
                <div className="bq-kv" key={key}>
                  <div className="bq-kv-label">{label}</div>
                  <div className={`bq-kv-val ${profile[key] ? '' : 'muted'}`}>
                    {profile[key] || 'Not set'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bq-panel">
            <div className="bq-panel-head">
              <div className="bq-panel-title"><WaveIcon /> Flood Status</div>
              <span className={`mng-badge ${level}`}>{RISK_META[level].label}</span>
            </div>
            <p className="bq-panel-sub">Follows the modeled flood depth from the hazard feed — read-only.</p>
            <div>
              <div className="bq-status-line">
                <span className="bq-status-key">Current Risk Level</span>
                <span className="bq-status-val">{RISK_META[level].label}</span>
              </div>
              <div className="bq-status-line">
                <span className="bq-status-key">Est. Flood Depth</span>
                <span className="bq-status-val">~{floodDepth.toFixed(2)} m</span>
              </div>
              <div className="bq-status-line">
                <span className="bq-status-key">Active Alerts</span>
                <span className="bq-status-val">{activeAlerts}</span>
              </div>
              <div className="bq-status-line">
                <span className="bq-status-key">Open Evacuation Shelters</span>
                <span className="bq-status-val">{openShelters}</span>
              </div>
              <div className="bq-status-line">
                <span className="bq-status-key">Response Readiness</span>
                <span className="bq-status-val">{readyCount}/{READINESS_ITEMS.length} ready</span>
              </div>
            </div>
          </div>
        </div>

        {/* Key officials & emergency contacts */}
        <div className="bq-panel">
          <div className="bq-panel-head">
            <div className="bq-panel-title"><PhoneIcon /> Key Officials &amp; Emergency Contacts</div>
            <button type="button" className="bq-mini-btn" onClick={() => setEditingContact('new')}>
              <PlusIcon /> Add Contact
            </button>
          </div>
          {contacts.length === 0 ? (
            <div className="bq-empty">
              <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.18 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 21.5 16z" /></svg>
              <div className="bq-empty-title">No contacts yet</div>
              <div className="bq-empty-sub">Add your captain, BDRRMC officers and emergency hotlines so they're one tap away.</div>
            </div>
          ) : (
            <div className="bq-contacts">
              {contacts.map((c) => (
                <div className="bq-contact-row" key={c.id}>
                  <div className="bq-contact-avatar">{initials(c.name)}</div>
                  <div className="bq-contact-main">
                    <div className="bq-contact-name">{c.name || 'Unnamed'}</div>
                    <div className="bq-contact-role">{c.role || '—'}</div>
                  </div>
                  <span className="bq-contact-num">{c.contact || '—'}</span>
                  <div className="bq-contact-actions">
                    <button type="button" className="bq-link" onClick={() => setEditingContact(c)}>Edit</button>
                    <button type="button" className="bq-icon-x" title="Remove" onClick={() => setConfirmDelContact(c)}>×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Response readiness */}
        <div className="bq-panel">
          <div className="bq-panel-head">
            <div className="bq-panel-title"><ShieldIcon /> Response Readiness</div>
            <span className="bq-ready-state ready" style={readyCount === 0 ? { background: '#f0eee9', color: '#6b7280' } : undefined}>
              {readyCount}/{READINESS_ITEMS.length} Ready
            </span>
          </div>
          <p className="bq-panel-sub">Mark each team and resource as ready when it's prepared and on standby for deployment.</p>
          <div>
            {READINESS_ITEMS.map((item) => {
              const ready = !!readiness[item.key]
              return (
                <div className="bq-ready-row" key={item.key}>
                  <div className="bq-ready-main">
                    <div className="bq-ready-label">{item.label}</div>
                    <div className="bq-ready-sub">{item.sub}</div>
                  </div>
                  <span className={`bq-ready-state ${ready ? 'ready' : ''}`}>{ready ? 'Ready' : 'Standby'}</span>
                  <label className="switch">
                    <input type="checkbox" checked={ready} onChange={() => toggleReady(item.key)} />
                    <span className="switch-slider" />
                  </label>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mng-note">
          <SparkIcon />
          <span>Profile, contacts and readiness are scoped to Brgy. {brgyLabel} and sync to the database once the backend is connected.</span>
        </div>
      </div>

      {/* Edit profile modal */}
      {editingProfile && (
        <div className="mng-overlay" onMouseDown={() => setEditingProfile(false)}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label="Edit barangay profile" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">Edit · Brgy. {brgyLabel} Profile</div>
                <div className="mng-modal-sub">Key facts for your barangay command hub</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setEditingProfile(false)} aria-label="Close">×</button>
            </div>
            <form className="mng-form" onSubmit={saveProfile}>
              <div className="mng-form-grid">
                {PROFILE_FIELDS.map(({ key, label, placeholder, type }) => (
                  <label key={key}>
                    {label}
                    <input name={key} type={type || 'text'} defaultValue={profile[key] || ''} placeholder={placeholder} />
                  </label>
                ))}
              </div>
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setEditingProfile(false)}>Cancel</button>
                <button type="submit" className="mng-btn">Save Profile</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / edit contact modal */}
      {editingContact && (
        <div className="mng-overlay" onMouseDown={() => setEditingContact(null)}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label={currentContact ? 'Edit contact' : 'Add contact'} onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">{currentContact ? 'Edit Contact' : 'Add Contact'}</div>
                <div className="mng-modal-sub">An official or emergency hotline for Brgy. {brgyLabel}</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setEditingContact(null)} aria-label="Close">×</button>
            </div>
            <form className="mng-form" onSubmit={saveContact}>
              <label>
                Name / Office
                <input name="name" type="text" defaultValue={currentContact?.name || ''} placeholder="e.g. Hon. Juan Dela Cruz" required />
              </label>
              <div className="mng-form-grid">
                <label>
                  Role / Designation
                  <input name="role" type="text" defaultValue={currentContact?.role || ''} placeholder="e.g. Barangay Captain" />
                </label>
                <label>
                  Contact Number
                  <input name="contact" type="tel" defaultValue={currentContact?.contact || ''} placeholder="0917 000 0000" />
                </label>
              </div>
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setEditingContact(null)}>Cancel</button>
                <button type="submit" className="mng-btn">{currentContact ? 'Save Changes' : 'Add Contact'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDelContact && (
        <ConfirmDialog
          title="Remove this contact?"
          confirmLabel="Remove contact"
          message={(
            <>Remove <b>{confirmDelContact.name || 'this contact'}</b>{confirmDelContact.role ? <> ({confirmDelContact.role})</> : null} from your emergency contacts? Residents rely on this list during an event.</>
          )}
          onConfirm={() => { removeContact(confirmDelContact.id); setConfirmDelContact(null) }}
          onCancel={() => setConfirmDelContact(null)}
        />
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </BarangayLayout>
  )
}

/* ── Icons ── */
function IdIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M15 8h3M15 12h3M7 16h10" />
    </svg>
  )
}
function WaveIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
    </svg>
  )
}
function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.18 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 21.5 16z" />
    </svg>
  )
}
function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}
function PenIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
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
