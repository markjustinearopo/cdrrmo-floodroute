-- ============================================================================
-- PENDING MIGRATIONS — run this ONCE in the Supabase SQL Editor.
--
--   https://supabase.com/dashboard/project/sreazvhevxijkespxxac/sql/new
--   → paste the whole file → Run
--
-- WHY THIS FILE EXISTS
-- Two migrations in supabase/migrations/ were written but never applied to the
-- live database. Both are DDL, so the app's public anon key cannot apply them
-- (PostgREST does not run DDL) — a human with dashboard access has to.
--
-- Verified against the live project on 2026-08-25:
--   ✗ 20260817120000_lock_account_password_columns  NOT applied
--   ✗ 20260821120000_alerts_emergency_level         NOT applied
--   ✓ 20260613120000_postgis_spatial                applied
--   ✓ 20260613130000_app_wiring                     applied
--   ✓ 20260623120000_auth_hashing_avatar            applied
--   ✓ 20260701120000_flood_reports                  applied
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) SECURITY — stop bulk-reading password hashes with the public anon key.
--
--    Right now `GET /rest/v1/accounts?select=*` returns every account's bcrypt
--    password_hash to anyone holding the anon key — and that key ships inside
--    the browser bundle of the deployed site, so "anyone" means any visitor
--    who opens dev tools. Confirmed live: the CDRRMO administrator hashes come
--    back in plain HTTP responses.
--
--    RLS is a ROW-level policy; `using (true)` says nothing about which COLUMNS
--    a select may return. This revokes the two password columns specifically.
--    Login is unaffected: app_login / app_change_password / the hashing trigger
--    are SECURITY DEFINER and run as the table owner.
--
--    STILL NOT FIXED (needs real auth, not a migration): anon can still WRITE
--    to accounts. Flagging so this is not mistaken for "fully locked down."
-- ---------------------------------------------------------------------------
revoke select (password_hash, password_plain) on public.accounts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Allow the EMERGENCY alert level.
--
--    alerts.level carries a CHECK constraint that permits only the three levels
--    the system originally shipped with (high / moderate / safe). The top tier
--    — the one that takes over every signed-in screen and sounds a siren — is
--    'emergency', and Postgres rejects it:
--
--      new row for relation "alerts" violates check constraint "alerts_level_check"
--
--    The app writes optimistically, so the alert appeared on the operator's
--    screen and then vanished when the persist failed. For a warning channel
--    that is the worst possible failure: the operator believes the city was
--    warned, and it was not.
--
--    'low' is included because levelFromDepth grades barangays into
--    safe/low/moderate/high, so an alert raised off that grading can carry it.
--
--    The constraint is kept, not dropped: it is what stops a typo or a future
--    bug writing a level nothing in the UI knows how to render.
-- ---------------------------------------------------------------------------
alter table public.alerts
  drop constraint if exists alerts_level_check;

alter table public.alerts
  add constraint alerts_level_check
  check (level in ('emergency', 'high', 'moderate', 'low', 'safe'));

commit;

-- ---------------------------------------------------------------------------
-- After running, re-seed so the emergency alert lands at its true level
-- (the seed downgrades it to 'high' when the constraint rejects it):
--
--   node scripts/seed-operational-data.mjs
-- ---------------------------------------------------------------------------


