/* ============================================================
   API service.

   Session helpers (token + cached user) plus thin resource wrappers.
   The data wrappers now talk to Supabase through ./db.js instead of a
   Node/Express backend; AdminDataContext is the main consumer of the
   live data, these exports are kept for any direct callers.
   ============================================================ */

import db from './db.js'
import * as otp from './authOtp.js'
import { TOKEN_KEY } from './supabase.js'

const api = {
  getToken() {
    return localStorage.getItem(TOKEN_KEY)
  },
  setToken(token) {
    // Falsy for the break-glass fallback (legacyLogin, below) — it has no path
    // to the signing secret, so it cannot mint a real one. Must actively clear
    // rather than leave a stale value, or a previous real session's token
    // would keep being sent as this "session"'s identity.
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  },
  clearToken() {
    localStorage.removeItem(TOKEN_KEY)
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
   Auth.

   Sign-in and registration now go through the `auth-otp` Edge Function
   (services/authOtp.js), not straight to the app_login RPC — the second
   factor and the email-verification gate have to be enforced somewhere the
   browser cannot skip, and one-time codes have to be minted somewhere the
   browser never sees them.

   `login()` no longer always returns a user: an account with two-factor on
   returns a challenge instead, and the caller finishes with `completeMfa()`.
   Callers that only need "am I signed in" keep using getUser()/getToken().
   ------------------------------------------------------------------ */
export const authApi = {
  /**
   * Password sign-in. Resolves to one of:
   *   { user }                     — signed in, session stored
   *   { mfaRequired: true, email } — a code was mailed; call completeMfa()
   *   { unverified: true, email }  — address never confirmed; verify first
   * Throws on bad credentials.
   */
  async login(identifier, password) {
    try {
      const res = await otp.login(identifier, password)
      if (res?.user) {
        startSession(res.user, res.token)
        return { user: res.user }
      }
      return res
    } catch (err) {
      if (err instanceof otp.AuthFunctionUnavailable && !REQUIRE_AUTH_FUNCTION) {
        const user = await legacyLogin(identifier, password)
        return { user, degraded: true }
      }
      throw err
    }
  },

  /** Finish a two-factor sign-in with the emailed code. */
  async completeMfa(email, code, trustDevice = false) {
    const res = await otp.verifyLogin(email, code, trustDevice)
    startSession(res.user, res.token)
    return res.user
  },

  /**
   * Sign in with a Google credential.
   *
   * Resolves to { user } when the address is already an account, or to
   * { needsBarangay: true, ticket, email, fullName } when it is not — Google
   * cannot tell us which barangay someone lives in, and this system cannot
   * serve an account without one.
   *
   * The session is only started in the first case; the second is not yet an
   * account.
   */
  async googleSignIn(credential) {
    const res = await otp.googleSignIn(credential)
    if (res?.needsBarangay) return res
    startSession(res.user, res.token)
    return { user: res.user }
  },

  /** Finish a first-time Google sign-up with the barangay they chose. */
  async completeGoogleSignUp(ticket, barangay) {
    const res = await otp.completeGoogleSignUp(ticket, barangay)
    startSession(res.user, res.token)
    return { user: res.user, created: res.created }
  },

  /**
   * Create a resident account. Resolves to { pending: true, email } — the
   * account exists but cannot sign in until verifyEmail() succeeds.
   *
   * Falls back to the legacy RPC on the same "function not deployed" condition
   * as login(), and reports { degraded: true } so the page skips the code step
   * instead of asking for an email that was never sent.
   */
  async registerResident(payload) {
    try {
      const res = await otp.registerResident(payload)
      /* The verification code could not be delivered on ANY channel, so the
         server activated the account rather than leaving a real resident
         locked out of one they cannot open. It handed back a session; start
         it here so the screen can carry them straight in, and let the caller
         surface `notice` — the reader is owed the reason. */
      if (res?.unverifiedFallback && res.user) startSession(res.user, res.token)
      return res
    } catch (err) {
      if (err instanceof otp.AuthFunctionUnavailable && !REQUIRE_AUTH_FUNCTION) {
        const { email, password, fullName, barangay } = payload
        try {
          await db.auth.registerResident({ email, password, fullName, barangay })
        } catch (rpcErr) {
          /* The two halves of this change ship together, and this is the state
             where only one of them landed: the migration has been run (so
             app_register_resident is revoked from anon) but auth-otp has not
             been deployed (so the call above 404s and we fell back here).

             There is no safe way through — the fallback's whole route into the
             database is the function the migration deliberately closed, and
             re-opening it would undo the control that was just installed. So
             this says what is actually wrong instead of surfacing a raw
             Postgres "permission denied for function" to a resident. */
          if (isPermissionDenied(rpcErr)) {
            throw new Error(
              'Account creation is temporarily unavailable: the email-verification ' +
              'service has not been deployed yet. Please contact CDRRMO IT support — ' +
              'existing accounts can still sign in normally.',
            )
          }
          throw rpcErr
        }
        return { degraded: true, email }
      }
      throw err
    }
  },

  /** Activate a pending account, then sign it in. */
  async verifyEmail(email, code) {
    const res = await otp.verifyEmail(email, code)
    if (res?.user) startSession(res.user, res.token)
    return res
  },

  /** Send a password-reset code. Same answer whether or not the account
   *  exists — see requestReset in authOtp.js. */
  requestReset: otp.requestReset,

  /** Finish a reset: code + new password, then straight into a session. */
  async confirmReset(email, code, password) {
    const res = await otp.confirmReset(email, code, password)
    if (res?.user) startSession(res.user, res.token)
    return res
  },

  resendCode: otp.resendCode,
  requestChallenge: otp.requestChallenge,
  solveChallenge: otp.solveChallenge,

  logout() {
    api.clearToken()
  },

  /** Sign out AND stop trusting this device — the shared-phone case. */
  async logoutEverywhere() {
    api.clearToken()
    await otp.forgetDevice()
  },
}

/**
 * @param {object} user
 * @param {string} [token] Signed JWT minted by auth-otp (see mintToken() there).
 *   Absent only from legacyLogin() below, which has no path to the signing
 *   secret; setToken() clears rather than fakes one in that case.
 */
function startSession(user, token) {
  api.setToken(token)
  api.setUser(user)
}

/* ------------------------------------------------------------------
   Break-glass fallback — OFF in normal operation.

   The two-factor and email-verification gates live in the `auth-otp` Edge
   Function, deployed and verified on 2026-08-26. VITE_REQUIRE_AUTH_FUNCTION is
   set to true in .env, so everything below is unreachable: a function that
   cannot be reached is a hard sign-in failure, which is what it should be.

   It is kept, rather than deleted, for one situation: if auth-otp is ever
   removed, broken by a bad deploy, or its platform is down, unsetting that one
   variable restores password sign-in for CDRRMO operators. This is a
   flood-warning system — being unable to reach the command centre during an
   event is a worse failure than a temporarily weaker sign-in, but that has to
   be a deliberate call by an operator, not something the network can trigger.

   Two properties make it safe to keep:
     · It only fires when the function is UNREACHABLE. A function that answers
       with an error is never fallen back on, so a rejected code or a failed
       human check cannot be downgraded by retrying.
     · It routes through app_register_resident for sign-up, which the migration
       revoked from anon — so even with the flag off, self-registration cannot
       bypass email verification. It fails with a clear message instead.
   ------------------------------------------------------------------ */
const REQUIRE_AUTH_FUNCTION = String(import.meta.env.VITE_REQUIRE_AUTH_FUNCTION) === 'true'

let warnedOnce = false
async function legacyLogin(identifier, password) {
  if (!warnedOnce) {
    warnedOnce = true
    console.warn(
      '[auth] The auth-otp Edge Function is not deployed, so two-factor ' +
      'sign-in and the email-verification gate are NOT being enforced. ' +
      'Deploy it (npx supabase functions deploy auth-otp) and set ' +
      'VITE_REQUIRE_AUTH_FUNCTION=true.',
    )
  }
  const user = await db.auth.login(identifier, password)
  // No token: this path only ever holds the anon key, never the signing
  // secret. Once RLS is locked down (Phase 2) this session reads as anon to
  // Postgres — the UI shell admits it, real data calls do not. Fails safe.
  startSession(user)
  return user
}

/** True when the last sign-in used the fallback above. Drives the UI notice. */
export function authIsDegraded() {
  return warnedOnce
}

/**
 * Postgres 42501 — the role lacks EXECUTE on the function. db.js flattens the
 * Supabase error to `new Error(error.message)`, so the code is not preserved
 * and the message text is what there is to match on.
 */
function isPermissionDenied(err) {
  const m = String(err?.message || '')
  return err?.code === '42501' || /permission denied/i.test(m)
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

// Maps a role to its landing route within the React app. CDRRMO staff land on
// the Flood Map: the map is where the work actually happens, and an operator
// opening the system during an event wants the city, not a summary of it.
export function getRoleForRedirect(role) {
  const map = {
    admin: '/admin/flood-map',
    staff: '/admin/flood-map', // accounts.role CHECK uses 'staff' for EOC/operator
    operator: '/admin/flood-map',
    viewer: '/admin/flood-map',
    officer: '/barangay/dashboard',
    barangay: '/barangay/dashboard',
    resident: '/resident/dashboard',
  }
  return map[role] || '/login'
}

export default api
