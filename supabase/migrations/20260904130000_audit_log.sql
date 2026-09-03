-- ============================================================================
-- Phase 6 — the audit trail.
--
-- An emergency office's output is EVIDENCE. Right now this system cannot
-- answer the questions a DRRMO is actually judged on afterwards:
--
--     "Who raised this alert, when, and on what basis?"
--     "Which roads were impassable at 2 a.m.?"
--     "Who marked that evacuation centre full?"
--
-- Nothing recorded any of it. alerts, road_status, accounts and
-- evacuation_centers are all mutated in place, so the previous value is gone
-- the moment it changes — the record of an event is destroyed as the event
-- happens, which is precisely when it matters.
--
-- WHY TRIGGERS AND NOT EDGE FUNCTIONS
-- The remediation plan assumed privileged writes would be funnelled through
-- service-role Edge Functions, and that the audit log would be written there.
-- Phase 2 took the other route: RLS policies, with writes still going direct
-- through PostgREST. A trigger is strictly better for this architecture —
-- it fires on EVERY write no matter the path: the admin UI, a barangay
-- official's browser, an RPC, a script, or someone typing in the SQL editor.
-- There is no way to write to these tables and not be recorded.
--
-- WHO the actor is comes from the Phase 1 identity work: the signed JWT
-- carries account_id and app_role, and auth.jwt() is readable inside the
-- trigger because it runs in the request's own context.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

create table if not exists public.audit_log (
  id           bigserial primary key,
  -- WHO. Null for an unauthenticated write (which, after Phase 2, should be
  -- close to impossible on these tables — a null here is itself a finding).
  actor_id     integer,
  actor_role   text,
  -- WHAT
  action       text        not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name   text        not null,
  row_id       text,
  -- BEFORE / AFTER. Full row images: the question after an event is usually
  -- "what did it say before?", and storing a diff means deciding in advance
  -- which columns will matter.
  before_data  jsonb,
  after_data   jsonb,
  at           timestamptz not null default now()
);

create index if not exists audit_log_at_idx         on public.audit_log (at desc);
create index if not exists audit_log_table_row_idx  on public.audit_log (table_name, row_id);
create index if not exists audit_log_actor_idx      on public.audit_log (actor_id);

comment on table public.audit_log is
  'Append-only record of every write to the operational tables. Written by
   the audit_row() trigger, never by the application directly.';


-- ---------------------------------------------------------------------------
-- The trigger.
--
-- SECURITY DEFINER so it can insert into audit_log even though the calling
-- role has no grant on it — that is the point: the application can generate
-- audit rows but can never write, edit or delete one directly.
-- ---------------------------------------------------------------------------
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  integer;
  v_role   text;
  v_row_id text;
begin
  -- nullif guards the empty-string case: an anon request has no account_id
  -- claim at all, and ''::integer would raise rather than yield null.
  v_actor := nullif(auth.jwt() ->> 'account_id', '')::integer;
  v_role  := auth.jwt() ->> 'app_role';

  if tg_op = 'DELETE' then
    v_row_id := to_jsonb(old) ->> 'id';
    insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, before_data, after_data)
    values (v_actor, v_role, tg_op, tg_table_name, v_row_id, to_jsonb(old), null);
    return old;
  end if;

  v_row_id := to_jsonb(new) ->> 'id';
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, before_data, after_data)
  values (
    v_actor, v_role, tg_op, tg_table_name, v_row_id,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end $$;


-- ---------------------------------------------------------------------------
-- Attach it to the tables whose history is the actual evidence.
--
-- alerts             — what was warned, to whom, when, by whom.
-- road_status        — which roads were impassable and at what hour. This is
--                      the after-action timeline: road_status upserts in
--                      place on osm_way_id, so without this the state of the
--                      network during an event is overwritten AS the event
--                      unfolds. The audit rows preserve it.
-- evacuation_centers — capacity and occupancy over the course of an event.
-- accounts           — who was given or denied access, and by whom.
--
-- NOT audited: flood_readings and notifications (high-volume, low-evidentiary
-- value — they would bury the rows that matter), and the auth/SMS code
-- tables, which hold credential material that has no business being copied.
-- ---------------------------------------------------------------------------
drop trigger if exists audit_alerts on public.alerts;
create trigger audit_alerts
  after insert or update or delete on public.alerts
  for each row execute function public.audit_row();

drop trigger if exists audit_road_status on public.road_status;
create trigger audit_road_status
  after insert or update or delete on public.road_status
  for each row execute function public.audit_row();

drop trigger if exists audit_evacuation_centers on public.evacuation_centers;
create trigger audit_evacuation_centers
  after insert or update or delete on public.evacuation_centers
  for each row execute function public.audit_row();

drop trigger if exists audit_accounts on public.accounts;
create trigger audit_accounts
  after insert or update or delete on public.accounts
  for each row execute function public.audit_row();


-- ---------------------------------------------------------------------------
-- Lock it down. Read: CDRRMO only. Write: nobody — only the trigger, which
-- runs as the definer and bypasses this.
--
-- An audit log the application can edit is not an audit log.
-- ---------------------------------------------------------------------------
alter table public.audit_log enable row level security;

drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));

revoke insert, update, delete on public.audit_log from anon, authenticated;
revoke all on sequence public.audit_log_id_seq from anon, authenticated;

commit;

-- ---------------------------------------------------------------------------
-- VERIFY — do not trust that this applied. Three migrations in this project
-- have run clean and done nothing (see the column-level REVOKE in
-- 20260817120000, and array_length in 20260904120000).
--
--   1. Change something, then:
--        select action, table_name, row_id, actor_id, actor_role, at
--        from public.audit_log order by at desc limit 5;
--      Expect a row naming the account that made the change.
--
--   2. Confirm the log cannot be tampered with — as a signed-in admin:
--        DELETE /rest/v1/audit_log?id=eq.<n>   → must be refused (42501)
--
--   3. Reconstruct the road network at a past moment:
--        select row_id, after_data ->> 'status', at
--        from public.audit_log
--        where table_name = 'road_status' and at <= '<timestamp>'
--        order by at desc;
-- ---------------------------------------------------------------------------
