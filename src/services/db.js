/* ============================================================
   db.js — Supabase data access for the CDRRMO portals.

   This is the single place that knows how the app's in-memory object
   shapes (camelCase, [lat,lng] coords, ms timestamps) map to the
   Postgres rows (snake_case, separate lat/lng columns, timestamptz).
   AdminDataContext and api.js call these helpers; nothing else touches
   the database directly.

   Collections wired to Supabase here:
     alerts · incidents (+ incident_updates history) · evacuation_centers ·
     accounts (users) · notifications · integrations · auth (login/register)

   NOT yet wired (still localStorage — see AdminDataContext / routingHelpers):
     road reports & painted road status, saved routes, barangay assignments,
     alert settings, system config, roles.
   ============================================================ */

import supabase from './supabase.js'
import { publicIntegrationConfig } from './integrationConfig.js'

/* ── small shared helpers ─────────────────────────────────────────────── */
const epochOf = (ts) => (ts ? new Date(ts).getTime() : undefined)
const isoOf = (ms) => (ms ? new Date(ms).toISOString() : null)

/** "Jun 11, 3:42 PM" (Asia/Manila) — same label format the UI used before. */
function label(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'Asia/Manila',
  })
}

/** Throw on a Supabase error so callers can try/catch uniformly. */
function unwrap({ data, error }) {
  if (error) throw new Error(error.message || 'Database error')
  return data
}

/* ============================================================
   Alerts
   ============================================================ */
function alertFromDb(r) {
  /* `barangays` is a text[] and always has been, but every reader took [0]
     and threw the rest away — so an alert for five lakeshore barangays was
     inexpressible. Faced with that, operators tagged it "All Barangays"
     instead: live alert 150 is a PRE-EMPTIVE EVACUATION whose own text names
     Baclaran, Bigaa, Butong, Marinig and Gulod, but it went to all eighteen.
     Over-alerting is not a harmless default — it is how people learn to
     ignore the channel.

     `barangays` (plural) is now the real field. `barangay` (singular) stays
     as the first entry so existing callers keep working while they migrate. */
  const list = Array.isArray(r.barangays) && r.barangays.length ? r.barangays : null
  return {
    id: r.id,
    level: r.level,
    title: r.title,
    message: r.message,
    barangays: list || ['All'],
    barangay: (list && list[0]) || 'All',
    status: r.status || 'active',
    issuedAt: epochOf(r.issued_at),
    issued: label(r.issued_at),
    scheduledFor: epochOf(r.scheduled_for),
    depth: r.depth_m != null ? Number(r.depth_m) : undefined,
  }
}
function alertToDb(a) {
  const out = {}
  if ('level' in a) out.level = a.level
  if ('title' in a) out.title = a.title
  if ('message' in a) out.message = a.message
  /* Accepts either shape: `barangays: [...]` for a real multi-barangay
     alert, or the legacy single `barangay`. Writing several is now possible
     without touching the schema — the column was always an array. */
  if ('barangays' in a) {
    const list = Array.isArray(a.barangays) ? a.barangays.filter(Boolean) : []
    out.barangays = list.length ? list : null
  } else if ('barangay' in a) {
    out.barangays = a.barangay ? [a.barangay] : null
  }
  if ('status' in a) out.status = a.status
  if ('depth' in a) out.depth_m = a.depth ?? null
  if ('scheduledFor' in a) out.scheduled_for = isoOf(a.scheduledFor)
  if ('issuedAt' in a) out.issued_at = isoOf(a.issuedAt)
  if ('issuedBy' in a) out.issued_by = a.issuedBy
  return out
}

export const alertsDb = {
  async list() {
    const rows = unwrap(await supabase.from('alerts').select('*').order('id', { ascending: false }))
    return rows.map(alertFromDb)
  },
  async create(alert) {
    const row = alertToDb({
      status: 'active',
      issuedAt: alert.status === 'scheduled' ? undefined : Date.now(),
      ...alert,
    })
    return alertFromDb(unwrap(await supabase.from('alerts').insert(row).select().single()))
  },
  async update(id, updates) {
    unwrap(await supabase.from('alerts').update(alertToDb(updates)).eq('id', id))
  },
  async remove(id) {
    unwrap(await supabase.from('alerts').delete().eq('id', id))
  },
  /**
   * Promote scheduled alerts whose time has come; returns true if any changed.
   * Goes through an RPC, not a raw update: this runs unauthenticated on
   * every page load (including the public /login screen — see
   * AdminDataContext's poll), so it can't rely on the caller having write
   * access to `alerts`. See promote_due_alerts() in
   * 20260901140000_operational_tables_rls.sql for why that's safe to grant
   * to anon despite alerts otherwise being barangay/admin-scoped for writes.
   */
  async promoteDue() {
    return unwrap(await supabase.rpc('promote_due_alerts'))
  },
}

/* ============================================================
   Incidents (+ incident_updates timeline)
   ============================================================ */
