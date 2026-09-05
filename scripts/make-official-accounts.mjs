/* ============================================================================
   make-official-accounts.mjs — build the CDRRMO FloodRoute account roster.

   WHY THIS SCRIPT, AND NOT A TRACKED .sql FILE
   This repository is PUBLIC (see scripts/check-leaked-credentials.mjs — real
   officials' passwords were committed once already and had to be rotated).
   So the roster of NAMES lives here, in version control, where it can be
   reviewed; the PASSWORDS are generated fresh at run time and written only to
   credentials/, which .gitignore excludes. Nothing this script emits is ever
   committed.

   It writes three files into credentials/:

     official-accounts.sql   paste ONCE into the Supabase SQL Editor
                             https://supabase.com/dashboard/project/sreazvhevxijkespxxac/sql/new
     CDRRMO_Accounts.xlsx    the printable hand-out sheet
     official-accounts.md    the same table in plain text

   The SQL is written to be safe to run against the live database in whatever
   state it is in: every account is upserted through one helper function that
   finds an existing row by its NEW login ID, then by its LEGACY login ID, then
   by e-mail, and only inserts when all three miss. Running it twice changes
   nothing except re-issuing the temporary passwords.

   Run:  node scripts/make-official-accounts.mjs
         node scripts/make-official-accounts.mjs --force   (overwrite existing)
   ============================================================================ */

import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomInt } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'credentials')
const FORCE = process.argv.includes('--force')
const TODAY = new Date().toISOString().slice(0, 10)

/* ── Temporary passwords ────────────────────────────────────────────────────
   Each real person gets their OWN first password, so one leaked sheet does not
   open every account, and so "who has signed in yet" stays answerable. Every
   one is 11 characters with an upper, a lower, four digits and a symbol, which
   clears the 8-character minimum the first-login prompt enforces.

   The words are ordinary Filipino disaster-response vocabulary: memorable
   enough to read aloud over the phone, and thrown away at first sign-in
   anyway. */
const WORDS = [
  'Bantay', 'Ligtas', 'Handa', 'Sagip', 'Gabay', 'Alalay', 'Tanglaw',
  'Kalinga', 'Panatag', 'Matibay', 'Alerto', 'Agapay', 'Tanod', 'Saklolo',
  'Balita', 'Tulong', 'Bayanihan', 'Damayan', 'Malasakit', 'Maagap',
]
const used = new Set()
function tempPassword() {
  for (;;) {
    const pw = `${WORDS[randomInt(WORDS.length)]}${String(randomInt(1000, 10000))}!`
    if (!used.has(pw)) { used.add(pw); return pw }
  }
}

/* The test logins deliberately SHARE one password. They are disposable demo
   accounts, typed by hand many times during a defence; unique passwords there
   would be friction protecting nothing. */
const TEST_PASSWORD = 'Test@2026'

/* ── 1. CDRRMO administrators ───────────────────────────────────────────────
   Names, ranks and offices exactly as the client supplied them, written in
   ordinary sentence case rather than the all-capitals of the source document.
   `legacy` is the username the 2026-07-08 seed gave the same person; it is how
   the upsert recognises the row it must rename rather than duplicate. */
const ADMINS = [
  { id: 'CDRRMO-001', legacy: 'cgarcia', name: 'Colin B. Garcia', email: 'colin.garcia@cabuyao.gov.ph', position: 'CGDH I - CDRRMO' },
  { id: 'CDRRMO-002', legacy: 'vbuot', name: 'Vincent Paul L. Buot', email: 'vincent.buot@cabuyao.gov.ph', position: 'Local DRRM Officer IV / Research and Planning Division Chief' },
  { id: 'CDRRMO-003', legacy: 'jterrenal', name: 'John April K. Terrenal', email: 'john.terrenal@cabuyao.gov.ph', position: 'Local DRRM Assistant / Admin and Training Division Chief' },
  { id: 'CDRRMO-004', legacy: 'csayson', name: 'Christopher John M. Sayson', email: 'christopher.sayson@cabuyao.gov.ph', position: 'Operations and Warning Division Chief' },
  { id: 'CDRRMO-005', legacy: 'linventor', name: 'Lyka D. Inventor', email: 'lyka.inventor@cabuyao.gov.ph', position: 'Command Center Focal Person' },
  { id: 'CDRRMO-006', legacy: 'edelossantos', name: 'Erica M. Delos Santos', email: 'erica.delossantos@cabuyao.gov.ph', position: 'Research and Planning Division Chief' },
  { id: 'CDRRMO-007', legacy: 'ksalom', name: 'Atty. Kristoffer Bryan L. Salom', email: 'kristoffer.salom@cabuyao.gov.ph', position: 'CGDH I - Public Order and Safety Officer (Cabuyao Public Order and Safety Office)' },
]

