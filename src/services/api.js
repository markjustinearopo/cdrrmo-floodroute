/* ============================================================
   API service — ported from the original assets/js/api.js
   Talks to the Node.js + Express backend (Conceptual Framework).
   ============================================================ */

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'

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

  async request(endpoint, options = {}) {
    const token = this.getToken()
    const headers = { 'Content-Type': 'application/json', ...options.headers }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers })

    if (res.status === 401) {
      this.clearToken()
      window.location.href = '/login'
      throw new Error('Session expired')
    }

    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Request failed')
    return data
  },

  get(endpoint) {
    return this.request(endpoint)
  },

  post(endpoint, body) {
    return this.request(endpoint, { method: 'POST', body: JSON.stringify(body) })
  },

  put(endpoint, body) {
    return this.request(endpoint, { method: 'PUT', body: JSON.stringify(body) })
  },

  del(endpoint) {
    return this.request(endpoint, { method: 'DELETE' })
  },
}

/* ------------------------------------------------------------------
   Flood Hazard Data Store (D2) — hazard layer endpoints.

   These mirror the backend contract described in the Conceptual
   Framework / DFD: processed flood-inundation polygons and risk
   classifications served as GeoJSON, plus a roll-up of hazard
   statistics. Until the Node/Express + PostGIS backend is wired in,
   every call resolves to an empty layer so the UI renders the base
   map with no hazards (data comes from the database, not the UI).
   ------------------------------------------------------------------ */
export const hazardApi = {
  // GeoJSON FeatureCollection of flood-inundation polygons (D2).
  getHazardLayer(category = 'inundation') {
    return api.get(`/hazard-layers/${category}`)
  },

  // Roll-up: inundated area, average depth, high-risk zone count, etc.
  getHazardSummary() {
    return api.get('/hazard-layers/summary')
  },

  /**
   * Live river-discharge reading from the Open-Meteo Flood API — one of the
   * external feeds named in the Conceptual Framework. No API key required.
   * Returns today's discharge (m³/s) for the given point, or null on failure
   * so the caller can fall back to a placeholder.
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

// Maps a role to its dashboard route within the React app.
export function getRoleForRedirect(role) {
  const map = {
    admin: '/admin/dashboard',
    barangay: '/barangay/dashboard',
    resident: '/resident/dashboard',
  }
  return map[role] || '/login'
}

export default api
