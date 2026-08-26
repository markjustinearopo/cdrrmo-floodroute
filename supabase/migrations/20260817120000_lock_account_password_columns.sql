-- ============================================================
-- Stop password hashes from being bulk-readable via the public anon key.
--
-- WHY THIS EXISTS: accounts has a permissive RLS policy (see
-- 20260613130000_app_wiring.sql) so the browser app can manage accounts
-- without a server-side session — `using (true)` on every row. That's a
-- row-level policy though; it says nothing about which COLUMNS a query
-- can read. Today, `GET /rest/v1/accounts?select=*` (or the app's own
-- usersDb.list()) returns every account's bcrypt password_hash to
-- whoever holds the anon key — which is anyone who opens dev tools on
-- the deployed site, since that key ships in the browser bundle.
--
-- This revokes SELECT on just the two password columns from anon +
-- authenticated. RLS still governs row visibility exactly as before;
-- this only removes those two columns from what any `select` can
-- return, including `select('*')`. The app's own accounts screen never
-- needed those columns (see the db.js change in the same commit) —
-- only the SECURITY DEFINER functions (app_login, app_change_password,
-- accounts_hash_password trigger) touch them, and those run with the
-- table owner's privileges, so this does not affect login.
--
-- NOT FIXED BY THIS: anon can still WRITE accounts (including setting
-- a new password_plain on any existing row) — there's no session token
-- in this app's design for RLS to check, so a write-side fix needs real
-- authentication (Supabase Auth or a signed session token), not a
-- migration. Flagging so it isn't mistaken for "fully locked down."
-- ============================================================

-- CORRECTED 2026-08-27. The original statement here was:
--
--     revoke select (password_hash, password_plain) on public.accounts
--       from anon, authenticated;
--
-- It runs without error and does NOTHING. Table-level and column-level
-- privileges are separate in Postgres: `GRANT SELECT ON accounts` authorises
-- every column by itself, and a column-level REVOKE does not subtract from
-- it. This was "applied" and the bcrypt hashes stayed readable through the
-- public anon key the whole time.
--
-- The working form is to drop the table-level grant and grant back only the
-- columns the app actually reads. Safe here because every read of `accounts`
-- in src/services/db.js names its columns (ACCOUNT_COLUMNS / the profile
-- select) — there is no `select('*')` to break.
revoke select on public.accounts from anon, authenticated;

grant select (
  id, username, email, role, barangay, full_name, position, phone,
  status, created_at, last_login, avatar, must_change_password,
  email_verified_at, mfa_enabled
) on public.accounts to anon, authenticated;

-- password_hash and password_plain are deliberately absent from that list.