/* ── 2. Punong Barangay, one per barangay ───────────────────────────────────
   The barangay names stored are the canonical ones in src/data/cabuyao.js
   (BARANGAYS) — "Banay-Banay", not "Banaybanay"; "Poblacion Uno", not
   "Pob. Uno". They must match exactly or the portal's jurisdiction lock
   scopes the official to nothing. */
const CAPTAINS = [
  { id: 'BCL-001', barangay: 'Baclaran', name: 'Oliver P. Galang' },
  { id: 'BNB-001', barangay: 'Banay-Banay', name: 'Eric E. Barron' },
  { id: 'BNL-001', barangay: 'Banlic', name: 'Elizabeth L. Austria' },
  { id: 'BGA-001', barangay: 'Bigaa', name: 'Rose Ann V. Cantalejo' },
  { id: 'BTG-001', barangay: 'Butong', name: 'Charie P. Barrio' },
  { id: 'CSL-001', barangay: 'Casile', name: 'Orlando P. De Sagun' },
  { id: 'DZM-001', barangay: 'Diezmo', name: 'Alfredo M. Malabanan' },
  { id: 'GLD-001', barangay: 'Gulod', name: 'Dominador V. Maniclang' },
  { id: 'MAM-001', barangay: 'Mamatid', name: 'Ernani G. Himpisao' },
  { id: 'MAR-001', barangay: 'Marinig', name: 'Conrado B. Hain, Jr.' },
  { id: 'NGN-001', barangay: 'Niugan', name: 'John Cyril C. Hain' },
  { id: 'PTL-001', barangay: 'Pittland', name: 'Teodoro N. Enriquez' },
  { id: 'PBU-001', barangay: 'Poblacion Uno', name: 'Raymonte D. Bienes' },
  { id: 'PBD-001', barangay: 'Poblacion Dos', name: 'Melvin R. Calandria' },
  { id: 'PBT-001', barangay: 'Poblacion Tres', name: 'Antonette M. Hain' },
  { id: 'PLO-001', barangay: 'Pulo', name: 'Armando H. Amoranto' },
  { id: 'SLA-001', barangay: 'Sala', name: 'Francisco D. Alimagno' },
  { id: 'SNI-001', barangay: 'San Isidro', name: 'Richard L. Algire' },
]

/* ── 3. IT experts, for the system evaluation ───────────────────────────────
   Given the `admin` role on purpose: an evaluator scoring functionality has to
   be able to reach every module, and a read-only seat would score the system
   on screens it was never allowed to open. They are NOT flagged
   must_change_password — a forced password change is friction in the middle of
   a timed evaluation, and these seats are retired once scoring ends.

   Put the real evaluator's name on each row (Settings -> User Management)
   before handing the sheet over. */
const IT_EXPERTS = [1, 2, 3, 4, 5].map((n) => ({
  id: `ITE-00${n}`,
  name: `IT Expert Evaluator ${n}`,
  email: `ite00${n}@eval.cdrrmo.ph`,
  position: 'IT Expert - System Evaluator',
}))

/* ── 4. Test logins, five per role ──────────────────────────────────────────
   Barangay and resident testers all sit in Baclaran on purpose: the two
   portals show the same barangay's data from different sides, so a claim made
   on one can be checked against the other. Change one account's barangay in
   User Management when the thing under test is jurisdiction isolation.

   The resident accounts' login ID is their E-MAIL ADDRESS, not a TEST-RES-n
   code, and that is deliberate. The resident panel on the login screen has one
   field, `type="email"` (src/pages/Login.jsx) — a browser will not even submit
   a code like TEST-RES-1 through it. Real residents register by e-mail and
   app_register_resident sets username = email, so this matches the path an
   actual citizen takes. Admin and Staff IDs are codes because those two panels
   ask for "Admin ID" and "Staff ID". */
