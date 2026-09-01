/* ============================================================================
   snapshot-data.mjs — a local JSON copy of the operational tables.

   WHY THIS EXISTS
   Phase 0 of the remediation plan wants a restore point before anything else,
   because until the anon write hole is closed a stranger can empty this
   database. The authoritative backup is the Supabase dashboard's (Database →
   Backups) — this does NOT replace it.

   What this adds is a copy you hold, on your own disk, of exactly the data the
   hole threatens: the alerts, incidents, road statuses and evacuation centres
   that represent real operational history and that nobody could reconstruct.

   DELIBERATELY PARTIAL, and it says so in the manifest it writes. It reads
   with the public anon key, so it cannot see:
     · password hashes (revoked from anon — correctly)
     · auth_codes, trusted_devices, sms_* (RLS-locked — correctly)
     · app_settings (locked)
   Those need a real dashboard backup or pg_dump with the database password.
   This is a safety net for the operational record, not a disaster-recovery
   plan.

   Usage:  node scripts/snapshot-data.mjs
   Writes: backups/snapshot-<ISO date>/<table>.json  + manifest.json
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
const ANON = env.VITE_SUPABASE_ANON_KEY

const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', DIM = '\x1b[2m'
const BOLD = '\x1b[1m', RESET = '\x1b[0m'

const TABLES = [
  'accounts', 'alerts', 'incidents', 'incident_updates', 'evacuation_centers',
  'road_status', 'notifications', 'saved_routes', 'flood_reports', 'residents',
  'barangays', 'barangay_officials', 'hazard_zones', 'flood_readings',
  'integrations', 'roles',
]

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = join(ROOT, 'backups', `snapshot-${stamp}`)
mkdirSync(outDir, { recursive: true })

console.log(`${BOLD}Snapshotting operational data${RESET}`)
console.log(`${DIM}${URL_}${RESET}`)
console.log(`${DIM}→ ${outDir}${RESET}\n`)

const manifest = {
  takenAt: new Date().toISOString(),
  source: URL_,
  readAs: 'anon (public key)',
  partial: true,
  omitted: [
    'accounts.password_hash / password_plain — revoked from anon',
    'auth_codes, trusted_devices, sms_subscribers, sms_messages, sms_codes — RLS-locked',
    'app_settings — locked',
  ],
  note: 'Supplementary to the Supabase dashboard backup, not a replacement.',
  tables: {},
}

let total = 0
for (const t of TABLES) {
  const res = await fetch(`${URL_}/rest/v1/${t}?select=*`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  })
  if (!res.ok) {
    console.log(`  ${YELLOW}skipped${RESET}  ${t.padEnd(22)} ${DIM}HTTP ${res.status}${RESET}`)
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

console.log(`\n${GREEN}${BOLD}${total} rows saved.${RESET}`)
console.log(`${DIM}Still take the dashboard backup — this covers operational data only.${RESET}`)
