begin;
-- Deploy the version-aware auth-otp and operator functions BEFORE this migration.
-- Trigger names determine order: compare hashes after the existing hashing trigger.
drop trigger if exists zz_accounts_revoke_sessions on public.accounts;
create trigger zz_accounts_revoke_sessions before update on public.accounts
  for each row execute function public.accounts_revoke_sessions();
commit;
