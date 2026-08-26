/* =========================================================================
   check-backend.mjs — read-only health check of the live Supabase backend.

   Answers, without changing anything: which tables exist, which migrations
   have actually been applied, what state the accounts are in, and whether the
   known-open security gaps are still open. Every finding it prints is
   something a person has to act on outside this repo (a SQL editor, a provider
   dashboard), so it is written to be pasted into a hand-off note.

   Run:  node scripts/check-backend.mjs
   ========================================================================= */

import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const BASE = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
if (!BASE || !KEY) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env')

const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function get(path) {
  try {
    const r = await fetch(`${BASE}/rest/v1/${path}`, { headers: HEADERS })
    const txt = await r.text()
    let body
    try { body = JSON.parse(txt) } catch { body = txt }
    return { ok: r.ok, status: r.status, body }
  } catch (e) {
    return { ok: false, status: 0, body: String(e.message) }
  }
}

const ok = (s) => `[32m${s}[0m`
const bad = (s) => `[31m${s}[0m`
const warn = (s) => `[33m${s}[0m`

console.log(`\nBackend: ${BASE}\n${'='.repeat(64)}`)

/* ── Tables ─────────────────────────────────────────────────────────────── */
const TABLES = [
  'accounts', 'alerts', 'incidents', 'evacuation_centers', 'road_status',
  'notifications', 'integrations', 'app_settings', 'saved_routes',
  'flood_reports', 'auth_codes', 'trusted_devices',
  'sms_subscribers', 'sms_messages', 'sms_codes',
]
console.log('\nTABLES')
const present = new Set()
for (const t of TABLES) {
  /* `select=id`, not `select=*`: once the password-column grant is corrected,
     `accounts?select=*` is refused for anon and this loop would report the
     whole table as "locked" — the security fix landing would look like the
     table disappearing. */
  const r = await get(`${t}?select=id&limit=1`)
  // 404 = no such table; 401/403 = exists but locked away from anon (by design
  // for the code tables, which is the correct answer, not a failure).
  const state = r.ok ? 'readable'
    : r.status === 404 ? 'MISSING'
      : `locked (${r.status})`
  if (r.ok || r.status !== 404) present.add(t)
  const label = state === 'MISSING' ? bad(state) : state === 'readable' ? ok(state) : warn(state)
  console.log(`  ${t.padEnd(22)} ${label}`)
}

/* ── Accounts ───────────────────────────────────────────────────────────── */
console.log('\nACCOUNTS')
/* `phone` is selected explicitly, and its own probe below decides whether the
   column exists. Inferring it from the keys of a row that never asked for it
   is how this script spent a run reporting a column MISSING that was there. */