const TEST_BARANGAY = 'Baclaran'
const TESTS = [
  ...[1, 2, 3, 4, 5].map((n) => ({ id: `TEST-ADMIN-${n}`, role: 'admin', barangay: null, name: `Test Admin ${n}`, email: `testadmin${n}@cdrrmo.test`, position: 'Test account - CDRRMO admin' })),
  ...[1, 2, 3, 4, 5].map((n) => ({ id: `TEST-BRGY-${n}`, role: 'barangay', barangay: TEST_BARANGAY, name: `Test Barangay Official ${n}`, email: `testbrgy${n}@cdrrmo.test`, position: 'Test account - Punong Barangay' })),
  ...[1, 2, 3, 4, 5].map((n) => ({ id: `testres${n}@cdrrmo.test`, role: 'resident', barangay: TEST_BARANGAY, name: `Test Resident ${n}`, email: `testres${n}@cdrrmo.test`, position: 'Test account - resident' })),
]

/* ── Assemble one flat roster ───────────────────────────────────────────── */
const GROUPS = ['CDRRMO Administrator', 'Punong Barangay', 'IT Expert (evaluation)', 'Test account']

const roster = [
  ...ADMINS.map((a) => ({
    group: GROUPS[0], id: a.id, legacy: a.legacy, name: a.name,
    email: a.email, role: 'admin', barangay: null, position: a.position,
    password: tempPassword(), mustChange: true,
  })),
  ...CAPTAINS.map((c) => ({
    group: GROUPS[1], id: c.id, legacy: c.id, name: c.name,
    email: `${c.id.slice(0, 3).toLowerCase()}001@brgy.cabuyao.ph`,
    role: 'barangay', barangay: c.barangay, position: 'Punong Barangay',
    password: tempPassword(), mustChange: true,
  })),
  ...IT_EXPERTS.map((e) => ({
    group: GROUPS[2], id: e.id, legacy: null, name: e.name,
    email: e.email, role: 'admin', barangay: null, position: e.position,
    password: tempPassword(), mustChange: false,
  })),
  ...TESTS.map((t) => ({
    group: GROUPS[3], id: t.id, legacy: null, name: t.name,
    email: t.email, role: t.role, barangay: t.barangay, position: t.position,
    password: TEST_PASSWORD, mustChange: false,
  })),
]

const inGroup = (g) => roster.filter((r) => r.group === g)

/* ── SQL ────────────────────────────────────────────────────────────────── */
const q = (v) => (v === null || v === undefined ? 'null' : "'" + String(v).split("'").join("''") + "'")

const calls = GROUPS.map((g) => {
  const rows = inGroup(g)
  const rule = '-'.repeat(74)
  const head = `-- ${rule}\n-- ${g} (${rows.length})\n-- ${rule}`
  const body = rows.map((r) => (
    `select public.__seed_upsert_account(${q(r.legacy)}, ${q(r.id)}, ${q(r.email)}, `
    + `${q(r.password)}, ${q(r.role)}, ${q(r.barangay)}, ${q(r.name)}, ${q(r.position)}, ${r.mustChange});`
  )).join('\n')
  return `${head}\n${body}`
}).join('\n\n')

