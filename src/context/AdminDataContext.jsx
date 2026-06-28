/* ============================================================
   AdminDataContext — the shared data layer for every portal.

   Centralises alerts, incidents, evacuation centres, users, road
   reports, integrations and notifications so each screen sees the same
   records. The hook API the pages consume (useAlerts, useIncidents, …)
   is unchanged — only the transport moved.

   TRANSPORT: most collections now read/write the Supabase Postgres
   backend through ../services/db.js. Mutations are OPTIMISTIC — local
   state updates immediately (and the add* helpers return the new object
   synchronously, as before), then the write is persisted and that
   collection is re-fetched to reconcile real database ids.

   Still on localStorage for now (coupled to the routing overlay that
   hasn't been migrated yet): road reports + the painted road-status map,
   and barangay assignments. Alert settings also remain local.
   ============================================================ */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState,
} from 'react'
import { INTEGRATION_CATALOG } from '../data/integrations.js'
import { BARANGAY_CENTROIDS } from '../data/cabuyaoBarangays.js'
import { SEED_FLOOD_AREAS } from '../data/floodAreas.js'
import db from '../services/db.js'
import supabase from '../services/supabase.js'

/* ── localStorage plumbing ────────────────────────────────────────────────
   Most collections are Supabase-backed now. localStorage survives only as:
   the alert-settings instant cache (KEYS.alertSettings), and the painted
   road-status / saved-routes MIRRORS that the synchronous map/routing
   consumers read (written by this provider from the Supabase source). */
const KEYS = {
  alertSettings: 'cdrrmo_alert_settings',
}
const ROAD_STATUS_KEY = 'cdrrmo_road_status'
const ROUTES_KEY = 'cdrrmo_routes'
/* Free-text road reports (a road name that matches no mapped OSM way) can't be
   stored in the way-keyed `road_status` table, so they live here on the client.
   The roadReports loader merges them back in so they persist across refetches
   and reloads instead of being wiped by the empty server result. */
const LOCAL_REPORTS_KEY = 'cdrrmo_road_reports_local'

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key))
    return v ?? fallback
  } catch {
    return fallback
  }
}
function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new CustomEvent('cdrrmo-store', { detail: { key } }))
}

/** "Jun 11, 3:42 PM" — the timestamp label used across the Manage screens. */
export function nowLabel(ts = Date.now()) {
  return new Date(ts).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'Asia/Manila',
  })
}

/** Interior point ([lat, lng]) of a barangay — incident/centre map fallback. */
export function barangayCoords(name) {
  return BARANGAY_CENTROIDS.find((b) => b.name === name)?.coords || null
}

/* Merge the in-code integration catalogue (names, fields, docs) with the
   dynamic part (enabled / status / values) stored in the database. */
function mergeIntegrations(stored) {
  return INTEGRATION_CATALOG.map((c) => {
    const s = stored[c.id] || {}
    return { ...c, ...s, values: { ...(c.values || {}), ...(s.values || {}) } }
  })
}

/* Mirror the Supabase road_status rows into the `cdrrmo_road_status`
   localStorage key that the synchronous map/routing consumers
   (routingHelpers.useRoadStatus) read. Only writes when the painted map
   actually changed, so the 6s poll / realtime don't churn those consumers. */
function mirrorRoadStatusToLocal(rows) {
  const next = {}
  for (const r of rows) next[Number(r.osm_way_id)] = r.status
  const cur = readJSON(ROAD_STATUS_KEY, {})
  if (JSON.stringify(cur) !== JSON.stringify(next)) writeJSON(ROAD_STATUS_KEY, next)
}

/* Mirror the saved_routes rows into the `cdrrmo_routes` localStorage key that
   the synchronous routing consumers (routingHelpers.useRoutes) read. */
function mirrorRoutesToLocal(routes) {
  const cur = readJSON(ROUTES_KEY, [])
  if (JSON.stringify(cur) !== JSON.stringify(routes)) writeJSON(ROUTES_KEY, routes)
}