function incidentFromDb(r, updates = []) {
  return {
    id: r.id,
    type: r.incident_type,
    barangay: r.barangay,
    priority: r.priority || 'medium',
    status: r.status || 'new',
    location: r.location || '',
    team: r.assigned_team || '',
    description: r.description || '',
    coords: r.lat != null && r.lng != null ? [Number(r.lat), Number(r.lng)] : null,
    reportedAt: epochOf(r.reported_at),
    reported: label(r.reported_at),
    history: updates
      .filter((u) => u.incident_id === r.id)
      .map((u) => ({ time: label(u.created_at), label: u.label })),
  }
}
function incidentToDb(i) {
  const out = {}
  if ('type' in i) out.incident_type = i.type
  if ('barangay' in i) out.barangay = i.barangay
  if ('priority' in i) out.priority = i.priority
  if ('status' in i) out.status = i.status
  if ('location' in i) out.location = i.location || null
  if ('team' in i) out.assigned_team = i.team || null
  if ('description' in i) out.description = i.description || null
  if ('coords' in i) {
    out.lat = i.coords?.[0] ?? null
    out.lng = i.coords?.[1] ?? null
  }
  if ('reportedAt' in i) out.reported_at = isoOf(i.reportedAt)
  if ('reportedBy' in i) out.reported_by = i.reportedBy
  return out
}

export const incidentsDb = {
  async list() {
    const [rows, updates] = await Promise.all([
      supabase.from('incidents').select('*').order('id', { ascending: false }).then(unwrap),
      supabase.from('incident_updates').select('*').order('id', { ascending: true }).then(unwrap),
    ])
    return rows.map((r) => incidentFromDb(r, updates))
  },
  async create(incident) {
    const row = incidentToDb({
      priority: 'medium', status: 'new', reportedAt: Date.now(), ...incident,
    })
    const saved = unwrap(await supabase.from('incidents').insert(row).select().single())
    // Seed the timeline with the first entry, mirroring the old behaviour.
    const firstLabel = incident.team ? `Reported · assigned to ${incident.team}` : 'Reported'
    unwrap(await supabase.from('incident_updates').insert({ incident_id: saved.id, label: firstLabel }))
    return incidentFromDb(saved)
  },
  /** Patch columns and append any timeline entries the caller computed. */
  async update(id, updates, historyEntries = []) {
    const row = incidentToDb(updates)
    if (Object.keys(row).length) {
      unwrap(await supabase.from('incidents').update(row).eq('id', id))
    }
    if (historyEntries.length) {
      unwrap(await supabase.from('incident_updates')
        .insert(historyEntries.map((l) => ({ incident_id: id, label: l }))))
    }
  },
  async remove(id) {
    unwrap(await supabase.from('incidents').delete().eq('id', id))
  },
}

/* ============================================================
   Flood reports (resident submissions) + flood_report_logs trail

   Residents file reports from the "Report Flood Status" flow; they start
   as 'pending' and only become public (and feed route planning) once an
   official approves them. The per-report verification history lives in
   flood_report_logs, mirrored into `history` exactly like incidents.
   ============================================================ */
/** Friendly one-line text for a verification-log row (the report timeline). */
function reportLogText(l) {
  switch (l.action) {
    case 'submitted': return 'Report submitted · awaiting verification'
    case 'approved': return `Approved${l.actor ? ` by ${l.actor}` : ''} · published to the public map`
    case 'rejected': return `Rejected${l.actor ? ` by ${l.actor}` : ''}`
    case 'verification_requested': return 'Sent back for re-verification'
    case 'status_updated': return l.note || 'Status updated'
    case 'note': return l.note || 'Note added'
    default: return l.note || l.action
  }
}

function floodReportFromDb(r, logs = []) {
  return {
    id: r.id,
    userId: r.user_id ?? null,
    reporter: r.reporter_name || '',
    barangay: r.barangay || '',
    coords: r.lat != null && r.lng != null ? [Number(r.lat), Number(r.lng)] : null,
    level: r.flood_level || 'moderate',
    depthFt: r.water_depth_ft != null ? Number(r.water_depth_ft) : undefined,
    description: r.description || '',
    photo: r.photo || null,
    status: r.verification_status || 'pending',
    officialNotes: r.official_notes || '',
    verifiedBy: r.verified_by || '',
    verifiedAt: epochOf(r.verified_at),
    verified: r.verified_at ? label(r.verified_at) : '',
    reportedAt: epochOf(r.reported_at),
    reported: label(r.reported_at),
    history: logs
      .filter((l) => l.report_id === r.id)
      .map((l) => ({ time: label(l.created_at), label: reportLogText(l), note: l.note || '' })),
  }
}
function floodReportToDb(x) {
  const out = {}
  if ('userId' in x) out.user_id = x.userId ?? null
  if ('reporter' in x) out.reporter_name = x.reporter || null
  if ('barangay' in x) out.barangay = x.barangay || null
  if ('coords' in x) {
    out.lat = x.coords?.[0] ?? null
    out.lng = x.coords?.[1] ?? null
  }
  if ('level' in x) out.flood_level = x.level
  if ('depthFt' in x) out.water_depth_ft = x.depthFt ?? null
  if ('description' in x) out.description = x.description || null
  if ('photo' in x) out.photo = x.photo || null
  if ('status' in x) out.verification_status = x.status
  if ('officialNotes' in x) out.official_notes = x.officialNotes || null
  if ('verifiedBy' in x) out.verified_by = x.verifiedBy || null
  if ('verifiedAt' in x) out.verified_at = isoOf(x.verifiedAt)
  if ('reportedAt' in x) out.reported_at = isoOf(x.reportedAt)
  return out
}