const sql = `-- ============================================================================
-- official-accounts.sql — CDRRMO FloodRoute login accounts
-- Generated ${TODAY} by scripts/make-official-accounts.mjs
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file -> Run
--   https://supabase.com/dashboard/project/sreazvhevxijkespxxac/sql/new
--
-- WHY THE SQL EDITOR AND NOT THE APP
--   Creating accounts needs privileges the public anon key does not have (the
--   Phase-2 RLS lockdown limits INSERT on accounts to a signed-in admin), and
--   the SQL editor runs as the database owner. One paste, one run, done.
--
-- WHAT IT DOES
--   ${roster.length} accounts: ${ADMINS.length} CDRRMO administrators, ${CAPTAINS.length} Punong Barangay,
--   ${IT_EXPERTS.length} IT-expert evaluation seats and ${TESTS.length} test logins (5 per role).
--   No resident accounts are created beyond the test ones, by request.
--
--   Each account is written through one helper that looks for an existing row
--   FIRST by its new login ID, THEN by the login ID the 2026-07-08 seed used,
--   THEN by e-mail address, and only inserts when all three miss. So an
--   official who already has an account keeps their row, their history and
--   their account id — the ID, name, rank and password are corrected in place.
--
--   Passwords are written to accounts.password_plain, which fires
--   trg_accounts_hash_password: it bcrypt-hashes the value into password_hash
--   and nulls the plaintext in the same statement. No plaintext password is
--   ever stored. Never write password_hash by hand.
--
--   Everyone real is flagged must_change_password, so the first sign-in shows
--   the "set your own password" prompt and the temporary password stops
--   working the moment they choose their own.
--
--   This file does NOT delete anything. Old test logins from earlier sessions
--   are left where they are; see credentials/retire-old-test-accounts.sql if
--   you want them gone.
-- ============================================================================

begin;

-- One upsert, used ${roster.length} times. Dropped again at the bottom of the file.
create or replace function public.__seed_upsert_account(
  p_legacy      text,
  p_username    text,
  p_email       text,
  p_password    text,
  p_role        text,
  p_barangay    text,
  p_full_name   text,
  p_position    text,
  p_must_change boolean
) returns text
language plpgsql
as $fn$
declare
  v_id     integer;
  v_action text;
begin
  select id into v_id from public.accounts where lower(username) = lower(p_username) limit 1;
  if v_id is null and p_legacy is not null then
    select id into v_id from public.accounts where lower(username) = lower(p_legacy) limit 1;
  end if;
  if v_id is null then
    select id into v_id from public.accounts where lower(email) = lower(p_email) limit 1;
  end if;

  if v_id is null then
    insert into public.accounts
      (username, email, password_plain, role, barangay, full_name, position,
       status, must_change_password, mfa_enabled, email_verified_at)
    values
      (p_username, p_email, p_password, p_role, p_barangay, p_full_name, p_position,
       'active', p_must_change, false, now())
    returning id into v_id;
    v_action := 'created';
  else
    update public.accounts set
      username             = p_username,
      email                = p_email,
      password_plain       = p_password,
      role                 = p_role,
      barangay             = p_barangay,
      full_name            = p_full_name,
      position             = p_position,
      status               = 'active',
      must_change_password = p_must_change,
      -- Two-factor off: it is delivered by e-mail, and these are @cabuyao.gov.ph
      -- and @brgy.cabuyao.ph addresses this system cannot yet send to. Leaving
      -- it on locks the account holder out behind a code that never arrives.
      mfa_enabled          = false,
      email_verified_at    = coalesce(email_verified_at, now())
    where id = v_id;
    v_action := 'updated';
  end if;

  return v_action || ' #' || v_id || '  ' || p_username;
end
$fn$;

${calls}

drop function public.__seed_upsert_account(text, text, text, text, text, text, text, text, boolean);

commit;

-- ── Check the result ────────────────────────────────────────────────────────
-- Every row below should read status=active and password_hash=true. A row with
-- password_hash=false did not get hashed and cannot sign in — say so rather
-- than retrying blind.
select
  id,
  username                    as login_id,
  full_name,
  role,
  coalesce(barangay, '-')     as barangay,
  status,
  must_change_password        as must_change_pw,
  (password_hash is not null) as password_hash,
  (password_plain is null)    as plaintext_cleared
from public.accounts
order by
  case role when 'admin' then 1 when 'staff' then 2 when 'barangay' then 3 else 4 end,
  username;
`

/* ── Optional cleanup, kept in its own file ─────────────────────────────────
   Deliberately NOT part of the main script: it deletes rows, and saved_routes
   cascade off accounts.id. Whoever runs it should mean to. */