/* Free-text road reports kept on the client (see LOCAL_REPORTS_KEY). */
function loadLocalReports() {
  const list = readJSON(LOCAL_REPORTS_KEY, [])
  return Array.isArray(list) ? list : []
}
function saveLocalReports(list) {
  writeJSON(LOCAL_REPORTS_KEY, list)
}

/* ── Remote collection loaders (Supabase) ───────────────────────────────── */
const REMOTE_LOADERS = {
  alerts: () => db.alerts.list(),
  incidents: () => db.incidents.list(),
  evacuationCenters: () => db.evac.list(),
  users: () => db.users.list(),
  notifications: () => db.notifications.list(),
  integrations: async () => mergeIntegrations(await db.integrations.read()),
  roadReports: async () => {
    const rows = await db.roadStatus.listRows()
    mirrorRoadStatusToLocal(rows) // keep the painted-map mirror in sync for every client
    // Free-text reports (client-only) sit ahead of the way-keyed server rows so
    // they survive the empty/refetched server result instead of disappearing.
    return [...loadLocalReports(), ...rows.map(db.roadStatus.toReport)]
  },
  savedRoutes: async () => {
    const routes = await db.savedRoutes.list()
    mirrorRoutesToLocal(routes) // keep the routing screens' list in sync for every client
    return routes
  },
  barangayAssignments: () => db.appSettings.get('barangay_assignments', {}),
  roadChangeRequests: () => db.appSettings.get('road_change_requests', []),
  // Documented flood-prone areas (depth in feet). Falls back to the seeded
  // historical record until an admin edit first persists the key.
  floodAreas: () => db.appSettings.get('flood_areas', SEED_FLOOD_AREAS),
}

/* ── Context ─────────────────────────────────────────────────────────────── */
const AdminDataContext = createContext(null)

const EMPTY = {
  alerts: [], incidents: [], evacuationCenters: [], users: [],
  notifications: [], integrations: [], roadReports: [], savedRoutes: [], barangayAssignments: {},
  roadChangeRequests: [],
  // Seeded so the historical flood-prone areas paint on every map from first render.
  floodAreas: SEED_FLOOD_AREAS,
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET':
      return { ...state, [action.name]: action.value, lastUpdated: Date.now() }
    case 'PATCH':
      return { ...state, ...action.patch, lastUpdated: Date.now() }
    case 'TOUCH':
      return { ...state, lastUpdated: Date.now() }
    default:
      return state
  }
}

