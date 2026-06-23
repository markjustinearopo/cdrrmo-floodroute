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
  return {
    id: r.id,
    level: r.level,
    title: r.title,
    message: r.message,
    barangay: (Array.isArray(r.barangays) && r.barangays[0]) || 'All',
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
  if ('barangay' in a) out.barangays = a.barangay ? [a.barangay] : null
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
  /** Promote scheduled alerts whose time has come; returns true if any changed. */
  async promoteDue() {
    const due = unwrap(await supabase
      .from('alerts').select('id')
      .eq('status', 'scheduled')
      .lte('scheduled_for', new Date().toISOString()))
    if (!due.length) return false
    unwrap(await supabase
      .from('alerts')
      .update({ status: 'active', issued_at: new Date().toISOString() })
      .in('id', due.map((d) => d.id)))
    return true
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

export const usersDb = {
  async list() {
    const rows = unwrap(await supabase.from('accounts').select('*').order('id', { ascending: false }))
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
    // insert (cleartext is never stored). 'changeme' is the default until the
    // create-account UI collects a password.
    const row = {
      ...userToDb({ role: 'viewer', status: 'active', barangay: 'All', ...user }),
      username: user.email || (user.name || 'user').toLowerCase().replace(/\s+/g, '.'),
      password_plain: user.password || 'changeme',
    }
    return userFromDb(unwrap(await supabase.from('accounts').insert(row).select().single()))
  },
  async createMany(users) {
    const rows = users.map((u) => ({
      ...userToDb({ role: 'viewer', status: 'active', barangay: 'All', ...u }),
      username: u.email || (u.name || 'user').toLowerCase().replace(/\s+/g, '.'),
      password_plain: u.password || 'changeme',
    }))
    return unwrap(await supabase.from('accounts').insert(rows).select()).map(userFromDb)
  },
  async update(id, updates) {
    unwrap(await supabase.from('accounts').update(userToDb(updates)).eq('id', id))
  },
  async remove(id) {
    unwrap(await supabase.from('accounts').delete().eq('id', id))
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
    for (const r of rows) out[r.id] = { enabled: r.enabled, status: r.status, values: r.config || {} }
    return out
  },
  async set(id, patch) {
    const existing = unwrap(await supabase.from('integrations').select('*').eq('id', id).maybeSingle())
    const merged = {
      id,
      enabled: 'enabled' in patch ? patch.enabled : existing?.enabled ?? false,
      status: 'status' in patch ? patch.status : existing?.status ?? 'disconnected',
      config: 'values' in patch ? { ...(existing?.config || {}), ...patch.values } : existing?.config || {},
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
   ============================================================ */
const VALID_ROUTE_TYPES = ['evacuation', 'relief', 'response']

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
    unwrap(await supabase.from('saved_routes').update(upd).eq('id', id))
  },
  async remove(id) {
    unwrap(await supabase.from('saved_routes').delete().eq('id', id))
  },
}

export default {
  alerts: alertsDb,
  incidents: incidentsDb,
  evac: evacDb,
  users: usersDb,
  notifications: notificationsDb,
  integrations: integrationsDb,
  roadStatus: roadStatusDb,
  savedRoutes: savedRoutesDb,
  appSettings: appSettingsDb,
  auth: authDb,
  ref: refDb,
}
