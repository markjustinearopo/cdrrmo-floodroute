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
