import { useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import {
  ROLES, PERMISSION_MODULES, PERMISSION_ACTIONS, DEFAULT_ROLE_PERMS, SAMPLE_USERS, buildPerms,
} from '../../data/settings.js'
import './Manage.css'
import './Settings.css'

/**
 * CDRRMO Admin — Permissions & Roles (Settings).
 *
 * Pick a role on the left, then grant it access per module on the right. Each
 * module has three escalating levels — View, Create/Edit and Delete/Manage —
 * and the matrix keeps them coherent (turning off View clears the rest;
 * enabling a higher level implies View). The built-in Administrator always has
 * full access and is locked. Custom roles can be added from a base template.
 *
 * Permission maps are held in component state and acknowledged with a toast;
 * they persist to the backend (PUT /roles) once it is connected.
 */

function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

export default function Roles() {
  const [roles, setRoles] = useState(ROLES)
  const [perms, setPerms] = useState(() => clone(DEFAULT_ROLE_PERMS))
  const [selected, setSelected] = useState('admin')
  const [dirty, setDirty] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState('')

  // Seed-derived account counts per role (live counts arrive with the API).
  const counts = useMemo(() => {
    const c = {}
    for (const u of SAMPLE_USERS) c[u.role] = (c[u.role] || 0) + 1
    return c
  }, [])

  const role = roles.find((r) => r.value === selected)
  const locked = selected === 'admin'

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  function toggle(modKey, action, value) {
    setPerms((prev) => {
      const cur = { ...prev[selected][modKey] }
      cur[action] = value
      // Keep levels coherent: View is the floor for the others.
      if (action === 'view' && !value) { cur.edit = false; cur.manage = false }
      if ((action === 'edit' || action === 'manage') && value) cur.view = true
      return { ...prev, [selected]: { ...prev[selected], [modKey]: cur } }
    })
    setDirty(true)
  }

  function handleSave() {
    setDirty(false)
    flash(`Permissions for ${role.label} saved.`)
  }
  function handleResetRole() {
    if (DEFAULT_ROLE_PERMS[selected]) {
      setPerms((prev) => ({ ...prev, [selected]: clone(DEFAULT_ROLE_PERMS[selected]) }))
      setDirty(true)
      flash(`${role.label} reset to its default access.`)
    }
  }

  function handleAddRole(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const label = f.get('label').trim()
    const base = f.get('base')
    const value = `role-${Date.now()}`
    setRoles((prev) => [...prev, { value, label, desc: f.get('desc').trim(), system: false }])
    setPerms((prev) => ({ ...prev, [value]: clone(prev[base] || buildPerms()) }))
    setSelected(value)
    setShowModal(false)
    flash(`Role “${label}” created.`)
  }

  function deleteRole() {
    const removed = role
    setRoles((prev) => prev.filter((r) => r.value !== selected))
    setPerms((prev) => {
      const next = { ...prev }
      delete next[selected]
      return next
    })
    setSelected('admin')
    flash(`Role “${removed.label}” deleted.`)
  }

  return (
    <AdminLayout>
      <div className="set">
        <div className="mng-head">
          <div className="mng-head-titles">
            <div className="mng-head-icon">
              <svg viewBox="0 0 24 24">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <div>
              <div className="mng-title">Permissions &amp; Roles</div>
              <div className="mng-sub">Define what each role can see and do</div>
            </div>
          </div>
          <button type="button" className="mng-btn" onClick={() => setShowModal(true)}>
            <PlusIcon /> Add Role
          </button>
        </div>

        <div className="set-roles">
          {/* Matrix (left) */}
          <section className="set-panel">
            <div className="set-panel-head">
              <div className="set-panel-icon">
                <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
              </div>
              <div>
                <div className="set-panel-title">{role?.label} — Access</div>
                <div className="set-panel-sub">
                  {locked ? 'Full access to every module (built-in, locked)' : 'Toggle access per module'}
                </div>
              </div>
              <div className="set-panel-head-actions">
                {!role?.system && (
                  <button type="button" className="mng-link subtle" onClick={deleteRole}>Delete role</button>
                )}
                {!locked && DEFAULT_ROLE_PERMS[selected] && (
                  <button type="button" className="mng-link subtle" onClick={handleResetRole}>Reset</button>
                )}
              </div>
            </div>

            <div className="mng-card" style={{ border: 'none', borderRadius: 0 }}>
              <table className="mng-table set-matrix">
                <thead>
                  <tr>
                    <th>Module</th>
                    {PERMISSION_ACTIONS.map((a) => (
                      <th key={a.key} className="set-matrix-act">{a.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSION_MODULES.map((m) => {
                    const p = perms[selected]?.[m.key] || { view: false, edit: false, manage: false }
                    return (
                      <tr key={m.key}>
                        <td className="set-matrix-mod">{m.label}</td>
                        {PERMISSION_ACTIONS.map((a) => (
                          <td key={a.key} className="set-matrix-act">
                            <label className="switch">
                              <input
                                type="checkbox"
                                checked={locked ? true : p[a.key]}
                                disabled={locked}
                                onChange={(e) => toggle(m.key, a.key, e.target.checked)}
                              />
                              <span className="switch-slider" />
                            </label>
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {!locked && (
              <div className="set-panel-body" style={{ paddingTop: 14 }}>
                <div className="set-savebar" style={{ border: 'none', padding: 0 }}>
                  <div className="set-savebar-note">
                    <SparkIcon />
                    <span>{dirty ? 'Unsaved changes for this role.' : 'No pending changes.'}</span>
                  </div>
                  <div className="set-savebar-actions">
                    <button type="button" className="mng-btn" onClick={handleSave} disabled={!dirty}>Save Permissions</button>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Role rail (right) */}
          <div className="set-role-list">
            {roles.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`set-role ${selected === r.value ? 'active' : ''}`}
                onClick={() => setSelected(r.value)}
              >
                <div className="set-role-top">
                  <span className="set-role-name">{r.label}</span>
                  <span className="set-role-count">{counts[r.value] || 0} user{(counts[r.value] || 0) === 1 ? '' : 's'}</span>
                </div>
                <span className="set-role-desc">{r.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mng-note">
          <SparkIcon />
          <span>The Administrator role is locked to full access so the system can always be managed. Changes are kept for this session until the roles API is connected.</span>
        </div>
      </div>

      {/* Add role modal */}
      {showModal && (
        <div className="mng-overlay" onMouseDown={() => setShowModal(false)}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label="Add role" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">Add Role</div>
                <div className="mng-modal-sub">Create a custom role from an existing template</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setShowModal(false)} aria-label="Close">×</button>
            </div>
            <form className="mng-form" onSubmit={handleAddRole}>
              <label>
                Role Name
                <input name="label" type="text" placeholder="e.g. Field Coordinator" required />
              </label>
              <label>
                Description
                <textarea name="desc" rows={2} placeholder="What this role is for and who gets it." required />
              </label>
              <label>
                Copy Permissions From
                <select name="base" defaultValue="viewer">
                  {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="mng-btn">Create Role</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </AdminLayout>
  )
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
}
function SparkIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
}
