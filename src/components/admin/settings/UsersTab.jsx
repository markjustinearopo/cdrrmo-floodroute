import { useEffect, useMemo, useState } from 'react'
import ConfirmDialog from '../../ConfirmDialog.jsx'
import { BARANGAYS } from '../../../data/cabuyao.js'
import {
  ROLES, ROLE_LABEL, USER_STATUSES, USER_STATUS_LABEL,
  PERMISSION_MODULES, PERMISSION_ACTIONS, DEFAULT_ROLE_PERMS, buildPerms,
} from '../../../data/settings.js'
import { useUsers } from '../../../context/AdminDataContext.jsx'
import db from '../../../services/db.js'
import { SaveBar, SettingsNote, TabHead } from '../SettingsKit.jsx'

/**
 * Settings → Users & Access (was User Management + Permissions & Roles).
 *
 * Two halves of one question, finally on one screen:
 *   1. Accounts — who has a login, what account type they hold, which
 *      barangay they are scoped to and whether the account is live.
 *   2. Account types — what each type is actually allowed to do, per module.
 *
 * The split between them is real, not cosmetic, and is called out in the UI:
 * an account's TYPE is a field on the account row (Supabase `accounts.role`,
 * catalog in `data/settings.js`), while what that type CAN DO is a permission
 * blob in `app_settings.role_permissions` cached in localStorage. Editing the
 * matrix changes every account of that type at once; it never touches the
 * accounts themselves.
 */

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'admin', label: 'Administrators' },
  { key: 'operator', label: 'Operators' },
  { key: 'officer', label: 'Barangay Officers' },
  { key: 'pending', label: 'Pending' },
  { key: 'suspended', label: 'Suspended' },
]

function initials(name) {
  const parts = name.replace(/[^a-zA-Z ]/g, ' ').trim().split(/\s+/)
  if (!parts[0]) return '?'
  return ((parts[0][0] || '') + (parts[1]?.[0] || '')).toUpperCase()
}

/* ── CSV bulk import ──────────────────────────────────────────────────────
   Expected columns: Full Name, Email, Role, Barangay Scope, Status.
   A header row is detected and skipped; role/status accept either the
   stored value ("officer") or the display label ("Barangay Officer"). */
function parseCsv(text) {
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim())) rows.push(row)
  return rows
}

const ROLE_BY_TEXT = Object.fromEntries(
  ROLES.flatMap((r) => [[r.value, r.value], [r.label.toLowerCase(), r.value]]),
)
const STATUS_BY_TEXT = Object.fromEntries(
  USER_STATUSES.flatMap((s) => [[s.value, s.value], [s.label.toLowerCase(), s.value]]),
)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateCsvRows(rows, existingEmails) {
  const valid = []
  const errors = []
  const seen = new Set()
  let start = 0
  // Header row: first cell reads like a column name, not a person.
  if (rows.length && /name/i.test(rows[0][0] || '')) start = 1
  for (let r = start; r < rows.length; r++) {
    const line = r + 1
    const [name = '', email = '', role = '', barangay = '', status = ''] = rows[r].map((c) => c.trim())
    if (!name) { errors.push(`Row ${line}: missing full name`); continue }
    if (!EMAIL_RE.test(email)) { errors.push(`Row ${line}: invalid email "${email}"`); continue }
    const emailKey = email.toLowerCase()
    if (existingEmails.has(emailKey)) { errors.push(`Row ${line}: ${email} already has an account`); continue }
    if (seen.has(emailKey)) { errors.push(`Row ${line}: duplicate email ${email} in file`); continue }
    const roleVal = ROLE_BY_TEXT[role.toLowerCase()] || (role ? null : 'viewer')
    if (!roleVal) { errors.push(`Row ${line}: unknown role "${role}"`); continue }
    const statusVal = STATUS_BY_TEXT[status.toLowerCase()] || (status ? null : 'pending')
    if (!statusVal) { errors.push(`Row ${line}: unknown status "${status}"`); continue }
    const brgy = barangay && barangay.toLowerCase() !== 'all'
      ? BARANGAYS.find((b) => b.toLowerCase() === barangay.toLowerCase())
      : 'All'
    if (!brgy) { errors.push(`Row ${line}: unknown barangay "${barangay}"`); continue }
    seen.add(emailKey)
    valid.push({ name, email, role: roleVal, barangay: brgy, status: statusVal })
  }
  return { valid, errors }
}

