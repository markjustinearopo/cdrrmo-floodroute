/* ============================================================================
   check-rls.mjs — Phase 2's safety net. A role x table x operation matrix.

   WHY THIS EXISTS
   Phase 2 rewrites the access model on a live database real people already
   use. There are no other tests in this repo. This script is what stands
   between "the policy is right" and "silently broke a page nobody clicked
   during testing" — every table gets added here BEFORE its permissive
   policy is dropped, so red-before/green-after is something you can see,
   not something you hope.

   It logs in as a real test account for each of the four app roles (getting
   a genuine Phase-1 signed JWT, the same way the app itself does) plus a
   bare anon-key call, then runs every assertion below against the LIVE
   database and reports PASS/FAIL/? per row. This is read-mostly by design —
   assertions that would otherwise mutate real data run inside a transaction
   that always ROLLBACKs (see EXEC via app_probe_in_transaction), same
   pattern the remediation plan itself specifies for verifying a policy
   before cutting over for real.

   Usage:  node scripts/check-rls.mjs             (all tables with assertions)
           node scripts/check-rls.mjs accounts    (just one table)
   ============================================================================ */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/).filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const URL_ = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY

const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', DIM = '\x1b[2m'
const BOLD = '\x1b[1m', RESET = '\x1b[0m'

/* ── Get a real signed session for each role (Phase 1's actual login path) ── */
const TEST_ACCOUNTS = {
  admin: ['testadmin', 'Test@1234'],
  barangay: ['testbarangay', 'Test@1234'],
  resident: ['testresident@cdrrmo.test', 'Test@1234'],
}

async function login(identifier, password) {
  const res = await fetch(`${URL_}/functions/v1/auth-otp`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', identifier, password }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.token) {
    throw new Error(`login failed for ${identifier}: ${res.status} ${JSON.stringify(data)}`)
  }
  return data.token
}

async function buildSessions() {
  const sessions = { anon: ANON }
  for (const [role, [id, pw]] of Object.entries(TEST_ACCOUNTS)) {
    sessions[role] = await login(id, pw)
  }
  return sessions
}

/* ── One REST call, as a given role's token ─────────────────────────────── */
async function call(token, method, path, body) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { Prefer: 'return=representation' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* not json */ }
  return { status: res.status, json, text }
}

/* An UPDATE/INSERT/DELETE "succeeded" if PostgREST returns 2xx AND actually
   touched a row — an empty {} body against a real filter with return=
   representation coming back as [] with 200/204 means RLS silently matched
   nothing, which must not be read as "allowed". This is the exact trap that
   made an earlier version of check-anon-writes.mjs report the opposite of
   the truth (empty-body PATCH always looked "successful"). */
function mutationAllowed(res) {
  if (res.status === 401 || res.status === 403) return false
  if (res.status >= 400) return false // 42501 etc surfaces as 4xx from PostgREST
  if (Array.isArray(res.json)) return res.json.length > 0
  return res.status === 204 || res.status === 200
}

function readAllowed(res, expectRows) {
  if (res.status === 401 || res.status === 403) return { allowed: false, rows: 0 }
  if (res.status >= 400) return { allowed: false, rows: 0 }
  const rows = Array.isArray(res.json) ? res.json.length : (res.json ? 1 : 0)
  return { allowed: expectRows === 'any' ? rows > 0 : true, rows }
}

/* ── Assertions ──────────────────────────────────────────────────────────
   Each row: { table, op, role, expect, run }
   expect: true = should succeed, false = should be denied
   run(token) -> the actual REST call for that role's token

   SAFETY, NOT JUST STYLE: every "should be denied" mutation targets either
   (a) the caller's OWN real row — worst case on a bug is a cosmetic
       self-rename of a test account, or
   (b) id -999999, which cannot match any real row.
   None of these role-based policies branch on WHICH row is targeted (only
   on the caller's app_role claim), so -999999 proves exactly the same thing
   a real other-account id would — without the possibility that a bug here
   actually deletes or takes over testadmin/testbarangay/testresident, which
   this whole session's verification depends on. Do not "strengthen" these
   by pointing them at real other accounts. ─────────────────────────────── */
