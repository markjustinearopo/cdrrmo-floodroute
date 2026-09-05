/* ============================================================================
   verify-official-accounts.mjs — did the account roster actually land?

   Run this AFTER pasting credentials/official-accounts.sql into the Supabase
   SQL Editor. It signs in through the same auth-otp endpoint the login screen
   uses, then reads the accounts table back with that session and compares it,
   row by row, against credentials/roster.json.

   It answers three separate questions, because they fail differently:

     1. Can the account sign in at all?      (a real login, not a table read)
     2. Is every account on the sheet there? (missing / extra rows)
     3. Does each row say what it should?    (name, role, barangay, flags)

   Nothing here is hard-coded — the roster and the test password both come from
   credentials/, which is git-ignored. This repository is public.

   Run:  node scripts/verify-official-accounts.mjs
   ============================================================================ */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const BASE = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
if (!BASE || !KEY) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env')

const ROSTER_PATH = join(ROOT, 'credentials', 'roster.json')
if (!existsSync(ROSTER_PATH)) {
  console.error('\ncredentials/roster.json is missing — run scripts/make-official-accounts.mjs first.\n')
  process.exit(1)
}
const { accounts: roster } = JSON.parse(readFileSync(ROSTER_PATH, 'utf8'))

const ok = (s) => `\x1b[32m${s}\x1b[0m`
const bad = (s) => `\x1b[31m${s}\x1b[0m`
const warn = (s) => `\x1b[33m${s}\x1b[0m`

async function login(identifier, password) {
  const r = await fetch(`${BASE}/functions/v1/auth-otp`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', identifier, password }),
  })
  const body = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, body }
}

console.log(`\nBackend: ${BASE}`)
console.log(`Roster:  ${roster.length} accounts\n${'='.repeat(66)}`)

/* ── 1. A real sign-in ──────────────────────────────────────────────────────
   The test admin, because it is the one account on the sheet that is meant to
   go straight to a dashboard: no first-login password prompt, no second
   factor. If this fails, nothing below can run — a table read needs the JWT
   the sign-in returns. */
const probe = roster.find((a) => a.id === 'TEST-ADMIN-1')
const signin = await login(probe.id, probe.password)
if (!signin.ok) {
  console.log(bad(`\nSign-in as ${probe.id} failed — HTTP ${signin.status}: ${signin.body.error ?? ''}`))
  console.log('\nThe SQL has probably not been run yet. Paste credentials/official-accounts.sql')
  console.log(`into ${BASE.replace('https://', 'https://supabase.com/dashboard/project/').replace('.supabase.co', '')}/sql/new and run it, then try again.\n`)
  process.exit(1)
}
const token = signin.body.token
console.log(ok(`Sign-in as ${probe.id} succeeded — role ${signin.body.user?.role}`))

/* ── 2 & 3. Read the table back and diff it against the sheet ─────────────── */
const res = await fetch(
  `${BASE}/rest/v1/accounts?select=id,username,email,full_name,role,barangay,position,status,must_change_password,mfa_enabled&order=id`,
  { headers: { apikey: KEY, Authorization: `Bearer ${token}` } },
)
const rows = await res.json()
if (!res.ok || !Array.isArray(rows)) {
  console.log(bad(`\nCould not read accounts — HTTP ${res.status}: ${JSON.stringify(rows).slice(0, 200)}`))
  process.exit(1)
}
console.log(`Database holds ${rows.length} account(s)\n`)

const byId = new Map(rows.map((r) => [String(r.username).toLowerCase(), r]))
const problems = []

for (const want of roster) {
  const got = byId.get(want.id.toLowerCase())
  if (!got) { problems.push(`${want.id.padEnd(14)} MISSING — not in the database`); continue }
  const diff = []
  if (got.full_name !== want.name) diff.push(`name "${got.full_name}" should be "${want.name}"`)
  if (got.role !== want.role) diff.push(`role "${got.role}" should be "${want.role}"`)
  if ((got.barangay ?? null) !== (want.barangay ?? null)) diff.push(`barangay "${got.barangay}" should be "${want.barangay}"`)
  if (got.position !== want.position) diff.push('position differs')
  if (got.status !== 'active') diff.push(`status "${got.status}" should be "active"`)
  if (Boolean(got.must_change_password) !== want.mustChange) diff.push(`must_change_password ${got.must_change_password} should be ${want.mustChange}`)
  if (got.mfa_enabled) diff.push('mfa_enabled is on — sign-in will wait on an e-mail that cannot be delivered')
  if (diff.length) problems.push(`${want.id.padEnd(14)} ${diff.join('; ')}`)
}

const rosterIds = new Set(roster.map((a) => a.id.toLowerCase()))
const extra = rows.filter((r) => !rosterIds.has(String(r.username).toLowerCase()))

console.log(problems.length
  ? bad(`${problems.length} problem(s):\n`) + problems.map((p) => `  ${p}`).join('\n')
  : ok(`All ${roster.length} accounts are present and correct.`))

if (extra.length) {
  console.log(warn(`\n${extra.length} account(s) in the database that are NOT on the sheet:`))
  for (const e of extra) {
    console.log(`  #${String(e.id).padEnd(5)} ${String(e.username).padEnd(28)} ${String(e.role).padEnd(9)} ${e.full_name ?? ''}`)
  }
  console.log('  (leftovers from earlier sessions, or a real resident sign-up — decide per row;')
  console.log('   credentials/retire-old-test-accounts.sql clears the old test logins only)')
}

/* ── One live sign-in per group ─────────────────────────────────────────────
   A row that reads correctly can still refuse a password: a row whose
   password_plain never hashed looks perfect in the table and cannot sign in.
   Only a real login proves it, so take one account from each group.

   These are this system's OWN accounts, with the passwords it just issued —
   the same check scripts/check-leaked-credentials.mjs performs. */
console.log('\nLive sign-in check, one per group:')
const sample = ['CDRRMO-001', 'BCL-001', 'ITE-001', 'TEST-BRGY-1', 'testres1@cdrrmo.test']
let failures = 0
for (const id of sample) {
  const a = roster.find((x) => x.id === id)
  if (!a) continue
  const r = await login(a.id, a.password)
  const detail = r.ok
    ? (r.body.mfaRequired ? warn('signed in, but asked for a second factor') : ok('signed in'))
    : bad(`refused — ${r.body.error ?? `HTTP ${r.status}`}`)
  if (!r.ok) failures += 1
  console.log(`  ${a.id.padEnd(14)} ${a.group.padEnd(24)} ${detail}`)
}

console.log(problems.length || failures
  ? bad('\nNot clean — fix the rows above before handing the sheet out.\n')
  : ok('\nEvery group signs in. The sheet in credentials/ is accurate.\n'))