const retireSql = `-- ============================================================================
-- retire-old-test-accounts.sql — OPTIONAL, and it DELETES rows.
--
-- Earlier sessions created throwaway logins (testadmin, testadmin2..4,
-- testbarangay*, testresident*@cdrrmo.test). The new roster replaces them with
-- TEST-ADMIN-1..5, TEST-BRGY-1..5 and testres1..5@cdrrmo.test, so the old ones
-- are only clutter in Settings -> User Management.
--
-- Run this ONLY if you want them gone. saved_routes has
-- "on delete cascade" against accounts.id, so anything one of these accounts
-- saved goes with it. Nothing else in the system points at them.
--
-- Look before you delete: run the SELECT on its own first and read the list.
--
-- The "not in (...)" list is every login ID on the current sheet. It is spelled
-- out rather than pattern-matched because the new test RESIDENTS are named by
-- e-mail (testresN@cdrrmo.test) and a "@cdrrmo.test" pattern would sweep them
-- away along with the old ones.
-- ============================================================================

-- 1. See exactly what would go.
select id, username, email, full_name, role, barangay, status, last_login
from public.accounts
where (username ~* '^test(admin|barangay|resident)[0-9]*$' or lower(email) like '%@cdrrmo.test')
  and lower(username) not in (
${roster.map((r) => `    ${q(r.id.toLowerCase())}`).join(',\n')}
  )
order by id;

-- 2. Only when that list is the one you meant, run the delete.
-- delete from public.accounts
-- where (username ~* '^test(admin|barangay|resident)[0-9]*$' or lower(email) like '%@cdrrmo.test')
--   and lower(username) not in (
${roster.map((r) => `--     ${q(r.id.toLowerCase())}`).join(',\n')}
--   );
`

/* ── Markdown ───────────────────────────────────────────────────────────── */
const mdGroups = GROUPS.map((g) => {
  const rows = inGroup(g)
  const header = '| Login ID | Name | Role | Barangay | Position | Temporary password | Change at 1st login |'
  const divide = '|---|---|---|---|---|---|---|'
  const body = rows.map((r) => (
    `| \`${r.id}\` | ${r.name} | ${r.role} | ${r.barangay || '-'} | ${r.position} `
    + `| \`${r.password}\` | ${r.mustChange ? 'yes' : 'no'} |`
  )).join('\n')
  return `## ${g} (${rows.length})\n\n${header}\n${divide}\n${body}`
}).join('\n\n')

