-- ============================================================
-- Auth password hashing + profile-photo column.
--
-- WHY THIS EXISTS: the live database hashes account passwords (bcrypt via
-- pgcrypto) — `password_hash` is the real credential and `password_plain` is
-- nulled by a trigger after hashing. That layer was applied directly to the
-- database and was never captured as a migration, so the older
-- `20260613130000_app_wiring.sql` still defines `app_login` with a PLAIN-TEXT
-- check (`password_plain = p_password`). Replaying migrations from scratch would
-- leave that broken version in place and every login would fail.
--
-- This migration captures the real auth layer AND adds the new `avatar` column
-- (profile photos). Everything is idempotent (IF NOT EXISTS / CREATE OR REPLACE
-- / DROP … IF EXISTS), so it is safe to re-run and safe on the live database.
-- ============================================================

-- pgcrypto (crypt / gen_salt) lives in the `extensions` schema on Supabase.
create extension if not exists pgcrypto with schema extensions;

-- Hashed password + profile photo (a small data-URL image).
alter table public.accounts add column if not exists password_hash text;
alter table public.accounts add column if not exists avatar text;

-- On write, hash `password_plain` into `password_hash` and clear the plaintext,
-- so cleartext is never stored. Callers (seeds, registration, password change)
-- keep writing `password_plain`; this turns it into a bcrypt hash transparently.
create or replace function public.accounts_hash_password()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.password_plain is not null and new.password_plain <> '' then
    new.password_hash := extensions.crypt(new.password_plain, extensions.gen_salt('bf'));
    new.password_plain := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_accounts_hash_password on public.accounts;
create trigger trg_accounts_hash_password
  before insert or update on public.accounts
  for each row execute function public.accounts_hash_password();

-- Login: verify the bcrypt HASH (password_plain is null after hashing) and
-- return the session payload, including the avatar.
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

  update public.accounts set last_login = now() where id = v_acc.id;

  return jsonb_build_object(
    'id', v_acc.id,
    'email', v_acc.email,
    'username', v_acc.username,
    'role', v_acc.role,
    'barangay', v_acc.barangay,
    'fullName', v_acc.full_name,
    'avatar', v_acc.avatar,
    'status', v_acc.status
  );
end $$;

-- Change password: verify the current hash, then set the new plaintext (the
-- trigger above re-hashes it).
create or replace function public.app_change_password(p_id integer, p_current text, p_new text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v public.accounts;
begin
  select * into v from public.accounts where id = p_id;
  if not found then return false; end if;
  if v.password_hash is null or v.password_hash <> extensions.crypt(p_current, v.password_hash) then
    return false; -- wrong current password
  end if;
  update public.accounts set password_plain = p_new where id = p_id; -- trigger re-hashes
  return true;
end $$;

-- Backfill: hash any legacy rows still holding plaintext (no-op once hashed —
-- on the live DB every account is already hashed).
update public.accounts set password_plain = password_plain
where password_plain is not null and password_plain <> '';

-- Grants (these RPCs are called with the anon key; security is enforced inside
-- the SECURITY DEFINER bodies, which require the correct password).
revoke all on function public.app_login(text, text) from public;
grant execute on function public.app_login(text, text) to anon, authenticated;
revoke all on function public.app_change_password(integer, text, text) from public;
grant execute on function public.app_change_password(integer, text, text) to anon, authenticated;
