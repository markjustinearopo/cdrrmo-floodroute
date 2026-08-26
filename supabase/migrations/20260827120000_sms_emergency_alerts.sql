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
