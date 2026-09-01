-- ============================================================================
-- Phase 2 of the identity/RLS fix — real per-role policies on public.accounts.
--
-- WHY THIS TABLE, WHY FIRST
-- accounts is the highest-value target and the smallest blast radius: sign-in
-- (app_login), registration (auth-otp Edge Function) and password change
-- (app_change_password) are all SECURITY DEFINER and bypass RLS entirely, so
-- none of that breaks here. The only real PostgREST-visible surface is the
-- admin Users tab (usersDb.list/create/update/remove) plus one shared surface
-- every portal uses: a signed-in user reading and editing THEIR OWN row
-- (Avatar.jsx, AccountModal.jsx) — verified by tracing every call site in
-- src/services/db.js and every importer, not assumed.
--
-- TWO REAL HOLES THIS CLOSES, CONFIRMED LIVE ON 2026-09-01:
--
--   1. Phase 0 (20260831) revoked INSERT/UPDATE on accounts from `anon` only.
--      `authenticated` was never touched, and the permissive accounts_anon_all
--      policy (using(true) with check(true), 20260613130000_app_wiring.sql)
--      still applies to it. So ANY signed-in account — a resident, using
--      their own valid Phase-1 session token — can currently PATCH ANY OTHER
--      row, including their own `role` column:
--
--          PATCH /rest/v1/accounts?id=eq.<any admin's id>
--          { "role": "admin" }
--
--      That is a full account takeover / self-promotion path, live, today,
--      for anyone who has ever signed in.
--
--   2. The same permissive policy also covers `anon` for SELECT. Confirmed
--      live: `GET /rest/v1/accounts?select=id,full_name,email,role,barangay`
--      with only the public anon key returns real residents' names and
--      personal emails and real CDRRMO officials' names and government
--      emails — no session, no credential, just the key every visitor's
--      browser already holds.
--
-- THE FIX
-- Drop accounts_anon_all. Replace with real policies keyed off the claims
-- Phase 1 already puts in every signed-in request's JWT (auth.jwt()):
--
--   SELECT  — admin/staff see every row (Users tab). Anyone else sees only
--             their own row (id = their own account_id claim) — covers
--             Avatar.jsx and AccountModal's own-profile read for every
--             portal. Not table-level: RLS filters ROWS, so the unrelated
--             background poll in AdminDataContext (which calls list() for
--             every role, unconditionally, every 6s, though only the admin
--             Users tab ever renders the result) simply gets back "just
--             yourself" instead of erroring — correct either way, quieter.
--   INSERT  — admin/staff only (new accounts, e.g. a barangay official).
--   UPDATE  — admin/staff only, full stop. A resident or barangay official
--             editing their OWN profile (name/email/phone/position/avatar —
--             AccountModal.jsx's Save Changes / photo upload) no longer goes
--             through a raw UPDATE at all: it moves to app_update_own_profile
--             below, which takes the id from the verified JWT (not from
--             client input) and writes only that fixed column list. This is
--             deliberately NOT "row-level self-edit, minus the sensitive
--             columns" — expressing "this row, but not this column, unless
--             the caller is admin" in pure RLS needs a WITH CHECK that
--             compares NEW against OLD per-column, which is exactly the kind
--             of clever-and-wrong SQL that got 20260817120000 silently
--             wrong. A SECURITY DEFINER function with a fixed column list is
--             the same pattern already proven correct by app_login and
--             app_change_password in this same schema.
--   DELETE  — admin/staff only.
--
-- Anon gets none of the above (no SELECT, no INSERT, no UPDATE, no DELETE) —
-- there is no legitimate not-yet-signed-in read of this table; every real
-- anon-facing path already goes through a SECURITY DEFINER function or the
-- Edge Function's service role.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Self-service profile update, in place of a raw UPDATE.
--
--    id comes from the verified JWT's account_id claim (Phase 1), never from
--    client input, so there is no id parameter for a caller to substitute
--    someone else's row into. The column list is fixed in the function body,
--    matching exactly what AccountModal.jsx's Save Changes already sends
--    (userToDb in src/services/db.js) — role/barangay/status/must_change_
--    password/password_hash are not reachable through this path at all,
--    regardless of what a caller sends.
-- ---------------------------------------------------------------------------
create or replace function public.app_update_own_profile(
  p_full_name text, p_email text, p_phone text, p_position text, p_avatar text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id integer;
  v_acc public.accounts;
begin
  v_id := nullif(auth.jwt() ->> 'account_id', '')::integer;
  if v_id is null then
    raise exception 'Not signed in.';
  end if;

  update public.accounts
     set full_name = p_full_name,
         email      = p_email,
         phone      = p_phone,
         position   = p_position,
         avatar     = p_avatar
   where id = v_id
  returning * into v_acc;

  if not found then
    raise exception 'Account not found.';
  end if;

  return jsonb_build_object(
    'id', v_acc.id, 'fullName', v_acc.full_name, 'email', v_acc.email,
    'phone', v_acc.phone, 'position', v_acc.position, 'avatar', v_acc.avatar
  );
end;
$$;

revoke all on function public.app_update_own_profile(text, text, text, text, text) from public;
grant execute on function public.app_update_own_profile(text, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 2) Replace the permissive policy with real per-role ones.
-- ---------------------------------------------------------------------------
drop policy if exists accounts_anon_all on public.accounts;

create policy accounts_select on public.accounts
  for select to authenticated
  using (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or id = nullif(auth.jwt() ->> 'account_id', '')::integer
  );

create policy accounts_admin_insert on public.accounts
  for insert to authenticated
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));

create policy accounts_admin_update on public.accounts
  for update to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));

create policy accounts_admin_delete on public.accounts
  for delete to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));

commit;

-- ---------------------------------------------------------------------------
-- VERIFY, do not assume — node scripts/check-rls.mjs. Expected after this:
--   · anon: SELECT/INSERT/UPDATE/DELETE all denied on accounts (was: SELECT
--     allowed, leaking real names/emails)
--   · resident/barangay token: SELECT own row only (not the roster), UPDATE
--     denied entirely (was: UPDATE on ANY row allowed, including role)
--   · admin/staff token: everything allowed, unchanged
-- ---------------------------------------------------------------------------
