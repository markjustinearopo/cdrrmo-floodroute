-- ============================================================================
-- PENDING MIGRATIONS — run this ONCE in the Supabase SQL Editor.
--
--   https://supabase.com/dashboard/project/sreazvhevxijkespxxac/sql/new
--   → paste the whole file → Run
--
-- WHY THIS FILE EXISTS
-- Several migrations in supabase/migrations/ were written but never applied to
-- the live database. They are DDL, so the app's public anon key cannot apply
-- them (PostgREST does not run DDL) — a human with dashboard access has to.
--
-- State after the 2026-08-27 run (node scripts/check-backend.mjs):
--   ✓ 20260827120000_sms_emergency_alerts           APPLIED
--        SMS tables exist and are correctly locked; accounts.phone present
--   ✗ 20260817120000_lock_account_password_columns  STILL OPEN
--        password_hash is STILL readable with the public anon key — the
--        statement was wrong, not merely unapplied. See section 1 below.
--   ✓ 20260821120000_alerts_emergency_level         applied
--   ✓ 20260826120000_resident_verification_mfa      applied
--   ✓ 20260613120000_postgis_spatial                applied
--   ✓ 20260613130000_app_wiring                     applied
--   ✓ 20260623120000_auth_hashing_avatar            applied
--   ✓ 20260701120000_flood_reports                  applied
--   ✓ 20260830120000_session_whoami                 applied — verified live 2026-08-31:
--        signed in as testadmin (app_role=admin) and testbarangay (app_role=
--        barangay, barangay=Baclaran); whoami() echoed the right claims for
--        each, and an anon-only call got back nothing but {"role":"anon"}.
--        Identity now flows end to end — Phase 2 (real RLS policies) is
--        unblocked.
--
-- TWO BUGS IN THIS FILE WERE FOUND BY RUNNING IT, AND ARE NOW FIXED HERE:
--
--   1. The password-column REVOKE was a no-op (column-level REVOKE does not
--      subtract from a table-level GRANT). Rewritten as revoke-then-column-
--      grant, which actually works.
--
--   2. ORDERING. The 2026-08-26 section sets email_verified_at on every row
--      and mfa_enabled = true on every resident. The 2026-08-27 section that
--      unsticks stranded residents was predicated on `email_verified_at is
--      null`, so by the time it ran it matched nothing — the stranded accounts
--      stayed pending AND three working residents had two-factor switched on
--      against a mail channel that cannot deliver. Both statements are now
--      order-independent.
--
--      That damage has already been repaired on the live database with
--      `node scripts/repair-accounts.mjs`. Re-running this file will no longer
--      re-break it.
--
-- The already-applied sections are left in place: every statement in this file
-- is idempotent, so pasting the whole thing is always safe, and editing it down
-- to "just the new bit" is how a step gets skipped.
--
-- Re-run check-backend.mjs afterwards to confirm each ✗ has flipped.
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
--    a select may return.
--
--    WHY THE PREVIOUS VERSION OF THIS DID NOTHING (found 2026-08-27, after it
--    had been "applied" and the hashes were still readable):
--
--        revoke select (password_hash, password_plain) on accounts from anon;
--
--    In Postgres, table-level and column-level privileges are SEPARATE grants.
--    `GRANT SELECT ON accounts` authorises every column on its own, and a
--    column-level REVOKE does not subtract from it — the statement succeeds,
--    reports no error, and changes nothing. The only way to restrict columns is
--    to drop the table-level grant and then grant the allowed columns back.
--
--    Safe for this app: every read of `accounts` in src/services/db.js names
--    its columns explicitly (ACCOUNT_COLUMNS, the profile select) — there is no
--    `select('*')` anywhere that would break. Login is unaffected either way:
--    app_login / app_change_password / the hashing trigger are SECURITY DEFINER
--    and run as the table owner.
--
--    STILL NOT FIXED (needs real auth, not a migration): anon can still WRITE
--    to accounts. Flagging so this is not mistaken for "fully locked down."
-- ---------------------------------------------------------------------------
revoke select on public.accounts from anon, authenticated;

grant select (
  id, username, email, role, barangay, full_name, position, phone,
  status, created_at, last_login, avatar, must_change_password,
  email_verified_at, mfa_enabled
) on public.accounts to anon, authenticated;

-- password_hash and password_plain are deliberately absent from that list.

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


