/* ============================================================================
   check-leaked-credentials.mjs — which published passwords still open a door?

   WHY THIS EXISTS
   On 2026-08-31 both GitHub repos (markjustinearopo/cdrrmo-floodroute and
   .../CDRRMO) were confirmed PUBLIC, and three tracked files carried plaintext
   passwords for CDRRMO administrators and barangay officials:
       supabase/seed_full_accounts.sql
       scripts/generate_accounts_excel.cjs
       CDRRMO_Dummy_Accounts.xlsx
   Those credentials were in every clone and every commit, worldwide.

   On 2026-09-05 they were deleted from the working tree and then purged from
   the history itself, and this file was rewritten so the pairs live outside
   the repository. `git log -S` over the rewritten history finds none of the
   passwords in any commit.

   That is still not the same as unpublished. Anyone who cloned or forked
   before the rewrite keeps the old objects; GitHub can serve a rewritten-away
   commit by its SHA until it garbage-collects, and only its support team can
   force that. Treat those passwords as compromised forever — which is what
   this script measures. It does not ask whether the passwords are still
   readable. It asks the only question that decides urgency: do they still
   open a door?

   The remediation plan says "rotate all of them." Before rotating blind, this
   answers the question that decides how urgent that is: which of the published
   passwords ACTUALLY still authenticate against the live database? A later
   migration wiped the dummy accounts and seeded real ones, so many of these
   may already be dead — but "may" is not something to assume about admin
   credentials that are published on the internet.

   It authenticates through the same app_login RPC the app uses. A success
   here is a stranger's success too.

   Usage:  node scripts/check-leaked-credentials.mjs
   ============================================================================ */

import { readFileSync, existsSync } from 'node:fs'
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

const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m'
const BOLD = '\x1b[1m', RESET = '\x1b[0m'

/* The pairs live OUTSIDE the repository, in git-ignored credentials/.

   They used to be a literal array right here, which made this file the very
   thing it was written to detect: a tracked, public file listing working
   passwords for named officials. Purging the old seed files from git history
   while this one still spelled them out would have achieved nothing.

   The file is a JSON array of [identifier, password] pairs. Barangay officials
   all shared one password per the old seed, so a single hit means every
   account of that pattern is open — a sample of prefixes is enough, there is
   no need to list all eighteen barangays. */
const PAIRS_PATH = join(ROOT, 'credentials', 'published-credentials.json')
if (!existsSync(PAIRS_PATH)) {
  console.error('\ncredentials/published-credentials.json is missing.')
  console.error('It holds the [identifier, password] pairs that were published in the')
  console.error('public repo, and it is deliberately git-ignored. Without it there is')
  console.error('nothing to test — restore it from your own copy before running this.\n')
  process.exit(1)
}
const PUBLISHED = JSON.parse(readFileSync(PAIRS_PATH, 'utf8'))

async function tryLogin(identifier, password) {
  const res = await fetch(`${URL_}/rest/v1/rpc/app_login`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_identifier: identifier, p_password: password }),
  })
  if (!res.ok) return { ok: false, note: `HTTP ${res.status}` }
  const data = await res.json()
  // app_login returns null on a bad credential, a session object on success,
  // and { unverified: true } for a correct password on an unverified address —
  // that last one is still a working password.
  if (data === null) return { ok: false }
  if (data?.unverified) return { ok: true, role: 'unverified', name: data.fullName }
  return { ok: true, role: data.role, name: data.fullName, barangay: data.barangay }
}

console.log(`${BOLD}Published credentials vs the live database${RESET}`)
console.log(`${DIM}${URL_}${RESET}`)
console.log(`${DIM}Both source repos were confirmed PUBLIC on 2026-08-31.${RESET}\n`)

const live = []
for (const [id, pw] of PUBLISHED) {
  const r = await tryLogin(id, pw)
  if (r.ok) {
    live.push([id, pw, r])
    const who = [r.role, r.barangay, r.name].filter(Boolean).join(' · ')
    console.log(`  ${RED}${BOLD}STILL WORKS${RESET}  ${id.padEnd(20)} ${DIM}${who}${RESET}`)
  } else {
    console.log(`  ${GREEN}dead${RESET}         ${id.padEnd(20)} ${DIM}${r.note ?? ''}${RESET}`)
  }
}

console.log()
if (live.length) {
  console.log(
    `${RED}${BOLD}${live.length} published credential(s) still authenticate.${RESET}`,
  )
  console.log(`  Anyone who has read the public repo can sign in as these accounts now.`)
  console.log(`  Rotate these first, then purge them from git history.`)
} else {
  console.log(
    `${GREEN}${BOLD}None of the published credentials still authenticate.${RESET}`,
  )
  console.log(
    `  ${DIM}The live accounts were re-seeded after those files were committed.`,
  )
  console.log(
    `  Purging git history is still worth doing, but this is not an active breach.${RESET}`,
  )
}
