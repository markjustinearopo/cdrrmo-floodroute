/* ============================================================================
   check-anon-writes.mjs — can a stranger destroy this database?

   WHY THIS EXISTS
   On 2026-08-31 a probe found all twelve application tables accepting an
   anonymous DELETE. The anon key ships in the deployed browser bundle, so that
   is one request away from every flood alert in Cabuyao being gone. This is
   the check that says whether supabase/PHASE0_CONTAIN.sql actually closed it.

   It exists as a script rather than a one-off because the last table-level
   lockdown in this project (20260817120000, the password columns) was
   "applied" and silently did nothing for eleven days — a column-level REVOKE
   does not subtract from a table-level GRANT. Nobody noticed because nothing
   re-checked. So: re-check.

   NON-DESTRUCTIVE BY CONSTRUCTION. Every write filters on an id that cannot
   exist, and every insert is rolled back by asking PostgREST not to return
   the row and then deleting nothing. What is read is the STATUS CODE, never
   an effect:
       204/200 → the role HOLDS that privilege (0 rows matched, but allowed)
       401/403 → denied

   Usage:
     node scripts/check-anon-writes.mjs
     node scripts/check-anon-writes.mjs --token <a signed session JWT>

   The optional token proves the other half: that Phase 0 did not break
   signed-in operators. Grab one from a browser after signing in as an admin
   (Application → Local Storage → cdrrmo_token).
   ============================================================================ */

import { readFileSync } from 'node:fs'
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

if (!URL_ || !ANON) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env')
  process.exit(1)
}

const argv = process.argv.slice(2)
const tokenArg = argv.indexOf('--token')
const USER_TOKEN = tokenArg !== -1 ? argv[tokenArg + 1] : null

const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m'
const DIM = '\x1b[2m', BOLD = '\x1b[1m', RESET = '\x1b[0m'

/* The tables the app actually serves. `accounts` is listed first because it is
   the one where a write is not merely vandalism but account takeover. */
const TABLES = [
  'accounts', 'alerts', 'incidents', 'evacuation_centers', 'road_status',
  'notifications', 'saved_routes', 'flood_reports', 'integrations',
  'residents', 'barangays', 'hazard_zones',
]

const NO_ROW_ID = -999999
const NO_ROW = `id=eq.${NO_ROW_ID}` // matches nothing, on every one of these tables

/* The PATCH body MUST name a real column.
   An earlier version of this script sent `{}` and was wrong in the most
   dangerous direction: it reported `accounts` as writable by anon when it had
   in fact been correctly locked. PostgREST answers an empty-object PATCH with
   204 WITHOUT issuing an UPDATE — there are no columns to set, so nothing ever
   reaches a privilege check, and every table looks "ALLOWED".

   Verified 2026-08-31 against the live database:
     accounts  {}                 → 204   (false negative on the lock)
     accounts  {"id":-999999}     → 401 42501 "Grant the required privileges"
     alerts    {"id":-999999}     → 204   (genuinely still writable)

   `id` is the right column to name: it exists on every table listed here (the
   DELETE filter proves it parses), and setting it on a filter that matches no
   row changes nothing. */
const PATCH_BODY = JSON.stringify({ id: NO_ROW_ID })

async function probe(table, method, bearer) {
  try {
    const res = await fetch(`${URL_}/rest/v1/${table}?${NO_ROW}`, {
      method,
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      ...(method === 'PATCH' ? { body: PATCH_BODY } : {}),
    })
    if (res.status === 204 || res.status === 200) return { status: res.status }
    let code = null
    try { code = (await res.json())?.code ?? null } catch { /* no JSON body */ }
    return { status: res.status, code }
  } catch (err) {
    return { status: `ERR ${err.message}`, code: null }
  }
}

/* Postgres error codes that prove the PRIVILEGE check passed and something
   later rejected the statement — which means the role does hold the privilege:
     42501  permission denied            → the one that means DENIED
     428C9  "id" is GENERATED ALWAYS     → privilege fine, column unsettable
   notifications, flood_reports and hazard_zones all define id as an identity
   column, so they answer 428C9 rather than 204. Scoring that as anything other
   than ALLOWED would under-report the exposure, which is the failure mode this
   script exists to prevent. */
function verdict({ status, code }) {
  if (status === 204 || status === 200) return { allowed: true, text: `${RED}${BOLD}ALLOWED${RESET}` }
  if (code === '42501' || status === 401 || status === 403) {
    return { allowed: false, text: `${GREEN}denied${RESET}  ${DIM}(${status})${RESET}` }
  }
  if (code === '428C9') {
    return { allowed: true, text: `${RED}${BOLD}ALLOWED${RESET} ${DIM}(identity col)${RESET}` }
  }
  return { allowed: true, text: `${YELLOW}likely allowed${RESET} ${DIM}(${status} ${code ?? ''})${RESET}` }
}

async function runAs(label, bearer, expectDenied) {
  console.log(`\n${BOLD}${label}${RESET}`)
  console.log(`  ${'table'.padEnd(20)} ${'DELETE'.padEnd(18)} ${'UPDATE'.padEnd(18)}`)
  console.log(`  ${'─'.repeat(20)} ${'─'.repeat(18)} ${'─'.repeat(18)}`)

  let exposed = 0
  for (const t of TABLES) {
    const del = verdict(await probe(t, 'DELETE', bearer))
    const upd = verdict(await probe(t, 'PATCH', bearer))
    if (del.allowed || upd.allowed) exposed++
    console.log(`  ${t.padEnd(20)} ${del.text.padEnd(18 + 20)} ${upd.text}`)
  }
  return exposed
}

console.log(`${BOLD}Anonymous write exposure${RESET} — ${URL_}`)
console.log(`${DIM}filter ${NO_ROW}: matches no row, so nothing can be modified${RESET}`)

const anonExposed = await runAs('AS ANON (a stranger with the public key)', ANON, true)

if (anonExposed) {
  console.log(
    `\n${YELLOW}${BOLD}${anonExposed}/${TABLES.length} table(s) still accept an anonymous UPDATE.${RESET}`,
  )
  console.log(`  ${DIM}Expected after Phase 0, which deliberately revoked only DELETE`)
  console.log(`  (everywhere) and INSERT/UPDATE (on accounts). Closing the rest`)
  console.log(`  needs per-role policies, not a revoke — that is Phase 2.${RESET}`)
} else {
  console.log(`\n${GREEN}${BOLD}No table is writable by an anonymous caller.${RESET}`)
}

if (USER_TOKEN) {
  const userExposed = await runAs('AS A SIGNED-IN OPERATOR (session JWT)', USER_TOKEN, false)
  console.log(
    userExposed
      ? `\n${GREEN}Signed-in operators retain write access on ${userExposed} table(s).${RESET}`
      : `\n${YELLOW}The signed-in operator can write NOTHING — Phase 0 cut too deep,` +
        ` or the token is expired.${RESET}`,
  )
} else {
  console.log(
    `\n${DIM}Pass --token <session JWT> to also confirm signed-in operators still work.${RESET}`,
  )
}
