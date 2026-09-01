-- ============================================================================
-- Phase 1 of the identity/RLS work — debug RPC for the new signed session.
--
-- WHY THIS EXISTS
-- Every request has always hit PostgREST as the anon key; RLS can only write
-- using(true)/using(false) until Postgres can tell callers apart. auth-otp now
-- mints a real signed JWT at sign-in (account_id, app_role, barangay, exp) and
-- the frontend attaches it as the Authorization bearer on every request — but
-- there was no fast way to CONFIRM a token actually arrives and Postgres can
-- actually read it, before writing a single real policy against those claims
-- (Phase 2).
--
-- whoami() echoes back exactly what the caller's own token carries. security
-- invoker (not definer) and no arguments in or out beyond auth.jwt() itself,
-- so it can never expose anything beyond what the request already carried —
-- safe to leave granted to anon (an anon caller just gets back null/{}).
--
-- Idempotent: safe to re-run, safe on the live database.
-- ============================================================================

create or replace function public.whoami()
returns jsonb
language sql
security invoker
stable
as $$ select coalesce(auth.jwt(), '{}'::jsonb) $$;

grant execute on function public.whoami() to anon, authenticated;
