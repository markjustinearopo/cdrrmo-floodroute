/* ============================================================
   Shared lookups for the CDRRMO Admin SETTINGS screens.

   Pulled out of the individual pages so the two account-oriented
   screens — User Management and Permissions & Roles — share one
   source of truth for roles and the permission matrix. Live records
   come from the Node/Express + database backend (Conceptual
   Framework); these are the fixed enums plus a small starter set of
   accounts so the screens are usable before the API is wired in.
   ============================================================ */

/* ── User roles ───────────────────────────────────────────── */
export const ROLES = [
  {
    value: 'admin',
    label: 'Administrator',
    desc: 'Full access to every module, settings and user accounts.',
    system: true, // built-in role — cannot be deleted or its scope reduced
  },
  {
    value: 'operator',
    label: 'Operator',
    desc: 'Command-center staff: issue alerts, dispatch incidents and manage routes.',
    system: true,
  },
  {
    value: 'officer',
    label: 'Barangay Officer',
    desc: 'Barangay-level user: report incidents and update their evacuation centre.',
    system: true,
  },
  {
    value: 'viewer',
    label: 'Viewer',
    desc: 'Read-only access to monitoring dashboards and the flood map.',
    system: true,
  },
]
export const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.value, r.label]))

/* ── Account status ───────────────────────────────────────── */
export const USER_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'suspended', label: 'Suspended' },
]
export const USER_STATUS_LABEL = Object.fromEntries(USER_STATUSES.map((s) => [s.value, s.label]))

/**
 * Starter accounts so the roster, role counts and status badges have
 * something to render before GET /users is connected. The signed-in
 * Administrator is always present; the rest illustrate the other
 * roles and account states and are session-only seed data.
 */
export const SAMPLE_USERS = [
  { id: 'usr-1', name: 'CDRRMO Admin', email: 'admin@cabuyao.gov.ph', role: 'admin', barangay: 'All', status: 'active', lastActive: 'Just now' },
  { id: 'usr-2', name: 'CDRRMO Operator', email: 'operator@cabuyao.gov.ph', role: 'operator', barangay: 'All', status: 'active', lastActive: '2h ago' },
  { id: 'usr-3', name: 'Barangay Officer — Pulo', email: 'pulo.bdrrmc@cabuyao.gov.ph', role: 'officer', barangay: 'Pulo', status: 'pending', lastActive: '—' },
  { id: 'usr-4', name: 'Records Viewer', email: 'records@cabuyao.gov.ph', role: 'viewer', barangay: 'All', status: 'suspended', lastActive: '5d ago' },
]

/* ── Permission matrix ────────────────────────────────────────
   Each module can be granted three escalating levels of access.
   The Permissions & Roles screen renders this as a role × module
   grid of switches.                                              */
export const PERMISSION_MODULES = [
  { key: 'dashboard', label: 'Dashboard & Monitoring' },
  { key: 'floodmap', label: 'Flood Map & Hazard Layer' },
  { key: 'routing', label: 'Route Planning & Road Status' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'incidents', label: 'Incidents' },
  { key: 'evacuation', label: 'Evacuation Centers' },
  { key: 'barangay', label: 'Barangay Management' },
  { key: 'users', label: 'User Accounts' },
  { key: 'system', label: 'System & Integrations' },
]
export const PERMISSION_ACTIONS = [
  { key: 'view', label: 'View' },
  { key: 'edit', label: 'Create / Edit' },
  { key: 'manage', label: 'Delete / Manage' },
]

/**
 * Build a full permission map from a compact spec where each module
 * is given a subset of the letters v(iew) · e(dit) · m(anage).
 * Anything unlisted defaults to no access.
 */
export function buildPerms(spec = {}) {
  const out = {}
  for (const m of PERMISSION_MODULES) {
    const s = spec[m.key] || ''
    out[m.key] = { view: s.includes('v'), edit: s.includes('e'), manage: s.includes('m') }
  }
  return out
}

const ALL = Object.fromEntries(PERMISSION_MODULES.map((m) => [m.key, 'vem']))

export const DEFAULT_ROLE_PERMS = {
  admin: buildPerms(ALL),
  operator: buildPerms({
    dashboard: 'v', floodmap: 've', routing: 'vem', alerts: 'vem',
    incidents: 'vem', evacuation: 've', barangay: 've', users: '', system: '',
  }),
  officer: buildPerms({
    dashboard: 'v', floodmap: 'v', routing: 'v', alerts: 'v',
    incidents: 've', evacuation: 've', barangay: 'v', users: '', system: '',
  }),
  viewer: buildPerms({
    dashboard: 'v', floodmap: 'v', routing: 'v', alerts: 'v',
    incidents: 'v', evacuation: 'v', barangay: 'v', users: '', system: '',
  }),
}
