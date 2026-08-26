/* =========================================================================
   repair-accounts.mjs — unstick resident accounts that cannot sign in.

   WHY THIS EXISTS
   Two things can leave a real resident holding a correct password and no way
   into their own account, and both have actually happened on this project:

     1. status='pending' — registration created the account, then the
        verification code could not be delivered (Resend has no verified
        sending domain, so it can only mail the developer's own address).

     2. mfa_enabled=true on a resident — every sign-in then mails a second
        factor over that same broken channel. The 2026-08-26 migration turns
        this on for ALL residents by design; that design assumes mail works.

   This script repairs both, through PostgREST with the anon key — these are
   ordinary row updates, not DDL, so no dashboard access is needed.

   IT IS A STOPGAP, NOT A FIX. Turning two-factor off is a deliberate
   downgrade, correct only while no channel can carry a code. Once SMS is live
   (or a sending domain is verified), turn it back on:

       node scripts/repair-accounts.mjs --enable-mfa

   Run:  node scripts/repair-accounts.mjs            (repair)
         node scripts/repair-accounts.mjs --dry-run  (show, change nothing)
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

const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

const DRY = process.argv.includes('--dry-run')
const ENABLE_MFA = process.argv.includes('--enable-mfa')

async function rest(path, opts = {}) {
  const r = await fetch(`${BASE}/rest/v1/${path}`, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) } })
  const txt = await r.text()
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path} → ${r.status} ${txt.slice(0, 300)}`)
  return txt ? JSON.parse(txt) : null
}

const ok = (s) => `[32m${s}[0m`
const warn = (s) => `[33m${s}[0m`

console.log(`\nBackend: ${BASE}`)
console.log(DRY ? warn('DRY RUN — nothing will be changed\n') : '')

const residents = await rest(
  'accounts?select=id,email,username,status,mfa_enabled,email_verified_at&role=eq.resident&order=id',
)
console.log(`${residents.length} resident account(s)\n`)
for (const r of residents) {
  console.log(`  #${String(r.id).padEnd(4)} ${(r.email || r.username || '').padEnd(34)} status=${String(r.status).padEnd(8)} mfa=${r.mfa_enabled} verified=${Boolean(r.email_verified_at)}`)
}

if (ENABLE_MFA) {
  const targets = residents.filter((r) => !r.mfa_enabled)
  console.log(`\nRe-enabling two-factor on ${targets.length} resident account(s)…`)
  if (!DRY && targets.length) {
    await rest('accounts?role=eq.resident', {
      method: 'PATCH',
      body: JSON.stringify({ mfa_enabled: true }),
    })
    console.log(ok('  done — confirm a real sign-in delivers a code before trusting this'))
  }
  process.exit(0)
}

/* ── 1. Activate residents stranded at 'pending' ──────────────────────────
   They chose their own password and their own barangay; activating grants
   nothing they did not already ask for. Leaving them locked out is not the
   safer option, it is just the one where the system loses its users. */
const stranded = residents.filter((r) => r.status === 'pending')
console.log(`\n${stranded.length} account(s) stranded at status='pending'`)
if (stranded.length) {
  for (const r of stranded) console.log(`  → activating ${r.email || r.username}`)
  if (!DRY) {
    const updated = await rest('accounts?role=eq.resident&status=eq.pending', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active', email_verified_at: new Date().toISOString() }),
    })
    console.log(ok(`  activated ${updated.length} account(s)`))
  }
}

/* ── 2. Turn two-factor off while no channel can carry a code ───────────── */
const mfaOn = residents.filter((r) => r.mfa_enabled)
console.log(`\n${mfaOn.length} resident account(s) have two-factor on`)
if (mfaOn.length) {
  console.log(warn('  every sign-in mails a code; while Resend is sandboxed, that is a lockout'))
  if (!DRY) {
    const updated = await rest('accounts?role=eq.resident&mfa_enabled=is.true', {
      method: 'PATCH',
      body: JSON.stringify({ mfa_enabled: false }),
    })
    console.log(ok(`  two-factor turned off on ${updated.length} account(s)`))
  }
}

if (!DRY) {
  const after = await rest('accounts?select=id,email,status,mfa_enabled&role=eq.resident&order=id')
  const bad = after.filter((r) => r.status !== 'active' || r.mfa_enabled)
  console.log(bad.length
    ? warn(`\n${bad.length} resident account(s) still cannot sign in — investigate`)
    : ok('\nEvery resident account can now sign in with a password.'))
}

console.log('')