export const floodReportsDb = {
  async list() {
    const [rows, logs] = await Promise.all([
      supabase.from('flood_reports').select('*').order('id', { ascending: false }).then(unwrap),
      supabase.from('flood_report_logs').select('*').order('id', { ascending: true }).then(unwrap),
    ])
    return rows.map((r) => floodReportFromDb(r, logs))
  },
  async create(report) {
    const row = floodReportToDb({ status: 'pending', reportedAt: Date.now(), ...report })
    const saved = unwrap(await supabase.from('flood_reports').insert(row).select().single())
    unwrap(await supabase.from('flood_report_logs').insert({
      report_id: saved.id, action: 'submitted', to_status: 'pending', actor: report.reporter || null,
    }))
    return floodReportFromDb(saved)
  },
  /** Patch columns and append any verification-log rows the caller computed. */
  async update(id, updates, logEntries = []) {
    const row = floodReportToDb(updates)
    if (Object.keys(row).length) {
      unwrap(await supabase.from('flood_reports').update(row).eq('id', id))
    }
    if (logEntries.length) {
      unwrap(await supabase.from('flood_report_logs')
        .insert(logEntries.map((e) => ({ report_id: id, ...e }))))
    }
  },
  async remove(id) {
    unwrap(await supabase.from('flood_reports').delete().eq('id', id))
  },
}

/* ============================================================
   Evacuation centres
   ============================================================ */
function evacFromDb(r) {
  return {
    id: r.id,
    name: r.name,
    barangay: r.barangay,
    capacity: Number(r.capacity || 0),
    occupancy: Number(r.occupancy || 0),
    status: r.status || 'open',
    manager: r.manager || '',
    contact: r.contact || '',
    coords: r.lat != null && r.lng != null ? [Number(r.lat), Number(r.lng)] : null,
  }
}
function evacToDb(c) {
  const out = {}
  if ('name' in c) out.name = c.name
  if ('barangay' in c) out.barangay = c.barangay
  if ('capacity' in c) out.capacity = c.capacity ?? 0
  if ('occupancy' in c) out.occupancy = c.occupancy ?? 0
  if ('status' in c) out.status = c.status || 'open'
  if ('manager' in c) out.manager = c.manager || null
  if ('contact' in c) out.contact = c.contact || null
  if ('coords' in c) {
    out.lat = c.coords?.[0] ?? null
    out.lng = c.coords?.[1] ?? null
  }
  return out
}

export const evacDb = {
  async list() {
    const rows = unwrap(await supabase.from('evacuation_centers').select('*').order('name'))
    return rows.map(evacFromDb)
  },
  async create(center) {
    return evacFromDb(unwrap(await supabase.from('evacuation_centers').insert(evacToDb(center)).select().single()))
  },
  async update(id, updates) {
    unwrap(await supabase.from('evacuation_centers').update(evacToDb(updates)).eq('id', id))
  },
  async remove(id) {
    unwrap(await supabase.from('evacuation_centers').delete().eq('id', id))
  },
}

/* ============================================================
   Users (accounts)
   ============================================================ */
function userFromDb(r) {
  return {
    id: r.id,
    name: r.full_name || r.username || r.email || 'Account',
    email: r.email || '',
    role: r.role,
    barangay: r.barangay || 'All',
    status: r.status || 'active',
    avatar: r.avatar || '',
    lastActive: r.last_login ? label(r.last_login) : '—',
  }
}
function userToDb(u) {
  const out = {}
  if ('name' in u) out.full_name = u.name
  if ('email' in u) out.email = u.email || null
  if ('role' in u) out.role = u.role || 'viewer'
  // barangay is an FK to barangays(name); "All" (city-wide) maps to NULL.
  if ('barangay' in u) out.barangay = (u.barangay && u.barangay !== 'All') ? u.barangay : null
  if ('status' in u) out.status = u.status || 'active'
  if ('phone' in u) out.phone = u.phone || null
  if ('position' in u) out.position = u.position || null
  if ('avatar' in u) out.avatar = u.avatar || null
  return out
}

// Columns the UI actually needs. Deliberately excludes password_hash /
// password_plain — Postgres now revokes anon/authenticated SELECT on those
// two (see migration 20260817120000), so a bare `select('*')` here would
// start erroring; naming columns also means nobody re-introduces the leak
// by widening a query later.
const ACCOUNT_COLUMNS = 'id, full_name, username, email, role, barangay, status, avatar, last_login'

/**
 * A one-time password for an account CDRRMO creates on someone's behalf.
 *
 * This replaces a hardcoded 'changeme'. Every account the admin Users tab
 * created carried that literal string as its password, was created `active`,
 * and never set must_change_password — so anyone who knew the convention
 * (it was in this file, in a public repo) could sign in as any newly created
 * barangay official. The UI collects no password, so there has to be a
 * default; it just has to be a different one every time.
 *
 * crypto.getRandomValues, not Math.random: this is a credential.
 */
