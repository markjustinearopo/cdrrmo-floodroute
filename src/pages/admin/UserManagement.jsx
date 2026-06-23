import { useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { BARANGAYS } from '../../data/cabuyao.js'
import {
  ROLES, ROLE_LABEL, USER_STATUSES, USER_STATUS_LABEL,
} from '../../data/settings.js'
import { useUsers } from '../../context/AdminDataContext.jsx'
import './Manage.css'
import './Settings.css'

/**
 * CDRRMO Admin — User Management (Settings).
 *
 * The roster of system accounts: command-center staff, barangay officers and
 * read-only viewers. Each account carries a role (which drives its permissions
 * on the Permissions & Roles screen), an optional barangay scope and an account
 * status. Records live in the shared AdminDataContext store (seeded with a
 * starter set, persisted across refreshes), and a whole roster can be brought
 * in at once with the CSV bulk import.
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

export default function UserManagement() {
  const { users, addUser, addUsers, updateUser, removeUser } = useUsers()
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null) // user object, {} for new, or null
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState(null) // { valid, errors, fileName }
  const [toast, setToast] = useState('')

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

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

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
      flash(`${data.name} updated.`)
    } else {
      addUser(data)
      flash(`${data.name} added.`)
    }
    setEditing(null)
  }

  function toggleStatus(id) {
    const u = users.find((x) => x.id === id)
    if (!u) return
    const status = u.status === 'suspended' ? 'active' : 'suspended'
    updateUser(id, { status })
    flash(status === 'suspended' ? `${u.name} suspended.` : `${u.name} reactivated.`)
  }
  function remove(id) {
    const u = users.find((x) => x.id === id)
    removeUser(id)
    flash(`${u?.name || 'Account'} removed.`)
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
    reader.onerror = () => flash('Could not read that file.')
    reader.readAsText(file)
    e.target.value = '' // same file can be re-picked after fixing it
  }

  function commitImport() {
    if (!importPreview?.valid.length) return
    addUsers(importPreview.valid)
    flash(`${importPreview.valid.length} account${importPreview.valid.length === 1 ? '' : 's'} imported.`)
    setImporting(false)
    setImportPreview(null)
  }

  function closeImport() {
    setImporting(false)
    setImportPreview(null)
  }

  return (
    <AdminLayout>
      <div className="mng">
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
              <div className="mng-title">User Management</div>
              <div className="mng-sub">Manage CDRRMO system accounts, roles and access</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setImporting(true)}>
              <UploadIcon /> Bulk Import
            </button>
            <button type="button" className="mng-btn" onClick={() => setEditing({})}>
              <PlusIcon /> Add User
            </button>
          </div>
        </div>

        <div className="mng-stats">
          <Stat color="blue" value={stats.total} label="Total Accounts" />
          <Stat color="green" value={stats.active} label="Active" />
          <Stat color="amber" value={stats.pending} label="Pending" />
          <Stat color="red" value={stats.suspended} label="Suspended" />
        </div>

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
                <th>Role</th>
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
                    <td><span className={`mng-badge role-${u.role}`}>{ROLE_LABEL[u.role]}</span></td>
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
                          onClick={() => remove(u.id)}
                          disabled={u.role === 'admin' && stats.total > 0 && users.filter((x) => x.role === 'admin').length === 1}
                          title={users.filter((x) => x.role === 'admin').length === 1 && u.role === 'admin' ? 'Cannot remove the last administrator' : undefined}
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

        <div className="mng-note">
          <SparkIcon />
          <span>Accounts persist across refreshes and are shared system-wide. Roles map to the access defined under Permissions &amp; Roles; use Bulk Import to bring in a whole roster from CSV.</span>
        </div>
      </div>

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

      {/* Add / edit modal */}
      {editing && (
        <div className="mng-overlay" onMouseDown={() => setEditing(null)}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label={editing.id ? 'Edit account' : 'Add account'} onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">{editing.id ? 'Edit Account' : 'Add User'}</div>
                <div className="mng-modal-sub">{editing.id ? 'Update this account’s role and access' : 'Create a new system account'}</div>
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
                  Role
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

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </AdminLayout>
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
  return (
    <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
  )
}
function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
  )
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
  )
}
function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
  )
}
