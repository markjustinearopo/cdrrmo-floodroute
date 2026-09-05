-- ============================================================================
-- Sign in with Google, for residents.
--
-- WHY THIS EXISTS
-- Registration in this system has a deadlock. A resident signs up, the server
-- mails them a six-digit code, and they cannot open the account until they
-- type it back. But the office has no verified sending domain, so the mail
-- provider will only deliver to the developer's own address — three real
-- residents sat at status='pending' for weeks because of it, and resident
-- two-factor had to be switched off entirely as a stopgap.
--
-- Google breaks the deadlock rather than working around it. A Google ID token
-- carries `email_verified`, asserted and signed by Google. That is STRONGER
-- evidence than a code we mail to an address, and it costs nothing to obtain,
-- because we are not the ones delivering anything.
--
-- WHAT THIS MIGRATION ACTUALLY CHANGES
-- Very little, deliberately. The identity system is unchanged: auth-otp still
-- mints the same HS256 session JWT with the same account_id / app_role /
-- barangay claims, so all of Phase 2's RLS keeps working untouched. This adds
-- one column so the app can tell how an account signs in.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- How this account authenticates.
--   'password'  the existing path: app_login against the bcrypt hash.
--   'google'    no password exists at all. Not "a password we hid" — the row
--               is inserted without one, the accounts_hash_password trigger
--               only fires when password_plain is non-empty, so password_hash
--               stays NULL and app_login's crypt() comparison can never match.
--               A credential that was never set is a credential nobody can
--               phish, reuse from another breach, or leak.
alter table public.accounts
  add column if not exists auth_provider text not null default 'password';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'accounts_auth_provider_check'
  ) then
    alter table public.accounts
      add constraint accounts_auth_provider_check
      check (auth_provider in ('password', 'google'));
  end if;
end $$;

comment on column public.accounts.auth_provider is
  'How this account signs in. google = no password_hash exists; the only door
   in is a verified Google ID token (see supabase/functions/auth-otp/google.ts).';

-- A Google account has no password, so password_plain must be optional. It is
-- almost certainly nullable already — this is here so a database rebuilt from
-- migrations alone cannot end up rejecting the insert.
alter table public.accounts alter column password_plain drop not null;

create index if not exists accounts_auth_provider_idx
  on public.accounts (auth_provider);

commit;

-- ---------------------------------------------------------------------------
-- VERIFY — do not trust that this applied. Three migrations in this project
-- have run clean and done nothing (a column-level REVOKE that does not
-- subtract from a table grant, and array_length on an empty array).
--
--   1. The column exists and defaults correctly:
--        select auth_provider, count(*) from public.accounts group by 1;
--      Expect every existing row to read 'password'.
--
--   2. The constraint actually refuses a bad value — write the row it should
--      reject, rather than assuming:
--        update public.accounts set auth_provider = 'facebook' where id = <n>;
--      Expect: ERROR, violates accounts_auth_provider_check.
--
--   3. A Google account really has no usable password. After one resident has
--      signed in with Google:
--        select email, auth_provider, password_hash is null as no_password
--        from public.accounts where auth_provider = 'google';
--      Expect no_password = true. If it is false, the row was created with a
--      password somewhere and this migration's central claim is wrong.
-- ---------------------------------------------------------------------------
