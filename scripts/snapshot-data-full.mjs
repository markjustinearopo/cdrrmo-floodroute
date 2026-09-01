/* ============================================================================
   snapshot-data-full.mjs — a complete local copy of every table's data.

   WHY THIS EXISTS, AND WHY IT'S DIFFERENT FROM snapshot-data.mjs
   Phase 0 wants a restore point before anything else. The Free Supabase plan
   has no platform-managed backup at all (Pro and up only), and the official
   `supabase db dump` CLI command shells out to pg_dump inside Docker — which
   isn't installed here. Installing Docker Desktop for a one-off backup is a
   real option, but a heavier one than this situation needs.

   The SCHEMA (every table/column/function/trigger) is already fully
   recoverable without any of that: it's tracked in supabase/migrations/*.sql
   in this repo's own git history. What is NOT recoverable from git is the
   DATA — the real 40 accounts, the real alert history, the real flood
   reports. That's what this captures, completely, using the service_role key
   (which bypasses RLS and the column-level grants) instead of the anon key
   snapshot-data.mjs uses — so unlike that script, this one can see
   `accounts.password_hash`, `app_settings`, and the RLS-locked auth/SMS
   tables too.

   THIS IS THEREFORE MAXIMALLY SENSITIVE OUTPUT. It contains bcrypt password
   hashes, one-time-code hashes, and every resident's/official's contact
   info. It goes in backups/ (gitignored — see .gitignore) and should stay on
   this machine only.

   THE SERVICE ROLE KEY NEVER TOUCHES DISK OR THIS REPO. Pass it as an
   environment variable on the command line so it exists only for the
   lifetime of this one process:

       SUPABASE_SERVICE_ROLE_KEY="your-key-here" node scripts/snapshot-data-full.mjs

   Get the key from: Project Settings > API > service_role secret
   (https://supabase.com/dashboard/project/sreazvhevxijkespxxac/settings/api).
   Do not put it in .env, do not commit it, do not paste it anywhere but this
   one command.

   Usage:  SUPABASE_SERVICE_ROLE_KEY="..." node scripts/snapshot-data-full.mjs
   Writes: backups/full-snapshot-<ISO date>/<table>.json + manifest.json
   ============================================================================ */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const URL_ = env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', DIM = '\x1b[2m'
const BOLD = '\x1b[1m', RESET = '\x1b[0m'

if (!SERVICE_KEY) {
  console.error(`${RED}${BOLD}SUPABASE_SERVICE_ROLE_KEY is not set.${RESET}`)
  console.error('Get it from Settings > API > service_role secret, then run:\n')
  console.error('  SUPABASE_SERVICE_ROLE_KEY="paste-it-here" node scripts/snapshot-data-full.mjs\n')
  console.error(`${DIM}(pass it inline like this — never put it in .env or commit it)${RESET}`)
  process.exit(1)
}

/* Every table found across supabase/migrations/*.sql plus the ones set up
   directly via the dashboard before migrations were adopted (accounts,
   alerts, incidents, evacuation_centers, road_status, saved_routes,
   residents, barangays, barangay_officials, flood_readings). */
const TABLES = [
  'accounts', 'alerts', 'incidents', 'incident_updates', 'evacuation_centers',
  'road_status', 'notifications', 'saved_routes', 'flood_reports',
  'flood_report_logs', 'residents', 'barangays', 'barangay_officials',
  'hazard_zones', 'flood_readings', 'integrations', 'roles', 'app_settings',
  'auth_codes', 'sms_codes', 'sms_messages', 'sms_subscribers',
  'trusted_devices',
]

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = join(ROOT, 'backups', `full-snapshot-${stamp}`)
mkdirSync(outDir, { recursive: true })

console.log(`${BOLD}Full data snapshot (service role — sees everything)${RESET}`)
console.log(`${DIM}${URL_}${RESET}`)
console.log(`${DIM}→ ${outDir}${RESET}\n`)
console.log(`${YELLOW}Contains password hashes and one-time-code hashes. Local only.${RESET}\n`)

const manifest = {
  takenAt: new Date().toISOString(),
  source: URL_,
  readAs: 'service_role (full access)',
  sensitive: true,
  note: 'Schema lives in supabase/migrations/*.sql (git); this is the data those migrations do not capture.',
  tables: {},
}

let total = 0
for (const t of TABLES) {
  const res = await fetch(`${URL_}/rest/v1/${t}?select=*`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!res.ok) {
    const body = await res.text()
    console.log(`  ${YELLOW}skipped${RESET}  ${t.padEnd(22)} ${DIM}HTTP ${res.status} ${body.slice(0, 80)}${RESET}`)
    manifest.tables[t] = { rows: null, status: res.status }
    continue
  }
  const rows = await res.json()
  writeFileSync(join(outDir, `${t}.json`), JSON.stringify(rows, null, 2))
  manifest.tables[t] = { rows: rows.length }
  total += rows.length
  console.log(`  ${GREEN}saved${RESET}    ${t.padEnd(22)} ${DIM}${rows.length} row(s)${RESET}`)
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

console.log(`\n${GREEN}${BOLD}${total} rows saved across ${TABLES.length} tables.${RESET}`)
console.log(`${DIM}Schema: supabase/migrations/*.sql (already in git).${RESET}`)
console.log(`${DIM}Restore, if ever needed: re-insert these JSON files into a fresh schema,`)
console.log(`${DIM}or ask for a restore script once you actually need one.${RESET}`)