const KNOWN_ID = { admin: 182, barangay: 183, resident: 184 }
const NO_SUCH_ID = -999999
const KNOWN_CENTER = { own: 25, other: 17 } // Baclaran (testbarangay's own) / Poblacion Tres

const ASSERTIONS = {
  accounts: [
    // SELECT
    { op: 'SELECT (roster)', role: 'anon', expect: false,
      run: (t) => call(t, 'GET', 'accounts?select=id,full_name,email&limit=5') },
    { op: 'SELECT (roster)', role: 'admin', expect: true,
      run: (t) => call(t, 'GET', 'accounts?select=id,full_name,email&limit=5') },
    { op: 'SELECT (own row)', role: 'resident', expect: true,
      run: (t) => call(t, 'GET', `accounts?select=id,full_name&id=eq.${KNOWN_ID.resident}`) },
    // NOT a "does any row come back" check — a resident's own row always
    // legitimately comes back. This checks that an UNFILTERED query, which
    // would return the whole roster under the old permissive policy, comes
    // back scoped to exactly the caller's own row and nothing else.
    { op: 'SELECT (unfiltered — must scope to self only)', role: 'resident', expect: false,
      run: (t) => call(t, 'GET', 'accounts?select=id,full_name&limit=5'), isSelfOnlyCheck: true },
    { op: 'SELECT (own row)', role: 'barangay', expect: true,
      run: (t) => call(t, 'GET', `accounts?select=id,full_name&id=eq.${KNOWN_ID.barangay}`) },

    // UPDATE — the finding this migration exists to close
    { op: 'UPDATE (own row, name only)', role: 'resident', expect: false,
      run: (t) => call(t, 'PATCH', `accounts?id=eq.${KNOWN_ID.resident}&select=id`, { full_name: 'Test Resident' }) },
    { op: 'UPDATE (self-promote to admin)', role: 'resident', expect: false,
      run: (t) => call(t, 'PATCH', `accounts?id=eq.${KNOWN_ID.resident}&select=id`, { role: 'admin' }) },
    { op: 'UPDATE (nonexistent row — policy shape only)', role: 'resident', expect: false,
      run: (t) => call(t, 'PATCH', `accounts?id=eq.${NO_SUCH_ID}&select=id`, { role: 'admin' }) },
    { op: 'UPDATE (own row)', role: 'barangay', expect: false,
      run: (t) => call(t, 'PATCH', `accounts?id=eq.${KNOWN_ID.barangay}&select=id`, { full_name: 'Test Barangay Official' }) },
    { op: 'UPDATE (own row, no-op value)', role: 'admin', expect: true,
      run: (t) => call(t, 'PATCH', `accounts?id=eq.${KNOWN_ID.admin}&select=id`, { full_name: 'Test Admin' }) },

    // INSERT / DELETE
    { op: 'INSERT', role: 'resident', expect: false,
      run: (t) => call(t, 'POST', 'accounts?select=id', { username: `rls-probe-${Date.now()}`, email: `x${Date.now()}@example.com`, role: 'resident' }) },
    { op: 'DELETE (nonexistent row — policy shape only)', role: 'resident', expect: false,
      run: (t) => call(t, 'DELETE', `accounts?id=eq.${NO_SUCH_ID}&select=id`) },
  ],

  barangays: [
    { op: 'SELECT', role: 'anon', expect: true,
      run: (t) => call(t, 'GET', 'barangays?select=id,name&limit=3') },
    { op: 'SELECT', role: 'resident', expect: true,
      run: (t) => call(t, 'GET', 'barangays?select=id,name&limit=3') },
    { op: 'UPDATE (no-op value)', role: 'admin', expect: true,
      run: (t) => call(t, 'PATCH', 'barangays?id=eq.1&select=id', { notes: null }) },
    { op: 'UPDATE (nonexistent row — policy shape only)', role: 'barangay', expect: false,
      run: (t) => call(t, 'PATCH', `barangays?id=eq.${NO_SUCH_ID}&select=id`, { notes: 'probe' }) },
    { op: 'UPDATE (nonexistent row — policy shape only)', role: 'resident', expect: false,
      run: (t) => call(t, 'PATCH', `barangays?id=eq.${NO_SUCH_ID}&select=id`, { notes: 'probe' }) },
  ],

  hazard_zones: [
    { op: 'SELECT', role: 'anon', expect: true,
      run: (t) => call(t, 'GET', 'hazard_zones?select=id,category&limit=3') },
    { op: 'SELECT', role: 'resident', expect: true,
      run: (t) => call(t, 'GET', 'hazard_zones?select=id,category&limit=3') },
    { op: 'UPDATE (no-op value)', role: 'admin', expect: true,
      run: (t) => call(t, 'PATCH', 'hazard_zones?id=eq.1&select=id', { source: 'SEED' }) },
    { op: 'UPDATE (nonexistent row — policy shape only)', role: 'barangay', expect: false,
      run: (t) => call(t, 'PATCH', `hazard_zones?id=eq.${NO_SUCH_ID}&select=id`, { source: 'probe' }) },
  ],

  evacuation_centers: [
    // KNOWN_CENTER.own = a real center in testbarangay's own barangay (Baclaran).
    // KNOWN_CENTER.other = a real center in a DIFFERENT barangay — the actual
    // finding this migration closes: today a barangay official can write ANY
    // center by id, not just their own.
    { op: 'SELECT', role: 'anon', expect: true,
      run: (t) => call(t, 'GET', 'evacuation_centers?select=id,name&limit=3') },
    // status values below are each center's REAL current value (checked
    // against the live snapshot before writing this) — true no-ops, not
    // guesses. Center 25 is "full" right now (the seeded forced-evacuation
    // scenario); sending "open" here would actually change that.
    { op: 'UPDATE (own barangay center, no-op value)', role: 'barangay', expect: true,
      run: (t) => call(t, 'PATCH', `evacuation_centers?id=eq.${KNOWN_CENTER.own}&select=id`, { status: 'full' }) },
    { op: 'UPDATE (another barangay\'s center — cross-jurisdiction write)', role: 'barangay', expect: false,
      run: (t) => call(t, 'PATCH', `evacuation_centers?id=eq.${KNOWN_CENTER.other}&select=id`, { status: 'open' }) },
    { op: 'UPDATE (any center)', role: 'admin', expect: true,
      run: (t) => call(t, 'PATCH', `evacuation_centers?id=eq.${KNOWN_CENTER.other}&select=id`, { status: 'open' }) },
    { op: 'INSERT (wrong barangay claimed)', role: 'barangay', expect: false,
      run: (t) => call(t, 'POST', 'evacuation_centers?select=id', { name: `RLS probe ${Date.now()}`, barangay: 'Mamatid', capacity: 1, occupancy: 0, status: 'open' }) },
    { op: 'DELETE (nonexistent row — policy shape only)', role: 'resident', expect: false,
      run: (t) => call(t, 'DELETE', `evacuation_centers?id=eq.${NO_SUCH_ID}&select=id`) },
  ],

  alerts: [
    // 136 = real Baclaran-only alert (status "active" — no-op value below).
    // 162 = real alert tagged ["All Barangays"] (status "resolved") — NOT
    // Baclaran, so testbarangay must be denied it despite it "being
    // city-wide" in intent; see the migration header for why that
    // inconsistent representation isn't trusted as a carve-out.
    { op: 'SELECT', role: 'anon', expect: true,
      run: (t) => call(t, 'GET', 'alerts?select=id,title&limit=3') },
    { op: 'UPDATE (own barangay alert, no-op value)', role: 'barangay', expect: true,
      run: (t) => call(t, 'PATCH', 'alerts?id=eq.136&select=id', { status: 'active' }) },
    { op: 'UPDATE (alert not tagged to my barangay)', role: 'barangay', expect: false,
      run: (t) => call(t, 'PATCH', 'alerts?id=eq.162&select=id', { status: 'resolved' }) },
    { op: 'INSERT (claims a different barangay)', role: 'barangay', expect: false,
      run: (t) => call(t, 'POST', 'alerts?select=id', { level: 'low', title: 'RLS probe', message: 'harmless', barangays: ['Mamatid'], status: 'active' }) },
    { op: 'UPDATE (any alert)', role: 'admin', expect: true,
      run: (t) => call(t, 'PATCH', 'alerts?id=eq.162&select=id', { status: 'resolved' }) },
    { op: 'DELETE (nonexistent row — policy shape only)', role: 'resident', expect: false,
      run: (t) => call(t, 'DELETE', `alerts?id=eq.${NO_SUCH_ID}&select=id`) },
  ],

  incidents: [
    // 84 = real Baclaran incident (status "in-progress" — no-op below).
    // 85 = real Marinig incident, same status — used both as the
    // cross-jurisdiction probe (barangay, should deny) and the admin "any
    // row" probe (should allow), both as true no-ops.
    { op: 'SELECT', role: 'anon', expect: false,
      run: (t) => call(t, 'GET', 'incidents?select=id&limit=3') },
    { op: 'SELECT', role: 'resident', expect: true,
      run: (t) => call(t, 'GET', 'incidents?select=id&limit=3') },
    { op: 'UPDATE (own barangay incident, no-op value)', role: 'barangay', expect: true,
      run: (t) => call(t, 'PATCH', 'incidents?id=eq.84&select=id', { status: 'in-progress' }) },
    { op: 'UPDATE (another barangay\'s incident)', role: 'barangay', expect: false,
      run: (t) => call(t, 'PATCH', 'incidents?id=eq.85&select=id', { status: 'in-progress' }) },
    { op: 'UPDATE (any incident)', role: 'admin', expect: true,
      run: (t) => call(t, 'PATCH', 'incidents?id=eq.85&select=id', { status: 'in-progress' }) },
    { op: 'INSERT (claims a different barangay)', role: 'barangay', expect: false,
      run: (t) => call(t, 'POST', 'incidents?select=id', { incident_type: 'RLS probe', barangay: 'Mamatid', priority: 'low', status: 'reported' }) },
  ],

  flood_reports: [
    { op: 'INSERT (as self)', role: 'resident', expect: true,
      run: (t) => call(t, 'POST', 'flood_reports?select=id', { user_id: KNOWN_ID.resident, reporter_name: 'RLS probe', barangay: 'Baclaran', lat: 14.27, lng: 121.12, flood_level: 'low', description: 'RLS probe (harmless)' }) },
    { op: 'INSERT (claims to be someone else)', role: 'resident', expect: false,
      run: (t) => call(t, 'POST', 'flood_reports?select=id', { user_id: KNOWN_ID.admin, reporter_name: 'RLS probe', barangay: 'Baclaran', lat: 14.27, lng: 121.12, flood_level: 'low', description: 'RLS probe (harmless)' }) },
    { op: 'DELETE (nonexistent row — policy shape only)', role: 'resident', expect: false,
      run: (t) => call(t, 'DELETE', `flood_reports?id=eq.${NO_SUCH_ID}&select=id`) },
  ],

  road_status: [
    { op: 'SELECT', role: 'anon', expect: true,
      run: (t) => call(t, 'GET', 'road_status?select=id&limit=3') },
    { op: 'UPDATE (no-op value)', role: 'admin', expect: true,
      run: (t) => call(t, 'PATCH', 'road_status?id=eq.777&select=id', { status: 'blocked' }) },
    { op: 'UPDATE (nonexistent row — policy shape only)', role: 'barangay', expect: false,
      run: (t) => call(t, 'PATCH', `road_status?id=eq.${NO_SUCH_ID}&select=id`, { status: 'open' }) },
    { op: 'UPDATE (nonexistent row — policy shape only)', role: 'resident', expect: false,
      run: (t) => call(t, 'PATCH', `road_status?id=eq.${NO_SUCH_ID}&select=id`, { status: 'open' }) },
  ],

  notifications: [
    { op: 'SELECT', role: 'anon', expect: false,
      run: (t) => call(t, 'GET', 'notifications?select=id&limit=3') },
    { op: 'SELECT', role: 'resident', expect: true,
      run: (t) => call(t, 'GET', 'notifications?select=id&limit=3') },
    { op: 'INSERT', role: 'resident', expect: true,
      run: (t) => call(t, 'POST', 'notifications?select=id', { level: 'low', title: 'RLS probe', message: 'harmless' }) },
    { op: 'INSERT', role: 'anon', expect: false,
      run: (t) => call(t, 'POST', 'notifications?select=id', { level: 'low', title: 'RLS probe (anon)', message: 'harmless' }) },
  ],

  saved_routes: [
    { op: 'SELECT', role: 'anon', expect: false,
      run: (t) => call(t, 'GET', 'saved_routes?select=id&limit=3') },
    { op: 'SELECT', role: 'resident', expect: true,
      run: (t) => call(t, 'GET', 'saved_routes?select=id&limit=3') },
    { op: 'UPDATE (no-op value)', role: 'barangay', expect: true,
      run: (t) => call(t, 'PATCH', 'saved_routes?id=eq.6&select=id', { name: 'Evacuation Route 1' }) },
    { op: 'UPDATE (nonexistent row — policy shape only)', role: 'resident', expect: false,
      run: (t) => call(t, 'PATCH', `saved_routes?id=eq.${NO_SUCH_ID}&select=id`, { name: 'probe' }) },
  ],

  // The vulnerable-persons registry: is_senior / is_pwd / is_pregnant, plus
  // addresses and phones. Nothing in the app reads it via PostgREST, so it is
  // CDRRMO-only — a resident must not be able to see it either.
  residents: [
    { op: 'SELECT', role: 'anon', expect: false,
      run: (t) => call(t, 'GET', 'residents?select=id,full_name&limit=3') },
    { op: 'SELECT', role: 'resident', expect: false,
      run: (t) => call(t, 'GET', 'residents?select=id,full_name&limit=3') },
    { op: 'SELECT', role: 'barangay', expect: false,
      run: (t) => call(t, 'GET', 'residents?select=id,full_name&limit=3') },
    { op: 'SELECT', role: 'admin', expect: true,
      run: (t) => call(t, 'GET', 'residents?select=id,full_name&limit=3') },
    { op: 'INSERT', role: 'resident', expect: false,
      run: (t) => call(t, 'POST', 'residents?select=id', { full_name: 'RLS probe', barangay: 'Baclaran' }) },
  ],

  barangay_officials: [
    { op: 'SELECT', role: 'anon', expect: false,
      run: (t) => call(t, 'GET', 'barangay_officials?select=id,full_name&limit=3') },
    { op: 'SELECT', role: 'barangay', expect: true,
      run: (t) => call(t, 'GET', 'barangay_officials?select=id,full_name&limit=3') },
    { op: 'UPDATE (nonexistent row — policy shape only)', role: 'barangay', expect: false,
      run: (t) => call(t, 'PATCH', `barangay_officials?id=eq.${NO_SUCH_ID}&select=id`, { nickname: 'probe' }) },
  ],

  flood_readings: [
    { op: 'SELECT', role: 'anon', expect: true,
      run: (t) => call(t, 'GET', 'flood_readings?select=id&limit=3') },
    { op: 'INSERT', role: 'resident', expect: false,
      run: (t) => call(t, 'POST', 'flood_readings?select=id', { barangay: 'Baclaran', depth_m: 0.1 }) },
  ],

  app_settings: [
    // system_config must stay anon-readable: it drives the maintenance banner
    // and the registration lock on the pre-login screens.
    { op: 'SELECT system_config (pre-login)', role: 'anon', expect: true,
      run: (t) => call(t, 'GET', 'app_settings?select=key&key=eq.system_config') },
    { op: 'SELECT alert_settings', role: 'anon', expect: false,
      run: (t) => call(t, 'GET', 'app_settings?select=key&key=eq.alert_settings') },
    { op: 'SELECT own user_prefs', role: 'admin', expect: true,
      run: (t) => call(t, 'GET', `app_settings?select=key&key=eq.user_prefs:${KNOWN_ID.admin}`) },
    { op: 'SELECT someone else\'s user_prefs', role: 'resident', expect: false,
      run: (t) => call(t, 'GET', `app_settings?select=key&key=eq.user_prefs:${KNOWN_ID.admin}`) },
    { op: 'UPDATE alert_settings', role: 'resident', expect: false,
      run: (t) => call(t, 'PATCH', 'app_settings?key=eq.alert_settings&select=key', { updated_at: new Date().toISOString() }) },
  ],
}

