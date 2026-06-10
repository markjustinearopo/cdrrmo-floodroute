import { useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { BARANGAYS } from '../../data/cabuyao.js'
import {
  ROLES, ROLE_LABEL, USER_STATUSES, USER_STATUS_LABEL, SAMPLE_USERS,
} from '../../data/settings.js'
import './Manage.css'
import './Settings.css'

/**
 * CDRRMO Admin — User Management (Settings).
 *
 * The roster of system accounts: command-center staff, barangay officers and
 * read-only viewers. Each account carries a role (which drives its permissions
 * on the Permissions & Roles screen), an optional barangay scope and an account
 * status. The list is seeded with a small starter set so the table is usable;
 * records live in component state until the users API (GET/POST/PUT /users) is
 * connected, after which this same shape is fed straight from the database.
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

export default function UserManagement() {
  const [users, setUsers] = useState(SAMPLE_USERS)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null) // user object, {} for new, or null
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
      setUsers((prev) => prev.map((u) => (u.id === editing.id ? { ...u, ...data } : u)))
      flash(`${data.name} updated.`)
    } else {
      setUsers((prev) => [
        { id: `usr-${Date.now()}`, lastActive: '—', ...data },
        ...prev,
      ])
      flash(`${data.name} added.`)
    }
    setEditing(null)
  }

  function toggleStatus(id) {
    setUsers((prev) => prev.map((u) => {
      if (u.id !== id) return u
      const status = u.status === 'suspended' ? 'active' : 'suspended'
      flash(status === 'suspended' ? `${u.name} suspended.` : `${u.name} reactivated.`)
      return { ...u, status }
    }))
  }
  function remove(id) {
    const u = users.find((x) => x.id === id)
    setUsers((prev) => prev.filter((x) => x.id !== id))
    flash(`${u?.name || 'Account'} removed.`)
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
          <button type="button" className="mng-btn" onClick={() => setEditing({})}>
            <PlusIcon /> Add User
          </button>
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
                        <div className={`set-user-av ${u.role === 'admin' ? 'admin' : ''}`}>{initials(u.name)}</div>
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
          <span>The roster is seeded with a starter set and kept for this session until the users API is connected. Roles map to the access defined under Permissions &amp; Roles.</span>
        </div>
      </div>

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