export function AdminDataProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, () => ({ ...EMPTY, lastUpdated: Date.now() }))
  const [isLoading, setIsLoading] = useState(true)

  // Latest state, readable inside callbacks for optimistic updates.
  const stateRef = useRef(state)
  stateRef.current = state

  /* Re-fetch one remote collection. Only push to state when the data actually
     changed, so the periodic poll / realtime sync don't re-render the UI or
     bump the "last updated" stamp when nothing moved. */
  const refetch = useCallback(async (name) => {
    const loader = REMOTE_LOADERS[name]
    if (!loader) return
    try {
      const value = await loader()
      const prev = stateRef.current[name]
      if (JSON.stringify(prev) !== JSON.stringify(value)) {
        dispatch({ type: 'SET', name, value })
      }
    } catch (e) {
      console.error(`[AdminData] reload ${name} failed`, e)
    }
  }, [])

  /* Apply an optimistic value now; persist in the background; reconcile. */
  const optimistic = useCallback((name, value) => dispatch({ type: 'SET', name, value }), [])
  const persist = useCallback((name, op) => {
    Promise.resolve()
      .then(op)
      .catch((e) => console.error(`[AdminData] persist ${name} failed`, e))
      .finally(() => refetch(name))
  }, [refetch])

  /* Initial load: pull every remote collection + the local ones. */
  useEffect(() => {
    let alive = true
    ;(async () => {
      const names = Object.keys(REMOTE_LOADERS)
      const results = await Promise.allSettled(names.map((n) => REMOTE_LOADERS[n]()))
      if (!alive) return
      const patch = {}
      results.forEach((res, i) => {
        patch[names[i]] = res.status === 'fulfilled' ? res.value : EMPTY[names[i]]
        if (res.status === 'rejected') console.error(`[AdminData] load ${names[i]}`, res.reason)
      })
      dispatch({ type: 'PATCH', patch })
      setIsLoading(false)
    })()
    return () => { alive = false }
  }, [])

  /* ── Live cross-user sync ────────────────────────────────────────────────
     Every portal (admin / barangay / resident) shares one Supabase backend,
     so a record one user creates must reach the others without a manual
     reload. Mounted once here in the provider, it covers all three portals.
     Two mechanisms, belt-and-braces:
       • Realtime  — instant: refetch a collection when its table changes.
       • Polling   — guaranteed fallback if the realtime socket drops; also
                     promotes any scheduled alert whose time has come.
     Both go through the diffing refetch above, so idle ticks cost nothing. */
  useEffect(() => {
    const TABLE_TO_COLLECTION = {
      alerts: 'alerts',
      incidents: 'incidents',
      incident_updates: 'incidents',
      evacuation_centers: 'evacuationCenters',
      accounts: 'users',
      notifications: 'notifications',
      integrations: 'integrations',
      road_status: 'roadReports',
      saved_routes: 'savedRoutes',
    }
    let channel
    try {
      channel = supabase.channel('cdrrmo-shared')
      for (const [table, collection] of Object.entries(TABLE_TO_COLLECTION)) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => refetch(collection))
      }
      channel.subscribe()
    } catch (e) {
      console.error('[AdminData] realtime subscribe failed', e)
    }

    const poll = setInterval(() => {
      db.alerts.promoteDue()
        .then((changed) => { if (changed) refetch('alerts') })
        .catch((e) => console.error('[AdminData] promoteDue', e))
      Object.keys(REMOTE_LOADERS).forEach((name) => refetch(name))
    }, 6000)

    return () => {
      clearInterval(poll)
      if (channel) supabase.removeChannel(channel)
    }
  }, [refetch])

  /* Manual "sync now" (topbar button): promote any due scheduled alert, pull
     every collection, and stamp the time so the chip acknowledges the click. */
  const refresh = useCallback(() => {
    db.alerts.promoteDue()
      .then((changed) => { if (changed) refetch('alerts') })
      .catch((e) => console.error('[AdminData] promoteDue', e))
    Object.keys(REMOTE_LOADERS).forEach((name) => refetch(name))
    dispatch({ type: 'TOUCH' })
  }, [refetch])

  /* ── Notifications (declared first; other helpers call notify) ── */
  const notify = useCallback((level, title, message) => {
    const saved = { id: `tmp-${Date.now()}`, level, title, message, time: nowLabel(), read: false }
    optimistic('notifications', [saved, ...stateRef.current.notifications].slice(0, 50))
    persist('notifications', () => db.notifications.create({ level, title, message }))
  }, [optimistic, persist])

  const markNotificationsRead = useCallback(() => {
    optimistic('notifications', stateRef.current.notifications.map((n) => (n.read ? n : { ...n, read: true })))
    persist('notifications', () => db.notifications.markAllRead())
  }, [optimistic, persist])

  /* ── Alerts ── */
  const addAlert = useCallback((alert) => {
    const saved = {
      id: `tmp-${Date.now()}`, status: 'active', issued: nowLabel(), issuedAt: Date.now(), ...alert,
    }
    optimistic('alerts', [saved, ...stateRef.current.alerts])
    notify(
      saved.level === 'high' ? 'high' : 'moderate',
      saved.status === 'scheduled' ? 'Alert scheduled' : 'Alert issued',
      `${saved.title} — ${saved.barangay}`,
    )
    persist('alerts', () => db.alerts.create(alert))
    return saved
  }, [optimistic, persist, notify])

  const updateAlert = useCallback((id, updates) => {
    optimistic('alerts', stateRef.current.alerts.map((a) => (a.id === id ? { ...a, ...updates } : a)))
    persist('alerts', () => db.alerts.update(id, updates))
  }, [optimistic, persist])

  const resolveAlert = useCallback((id) => updateAlert(id, { status: 'resolved' }), [updateAlert])

  const removeAlert = useCallback((id) => {
    optimistic('alerts', stateRef.current.alerts.filter((a) => a.id !== id))
    persist('alerts', () => db.alerts.remove(id))
  }, [optimistic, persist])

  /* ── Incidents ── */
  const addIncident = useCallback((incident) => {
    const now = Date.now()
    const saved = {
      id: `tmp-${now}`,
      reported: nowLabel(now),
      reportedAt: now,
      coords: incident.coords || barangayCoords(incident.barangay),
      history: [{ time: nowLabel(now), label: incident.team ? `Reported · assigned to ${incident.team}` : 'Reported' }],
      ...incident,
    }
    optimistic('incidents', [saved, ...stateRef.current.incidents])
    notify(
      saved.priority === 'critical' ? 'high' : 'moderate',
      'Incident reported',
      `${saved.type} — ${saved.barangay}${saved.location ? ` (${saved.location})` : ''}`,
    )
    persist('incidents', () => db.incidents.create({ ...incident, coords: saved.coords }))
    return saved
  }, [optimistic, persist, notify])

  const updateIncident = useCallback((id, updates, note) => {
    // Compute the timeline entries exactly as before, so the optimistic state
    // and the persisted incident_updates rows match.
    const current = stateRef.current.incidents.find((i) => i.id === id)
    const entries = []
    if (note) entries.push(note)
    if (updates.status && current && updates.status !== current.status) {
      entries.push(`Status → ${updates.status.replace('-', ' ')}`)
    }
    if ('team' in updates && current && updates.team !== current.team) {
      entries.push(updates.team ? `Assigned to ${updates.team}` : 'Team unassigned')
    }
    optimistic('incidents', stateRef.current.incidents.map((i) => {
      if (i.id !== id) return i
      const history = entries.length
        ? [...(i.history || []), ...entries.map((label) => ({ time: nowLabel(), label }))]
        : i.history
      return { ...i, ...updates, history }
    }))
    persist('incidents', () => db.incidents.update(id, updates, entries))
  }, [optimistic, persist])

  const removeIncident = useCallback((id) => {
    optimistic('incidents', stateRef.current.incidents.filter((i) => i.id !== id))
    persist('incidents', () => db.incidents.remove(id))
  }, [optimistic, persist])

  /* ── Evacuation centres ── */
  const addEvacCenter = useCallback((center) => {
    const saved = { id: `tmp-${Date.now()}`, coords: center.coords || barangayCoords(center.barangay), ...center }
    optimistic('evacuationCenters', [saved, ...stateRef.current.evacuationCenters])
    persist('evacuationCenters', () => db.evac.create({ ...center, coords: saved.coords }))
    return saved
  }, [optimistic, persist])

  const updateEvacCenter = useCallback((id, updates) => {
    optimistic('evacuationCenters', stateRef.current.evacuationCenters.map((c) => (c.id === id ? { ...c, ...updates } : c)))
    persist('evacuationCenters', () => db.evac.update(id, updates))
  }, [optimistic, persist])

  const removeEvacCenter = useCallback((id) => {
    optimistic('evacuationCenters', stateRef.current.evacuationCenters.filter((c) => c.id !== id))
    persist('evacuationCenters', () => db.evac.remove(id))
  }, [optimistic, persist])

  /* ── Users ── */
  const addUser = useCallback((user) => {
    const saved = { id: `tmp-${Date.now()}`, lastActive: '—', ...user }
    optimistic('users', [saved, ...stateRef.current.users])
    persist('users', () => db.users.create(user))
    return saved
  }, [optimistic, persist])

  const addUsers = useCallback((users) => {
    const stamped = users.map((u, i) => ({ id: `tmp-${Date.now()}-${i}`, lastActive: '—', ...u }))
    optimistic('users', [...stamped, ...stateRef.current.users])
    persist('users', () => db.users.createMany(users))
    return stamped
  }, [optimistic, persist])

  const updateUser = useCallback((id, updates) => {
    optimistic('users', stateRef.current.users.map((u) => (u.id === id ? { ...u, ...updates } : u)))
    persist('users', () => db.users.update(id, updates))
  }, [optimistic, persist])

  const removeUser = useCallback((id) => {
    optimistic('users', stateRef.current.users.filter((u) => u.id !== id))
    persist('users', () => db.users.remove(id))
  }, [optimistic, persist])

  /* ── Integrations ── */
  const setIntegration = useCallback((id, patch) => {
    optimistic('integrations', stateRef.current.integrations.map((it) => (
      it.id === id ? { ...it, ...patch, values: { ...it.values, ...(patch.values || {}) } } : it
    )))
    persist('integrations', () => db.integrations.set(id, patch))
  }, [optimistic, persist])

  /* ── Road reports (Supabase road_status; mirrors onto the painted map) ── */
  const reportRoad = useCallback((report) => {
    const now = Date.now()
    const painted = { passable: null, caution: 'flooded', closed: 'blocked' }[report.status]
    const saved = { id: `rr-${now}`, updated: nowLabel(now), updatedAt: now, ...report }

    // Optimistic: paint the local map + show the report immediately.
    if (saved.wayId != null) {
      const statusMap = readJSON(ROAD_STATUS_KEY, {})
      const next = { ...statusMap }
      if (painted) next[saved.wayId] = painted
      else delete next[saved.wayId]
      writeJSON(ROAD_STATUS_KEY, next)
    } else {
      // Free-text report: persist client-side (the way-keyed table can't hold
      // it) so the report survives refetches. Dedupe by road name, newest wins.
      const needle = saved.name.trim().toLowerCase()
      const local = [saved, ...loadLocalReports().filter((r) => r.name.trim().toLowerCase() !== needle)]
      saveLocalReports(local)
    }
    optimistic('roadReports', [saved, ...stateRef.current.roadReports.filter((r) => (
      r.id !== saved.id &&
      !(saved.wayId && r.wayId === saved.wayId) &&
      !(saved.wayId == null && r.wayId == null && r.name.trim().toLowerCase() === saved.name.trim().toLowerCase())
    ))])

    notify(
      saved.status === 'closed' ? 'high' : 'moderate',
      'Road status reported',
      `${saved.name} (${saved.barangay}) — ${saved.status}`,
    )

    // Persist to Supabase (shared across users), then reconcile.
    persist('roadReports', () => {
      if (saved.wayId == null) return Promise.resolve()
      return painted
        ? db.roadStatus.setWay(saved.wayId, painted, {
            name: saved.name, barangay: saved.barangay, depth: saved.depth,
            depthFt: saved.depthFt, reason: saved.reason, reportedBy: saved.reportedBy,
          })
        : db.roadStatus.removeWay(saved.wayId)
    })
    return saved
  }, [optimistic, persist, notify])

  const removeRoadReport = useCallback((id) => {
    const report = stateRef.current.roadReports.find((r) => r.id === id)
    if (report?.wayId != null) {
      const statusMap = readJSON(ROAD_STATUS_KEY, {})
      if (statusMap[report.wayId]) {
        const next = { ...statusMap }
        delete next[report.wayId]
        writeJSON(ROAD_STATUS_KEY, next)
      }
    } else {
      // Drop the matching free-text report from the client store.
      saveLocalReports(loadLocalReports().filter((r) => r.id !== id))
    }
    optimistic('roadReports', stateRef.current.roadReports.filter((r) => r.id !== id))
    // Only way-keyed reports live in the DB; free-text ones are client-only.
    persist('roadReports', () => (report?.wayId != null ? db.roadStatus.removeWay(report.wayId) : Promise.resolve()))
  }, [optimistic, persist])

  /* ── Saved routes (Supabase-backed) ── */
  const addSavedRoute = useCallback((route) => {
    const saved = { id: `tmp-${Date.now()}`, createdAt: Date.now(), ...route }
    optimistic('savedRoutes', [saved, ...stateRef.current.savedRoutes])
    persist('savedRoutes', () => db.savedRoutes.create(route))
    return saved
  }, [optimistic, persist])

  const updateSavedRoute = useCallback((id, patch) => {
    optimistic('savedRoutes', stateRef.current.savedRoutes.map((r) => r.id === id ? { ...r, ...patch } : r))
    persist('savedRoutes', () => db.savedRoutes.update(id, patch))
  }, [optimistic, persist])

  const removeSavedRoute = useCallback((id) => {
    optimistic('savedRoutes', stateRef.current.savedRoutes.filter((r) => r.id !== id))
    persist('savedRoutes', () => db.savedRoutes.remove(id))
  }, [optimistic, persist])

  /* ── Barangay assignments (still localStorage) ── */
  const assignBarangay = useCallback((name, assignment) => {
    const cur = stateRef.current.barangayAssignments || {}
    const next = { ...cur, [name]: { ...(cur[name] || {}), ...assignment } }
    optimistic('barangayAssignments', next)
    persist('barangayAssignments', () => db.appSettings.set('barangay_assignments', next))
  }, [optimistic, persist])

  /* ── Road change requests (barangay → CDRRMO approval; app_settings) ──────
     A barangay official can't paint the shared map directly: they SUBMIT a
     request to flag a road flooded/closed, and the road only changes on the
     live map once CDRRMO approves it. The queue lives in the shared
     `road_change_requests` app-settings blob, so it syncs to every portal via
     the 6s poll just like barangay assignments. `requestedStatus` is already a
     painted value ('flooded' | 'blocked'), so approval paints it as-is. */
  const submitRoadRequest = useCallback((req) => {
    const now = Date.now()
    const saved = {
      id: `rcr-${now}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'pending',
      requestedAt: now,
      requestedLabel: nowLabel(now),
      ...req,
    }
    const next = [saved, ...stateRef.current.roadChangeRequests]
    optimistic('roadChangeRequests', next)
    notify(
      'moderate',
      'Road condition request',
      `${saved.roadName || `Road #${saved.wayId}`} (${saved.barangay}) → ${saved.requestedStatus} — awaiting CDRRMO approval`,
    )
    persist('roadChangeRequests', () => db.appSettings.set('road_change_requests', next))
    return saved
  }, [optimistic, persist, notify])

  const approveRoadRequest = useCallback((id, meta = {}) => {
    const now = Date.now()
    const cur = stateRef.current.roadChangeRequests
    const req = cur.find((r) => r.id === id)
    if (!req) return
    const next = cur.map((r) => (r.id === id
      ? { ...r, status: 'approved', decidedAt: now, decidedLabel: nowLabel(now), decidedBy: meta.decidedBy || 'CDRRMO', decisionNote: meta.note || '' }
      : r))
    optimistic('roadChangeRequests', next)

    // Paint the road into the shared road-status store — optimistic mirror now,
    // Supabase persist below — so it appears on every map (admin/barangay/resident).
    if (req.wayId != null) {
      const statusMap = readJSON(ROAD_STATUS_KEY, {})
      writeJSON(ROAD_STATUS_KEY, { ...statusMap, [req.wayId]: req.requestedStatus })
    }
    notify(
      req.requestedStatus === 'blocked' ? 'high' : 'moderate',
      'Road request approved',
      `${req.roadName || `Road #${req.wayId}`} (${req.barangay}) → ${req.requestedStatus}`,
    )

    persist('roadChangeRequests', () => Promise.all([
      db.appSettings.set('road_change_requests', next),
      req.wayId != null
        ? db.roadStatus.setWay(req.wayId, req.requestedStatus, {
            name: req.roadName, barangay: req.barangay, reason: req.reason, reportedBy: req.requestedBy,
          })
        : Promise.resolve(),
    ]))
  }, [optimistic, persist, notify])

  const rejectRoadRequest = useCallback((id, note = '') => {
    const now = Date.now()
    const cur = stateRef.current.roadChangeRequests
    const req = cur.find((r) => r.id === id)
    if (!req) return
    const next = cur.map((r) => (r.id === id
      ? { ...r, status: 'rejected', decidedAt: now, decidedLabel: nowLabel(now), decidedBy: 'CDRRMO', decisionNote: note }
      : r))
    optimistic('roadChangeRequests', next)
    notify('moderate', 'Road request declined', `${req.roadName || `Road #${req.wayId}`} (${req.barangay})`)
    persist('roadChangeRequests', () => db.appSettings.set('road_change_requests', next))
  }, [optimistic, persist, notify])

  const removeRoadRequest = useCallback((id) => {
    const next = stateRef.current.roadChangeRequests.filter((r) => r.id !== id)
    optimistic('roadChangeRequests', next)
    persist('roadChangeRequests', () => db.appSettings.set('road_change_requests', next))
  }, [optimistic, persist])

  /* ── Flood-prone areas (depth in feet; shared via app_settings) ──────────────
     Admins set these like road status: pin a location, record the depth in feet
     and the cause. The whole list is persisted as one app-settings blob so it
     syncs to every portal via the 6s poll, exactly like the road requests. */
  const addFloodArea = useCallback((area) => {
    const now = Date.now()
    const saved = { id: `fa-${now}-${Math.random().toString(36).slice(2, 6)}`, updatedAt: now, ...area }
    const next = [saved, ...stateRef.current.floodAreas]
    optimistic('floodAreas', next)
    notify('moderate', 'Flood-prone area added', `${saved.name} (${saved.barangay})`)
    persist('floodAreas', () => db.appSettings.set('flood_areas', next))
    return saved
  }, [optimistic, persist, notify])

  const updateFloodArea = useCallback((id, updates) => {
    const next = stateRef.current.floodAreas.map((a) => (
      a.id === id ? { ...a, ...updates, updatedAt: Date.now() } : a
    ))
    optimistic('floodAreas', next)
    persist('floodAreas', () => db.appSettings.set('flood_areas', next))
  }, [optimistic, persist])

  const removeFloodArea = useCallback((id) => {
    const next = stateRef.current.floodAreas.filter((a) => a.id !== id)
    optimistic('floodAreas', next)
    persist('floodAreas', () => db.appSettings.set('flood_areas', next))
  }, [optimistic, persist])

  const value = useMemo(() => ({
    ...state,
    isLoading,
    refresh,
    addAlert, updateAlert, resolveAlert, removeAlert,
    addIncident, updateIncident, removeIncident,
    addEvacCenter, updateEvacCenter, removeEvacCenter,
    addUser, addUsers, updateUser, removeUser,
    assignBarangay,
    reportRoad, removeRoadReport,
    submitRoadRequest, approveRoadRequest, rejectRoadRequest, removeRoadRequest,
    addFloodArea, updateFloodArea, removeFloodArea,
    setIntegration,
    notify, markNotificationsRead,
    addSavedRoute, updateSavedRoute, removeSavedRoute,
  }), [
    state, isLoading, refresh,
    addAlert, updateAlert, resolveAlert, removeAlert,
    addIncident, updateIncident, removeIncident,
    addEvacCenter, updateEvacCenter, removeEvacCenter,
    addUser, addUsers, updateUser, removeUser,
    assignBarangay, reportRoad, removeRoadReport,
    submitRoadRequest, approveRoadRequest, rejectRoadRequest, removeRoadRequest,
    addFloodArea, updateFloodArea, removeFloodArea,
    setIntegration, notify, markNotificationsRead,
    addSavedRoute, updateSavedRoute, removeSavedRoute,
  ])

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>
}

export function useAdminData() {
  const ctx = useContext(AdminDataContext)
  if (!ctx) throw new Error('useAdminData must be used inside <AdminDataProvider>')
  return ctx
}

/* ── Focused hooks (what the screens actually import) ────────────────────── */
export function useAlerts() {
  const { alerts, addAlert, updateAlert, resolveAlert, removeAlert } = useAdminData()
  return { alerts, addAlert, updateAlert, resolveAlert, removeAlert }
}

export function useIncidents() {
  const { incidents, addIncident, updateIncident, removeIncident } = useAdminData()
  return { incidents, addIncident, updateIncident, removeIncident }
}

export function useEvacCenters() {
  const { evacuationCenters, addEvacCenter, updateEvacCenter, removeEvacCenter } = useAdminData()
  return { evacuationCenters, addEvacCenter, updateEvacCenter, removeEvacCenter }
}

export function useUsers() {
  const { users, addUser, addUsers, updateUser, removeUser } = useAdminData()
  return { users, addUser, addUsers, updateUser, removeUser }
}

export function useBarangayAssignments() {
  const { barangayAssignments, assignBarangay } = useAdminData()
  return { barangayAssignments, assignBarangay }
}

export function useRoadReports() {
  const { roadReports, reportRoad, removeRoadReport } = useAdminData()
  return { roadReports, reportRoad, removeRoadReport }
}

/**
 * Road change requests (barangay → CDRRMO approval queue). Officials submit;
 * only CDRRMO can approve (which paints the shared map) or reject.
 */
export function useRoadRequests() {
  const {
    roadChangeRequests, submitRoadRequest, approveRoadRequest, rejectRoadRequest, removeRoadRequest,
  } = useAdminData()
  return { roadChangeRequests, submitRoadRequest, approveRoadRequest, rejectRoadRequest, removeRoadRequest }
}

export function useIntegrations() {
  const { integrations, setIntegration } = useAdminData()
  return { integrations, setIntegration }
}

/**
 * Documented flood-prone areas (depth in feet). Admins (CDRRMO) get the full
 * CRUD; the barangay/resident maps consume `floodAreas` read-only.
 */
export function useFloodAreas() {
  const { floodAreas, addFloodArea, updateFloodArea, removeFloodArea } = useAdminData()
  return { floodAreas, addFloodArea, updateFloodArea, removeFloodArea }
}

/**
 * Supabase-backed saved routes — same [routes, helpers] shape as the
 * localStorage-only useRoutes() in routingHelpers, so pages can swap imports
 * without changing call sites.
 */
export function useSavedRoutes() {
  const { savedRoutes, addSavedRoute, updateSavedRoute, removeSavedRoute } = useAdminData()
  return [savedRoutes, { addRoute: addSavedRoute, updateRoute: updateSavedRoute, removeRoute: removeSavedRoute }]
}

export function useNotifications() {
  const { notifications, notify, markNotificationsRead } = useAdminData()
  return { notifications, notify, markNotificationsRead }
}

/* ── Alert settings (shared via app_settings; localStorage = instant cache) ── */
const ALERT_SETTINGS_DBKEY = 'alert_settings'

export const ALERT_SETTINGS_DEFAULTS = {
  email: true, push: false,
  autoIssue: false, triggerLevel: 'high', reissueInterval: 30,
  tplHigh: '🚨 SEVERE FLOOD WARNING for {barangay}. Water level has reached {depth} m. Evacuate low-lying areas immediately and proceed to the nearest evacuation center.',
  tplModerate: '⚠️ Flood advisory for {barangay}. Water level is rising ({depth} m). Avoid flooded roads and prepare to evacuate if conditions worsen.',
  tplSafe: '✅ ALL CLEAR for {barangay}. Flood waters have receded. Stay alert for further advisories from CDRRMO.',
  toStaff: true, toOfficials: true, toResidents: false,
  quietHours: false, quietFrom: '22:00', quietTo: '05:00', maxPerHour: 4,
}

/** Sync read of the localStorage cache — instant render before the remote load. */
export function loadAlertSettings() {
  return { ...ALERT_SETTINGS_DEFAULTS, ...readJSON(KEYS.alertSettings, {}) }
}

/** Pull the shared settings from Supabase, refresh the local cache, return them. */
export async function loadAlertSettingsRemote() {
  try {
    const remote = await db.appSettings.get(ALERT_SETTINGS_DBKEY)
    if (remote) {
      const merged = { ...ALERT_SETTINGS_DEFAULTS, ...remote }
      writeJSON(KEYS.alertSettings, merged)
      return merged
    }
  } catch (e) {
    console.error('[AlertSettings] remote load failed', e)
  }
  return loadAlertSettings()
}

/** Persist to the shared backend (app_settings) and the local cache. */
export function saveAlertSettings(cfg) {
  writeJSON(KEYS.alertSettings, cfg) // optimistic cache for instant + offline read
  return db.appSettings.set(ALERT_SETTINGS_DBKEY, cfg)
    .catch((e) => console.error('[AlertSettings] remote save failed', e))
}