function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export const usersDb = {
  async list() {
    const rows = unwrap(await supabase.from('accounts').select(ACCOUNT_COLUMNS).order('id', { ascending: false }))
    return rows.map(userFromDb)
  },
  /** Full profile for the Account modal (includes phone + position). */
  async profile(id) {
    const r = unwrap(await supabase.from('accounts')
      .select('id, full_name, username, email, phone, position, role, barangay, avatar')
      .eq('id', id).maybeSingle())
    if (!r) return null
    return {
      id: r.id, name: r.full_name || '', username: r.username || '', email: r.email || '',
      phone: r.phone || '', position: r.position || '', role: r.role, barangay: r.barangay,
      avatar: r.avatar || '',
    }
  },
  async create(user) {
    // username is required; password_plain is bcrypt-hashed by a DB trigger on
    // insert (cleartext is never stored — the trigger nulls the column).
    const password = user.password || temporaryPassword()
    const row = {
      ...userToDb({ role: 'viewer', status: 'active', barangay: 'All', ...user }),
      username: user.email || (user.name || 'user').toLowerCase().replace(/\s+/g, '.'),
      password_plain: password,
      must_change_password: true,
    }
    const created = userFromDb(unwrap(
      await supabase.from('accounts').insert(row).select(ACCOUNT_COLUMNS).single(),
    ))
    // Handed back so the operator can pass it to the account holder. This is
    // the ONLY moment it exists in readable form anywhere.
    return { ...created, temporaryPassword: password }
  },
  async createMany(users) {
    const rows = users.map((u) => ({
      ...userToDb({ role: 'viewer', status: 'active', barangay: 'All', ...u }),
      username: u.email || (u.name || 'user').toLowerCase().replace(/\s+/g, '.'),
      password_plain: u.password || temporaryPassword(),
      must_change_password: true,
    }))
    return unwrap(await supabase.from('accounts').insert(rows).select(ACCOUNT_COLUMNS)).map(userFromDb)
  },
  async update(id, updates) {
    unwrap(await supabase.from('accounts').update(userToDb(updates)).eq('id', id))
  },
  async remove(id) {
    unwrap(await supabase.from('accounts').delete().eq('id', id))
  },
}

/* ============================================================
   Rescue requests (+ rescue_request_updates timeline)

   Raised automatically when the flood-aware router can find NO safe route
   out for a resident — see components/admin/routeSafety.js for the verdict
   and components/resident/NoSafeRouteAlert.jsx for what the resident sees.
   Shaped deliberately like incidentsDb: same from/to row mapping, same
   timeline-append update signature, so AdminDataContext wires it with the
   same optimistic/persist/refetch machinery as everything else.
   ============================================================ */
export const RESCUE_STATUS_LABEL = {
  pending: 'Pending',
  responding: 'Responding',
  rescued: 'Rescued',
  resolved: 'Resolved',
}

/** Statuses a request is still WAITING on — the ones the dashboard counts. */
export const RESCUE_OPEN_STATUSES = ['pending', 'responding']

function rescueFromDb(r, updates = []) {
  return {
    id: r.id,
    accountId: r.account_id ?? null,
    reporter: r.reporter || '',
    contact: r.contact || '',
    barangay: r.barangay || '',
    coords: r.lat != null && r.lng != null ? [Number(r.lat), Number(r.lng)] : null,
    accuracyM: r.accuracy_m != null ? Number(r.accuracy_m) : null,
    location: r.location || '',
    reason: r.reason || 'no-safe-route',
    /* Always an object for the UI, even on a legacy/blank row: every reader
       below does `hazard.something` and a null here would be a crash on the
       one screen that must not crash. */
    hazard: (r.hazard && typeof r.hazard === 'object') ? r.hazard : {},
    blockedRoads: Array.isArray(r.blocked_roads) ? r.blocked_roads : [],
    status: r.status || 'pending',
    team: r.assigned_team || '',
    requestedAt: epochOf(r.requested_at),
    requested: label(r.requested_at),
    respondedAt: epochOf(r.responded_at),
    rescuedAt: epochOf(r.rescued_at),
    resolvedAt: epochOf(r.resolved_at),
    updatedAt: epochOf(r.updated_at),
    history: updates
      .filter((u) => String(u.request_id) === String(r.id))
      .map((u) => ({ time: label(u.created_at), label: u.label, note: u.note || '' })),
  }
}

function rescueToDb(x) {
  const out = {}
  if ('accountId' in x) out.account_id = x.accountId ?? null
  if ('reporter' in x) out.reporter = x.reporter || null
  if ('contact' in x) out.contact = x.contact || null
  if ('barangay' in x) out.barangay = x.barangay || null
  if ('coords' in x) {
    out.lat = x.coords?.[0] ?? null
    out.lng = x.coords?.[1] ?? null
  }
  if ('accuracyM' in x) out.accuracy_m = x.accuracyM ?? null
  if ('location' in x) out.location = x.location || null
  if ('reason' in x) out.reason = x.reason
  if ('hazard' in x) out.hazard = x.hazard || {}
  if ('blockedRoads' in x) out.blocked_roads = Array.isArray(x.blockedRoads) ? x.blockedRoads : null
  if ('status' in x) out.status = x.status
  if ('team' in x) out.assigned_team = x.team || null
  if ('requestedAt' in x) out.requested_at = isoOf(x.requestedAt)
  /* The three lifecycle stamps are set by whoever moves the status, not by
     the caller passing them individually — see `update` below. */
  if ('respondedAt' in x) out.responded_at = isoOf(x.respondedAt)
  if ('rescuedAt' in x) out.rescued_at = isoOf(x.rescuedAt)
  if ('resolvedAt' in x) out.resolved_at = isoOf(x.resolvedAt)
  return out
}

