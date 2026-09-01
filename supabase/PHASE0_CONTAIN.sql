-- ============================================================================
-- PHASE 0 — CONTAIN. Run this ONCE in the Supabase SQL editor, tonight.
--
--   https://supabase.com/dashboard/project/sreazvhevxijkespxxac/sql/new
--   → paste the whole file → Run
--
-- WHAT IS WRONG RIGHT NOW
-- Probed live on 2026-08-31 (scripts/check-anon-writes.mjs): all twelve
-- application tables accept an anonymous DELETE. The public anon key ships
-- inside the browser bundle of the deployed site, so "anonymous" means any
-- visitor who opens dev tools. One request —
--
--     DELETE /rest/v1/alerts?id=gte.0
--
-- — removes every flood alert in Cabuyao. The same holds for accounts,
-- evacuation_centers, road_status and the rest.
--
-- This file does not fix the access model; that is Phase 2, and it needs real
-- per-role policies. This caps the blast radius tonight so the weeks that
-- proper fix takes are not spent wide open.
--
-- WHY THIS IS NOW A PRECISE CUT AND NOT A BLUNT ONE
-- The original containment plan assumed this would break the admin UI, and
-- accepted that ("if the admin Users tab breaks, that is the correct trade").
-- It no longer has to. Phase 1 shipped first: auth-otp now mints a signed JWT
-- carrying `role: authenticated`, so PostgREST runs a signed-in operator's
-- requests as the `authenticated` Postgres role, while an unauthenticated
-- stranger is still `anon`. Those are two different roles with two different
-- grant sets, so revoking from `anon` alone:
--
--     · removes the mass-wipe scenario entirely, and
--     · leaves every signed-in CDRRMO operator working exactly as before.
--
-- In Postgres a write needs BOTH the table privilege AND a permitting RLS
-- policy. Revoking the privilege is therefore sufficient on its own — the
-- permissive `*_anon_all` policy from 20260613130000 stays in place and stays
-- irrelevant to DELETE-as-anon once the grant is gone.
--
-- (Contrast the failure in 20260817120000: a COLUMN-level revoke does not
-- subtract from a TABLE-level grant, so that one silently did nothing. This is
-- a table-level revoke of a table-level privilege, which does work. Verify it
-- rather than trusting it — see the bottom of this file.)
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Remove DELETE from the anonymous role, everywhere.
--
--    Deletes are rare and administrative. Nothing a not-yet-signed-in visitor
--    does in this app legitimately deletes a row — the landing page counts
--    barangays and evacuation centres, the login page authenticates through a
--    SECURITY DEFINER RPC, and registration goes through the auth-otp Edge
--    Function on the service role. All three are unaffected by this.
-- ---------------------------------------------------------------------------
revoke delete on all tables in schema public from anon;

-- Future tables should not silently re-open the hole.
alter default privileges in schema public revoke delete on tables from anon;


-- ---------------------------------------------------------------------------
-- 2) `accounts` is the crown jewel — take INSERT and UPDATE from anon too.
--
--    Today an anonymous POST can create an account at any role, and an
--    anonymous PATCH can set password_plain on an existing one (the hashing
--    trigger then turns it into a working password) — that is full takeover of
--    any CDRRMO administrator account, from a browser, with no credential.
--
--    Legitimate anonymous account writes do not go through PostgREST:
--      · registration  → auth-otp Edge Function (service role)
--      · sign-in       → app_login (SECURITY DEFINER)
--      · password change → app_change_password (SECURITY DEFINER)
--    SECURITY DEFINER functions run as the table owner and are not affected.
-- ---------------------------------------------------------------------------
revoke insert, update on public.accounts from anon;

commit;

-- ---------------------------------------------------------------------------
-- VERIFY, do not assume. From the repo:
--
--     node scripts/check-anon-writes.mjs
--
-- Expected after this runs: every table DENIED for anon, and still ALLOWED for
-- a signed-in admin token. If any row still says ALLOWED for anon, this did
-- not take effect and the hole is still open.
--
-- STILL OPEN after this file — deliberately, because they need the real access
-- model (Phase 2), not a revoke:
--   · anon can still INSERT/UPDATE every table other than accounts
--   · anon can still SELECT operational data
--   · `authenticated` is still unrestricted: any signed-in account, of any
--     role, from any barangay, can still write anything. Jurisdiction is not
--     enforced yet — Phase 1 only made it VISIBLE (app_role + barangay claims).
-- ---------------------------------------------------------------------------
