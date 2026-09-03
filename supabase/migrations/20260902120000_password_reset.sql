-- ============================================================================
-- Password reset — allow the new one-time-code purpose.
--
-- WHY THIS EXISTS
-- There was no way to reset a password. An official who forgot theirs needed
-- a developer to edit the database by hand. For a system whose entire purpose
-- is to be reachable when a typhoon is landing, that is not a gap — it is a
-- scheduled outage waiting for its date.
--
-- The reset flow reuses the auth_codes machinery that already backs email
-- verification and two-factor sign-in (see the request-reset / confirm-reset
-- actions in supabase/functions/auth-otp/index.ts). All this migration does is
-- widen the purpose CHECK so those rows can be written — without it, every
-- reset request fails on a constraint violation.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

alter table public.auth_codes
  drop constraint if exists auth_codes_purpose_check;

alter table public.auth_codes
  add constraint auth_codes_purpose_check
  check (purpose in ('verify_email', 'login_mfa', 'reset_password'));

commit;

-- ---------------------------------------------------------------------------
-- AFTER RUNNING THIS, redeploy the function that owns the codes:
--
--     npx supabase functions deploy auth-otp
--
-- Then check it end to end: "Forgot password?" on the login screen, enter a
-- real account's email, read the code, set a new password, and confirm you
-- land signed in. Codes expire in 10 minutes and allow 5 attempts, the same
-- limits the verification and 2FA flows use.
-- ---------------------------------------------------------------------------