export const rescueDb = {
  fromDb: rescueFromDb,
  async list() {
    const [rows, updates] = await Promise.all([
      supabase.from('rescue_requests').select('*').order('id', { ascending: false }).then(unwrap),
      supabase.from('rescue_request_updates').select('*').order('id', { ascending: true }).then(unwrap),
    ])
    return rows.map((r) => rescueFromDb(r, updates))
  },
  async create(request) {
    const row = rescueToDb({ status: 'pending', requestedAt: Date.now(), ...request })
    const saved = unwrap(await supabase.from('rescue_requests').insert(row).select().single())
    const { error: historyError } = await supabase.from('rescue_request_updates').insert({
      request_id: saved.id,
      label: 'Rescue request created automatically — no safe route available',
      note: request.hazard?.summary || null,
      created_by: request.reporter || null,
    })
    // The request is already accepted. A secondary history failure must not
    // report it as unsent and encourage a duplicate rescue request.
    if (historyError) console.error('[rescue] Initial history unavailable', historyError.message)
    return rescueFromDb(saved)
  },
  /**
   * Patch columns and append the timeline entries the caller computed.
   *
   * Moving the status also stamps the matching lifecycle time here rather
   * than in the UI, so a request worked from any screen carries the same
   * "responded at / rescued at" record. Only ever sets a stamp, never clears
   * one: reopening a request must not erase the fact that a team went out.
   */
  async update(id, updates, historyEntries = []) {
    const patch = { ...updates }
    const now = Date.now()
    if (updates.status === 'responding' && !('respondedAt' in updates)) patch.respondedAt = now
    if (updates.status === 'rescued' && !('rescuedAt' in updates)) patch.rescuedAt = now
    if (updates.status === 'resolved' && !('resolvedAt' in updates)) patch.resolvedAt = now
    const row = rescueToDb(patch)
    if (Object.keys(row).length) {
      unwrap(await supabase.from('rescue_requests').update(row).eq('id', id))
    }
    if (historyEntries.length) {
      unwrap(await supabase.from('rescue_request_updates')
        .insert(historyEntries.map((l) => ({ request_id: id, label: l }))))
    }
  },
  async remove(id) {
    unwrap(await supabase.from('rescue_requests').delete().eq('id', id))
  },
}

/* ============================================================
   Notifications
   ============================================================ */
function notifFromDb(r) {
  return {
    id: r.id,
    level: r.level,
    title: r.title,
    message: r.message,
    read: !!r.read,
    time: label(r.created_at),
  }
}

export const notificationsDb = {
  async list() {
    const rows = unwrap(await supabase
      .from('notifications').select('*').order('id', { ascending: false }).limit(50))
    return rows.map(notifFromDb)
  },
  async create(n) {
    return notifFromDb(unwrap(await supabase.from('notifications').insert({
      level: n.level || 'moderate',
      title: n.title || null,
      message: n.message || null,
      read: !!n.read,
    }).select().single()))
  },
  async markAllRead() {
    unwrap(await supabase.from('notifications').update({ read: true }).eq('read', false))
  },
}

/* ============================================================
   Integrations (dynamic config; catalogue copy stays in code)
   Shape returned: { [id]: { enabled, status, values } }
   ============================================================ */
export const integrationsDb = {
  async read() {
    const rows = unwrap(await supabase.from('integrations').select('*'))
    const out = {}
    for (const r of rows) out[r.id] = { enabled: r.enabled, status: r.status, values: publicIntegrationConfig(r.config) }
    return out
  },
  async set(id, patch) {
    const existing = unwrap(await supabase.from('integrations').select('*').eq('id', id).maybeSingle())
    const merged = {
      id,
      enabled: 'enabled' in patch ? patch.enabled : existing?.enabled ?? false,
      status: 'status' in patch ? patch.status : existing?.status ?? 'disconnected',
      config: 'values' in patch ? publicIntegrationConfig(patch.values, true) : publicIntegrationConfig(existing?.config),
    }
    unwrap(await supabase.from('integrations').upsert(merged, { onConflict: 'id' }))
  },
}

/* ============================================================
   Auth (custom accounts table via SECURITY DEFINER RPCs)
   ============================================================ */
