/* ============================================================
   Barangay-portal session helpers.

   A Barangay Official manages a SINGLE barangay — their own
   jurisdiction. Which barangay that is comes from the logged-in
   user record (the backend returns it on /auth/login) or, until the
   API is wired in, from the barangay they picked on the login screen.

   Nothing here is demo data: collections start empty and every screen
   pulls its live records from the same Node/Express + database backend
   the admin portal uses, so a report filed by a barangay shows up in
   the city command center and vice-versa.
   ============================================================ */

import api from '../services/api.js'

// Key the login screen writes the chosen barangay to, so the portal can
// scope itself even before the auth backend exists.
export const OFFICIAL_BRGY_KEY = 'cdrrmo_brgy'

/**
 * The barangay this official governs. Prefers the authenticated user's
 * record, falling back to the login selection. Empty string when unknown
 * (e.g. the portal was opened directly without signing in).
 */
export function getOfficialBarangay() {
  const user = api.getUser?.()
  return user?.barangay || localStorage.getItem(OFFICIAL_BRGY_KEY) || ''
}

/** A safe display label for the header/titles when no barangay is set yet. */
export function officialBarangayLabel() {
  return getOfficialBarangay() || 'Your Barangay'
}

/**
 * Best-effort GET against the shared backend. Resolves to `fallback` on any
 * failure (network error, backend not running yet) so screens render their
 * empty state instead of throwing. This is how "data starts at none, then
 * fills from the database" is honoured without a backend in place.
 */
export async function safeGet(endpoint, fallback = null) {
  try {
    const data = await api.get(endpoint)
    return data ?? fallback
  } catch {
    return fallback
  }
}

/**
 * Best-effort write (POST/PUT/DELETE) that never rejects — the barangay UI
 * updates optimistically and this syncs the change to the database when the
 * backend is reachable. Returns true on success, false otherwise.
 */
export async function safeSend(method, endpoint, body) {
  try {
    await api[method](endpoint, body)
    return true
  } catch {
    return false
  }
}

/** Encode the official's barangay as a query filter for shared endpoints. */
export function brgyQuery(extra = '') {
  const b = getOfficialBarangay()
  const base = b ? `barangay=${encodeURIComponent(b)}` : ''
  const tail = extra ? (base ? `&${extra}` : extra) : ''
  const qs = `${base}${tail}`
  return qs ? `?${qs}` : ''
}