-- ############################################################################
-- ############################################################################
--
--   ADDED 2026-08-26 — RESIDENT VERIFICATION + TWO-FACTOR SIGN-IN
--
--   Everything below is migration 20260826120000_resident_verification_mfa.sql,
--   inlined so it can be pasted into the SQL editor with the two above.
--
--   THIS SQL IS ONLY HALF THE CHANGE. The logic lives in an Edge Function that
--   also has to be deployed, and the app deliberately keeps working (with the
--   old, single-factor sign-in) until it is. Full order of operations:
--
--     1. Run this whole file in the Supabase SQL editor.
--
--     2. Deploy the function that owns the one-time codes:
--
--            npx supabase login
--            npx supabase link --project-ref sreazvhevxijkespxxac
--            npx supabase functions deploy auth-otp
--
--        It reuses the RESEND_API_KEY secret that send-alert-email already
--        uses (verified set on 2026-08-26), so no new secret is required.
--        Optional hardening: set a dedicated signing secret for the
--        proof-of-work challenge, instead of falling back to the service key —
--
--            npx supabase secrets set AUTH_OTP_SECRET="$(openssl rand -hex 32)"
--
--        Optional: send from your own verified domain rather than Resend's
--        shared onboarding sender (which lands in spam more often) —
--
--            npx supabase secrets set AUTH_OTP_FROM="CDRRMO FloodRoute <noreply@yourdomain.ph>"
--
--     3. Add this to .env (and to the Vercel project's env vars) so a missing
--        function becomes a hard failure instead of falling back to
--        single-factor sign-in:
--
--            VITE_REQUIRE_AUTH_FUNCTION=true
--
--        See the "Transitional fallback" note in src/services/api.js. Until
--        step 2 is done, LEAVE THIS UNSET — otherwise nobody can sign in.
--
--     4. Check it end to end: register a resident with a real address, confirm
--        the code arrives, then sign out and sign back in to see the second
--        factor. Codes expire in 10 minutes, allow 5 attempts, and are rate
--        limited to 6 per address per hour.
--
--   WHAT THIS DOES NOT FIX: `anon` can still WRITE to public.accounts through
--   PostgREST (the permissive demo policy from 20260613130000). Registration is
--   no longer the way in, but a direct POST to /rest/v1/accounts still is. That
--   needs the write policies tightened, which is a separate change.
--
-- ############################################################################
-- ============================================================
-- Resident account verification + two-factor sign-in.
--
-- WHY: residents self-register. Until now anyone — or anything — could type an
-- address they do not own, get an active account, and read that barangay's
-- operational picture. Nothing proved the address was real, nothing proved the
-- person registering could receive mail at it, and nothing stood between a
-- script and 10,000 accounts.
--
-- This adds the storage for three controls. The logic that uses them lives in
-- the `auth-otp` Edge Function, which holds the service-role key — codes are
-- minted, hashed and checked there and are NEVER returned to the browser.
--
--   1. Email verification  — a new resident account starts `pending` and is
--      activated only by a code delivered to the address they registered.
--   2. Login two-factor    — after the password check, a second code goes to
--      the verified address. Residents default to on.
--   3. Trusted devices     — so 2FA is not a per-login tax on someone who may
--      be opening this while evacuating. A device the resident confirms is
--      remembered for 30 days, revocably.
--
-- SECURITY NOTE ON RLS: these two tables get RLS enabled and NO policy, which
-- denies anon and authenticated outright. That is deliberate — they hold code
-- hashes and device tokens, and the anon key ships in the browser bundle. The
-- Edge Function uses the service role, which bypasses RLS. Do NOT add them to
-- the permissive `*_anon_all` policy loop in 20260613130000_app_wiring.sql.
--
-- Idempotent: safe to re-run, safe on the live database.
-- ============================================================

begin;

-- ── accounts: verification + 2FA state ──────────────────────────────────────
alter table public.accounts add column if not exists email_verified_at timestamptz;
alter table public.accounts add column if not exists mfa_enabled boolean not null default false;

-- Accounts that already existed are real people the CDRRMO seeded by hand, so
-- they are treated as verified rather than being locked out by this migration.
update public.accounts
   set email_verified_at = coalesce(email_verified_at, created_at, now())
 where email_verified_at is null;

-- Residents are the self-registering role, so they are the ones that need the
-- second factor by default. Staff can opt in from their account settings.
update public.accounts
   set mfa_enabled = true
 where role = 'resident' and mfa_enabled = false;


-- ── One-time codes (email verification + login 2FA) ─────────────────────────
create table if not exists public.auth_codes (
  id           bigserial primary key,
  account_id   integer references public.accounts(id) on delete cascade,
  email        text        not null,
  purpose      text        not null check (purpose in ('verify_email', 'login_mfa')),
  -- SHA-256 of (salt || code). The code itself is never stored anywhere.
  code_hash    text        not null,
  code_salt    text        not null,
  expires_at   timestamptz not null,
  attempts     smallint    not null default 0,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists auth_codes_lookup_idx
  on public.auth_codes (lower(email), purpose, created_at desc);
create index if not exists auth_codes_expiry_idx
  on public.auth_codes (expires_at);


-- ── Trusted devices ─────────────────────────────────────────────────────────
create table if not exists public.trusted_devices (
  id            bigserial primary key,
  account_id    integer     not null references public.accounts(id) on delete cascade,
  -- SHA-256 of the opaque token held in the browser. A database leak therefore
  -- does not hand anyone a working device token.
  token_hash    text        not null unique,
  label         text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_used_at  timestamptz
);

create index if not exists trusted_devices_account_idx
  on public.trusted_devices (account_id);


-- ── Lock both tables away from the browser ──────────────────────────────────
alter table public.auth_codes      enable row level security;
alter table public.trusted_devices enable row level security;

-- No policies on purpose: RLS with zero policies denies every role except the
-- service role (which bypasses it). Belt and braces, revoke the grants too so
-- an accidentally-added permissive policy still would not expose them.
revoke all on public.auth_codes      from anon, authenticated;
revoke all on public.trusted_devices from anon, authenticated;
revoke all on sequence public.auth_codes_id_seq      from anon, authenticated;
revoke all on sequence public.trusted_devices_id_seq from anon, authenticated;


-- ── app_login must refuse accounts that have not verified their email ───────
-- Same contract as before (returns the session payload, or null on a bad
-- credential) with one addition: a distinguishable 'unverified' result, so the
-- sign-in screen can say "check your email" instead of "wrong password" — the
-- latter sends a real resident round a loop they cannot get out of.
create or replace function public.app_login(p_identifier text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_acc public.accounts;
begin
  select * into v_acc
  from public.accounts
  where (lower(email) = lower(p_identifier) or lower(username) = lower(p_identifier))
    and password_hash is not null
    and password_hash = extensions.crypt(p_password, password_hash)
    and coalesce(status, 'active') <> 'suspended'
  limit 1;

  if not found then
    return null;
  end if;

  -- Correct password, but the address was never proven. Do not start a session.
  if v_acc.email_verified_at is null then
    return jsonb_build_object(
      'unverified', true,
      'email', v_acc.email,
      'fullName', v_acc.full_name
    );
  end if;

  update public.accounts set last_login = now() where id = v_acc.id;

  return jsonb_build_object(
    'id', v_acc.id,
    'email', v_acc.email,
    'username', v_acc.username,
    'role', v_acc.role,
    'barangay', v_acc.barangay,
    'fullName', v_acc.full_name,
    'avatar', v_acc.avatar,
    'status', v_acc.status,
    'mfaEnabled', coalesce(v_acc.mfa_enabled, false)
  );
end $$;


-- ── Registration is no longer callable straight from the browser ────────────
-- app_register_resident created an ACTIVE account from an unproven address.
-- Registration now goes through the auth-otp Edge Function, which does the
-- human check, creates the account `pending`, and mails the code. Leaving the
-- old RPC executable by anon would leave the whole control trivially bypassable
-- (POST /rest/v1/rpc/app_register_resident and you are in), so the grant is
-- withdrawn. The function itself is kept for the service role.
revoke execute on function public.app_register_resident(text, text, text, text)
  from anon, authenticated;

commit;