export const authDb = {
  async login(identifier, password) {
    const data = unwrap(await supabase.rpc('app_login', {
      p_identifier: identifier, p_password: password,
    }))
    if (!data) throw new Error('Invalid email/ID or password.')
    return data // { id, email, role, barangay, fullName, status }
  },
  async registerResident({ email, password, fullName, barangay }) {
    return unwrap(await supabase.rpc('app_register_resident', {
      p_email: email, p_password: password, p_full_name: fullName, p_barangay: barangay,
    }))
  },
  /** Verify the current password and set a new one (bcrypt via DB trigger). */
  async changePassword(id, current, next) {
    const ok = unwrap(await supabase.rpc('app_change_password', {
      p_id: id, p_current: current, p_new: next,
    }))
    if (!ok) throw new Error('Current password is incorrect.')
    return true
  },
  /**
   * Edit the CALLER's own profile. Takes no id — the RPC reads it from the
   * caller's own signed session token, so there is nothing here a caller
   * could point at someone else's row. Replaces the old `usersDb.update(meId,
   * ...)` self-edit path now that accounts' RLS only allows admin/staff to
   * UPDATE the table directly (see 20260901120000_accounts_rls_lockdown.sql).
   */
  async updateOwnProfile({ name, email, phone, position, avatar }) {
    return unwrap(await supabase.rpc('app_update_own_profile', {
      p_full_name: name || null, p_email: email || null, p_phone: phone || null,
      p_position: position || null, p_avatar: avatar || null,
    }))
  },
}

/* ============================================================
   Read-only reference reads (available for maps / dashboards later)
   ============================================================ */
export const refDb = {
  async barangays() {
    return unwrap(await supabase.from('barangays').select('*').order('name'))
  },
  /** Headline counts for the public landing/brand panel. */
  async counts() {
    const [b, e] = await Promise.all([
      supabase.from('barangays').select('*', { count: 'exact', head: true }),
      supabase.from('evacuation_centers').select('*', { count: 'exact', head: true }),
    ])
    return { barangays: b.count ?? 0, evac: e.count ?? 0 }
  },
  async hazardZones(category) {
    let q = supabase.from('hazard_zones').select('*')
    if (category) q = q.eq('category', category)
    return unwrap(await q)
  },
  async floodReadings(barangay) {
    let q = supabase.from('flood_readings').select('*').order('recorded_at', { ascending: false })
    if (barangay) q = q.eq('barangay', barangay)
    return unwrap(await q)
  },
}

/* ============================================================
   Road status (painted road conditions, shared across users)

   The `road_status` table is the source of truth for the painted road
   map ({ wayId: 'flooded' | 'blocked' }). osm_way_id is unique, so each
   road carries a single current status (upsert). The wayIds come from the
   bundled OSM routing network, not the (unused) roads table — its FK was
   dropped so any way can be flagged. AdminDataContext mirrors these rows
   into the `cdrrmo_road_status` localStorage key that the synchronous
   map/routing consumers (routingHelpers.useRoadStatus) read.
   ============================================================ */
function reportFromRow(r) {
  return {
    id: r.id,
    wayId: Number(r.osm_way_id),
    name: r.name || '',
    barangay: r.barangay || '',
    // UI status mirrors the painted value: flooded↔caution, blocked↔closed.
    status: r.status === 'blocked' ? 'closed' : 'caution',
    depth: r.flood_depth_m != null ? Number(r.flood_depth_m) : undefined,
    // Flood depth in FEET — the unit CDRRMO records and the UI displays.
    depthFt: r.flood_depth_ft != null ? Number(r.flood_depth_ft) : undefined,
    reason: r.reason || '',
    updatedAt: epochOf(r.reported_at),
    updated: label(r.reported_at),
  }
}

export const roadStatusDb = {
  toReport: reportFromRow,
  async listRows() {
    return unwrap(await supabase.from('road_status').select('*').order('reported_at', { ascending: false }))
  },
  /** Upsert a single road's painted status ('flooded' | 'blocked'). */
  async setWay(wayId, status, meta = {}) {
    unwrap(await supabase.from('road_status').upsert({
      osm_way_id: wayId,
      status,
      name: meta.name ?? null,
      barangay: meta.barangay ?? null,
      flood_depth_m: meta.depth ?? null,
      flood_depth_ft: meta.depthFt ?? null,
      reason: meta.reason ?? null,
      reported_by: meta.reportedBy ?? null,
      reported_at: new Date().toISOString(),
    }, { onConflict: 'osm_way_id' }))
  },
  async removeWay(wayId) {
    unwrap(await supabase.from('road_status').delete().eq('osm_way_id', wayId))
  },
  async removeById(id) {
    unwrap(await supabase.from('road_status').delete().eq('id', id))
  },
  async clear() {
    unwrap(await supabase.from('road_status').delete().gte('id', 0))
  },
}

/* ============================================================
   Road blocks — selective (partial) road closures.

   `road_status` holds one status per OSM way and always will; this table
   holds closures of a SECTION of a way, several per way if the ground calls
   for it. The two live side by side on purpose — see the header of
   20260908130000_road_blocks.sql for why the way-keyed table was not simply
   extended.

   The blocked section's geometry is the record. It is written twice in the
   same statement: as `geometry` jsonb ([[lat,lng], …], which is what the app
   and the router read) and as a PostGIS `geom` LineString, so spatial queries
   work without the database having to parse the jsonb. Same belt-and-braces
   the saved_routes table uses, and the same axis-order trap — see
   toLineStringWKT below, which is defined further down this file for the
   route geometry and reused here.
   ============================================================ */
