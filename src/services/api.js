/* ============================================================
   API service.

   Session helpers (token + cached user) plus thin resource wrappers.
   The data wrappers now talk to Supabase through ./db.js instead of a
   Node/Express backend; AdminDataContext is the main consumer of the
   live data, these exports are kept for any direct callers.
   ============================================================ */

import db from './db.js'

const api = {
  getToken() {
    return localStorage.getItem('cdrrmo_token')
  },
  setToken(token) {
    localStorage.setItem('cdrrmo_token', token)
  },
  clearToken() {
    localStorage.removeItem('cdrrmo_token')
    localStorage.removeItem('cdrrmo_user')
  },
  getUser() {
    try {
      return JSON.parse(localStorage.getItem('cdrrmo_user'))
    } catch {
      return null
    }
  },
  setUser(user) {
    localStorage.setItem('cdrrmo_user', JSON.stringify(user))
  },
}

/* ------------------------------------------------------------------
   Auth — custom accounts table via Supabase SECURITY DEFINER RPCs
   (app_login / app_register_resident). No Node backend required.
   ------------------------------------------------------------------ */
export const authApi = {
  /** Returns the signed-in user record; throws on bad credentials. */
  async login(identifier, password) {
    const user = await db.auth.login(identifier, password)
    api.setToken(`local-${user.id}`) // placeholder session token
    api.setUser(user)
    return user
  },
  async registerResident(payload) {
    return db.auth.registerResident(payload)
  },
  logout() {
    api.clearToken()
  },
}

/* ------------------------------------------------------------------
   Flood hazard data — river discharge stays on Open-Meteo (keyless);
   hazard polygons come from the PostGIS `hazard_zones` table.
   ------------------------------------------------------------------ */
export const hazardApi = {
  async getHazardLayer(category = 'inundation') {
    try {
      const rows = await db.ref.hazardZones(category)
      return { type: 'FeatureCollection', features: rows.map((r) => ({
        type: 'Feature',
        properties: { id: r.id, risk_class: r.risk_class, depth_m: r.depth_m, barangay: r.barangay, ...r.properties },
        geometry: r.geom || null,
      })) }
    } catch {
      return { type: 'FeatureCollection', features: [] }
    }
  },

  /**
   * Live river-discharge reading from the Open-Meteo Flood API. No key needed.
   * Returns today's discharge (m³/s) for the point, or null on failure.
   */
  async getRiverDischarge(lat, lng) {
    try {
      const url =
        `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}` +
        `&longitude=${lng}&daily=river_discharge&forecast_days=1`
      const res = await fetch(url)
      if (!res.ok) return null
      const data = await res.json()
      const value = data?.daily?.river_discharge?.[0]
      return typeof value === 'number' ? value : null
    } catch {
      return null
    }
  },
}

/* ------------------------------------------------------------------
   Resource wrappers — delegate to Supabase via db.js.
   ------------------------------------------------------------------ */
export const alertsApi = {
  list: () => db.alerts.list(),
  create: (item) => db.alerts.create(item),
  update: (id, updates) => db.alerts.update(id, updates),
  remove: (id) => db.alerts.remove(id),
}
export const incidentsApi = {
  list: () => db.incidents.list(),
  create: (item) => db.incidents.create(item),
  update: (id, updates) => db.incidents.update(id, updates),
  remove: (id) => db.incidents.remove(id),
}
export const evacApi = {
  list: () => db.evac.list(),
  create: (item) => db.evac.create(item),
  update: (id, updates) => db.evac.update(id, updates),
  remove: (id) => db.evac.remove(id),
}
export const usersApi = {
  list: () => db.users.list(),
  create: (item) => db.users.create(item),
  update: (id, updates) => db.users.update(id, updates),
  remove: (id) => db.users.remove(id),
}

// Maps a role to its dashboard route within the React app.
export function getRoleForRedirect(role) {
  const map = {
    admin: '/admin/dashboard',
    staff: '/admin/dashboard', // accounts.role CHECK uses 'staff' for EOC/operator
    operator: '/admin/dashboard',
    viewer: '/admin/dashboard',
    officer: '/barangay/dashboard',
    barangay: '/barangay/dashboard',
    resident: '/resident/dashboard',
  }
  return map[role] || '/login'
}

export default api