/* ── Runner ──────────────────────────────────────────────────────────────── */
async function runTable(table, sessions) {
  const rows = ASSERTIONS[table]
  if (!rows) {
    console.log(`${RED}${BOLD}Unknown table "${table}" — no assertions defined.${RESET}`)
    console.log(`${DIM}Known: ${Object.keys(ASSERTIONS).join(', ')}${RESET}`)
    return { pass: 0, fail: 0, unknown: true }
  }

  console.log(`\n${BOLD}${table}${RESET}`)
  let pass = 0, fail = 0
  for (const a of rows) {
    const token = sessions[a.role]
    const res = await a.run(token)
    let ok, wanted, got, detail = ''

    if (a.isSelfOnlyCheck) {
      // Not an allow/deny check: a resident's own row legitimately comes
      // back for an unfiltered query too. What matters is whether OTHER
      // rows leak in alongside it.
      const ownId = KNOWN_ID[a.role]
      const rowIds = Array.isArray(res.json) ? res.json.map((r) => r.id) : []
      const onlySelf = rowIds.every((id) => id === ownId)
      ok = onlySelf === true
      wanted = 'self only'
      got = onlySelf ? 'self only' : `rows: ${JSON.stringify(rowIds)}`
    } else {
      const isRead = a.op.startsWith('SELECT')
      const actual = isRead ? readAllowed(res, 'any').allowed : mutationAllowed(res)
      ok = actual === a.expect
      wanted = a.expect ? 'allow' : 'deny'
      got = actual ? 'ALLOWED' : 'denied'
      detail = ok ? '' : ` ${DIM}(HTTP ${res.status})${RESET}`
    }

    ok ? pass++ : fail++
    const verdict = ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`
    console.log(`  ${verdict}  ${a.role.padEnd(9)} ${a.op.padEnd(38)} want ${wanted.padEnd(10)} got ${got}${detail}`)
  }
  return { pass, fail }
}

console.log(`${BOLD}RLS verification matrix${RESET} — ${URL_}`)
console.log(`${DIM}Logging in as testadmin / testbarangay / testresident for real session tokens...${RESET}`)

const sessions = await buildSessions()
console.log(`${GREEN}Got tokens for: ${Object.keys(sessions).join(', ')}${RESET}`)

const requested = process.argv[2] ? [process.argv[2]] : Object.keys(ASSERTIONS)
let totalPass = 0, totalFail = 0, anyUnknown = false
for (const t of requested) {
  const { pass, fail, unknown } = await runTable(t, sessions)
  totalPass += pass; totalFail += fail
  if (unknown) anyUnknown = true
}

// A run that checked nothing must never report success — that is exactly the
// "empty {} PATCH always looks like 200" trap from earlier in this project.
if (anyUnknown || totalPass + totalFail === 0) {
  console.log(`\n${RED}${BOLD}No assertions ran — this is NOT a pass.${RESET}`)
  process.exit(1)
}

console.log(`\n${BOLD}${totalPass} passed, ${totalFail === 0 ? GREEN : RED}${totalFail} failed${RESET}`)
if (totalFail > 0) {
  console.log(`${RED}Not green — do not cut over the permissive policy for a failing table.${RESET}`)
  process.exit(1)
} else {
  console.log(`${GREEN}Green.${RESET}`)
}