-- ############################################################################
-- ############################################################################
--
--   ADDED 2026-08-27 — EMERGENCY SMS + THE REGISTRATION DEAD END
--
--   Everything below is migration 20260827120000_sms_emergency_alerts.sql,
--   inlined so it can be pasted into the SQL editor with the ones above.
--
--   WHY IT MATTERS MORE THAN IT LOOKS
--   A live check of this project on 2026-08-27 found THREE real residents
--   (rovictamboong23@gmail.com, rovictamboong@gmail.com,
--   markjustine211996@gmail.com) sitting at status='pending' with correct
--   passwords and no way in — the verification email could not physically be
--   delivered, because the Resend account has no verified sending domain and
--   can only mail the developer's own address. The same check confirmed
--   send-alert-email still returns Resend's sandbox error, which means no
--   flood alert email has ever reached a resident either.
--
--   This migration unsticks those three accounts and adds the storage for a
--   channel that actually reaches people: SMS.
--
--   AFTER RUNNING IT:
--
--     1. Deploy the two functions (the frontend already calls both):
--
--            npx supabase functions deploy sms-alert
--            npx supabase functions deploy auth-otp
--
--        Until sms-alert responds, the resident opt-in card and the admin SMS
--        panel both say the channel is unreachable rather than pretending.
--
--     2. Give it a provider. With no key it runs in SIMULATION: every message
--        is recorded in sms_messages and labelled "not delivered" on screen.
--        Semaphore is the right choice for Cabuyao (free trial credits, and it
--        reaches any Philippine number, unlike a Twilio trial):
--
--            npx supabase secrets set SEMAPHORE_API_KEY=xxxxxxxx
--            npx supabase secrets set SEMAPHORE_SENDER_NAME=CDRRMO
--
--     3. Verify with: node scripts/check-backend.mjs
--
-- ############################################################################
-- ============================================================================
-- Emergency SMS alerts + phone-based account verification.
--
-- WHY THIS EXISTS
-- Almost nobody opens a municipal website on the evening a typhoon lands. They
-- look at their phone. Until now the only outbound channel this system had was
-- email, through a Resend account with no verified sending domain — which means
-- it can physically only deliver to the developer's own inbox. Every "alert
-- sent" this system has ever reported to an operator was, for residents, a
-- message that went nowhere.
--
-- This adds the storage for a channel that reaches people where they are:
--
--   1. A resident opts in with their mobile number and confirms it with a code.
--   2. CDRRMO issues an alert; every VERIFIED, non-opted-out number in the
--      affected barangay is texted.
--   3. Every send is written to an outbox with its provider and outcome, so
--      "we warned Barangay Mamatid" is a claim somebody can check.
--
-- SCOPE OF THE OPT-IN, deliberately narrow: emergency alerts only. There is no
-- marketing list here and no way to grow one — `purpose` on every message row
-- records why it was sent, and the only purposes the function will send are
-- 'alert' (a real CDRRMO alert), 'verify' (the resident's own opt-in code) and
-- 'test' (an operator testing their own configuration).
--
-- WHERE THE LOGIC LIVES: supabase/functions/sms-alert/index.ts. It holds the
-- service-role key, so codes are hashed and checked there and phone numbers are
-- never bulk-readable from the browser — see the RLS note below.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ── accounts: the number a resident registered with ─────────────────────────
alter table public.accounts add column if not exists phone text;

comment on column public.accounts.phone is
  'Mobile number in E.164 (+639XXXXXXXXX). Used for emergency SMS and, when the
   email channel is undeliverable, for account verification.';


-- ── How an account-verification code was actually delivered ─────────────────
-- auth_codes already stores the salted hash; it did not store which channel
-- carried it. That matters at verification time: if the code arrived by SMS,
-- the resident has just proved they hold that handset, and their number can be
-- enrolled for emergency alerts on the spot. If it arrived by email, the phone
-- they typed is still unproven and has to be confirmed separately.
alter table public.auth_codes add column if not exists channel text;


-- ── Who has opted in to emergency SMS ───────────────────────────────────────
create table if not exists public.sms_subscribers (
  id           bigserial primary key,
  phone        text        not null unique,          -- E.164, normalised by the function
  account_id   integer     references public.accounts(id) on delete set null,
  barangay     text,                                 -- which alerts reach this number
  full_name    text,
  verified_at  timestamptz,                          -- null until the code is entered
  opted_out_at timestamptz,                          -- set by STOP / the resident's toggle
  source       text        not null default 'resident'
               check (source in ('resident', 'registration', 'admin', 'import')),
  last_sent_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists sms_subscribers_barangay_idx
  on public.sms_subscribers (barangay)
  where verified_at is not null and opted_out_at is null;


-- ── Every message the system tried to send ──────────────────────────────────
-- This is the audit trail. A warning system that cannot show what it actually
-- delivered is indistinguishable from one that delivered nothing.
create table if not exists public.sms_messages (
  id         bigserial primary key,
  phone      text        not null,
  body       text        not null,
  purpose    text        not null check (purpose in ('alert', 'verify', 'test')),
  alert_id   integer,
  barangay   text,
  level      text,
  provider   text,                                   -- semaphore | twilio | simulation
  -- 'simulated' is a first-class outcome, not a failure: with no provider key
  -- configured the pipeline still runs end to end and says so, rather than
  -- pretending a handset was reached.
  status     text        not null default 'queued'
             check (status in ('queued', 'sent', 'failed', 'simulated')),
  error      text,
  created_at timestamptz not null default now()
);

create index if not exists sms_messages_recent_idx on public.sms_messages (created_at desc);
create index if not exists sms_messages_alert_idx  on public.sms_messages (alert_id);


-- ── One-time codes for confirming a phone number ────────────────────────────
-- Separate from auth_codes because that table's `email` column is NOT NULL and
-- its purpose CHECK is about email flows. Same discipline: salted SHA-256, the
-- code itself is never stored.
create table if not exists public.sms_codes (
  id          bigserial primary key,
  phone       text        not null,
  purpose     text        not null default 'verify_phone'
              check (purpose in ('verify_phone', 'verify_account')),
  code_hash   text        not null,
  code_salt   text        not null,
  expires_at  timestamptz not null,
  attempts    smallint    not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists sms_codes_lookup_idx on public.sms_codes (phone, purpose, created_at desc);


-- ── Lock all three away from the browser ────────────────────────────────────
-- RLS with ZERO policies denies anon and authenticated outright; the service
-- role bypasses it. These tables hold residents' mobile numbers and live code
-- hashes, and the anon key ships inside the deployed browser bundle — so unlike
-- the operational tables, there is no version of "readable from the client"
-- that is acceptable here.
--
-- The admin SMS panel therefore reads its outbox through the Edge Function,
-- which returns numbers MASKED (+63 9•• ••• 1234). An operator auditing a
-- dispatch needs to know a message went out and to how many people; they do not
-- need a downloadable list of every resident's phone number, and neither does
-- anyone who opens dev tools on the deployed site.
--
-- Do NOT add these to the permissive `*_anon_all` policy loop in
-- 20260613130000_app_wiring.sql.
alter table public.sms_subscribers enable row level security;
alter table public.sms_messages    enable row level security;
alter table public.sms_codes       enable row level security;

revoke all on public.sms_subscribers from anon, authenticated;
revoke all on public.sms_messages    from anon, authenticated;
revoke all on public.sms_codes       from anon, authenticated;
revoke all on sequence public.sms_subscribers_id_seq from anon, authenticated;
revoke all on sequence public.sms_messages_id_seq    from anon, authenticated;
revoke all on sequence public.sms_codes_id_seq       from anon, authenticated;


-- ── The SMS provider row on the Integrations screen ─────────────────────────
-- The API key is entered in the Supabase secrets, not here; this row records
-- which provider is in play and whether the channel is switched on.
insert into public.integrations (id, enabled, status, config)
values ('sms', false, 'disconnected', '{"provider":"semaphore","senderName":"CDRRMO"}'::jsonb)
on conflict (id) do nothing;


-- ── Unstick the residents the email gate stranded ───────────────────────────
-- Three real people registered, the verification email could not physically be
-- delivered (Resend sandbox: only the developer's own address), and their
-- accounts have sat at status='pending' ever since — correct password, no way
-- in, no way to ask for another code that would also not arrive.
--
-- They chose their own passwords and their own barangay; activating them grants
-- nothing they did not already ask for. Leaving them locked out is not the
-- safer option, it is just the one where the system quietly loses its users.
--
-- Scoped as narrowly as it can be: residents only, only accounts that were
-- never verified, only ones that already exist at the moment this runs.
-- ORDER MATTERS, and getting it wrong here cost a live outage on 2026-08-27.
-- The 2026-08-26 section ABOVE runs first and does two things to every row:
--   set email_verified_at = coalesce(email_verified_at, created_at, now())
--   set mfa_enabled = true  where role = 'resident'
-- The first version of the statement below carried `and email_verified_at is
-- null`, which by this point in the file matches NOTHING — so the stranded
-- accounts stayed pending, and three residents who could sign in that morning
-- had two-factor switched on against a mail channel that cannot deliver.
--
-- So: no predicate on email_verified_at, and the two-factor downgrade is
-- explicit rather than incidental.
update public.accounts
   set status = 'active',
       email_verified_at = coalesce(email_verified_at, now())
 where role = 'resident'
   and status = 'pending';

-- Two-factor by email would strand every resident on their next sign-in, so it
-- stays off until a code can actually be delivered. Turn it back on with
--   node scripts/repair-accounts.mjs --enable-mfa
-- once SMS is live or a sending domain is verified, and confirm a real sign-in
-- before trusting it.
update public.accounts
   set mfa_enabled = false
 where role = 'resident'
   and mfa_enabled;

commit;

-- ---------------------------------------------------------------------------
-- AFTER RUNNING THIS
--
--   1. Deploy the function that owns the sending:
--
--          npx supabase functions deploy sms-alert
--
--   2. Give it a provider. Without one it runs in SIMULATION mode — every
--      message is written to sms_messages with status='simulated' and the
--      admin panel says so in as many words. That is enough to demonstrate and
--      test the whole pipeline; it is not enough to warn anybody.
--
--      Semaphore (Philippine gateway, free trial credits, reaches any PH
--      number — the right choice here):
--
--          npx supabase secrets set SMS_PROVIDER=semaphore
--          npx supabase secrets set SEMAPHORE_API_KEY=xxxxxxxx
--          npx supabase secrets set SEMAPHORE_SENDER_NAME=CDRRMO
--
--      Twilio (works, but a trial account can only text numbers you have
--      verified in the Twilio console — fine for a demo, useless for a city):
--
--          npx supabase secrets set SMS_PROVIDER=twilio
--          npx supabase secrets set TWILIO_ACCOUNT_SID=ACxxxx
--          npx supabase secrets set TWILIO_AUTH_TOKEN=xxxx
--          npx supabase secrets set TWILIO_FROM=+1xxxxxxxxxx
--
--   3. Turn the channel on: Settings → API Integrations → SMS Gateway, and
--      Settings → Alert Settings → "Send SMS to residents".
--
-- STILL OPEN, and not fixed by this migration: `anon` can write directly to
-- public.accounts through PostgREST (the permissive demo policy from
-- 20260613130000). See supabase/PENDING_MIGRATIONS.sql.
-- ---------------------------------------------------------------------------


-- ############################################################################
-- ############################################################################
--
--   ADDED 2026-08-30 — REAL SESSIONS: PHASE 1 OF THE IDENTITY/RLS FIX
--
--   Everything below is migration 20260830120000_session_whoami.sql, inlined
--   so it can be pasted into the SQL editor with everything above.
--
--   WHY THIS MATTERS
--   Every request this app has ever made — from every role — has hit
--   PostgREST as the anon key. `accounts` and nearly every other table carry a
--   blanket `using (true) with check (true)` RLS policy (20260613130000), and
--   the "session" the browser keeps in localStorage was never more than the
--   string `local-<id>` — never sent anywhere, checked by nothing. RLS cannot
--   be tightened before this: a policy can only say using(true) or
--   using(false) when every caller looks identical, so locking it down first
--   either changes nothing or locks out every legitimate user at once.
--
--   This is Phase 1, and it does exactly one thing: make the session real.
--   `auth-otp` now mints a signed JWT at sign-in (account_id, app_role,
--   barangay, exp — see the code change in the same commit) and the frontend
--   attaches it as the Authorization bearer on every request. RLS itself is
--   UNCHANGED here — still the same permissive policies — so the app should
--   look and behave identically. What changes is that Postgres can now, for
--   the first time, tell who is actually asking. Writing real per-role,
--   per-barangay policies against that is Phase 2, a separate change.
--
--   AFTER RUNNING THE SQL BELOW:
--
--     1. Get the project's JWT signing secret: Supabase dashboard →
--        Settings → API → JWT Settings → reveal/generate the Legacy JWT
--        Secret (HS256). This is what auth-otp signs with and what PostgREST
--        already validates against — that's what makes a self-minted token
--        acceptable to PostgREST at all.
--
--     2. Give auth-otp that secret and redeploy it:
--
--            npx supabase secrets set SESSION_JWT_SECRET="<value from step 1>"
--            npx supabase functions deploy auth-otp
--
--     3. Sign in and confirm it worked: DevTools → Application → Local
--        Storage → `cdrrmo_token` should be a three-part JWT now, not
--        `local-<id>`. Then, in the console on the running app:
--
--            await supabase.rpc('whoami')
--
--        should echo back { role: "authenticated", account_id, app_role,
--        barangay, exp, ... } — the claims for whoever is currently signed
--        in. A different role/barangay signing in should change the answer.
--
--   WHAT THIS DOES NOT FIX: RLS is exactly as permissive as it was before
--   this ran. `anon` can still read and write everything the blanket policy
--   from 20260613130000 covers — this migration only makes it POSSIBLE to
--   change that. The break-glass password-only fallback in src/services/
--   api.js (`legacyLogin`, off by default) still cannot mint a token — it has
--   no path to the signing secret, by design — so once Phase 2 does land, a
--   break-glass sign-in will read as plain anon to Postgres rather than as
--   the signed-in account. That is the correct direction to fail.
-- ############################################################################

create or replace function public.whoami()
returns jsonb
language sql
security invoker
stable
as $$ select coalesce(auth.jwt(), '{}'::jsonb) $$;

grant execute on function public.whoami() to anon, authenticated;

-- ---------------------------------------------------------------------------