function roadBlockFromRow(r) {
  return {
    id: r.id,
    wayId: r.osm_way_id != null ? Number(r.osm_way_id) : null,
    roadName: r.road_name || '',
    barangay: r.barangay || '',
    scope: r.scope || 'partial',
    start: r.start_lat != null && r.start_lng != null ? [Number(r.start_lat), Number(r.start_lng)] : null,
    end: r.end_lat != null && r.end_lng != null ? [Number(r.end_lat), Number(r.end_lng)] : null,
    /* Always an array for the router and the map layer: a null here would be
       a crash in the one loop that decides which roads are passable. */
    geometry: Array.isArray(r.geometry) ? r.geometry : [],
    lengthM: r.length_m != null ? Number(r.length_m) : null,
    reason: r.reason || '',
    hazardLevel: r.hazard_level || null,
    depthM: r.depth_m != null ? Number(r.depth_m) : null,
    effect: r.effect || 'blocked',
    status: r.status || 'active',
    accountId: r.account_id ?? null,
    createdBy: r.created_by || '',
    reportedAt: epochOf(r.reported_at),
    reported: label(r.reported_at),
    resolvedAt: epochOf(r.resolved_at),
    updatedAt: epochOf(r.updated_at),
  }
}

function roadBlockToRow(b) {
  const out = {}
  if ('wayId' in b) out.osm_way_id = b.wayId
  if ('roadName' in b) out.road_name = b.roadName || null
  if ('barangay' in b) out.barangay = b.barangay || null
  if ('scope' in b) out.scope = b.scope === 'full' ? 'full' : 'partial'
  if ('start' in b) {
    out.start_lat = b.start?.[0] ?? null
    out.start_lng = b.start?.[1] ?? null
  }
  if ('end' in b) {
    out.end_lat = b.end?.[0] ?? null
    out.end_lng = b.end?.[1] ?? null
  }
  if ('geometry' in b) {
    const line = Array.isArray(b.geometry) ? b.geometry : []
    out.geometry = line
    out.geom = toLineStringWKT(line) // the PostGIS projection, never drifting
  }
  if ('lengthM' in b) out.length_m = b.lengthM ?? null
  if ('reason' in b) out.reason = b.reason || null
  if ('hazardLevel' in b) out.hazard_level = b.hazardLevel || null
  if ('depthM' in b) out.depth_m = b.depthM ?? null
  if ('effect' in b) out.effect = b.effect === 'flooded' ? 'flooded' : 'blocked'
  if ('status' in b) out.status = b.status
  if ('accountId' in b) out.account_id = b.accountId ?? null
  if ('createdBy' in b) out.created_by = b.createdBy || null
  if ('reportedAt' in b) out.reported_at = isoOf(b.reportedAt)
  if ('resolvedAt' in b) out.resolved_at = isoOf(b.resolvedAt)
  return out
}

export const roadBlocksDb = {
  fromRow: roadBlockFromRow,
  async list() {
    const rows = unwrap(await supabase.from('road_blocks').select('*').order('reported_at', { ascending: false }))
    return rows.map(roadBlockFromRow)
  },
  async create(block) {
    const row = roadBlockToRow({ status: 'active', reportedAt: Date.now(), ...block })
    return roadBlockFromRow(unwrap(await supabase.from('road_blocks').insert(row).select().single()))
  },
  async update(id, patch) {
    /* Resolving stamps the time here rather than in the UI, so a closure
       reopened from any screen carries the same record of when it ended. */
    const next = { ...patch }
    if (patch.status === 'resolved' && !('resolvedAt' in patch)) next.resolvedAt = Date.now()
    if (patch.status === 'active' && !('resolvedAt' in patch)) next.resolvedAt = null
    unwrap(await supabase.from('road_blocks').update(roadBlockToRow(next)).eq('id', id))
  },
  async remove(id) {
    unwrap(await supabase.from('road_blocks').delete().eq('id', id))
  },
}

/* ============================================================
   App settings (shared key/value config — system config, alert settings)
   `app_settings` is (key text PK, value jsonb, updated_at). One row per
   config blob; the Settings pages keep a localStorage cache for instant
   render but treat this table as the shared source of truth.
   ============================================================ */