const md = `# CDRRMO FloodRoute — login accounts

Generated ${TODAY}. **Do not commit this file** — \`credentials/\` is git-ignored,
and this repository is public.

**Type the Login ID into the login screen** — for administrators and barangay
officials that is a code, and the login screen already asks for it by name
("Admin ID", "Staff ID"). Residents are the exception: their panel has a single
e-mail field, so a resident's login ID *is* their e-mail address.

Barangay officials must also pick their barangay from the dropdown before
signing in; it is listed for each of them below.

Accounts marked "change at 1st login" show a *Set your own password* prompt the
first time they sign in — the temporary password stops working the moment they
choose their own.

${mdGroups}

## E-mail addresses on file

Stored for password reset and alert delivery. They are **not** login IDs, and
mail to them is not deliverable yet — the system has no verified sending domain.

${roster.map((r) => `- \`${r.id}\` — ${r.email}`).join('\n')}
`

/* ── Write ──────────────────────────────────────────────────────────────── */
mkdirSync(OUT, { recursive: true })
const sqlPath = join(OUT, 'official-accounts.sql')
const mdPath = join(OUT, 'official-accounts.md')
if (!FORCE && (existsSync(sqlPath) || existsSync(mdPath))) {
  console.error('\ncredentials/ already holds a generated roster.')
  console.error('Re-running issues NEW temporary passwords and invalidates any sheet already handed out.')
  console.error('Pass --force if that is what you want.\n')
  process.exit(1)
}
writeFileSync(sqlPath, sql, 'utf8')
writeFileSync(mdPath, md, 'utf8')
writeFileSync(join(OUT, 'retire-old-test-accounts.sql'), retireSql, 'utf8')

/* The machine-readable copy. scripts/verify-official-accounts.mjs reads it to
   check what actually landed in the database, which is why the test password
   is not hard-coded into a tracked script. */
writeFileSync(join(OUT, 'roster.json'), `${JSON.stringify({ generated: TODAY, accounts: roster }, null, 2)}\n`, 'utf8')

/* ── Excel hand-out ─────────────────────────────────────────────────────── */
const { default: ExcelJS } = await import('exceljs')
const wb = new ExcelJS.Workbook()
wb.creator = 'CDRRMO FloodRoute'
wb.created = new Date()

const FONT = 'Arial'
const fill = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } })
const thin = (hex = 'D9D9D9') => {
  const s = { style: 'thin', color: { argb: `FF${hex}` } }
  return { top: s, left: s, bottom: s, right: s }
}
const GROUP_TINT = {
  [GROUPS[0]]: 'EDE9FD',
  [GROUPS[1]]: 'FEF3E2',
  [GROUPS[2]]: 'E2F5EF',
  [GROUPS[3]]: 'F1F1F1',
}

const ws = wb.addWorksheet('Accounts', {
  views: [{ state: 'frozen', ySplit: 4 }],
  pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
})
ws.columns = [
  { key: 'id', width: 16 }, { key: 'name', width: 32 }, { key: 'role', width: 11 },
  { key: 'barangay', width: 16 }, { key: 'position', width: 46 },
  { key: 'email', width: 34 }, { key: 'password', width: 17 }, { key: 'change', width: 15 },
]

ws.mergeCells('A1:H1')
ws.getCell('A1').value = 'CDRRMO FloodRoute — System Login Accounts'
ws.getCell('A1').font = { name: FONT, bold: true, size: 15, color: { argb: 'FFFFFFFF' } }
ws.getCell('A1').fill = fill('0D2137')
ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' }
ws.getRow(1).height = 30

ws.mergeCells('A2:H2')
ws.getCell('A2').value = `City Disaster Risk Reduction and Management Office · Cabuyao, Laguna · ${roster.length} accounts · generated ${TODAY}`
ws.getCell('A2').font = { name: FONT, size: 9, italic: true, color: { argb: 'FF444444' } }
ws.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' }
ws.getRow(2).height = 18

ws.mergeCells('A3:H3')
ws.getCell('A3').value = 'CONFIDENTIAL — type the Login ID into the login screen (residents: that is their e-mail). Temporary passwords must be replaced at first sign-in.'
ws.getCell('A3').font = { name: FONT, size: 9, bold: true, color: { argb: 'FF8A1C1C' } }
ws.getCell('A3').fill = fill('FDECEC')
ws.getCell('A3').alignment = { vertical: 'middle', horizontal: 'center' }
ws.getRow(3).height = 18

const HEAD = ['Login ID (type this)', 'Name', 'Role', 'Barangay', 'Position / Designation', 'E-mail on file', 'Temporary password', 'Change at 1st login']
const hr = ws.addRow(HEAD)
hr.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
hr.fill = fill('1E3A5F')
hr.height = 26
hr.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
hr.eachCell((c) => { c.border = thin('1E3A5F') })

let lastGroup = null
for (const r of roster) {
  if (r.group !== lastGroup) {
    const sr = ws.addRow([`${r.group}  (${inGroup(r.group).length})`])
    ws.mergeCells(`A${sr.number}:H${sr.number}`)
    sr.getCell(1).font = { name: FONT, bold: true, size: 10, color: { argb: 'FF1E3A5F' } }
    sr.getCell(1).fill = fill(GROUP_TINT[r.group])
    sr.getCell(1).alignment = { vertical: 'middle', indent: 1 }
    sr.height = 22
    lastGroup = r.group
  }
  const row = ws.addRow([r.id, r.name, r.role, r.barangay || '-', r.position, r.email, r.password, r.mustChange ? 'Yes' : 'No'])
  row.font = { name: FONT, size: 9 }
  row.height = 17
  row.eachCell((c, i) => {
    c.border = thin()
    c.alignment = { vertical: 'middle', horizontal: [1, 3, 4, 7, 8].includes(i) ? 'center' : 'left' }
  })
  row.getCell(1).font = { name: 'Consolas', size: 9, bold: true }
  row.getCell(2).font = { name: FONT, size: 9, bold: true }
  row.getCell(7).font = { name: 'Consolas', size: 9, bold: true, color: { argb: 'FF8A1C1C' } }
}
ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 8 } }

await wb.xlsx.writeFile(join(OUT, 'CDRRMO_Accounts.xlsx'))

/* ── Report ─────────────────────────────────────────────────────────────── */
console.log(`\n${roster.length} accounts written to credentials/ (git-ignored)`)
for (const g of GROUPS) console.log(`  ${String(inGroup(g).length).padStart(3)}  ${g}`)
console.log('\n  credentials/official-accounts.sql        -> paste into the Supabase SQL Editor')
console.log('  credentials/CDRRMO_Accounts.xlsx         -> the hand-out sheet')
console.log('  credentials/official-accounts.md         -> the same table as text')
console.log('  credentials/retire-old-test-accounts.sql -> optional, deletes the old test logins\n')
