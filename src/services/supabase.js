/* ============================================================
   Supabase client — the single connection to the Postgres + PostGIS
   backend (project cdrrmo-floodroute). Configured from environment
   variables in .env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).

   The publishable/anon key is meant to be shipped in the browser;
   row-level security on the database is what actually guards the data.

   IDENTITY (Phase 1 of the identity/RLS fix, see supabase/PENDING_MIGRATIONS.sql
   2026-08-30 section): auth-otp mints a real signed JWT at sign-in and
   src/services/api.js stores it under TOKEN_KEY. This client has no Supabase
   Auth session to carry it automatically (persistSession: false, above), so
   the custom `fetch` below attaches it as the Authorization bearer on every
   request by reading storage at call time — that is also what lets a single
   module-level client instance reflect sign-in/sign-out/expiry without being
   recreated. Until Phase 2 writes real RLS policies against those claims,
   this changes nothing about what any request is allowed to do; it only
   makes the caller's identity visible to Postgres via auth.jwt().
   ============================================================ */

import { createClient } from '@supabase/supabase-js'
import { clearPrivateOfflineData } from './offline.js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  // Surface a clear message instead of a cryptic network error if .env is missing.
  console.error(
    '[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
    'Add them to .env and restart the dev server.',
  )
}

/** localStorage key for the signed session token. Shared with api.js so
 *  there is exactly one name for it, not two strings kept in sync by hand. */
export const TOKEN_KEY = 'cdrrmo_token'

export const supabase = createClient(url, key, {
  auth: { persistSession: false }, // app uses its own accounts table, not Supabase Auth
  global: {
    fetch: (input, init = {}) => {
      const token = localStorage.getItem(TOKEN_KEY)
      const headers = new Headers(init.headers)
      if (!token) {
        return fetch(input, { ...init, headers })
      }
      headers.set('Authorization', `Bearer ${token}`)
      return fetch(input, { ...init, headers }).then((res) => {
        // The token expired or was rejected: drop it so the next route
        // render sends the user back to /login instead of silently failing
        // every request from here on (see RequireAuth.jsx).
        if (res.status === 401 && localStorage.getItem(TOKEN_KEY) === token) {
          localStorage.removeItem(TOKEN_KEY)
          localStorage.removeItem('cdrrmo_user')
          clearPrivateOfflineData()
          window.dispatchEvent(new Event('cdrrmo-session'))
        }
        return res
      })
    },
  },
})

export default supabase