const acc = await get('accounts?select=id,role,status,email,username,mfa_enabled,email_verified_at&limit=1000')
if (Array.isArray(acc.body)) {
  const rows = acc.body
  const by = {}
  for (const r of rows) {
    const k = `${r.role || '?'} / ${r.status || 'active'}`
    by[k] = (by[k] || 0) + 1
  }
  console.log(`  ${rows.length} accounts`)
  for (const [k, n] of Object.entries(by).sort()) console.log(`    ${k.padEnd(26)} ${n}`)

  const stuck = rows.filter((r) => r.status === 'pending' || !r.email_verified_at)
  if (stuck.length) {
    console.log(warn(`\n  ${stuck.length} account(s) cannot sign in — pending or never verified:`))
    for (const r of stuck) {
      console.log(`    ${(r.email || r.username || `#${r.id}`).padEnd(38)} status=${r.status} verified=${Boolean(r.email_verified_at)}`)
    }
  } else {
    console.log(ok('  no accounts stuck unverified'))
  }

  const mfa = rows.filter((r) => r.mfa_enabled)
  const residentMfa = rows.filter((r) => r.mfa_enabled && r.role === 'resident')
  console.log(`  two-factor enabled on ${mfa.length} account(s)`)
  /* Two-factor on a resident is only safe if a code can actually reach them.
     While email delivery is broken and SMS is not live, it is a lockout. */
  if (residentMfa.length) {
    console.log(bad(`  ${residentMfa.length} RESIDENT account(s) have two-factor on`))
    console.log('    every sign-in mails a code; while Resend is sandboxed that locks them out')
  }

  // Does accounts.phone exist? Ask for it directly — PostgREST 400s if not.
  const phoneProbe = await get('accounts?select=phone&limit=1')
  if (phoneProbe.ok) console.log(ok('  accounts.phone column present'))
  else console.log(warn(`  accounts.phone column MISSING (${phoneProbe.status}) — SMS migration not applied`))
} else {
  console.log(bad(`  could not read accounts: ${acc.status} ${JSON.stringify(acc.body).slice(0, 160)}`))
}

/* ── Known security gaps ────────────────────────────────────────────────── */
console.log('\nSECURITY')
// Ask for a row that definitely HAS a hash, so a null first row cannot read
// as "not exposed".
const hash = await get('accounts?select=email,password_hash&password_hash=not.is.null&limit=1')
if (hash.ok && Array.isArray(hash.body) && hash.body[0]?.password_hash) {
  console.log(bad('  password_hash IS READABLE with the public anon key'))
  console.log('    fix: run the REVOKE + column GRANT in supabase/PENDING_MIGRATIONS.sql')
  console.log('    (a bare column-level REVOKE is a no-op against a table-level grant)')
} else {
  console.log(ok('  password hashes are not exposed to anon'))
  // Confirm the fix did not overshoot and lock the app out of what it reads.
  const appRead = await get('accounts?select=id,full_name,username,email,role,barangay,status,avatar,last_login&limit=1')
  console.log(appRead.ok
    ? ok('  the columns the app reads are still readable')
    : bad(`  the app can no longer read accounts (${appRead.status}) — the column grant is too narrow`))
}

/* ── Alert level constraint ─────────────────────────────────────────────── */
console.log('\nALERTS')
const alerts = await get('alerts?select=id,level,status&limit=200')
if (Array.isArray(alerts.body)) {
  const levels = [...new Set(alerts.body.map((r) => r.level))]
  console.log(`  ${alerts.body.length} alerts, levels in use: ${levels.join(', ') || '(none)'}`)
  console.log(levels.includes('emergency')
    ? ok('  the emergency tier persists (constraint updated)')
    : warn('  no emergency-level alert stored — the CHECK constraint may still reject it'))
}

/* ── Integrations ───────────────────────────────────────────────────────── */
console.log('\nINTEGRATIONS')
const integ = await get('integrations?select=*')
if (Array.isArray(integ.body)) {
  for (const r of integ.body) {
    const id = r.id ?? r.key ?? r.name
    console.log(`  ${String(id).padEnd(14)} enabled=${String(r.enabled).padEnd(5)} status=${r.status ?? '?'}`)
  }
  if (!integ.body.some((r) => String(r.id ?? r.key ?? '').includes('sms'))) {
    console.log(warn('  no SMS integration row — add one to configure the provider'))
  }
}

/* ── Edge Functions ─────────────────────────────────────────────────────── */
console.log('\nEDGE FUNCTIONS')
for (const fn of ['auth-otp', 'send-alert-email', 'sms-alert']) {
  try {
    const r = await fetch(`${BASE}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ping' }),
    })
    const txt = (await r.text()).slice(0, 120)
    // Any structured answer means the function is deployed; 404 means it is not.
    console.log(`  ${fn.padEnd(18)} ${r.status === 404 ? bad('NOT DEPLOYED') : ok(`deployed (${r.status})`)} ${r.status === 404 ? '' : txt}`)
  } catch (e) {
    console.log(`  ${fn.padEnd(18)} ${bad('unreachable')} ${e.message}`)
  }
}

console.log(`\n${'='.repeat(64)}\n`)