export const appSettingsDb = {
  async get(key, fallback = null) {
    const row = unwrap(await supabase.from('app_settings').select('value').eq('key', key).maybeSingle())
    return row ? row.value : fallback
  },
  async set(key, value) {
    unwrap(await supabase.from('app_settings').upsert(
      { key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' },
    ))
  },
  async remove(key) {
    unwrap(await supabase.from('app_settings').delete().eq('key', key))
  },
}

/* ============================================================
   Saved routes (shared across users)

   The app works with coordinate arrays (points / path / override), so the
   full route object lives in the `data` jsonb column; the scalar columns
   (name, route_type, mean_risk, …) are populated for the schema / ERD.

   THE SPATIAL COLUMNS
   The PostGIS migration gave this table origin_lat/lng, dest_lat/lng, a
   `path` LineString, an `override_path` LineString, and GiST indexes over
   origin_geom / dest_geom — and nothing ever wrote to any of them. Every
   coordinate went into the jsonb blob instead, so the generated geometry
   columns were always NULL and the spatial indexes indexed nothing. A
   PostGIS schema that no query can use is decoration.

   So the writes below fill them from the same route object, which makes the
   spatial questions this system is actually about answerable in SQL rather
   than by pulling every row into JavaScript first:

     "routes that pass within 200 m of this flooded segment"
     "routes ending at a shelter that is now full"
     "routes crossing this barangay"

   The jsonb stays the source of truth for the app — these are a queryable
   projection of it, written in the same statement so they cannot drift.
   ============================================================ */
const VALID_ROUTE_TYPES = ['evacuation', 'relief', 'response']

/**
 * [lat,lng][] → an EWKT LineString PostGIS will accept over PostgREST.
 *
 * Note the axis order flip: the app carries [lat, lng] (Leaflet's order) and
 * WKT is written (x y) — longitude first. Getting this backwards does not
 * error; it silently files every Cabuyao route somewhere off Somalia.
 */
function toLineStringWKT(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null
  const pts = coords
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(([lat, lng]) => `${lng} ${lat}`)
  if (pts.length < 2) return null
  return `SRID=4326;LINESTRING(${pts.join(',')})`
}

/* Metres between two [lat,lng] points.
   Inlined rather than imported from routingHelpers on purpose: that module
   pulls in the 914 kB bundled road network, and this file is loaded by every
   screen in the app. */
function metresBetween([lat1, lng1], [lat2, lng2]) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function pathLengthM(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null
  let m = 0
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]
    const b = coords[i]
    if (!Array.isArray(a) || !Array.isArray(b)) continue
    m += metresBetween(a, b)
  }
  return Math.round(m)
}

/** The spatial projection of a route: the columns the ERD promised. */
function routeGeometryColumns(route) {
  /* Prefer the road-following path's own endpoints over the A/B anchors: the
     anchors are where the operator clicked, which can be a few metres off the
     road the route actually starts on. */
  const line = Array.isArray(route.path) && route.path.length > 1 ? route.path : route.points
  const first = Array.isArray(line) ? line[0] : null
  const last = Array.isArray(line) ? line[line.length - 1] : null
  const ok = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])

  return {
    origin_lat: ok(first) ? first[0] : null,
    origin_lng: ok(first) ? first[1] : null,
    dest_lat: ok(last) ? last[0] : null,
    dest_lng: ok(last) ? last[1] : null,
    path: toLineStringWKT(route.path),
    override_path: toLineStringWKT(route.override),
    distance_m: pathLengthM(route.path) ?? pathLengthM(route.points),
  }
}

function routeFromRow(r) {
  return {
    ...(r.data || {}),
    id: r.id,
    createdAt: epochOf(r.created_at) ?? Date.now(),
    name: r.name,
    type: r.route_type || r.data?.type,
  }
}
function routeToRow(route) {
  const { id, createdAt, ...data } = route // DB owns id + created_at
  return {
    name: route.name || 'Route',
    route_type: VALID_ROUTE_TYPES.includes(route.type) ? route.type : null,
    source: route.source || 'auto',
    destination: route.destination ?? null,
    mean_risk: route.meanRisk ?? null,
    barangay: route.barangay ?? null,
    data,
    ...routeGeometryColumns(route),
  }
}

export const savedRoutesDb = {
  toRoute: routeFromRow,
  async list() {
    const rows = unwrap(await supabase.from('saved_routes').select('*').order('created_at', { ascending: false }))
    return rows.map(routeFromRow)
  },
  async create(route) {
    return routeFromRow(unwrap(await supabase.from('saved_routes').insert(routeToRow(route)).select().single()))
  },
  async update(id, patch) {
    const existing = unwrap(await supabase.from('saved_routes').select('data').eq('id', id).maybeSingle())
    const data = { ...(existing?.data || {}), ...patch }
    const upd = { data }
    if ('name' in patch) upd.name = patch.name
    if ('type' in patch) upd.route_type = VALID_ROUTE_TYPES.includes(patch.type) ? patch.type : null
    if ('meanRisk' in patch) upd.mean_risk = patch.meanRisk
    if ('destination' in patch) upd.destination = patch.destination ?? null
    /* Recomputed from the MERGED object, not the patch: the Override tab
       sends only { override, … }, and the geometry columns have to stay
       consistent with the whole route or `path` would be nulled out every
       time somebody drew an override over it. */
    if ('path' in patch || 'points' in patch || 'override' in patch) {
      Object.assign(upd, routeGeometryColumns(data))
    }
    unwrap(await supabase.from('saved_routes').update(upd).eq('id', id))
  },
  async remove(id) {
    unwrap(await supabase.from('saved_routes').delete().eq('id', id))
  },
}

export default {
  alerts: alertsDb,
  incidents: incidentsDb,
  rescue: rescueDb,
  floodReports: floodReportsDb,
  evac: evacDb,
  users: usersDb,
  notifications: notificationsDb,
  integrations: integrationsDb,
  roadStatus: roadStatusDb,
  roadBlocks: roadBlocksDb,
  savedRoutes: savedRoutesDb,
  appSettings: appSettingsDb,
  auth: authDb,
  ref: refDb,
}