/* ── Permission matrix storage ──────────────────────────────────────────── */
function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

const ROLES_KEY = 'cdrrmo_roles'        // localStorage cache (instant render)
const ROLES_DBKEY = 'role_permissions'  // shared app_settings row ({roles, perms} blob)

function loadRolesState() {
  try {
    const saved = JSON.parse(localStorage.getItem(ROLES_KEY))
    if (saved?.roles && saved?.perms) return saved
  } catch { /* fall through to defaults */ }
  return { roles: ROLES, perms: clone(DEFAULT_ROLE_PERMS) }
}

export default function UsersTab({ onToast }) {
  const { users, addUser, addUsers, updateUser, removeUser } = useUsers()

  /* ── Accounts ── */
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null) // user object, {} for new, or null
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState(null) // { valid, errors, fileName }
  const [confirmDelete, setConfirmDelete] = useState(null) // account pending deletion

  /* ── Account types / permissions ── */
  const initial = loadRolesState()
  const [roles, setRoles] = useState(initial.roles)
  const [perms, setPerms] = useState(initial.perms)
  const [selected, setSelected] = useState('admin')
  const [permsDirty, setPermsDirty] = useState(false)
  const [showRoleModal, setShowRoleModal] = useState(false)
  const [confirmRoleDelete, setConfirmRoleDelete] = useState(false)

  // Pull the shared role/permission matrix from Supabase once on mount
  // (the localStorage cache renders first). Stored as a config blob in
  // app_settings, distinct from the accounts-role catalog in the roles table.
  useEffect(() => {
    let alive = true
    db.appSettings.get(ROLES_DBKEY).then((remote) => {
      if (alive && remote?.roles && remote?.perms) {
        setRoles(remote.roles)
        setPerms(remote.perms)
        localStorage.setItem(ROLES_KEY, JSON.stringify(remote))
      }
    }).catch((e) => console.error('[Users] role permissions load failed', e))
    return () => { alive = false }
  }, [])

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.status === 'active').length,
    pending: users.filter((u) => u.status === 'pending').length,
    suspended: users.filter((u) => u.status === 'suspended').length,
  }), [users])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users.filter((u) => {
      if (['admin', 'operator', 'officer'].includes(filter) && u.role !== filter) return false
      if (['pending', 'suspended'].includes(filter) && u.status !== filter) return false
      if (q && !(`${u.name} ${u.email} ${u.barangay}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [users, filter, query])

  // Live account counts per account type from the shared users store.
  const counts = useMemo(() => {
    const c = {}
    for (const u of users) c[u.role] = (c[u.role] || 0) + 1
    return c
  }, [users])

  const role = roles.find((r) => r.value === selected)
  const locked = selected === 'admin'

  function handleSave(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const data = {
      name: f.get('name').trim(),
      email: f.get('email').trim(),
      role: f.get('role'),
      barangay: f.get('barangay'),
      status: f.get('status'),
    }
    if (editing.id) {
      updateUser(editing.id, data)
      onToast(`${data.name} updated.`)
    } else {
      addUser(data)
      onToast(`${data.name} added.`)
    }
    setEditing(null)
  }

  function toggleStatus(id) {
    const u = users.find((x) => x.id === id)
    if (!u) return
    const status = u.status === 'suspended' ? 'active' : 'suspended'
    updateUser(id, { status })
    onToast(status === 'suspended' ? `${u.name} suspended.` : `${u.name} reactivated.`)
  }
  function remove(user) {
    removeUser(user.id)
    setConfirmDelete(null)
    onToast(`${user.name || 'Account'} removed.`)
  }

  /* ── Bulk import ── */
  function handleImportFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const existing = new Set(users.map((u) => u.email.toLowerCase()))
      const { valid, errors } = validateCsvRows(parseCsv(String(reader.result)), existing)
      setImportPreview({ valid, errors, fileName: file.name })
    }
    reader.onerror = () => onToast('Could not read that file.')
    reader.readAsText(file)
    e.target.value = '' // same file can be re-picked after fixing it
  }

  function commitImport() {
    if (!importPreview?.valid.length) return
    addUsers(importPreview.valid)
    onToast(`${importPreview.valid.length} account${importPreview.valid.length === 1 ? '' : 's'} imported.`)
    setImporting(false)
    setImportPreview(null)
  }

  function closeImport() {
    setImporting(false)
    setImportPreview(null)
  }

  /* ── Permission matrix ── */
  // Persist account types + permission maps together: local cache + app_settings.
  function persistPerms(nextRoles, nextPerms) {
    const blob = { roles: nextRoles, perms: nextPerms }
    localStorage.setItem(ROLES_KEY, JSON.stringify(blob))
    db.appSettings.set(ROLES_DBKEY, blob).catch((e) => console.error('[Users] role permissions save failed', e))
  }

  function togglePerm(modKey, action, value) {
    setPerms((prev) => {
      const cur = { ...prev[selected][modKey] }
      cur[action] = value
      // Keep levels coherent: View is the floor for the others.
      if (action === 'view' && !value) { cur.edit = false; cur.manage = false }
      if ((action === 'edit' || action === 'manage') && value) cur.view = true
      return { ...prev, [selected]: { ...prev[selected], [modKey]: cur } }
    })
    setPermsDirty(true)
  }

  function handleSavePerms() {
    persistPerms(roles, perms)
    setPermsDirty(false)
    onToast(`Permissions for ${role.label} saved.`)
  }
  function handleResetRole() {
    if (DEFAULT_ROLE_PERMS[selected]) {
      setPerms((prev) => ({ ...prev, [selected]: clone(DEFAULT_ROLE_PERMS[selected]) }))
      setPermsDirty(true)
      onToast(`${role.label} reset to its default access.`)
    }
  }

  function handleAddRole(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const label = f.get('label').trim()
    const base = f.get('base')
    const value = `role-${Date.now()}`
    const nextRoles = [...roles, { value, label, desc: f.get('desc').trim(), system: false }]
    const nextPerms = { ...perms, [value]: clone(perms[base] || buildPerms()) }
    setRoles(nextRoles)
    setPerms(nextPerms)
    persistPerms(nextRoles, nextPerms)
    setSelected(value)
    setShowRoleModal(false)
    onToast(`Account type “${label}” created.`)
  }

  function deleteRole() {
    const removed = role
    const nextRoles = roles.filter((r) => r.value !== selected)
    const nextPerms = { ...perms }
    delete nextPerms[selected]
    setRoles(nextRoles)
    setPerms(nextPerms)
    persistPerms(nextRoles, nextPerms)
    setSelected('admin')
    setConfirmRoleDelete(false)
    onToast(`Account type “${removed.label}” deleted.`)
  }

  const onlyOneAdmin = users.filter((x) => x.role === 'admin').length === 1

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
        title="Users &amp; Access"
        sub="System accounts, the account types they hold, and what each type can do"
        actions={(
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setImporting(true)}>
              <UploadIcon /> Bulk Import
            </button>
            <button type="button" className="mng-btn" onClick={() => setEditing({})}>
              <PlusIcon /> Add User
            </button>
          </div>
        )}
      />

      <div className="mng-stats">
        <Stat color="blue" value={stats.total} label="Total Accounts" />
        <Stat color="green" value={stats.active} label="Active" />
        <Stat color="amber" value={stats.pending} label="Pending" />
        <Stat color="red" value={stats.suspended} label="Suspended" />
      </div>

      {/* ══ 1. Accounts ══ */}
      <div className="set-subhead">Accounts — who can sign in</div>

      <div className="mng-toolbar">
        <div className="mng-search">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search by name, email or barangay…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="mng-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`mng-chip ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mng-card">
        <table className="mng-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Account Type</th>
              <th>Barangay Scope</th>
              <th>Status</th>
              <th>Last Active</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="mng-empty">
                  <span className="mng-empty-strong">No accounts match this view</span>
                  Try a different filter or clear your search.
                </td>
              </tr>
            ) : (
              visible.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="set-user">
                      <div className={`set-user-av ${u.role === 'admin' ? 'admin' : ''}`}>
                        {u.avatar
                          ? <img src={u.avatar} alt={u.name} className="set-user-av-img" />
                          : initials(u.name)}
                      </div>
                      <div>
                        <div className="set-user-name">{u.name}</div>
                        <div className="set-user-email">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`mng-badge role-${u.role} set-type-link`}
                      title={`See what ${ROLE_LABEL[u.role] || u.role} accounts can do`}
                      onClick={() => setSelected(u.role)}
                    >
                      {ROLE_LABEL[u.role] || u.role}
                    </button>
                  </td>
                  <td>{u.barangay === 'All'
                    ? <span className="mng-muted">All barangays</span>
                    : u.barangay}</td>
                  <td><span className={`mng-badge ${u.status}`}>{USER_STATUS_LABEL[u.status]}</span></td>
                  <td className="mng-muted mng-num" style={{ fontSize: '0.75rem' }}>{u.lastActive}</td>
                  <td>
                    <div className="mng-row-actions">
                      <button type="button" className="mng-link" onClick={() => setEditing(u)}>Edit</button>
                      <button type="button" className="mng-link subtle" onClick={() => toggleStatus(u.id)}>
                        {u.status === 'suspended' ? 'Activate' : 'Suspend'}
                      </button>
                      <button
                        type="button"
                        className="mng-link subtle"
                        onClick={() => setConfirmDelete(u)}
                        disabled={u.role === 'admin' && onlyOneAdmin}
                        title={onlyOneAdmin && u.role === 'admin' ? 'Cannot remove the last administrator' : undefined}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ══ 2. Account types & their permissions ══ */}
      <div className="set-divider" />
      <div className="set-subhead set-subhead--split">
        <span>Account types — what each type can do</span>
        <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setShowRoleModal(true)}>
          <PlusIcon /> Add Account Type
        </button>
      </div>
      <div className="set-field-hint" style={{ marginBottom: 12 }}>
        An account’s <b>type</b> is a field on the account above. What that type is <b>allowed to do</b> lives here and
        applies to every account holding it — editing the matrix changes them all at once and never edits an account.
      </div>

      <div className="set-roles">
        {/* Matrix (left) */}
        <section className="set-panel">
          <div className="set-panel-head">
            <div className="set-panel-icon">
              <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
            </div>
            <div>
              {/* Neutral phrasing: type names are operator-authored, so "a/an" can't be inferred. */}
              <div className="set-panel-title">{role?.label} — what this type can do</div>
              <div className="set-panel-sub">
                {locked ? 'Full access to every module (built-in, locked)' : 'Toggle access per module'}
              </div>
            </div>
            <div className="set-panel-head-actions">
              {!role?.system && (
                <button type="button" className="mng-link subtle" onClick={() => setConfirmRoleDelete(true)}>Delete type</button>
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
                              onChange={(e) => togglePerm(m.key, a.key, e.target.checked)}
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
              <SaveBar
                dirty={permsDirty}
                flush
                dirtyText="Unsaved changes for this account type."
                cleanText="No pending changes."
              >
                <button type="button" className="mng-btn" onClick={handleSavePerms} disabled={!permsDirty}>
                  Save Permissions
                </button>
              </SaveBar>
            </div>
          )}
        </section>

        {/* Account-type rail (right) */}
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
                <span className="set-role-count">{counts[r.value] || 0} account{(counts[r.value] || 0) === 1 ? '' : 's'}</span>
              </div>
              <span className="set-role-desc">{r.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <SettingsNote>
        Accounts persist across refreshes and are shared system-wide; use Bulk Import to bring in a whole roster from
        CSV. The Administrator type is locked to full access so the system can always be managed, and permission
        changes persist to the shared backend and apply on every device.
      </SettingsNote>

      {/* Bulk import modal */}
      {importing && (
        <div className="mng-overlay" onMouseDown={closeImport}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label="Bulk import users" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">Bulk Import Users</div>
                <div className="mng-modal-sub">CSV columns: Full Name, Email, Role, Barangay Scope, Status</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={closeImport} aria-label="Close">×</button>
            </div>
            <div className="mng-form">
              <label>
                CSV File
                <input type="file" accept=".csv,text/csv" onChange={handleImportFile} />
              </label>
              {importPreview && (
                <>
                  <div className="mng-detail-notes">
                    <b>{importPreview.fileName}</b> — {importPreview.valid.length} account{importPreview.valid.length === 1 ? '' : 's'} ready to import
                    {importPreview.errors.length > 0 && `, ${importPreview.errors.length} row${importPreview.errors.length === 1 ? '' : 's'} skipped`}.
                  </div>
                  {importPreview.valid.length > 0 && (
                    <ul className="mng-import-list">
                      {importPreview.valid.slice(0, 8).map((u) => (
                        <li key={u.email}>
                          <span className="mng-strong">{u.name}</span> · {u.email} · {ROLE_LABEL[u.role]} · {u.barangay}
                        </li>
                      ))}
                      {importPreview.valid.length > 8 && (
                        <li className="mng-muted">…and {importPreview.valid.length - 8} more</li>
                      )}
                    </ul>
                  )}
                  {importPreview.errors.length > 0 && (
                    <ul className="mng-import-list errors">
                      {importPreview.errors.slice(0, 6).map((err) => <li key={err}>{err}</li>)}
                      {importPreview.errors.length > 6 && (
                        <li>…and {importPreview.errors.length - 6} more</li>
                      )}
                    </ul>
                  )}
                </>
              )}
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={closeImport}>Cancel</button>
                <button
                  type="button"
                  className="mng-btn"
                  disabled={!importPreview?.valid.length}
                  onClick={commitImport}
                >
                  Import {importPreview?.valid.length || ''} Account{importPreview?.valid.length === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / edit account modal */}
      {editing && (
        <div className="mng-overlay" onMouseDown={() => setEditing(null)}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label={editing.id ? 'Edit account' : 'Add account'} onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">{editing.id ? 'Edit Account' : 'Add User'}</div>
                <div className="mng-modal-sub">{editing.id ? 'Update this account’s type and access' : 'Create a new system account'}</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setEditing(null)} aria-label="Close">×</button>
            </div>
            <form className="mng-form" onSubmit={handleSave}>
              <div className="mng-form-grid">
                <label>
                  Full Name
                  <input name="name" type="text" defaultValue={editing.name || ''} placeholder="e.g. Maria Santos" required />
                </label>
                <label>
                  Email Address
                  <input name="email" type="email" defaultValue={editing.email || ''} placeholder="name@cabuyao.gov.ph" required />
                </label>
              </div>
              <div className="mng-form-grid">
                <label>
                  Account Type
                  <select name="role" defaultValue={editing.role || 'viewer'} required>
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </label>
                <label>
                  Barangay Scope
                  <select name="barangay" defaultValue={editing.barangay || 'All'}>
                    <option value="All">All barangays</option>
                    {BARANGAYS.map((b) => <option key={b}>{b}</option>)}
                  </select>
                </label>
              </div>
              <label>
                Account Status
                <select name="status" defaultValue={editing.status || 'pending'}>
                  {USER_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit" className="mng-btn">{editing.id ? 'Save Changes' : 'Add User'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add account-type modal */}
      {showRoleModal && (
        <div className="mng-overlay" onMouseDown={() => setShowRoleModal(false)}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label="Add account type" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">Add Account Type</div>
                <div className="mng-modal-sub">Create a custom type from an existing template</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setShowRoleModal(false)} aria-label="Close">×</button>
            </div>
            <form className="mng-form" onSubmit={handleAddRole}>
              <label>
                Type Name
                <input name="label" type="text" placeholder="e.g. Field Coordinator" required />
              </label>
              <label>
                Description
                <textarea name="desc" rows={2} placeholder="What this type is for and who gets it." required />
              </label>
              <label>
                Copy Permissions From
                <select name="base" defaultValue="viewer">
                  {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setShowRoleModal(false)}>Cancel</button>
                <button type="submit" className="mng-btn">Create Type</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this account?"
          message={`Delete “${confirmDelete.name}” (${confirmDelete.email})? They lose access immediately and the account cannot be recovered. Suspend instead if this is temporary.`}
          confirmLabel="Delete account"
          tone="danger"
          onConfirm={() => remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmRoleDelete && role && (
        <ConfirmDialog
          title={`Delete the “${role.label}” account type?`}
          message={
            (counts[selected] || 0) > 0
              ? `${counts[selected]} account${counts[selected] === 1 ? '' : 's'} currently use this type. Deleting it removes the type and its permission map — reassign those accounts afterwards. This cannot be undone.`
              : 'This removes the account type and its permission map. This cannot be undone.'
          }
          confirmLabel="Delete type"
          onConfirm={deleteRole}
          onCancel={() => setConfirmRoleDelete(false)}
        />
      )}
    </div>
  )
}

function Stat({ color, value, label }) {
  return (
    <div className={`mng-stat ${color}`}>
      <div className="mng-stat-val">{value}</div>
      <div className="mng-stat-lbl">{label}</div>
    </div>
  )
}
function PlusIcon() {
  return <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
}
function UploadIcon() {
  return <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
}
function SearchIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
}
