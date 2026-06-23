/* ============================================================
   Supabase client — the single connection to the Postgres + PostGIS
   backend (project cdrrmo-floodroute). Configured from environment
   variables in .env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).

   The publishable/anon key is meant to be shipped in the browser;
   row-level security on the database is what actually guards the data.
   ============================================================ */

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  // Surface a clear message instead of a cryptic network error if .env is missing.
  console.error(
    '[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
    'Add them to .env and restart the dev server.',
  )
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false }, // app uses its own accounts table, not Supabase Auth
})

export default supabase
