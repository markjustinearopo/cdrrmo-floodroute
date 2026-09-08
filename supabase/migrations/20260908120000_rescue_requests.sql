-- ============================================================================
-- No Safe Route → Automatic Rescue Request
-- Migration: 20260908120000_rescue_requests
--
-- WHY THIS TABLE EXISTS
-- The routing engine can already answer "what is the safest way out of here".
-- Until now it had no way to answer the question underneath it: what happens
-- when the honest answer is THERE IS NO WAY OUT. The resident screen fell back
-- to recommending the least-bad path — a route across water the same engine
-- had just flagged as impassable — and CDRRMO never learned that anyone had
-- asked. Somebody standing in a cut-off barangay at 2 a.m. was, as far as the
-- command center was concerned, invisible.
--
-- A rescue request is the record of that moment: WHERE the person is, WHEN
-- they asked, WHY the system could not route them, and WHICH roads closed
-- around them. It is created by the system, not by a form — nobody who is cut
-- off should have to fill anything in — and it lands on the CDRRMO dashboard
-- in real time.
--
-- WHY NOT `incidents`
-- Incidents are what CDRRMO logs about the city (flooding, a fallen post, a
-- stranded vehicle) and are worked through new → assigned → in-progress →
-- resolved. A rescue request is a person waiting, worked through
-- pending → responding → rescued → resolved, and it carries the routing
-- evidence that produced it. Squeezing that into `incidents.description`
-- would lose the structure responders need (exact GPS, the blocked roads, the
-- modeled depth) and would put resident-created rows into a table whose RLS is
-- written for officials. It is a separate record, wired into the SAME shared
-- data layer (AdminDataContext), realtime channel, notification feed and admin
-- shell as everything else — not a separate system.
--
-- Additive and idempotent: no DROP of an existing object, safe to re-run.
-- ============================================================================

begin;

create table if not exists public.rescue_requests (
  id            bigint generated always as identity primary key,

  -- WHO. account_id is the resident's own account; the display name is
  -- denormalised so a responder reading the row at 2 a.m. does not need a
  -- join, and so the record still names somebody if the account is removed.
  account_id    integer references public.accounts(id) on delete set null,
  reporter      text,
  contact       text,
  barangay      text,

  -- WHERE. The position at the moment the request fired. `accuracy_m` is the
  -- GPS fix's own reported accuracy — a 2 km circle and a 5 m circle are very
  -- different instructions to a rescue boat, and that difference must survive
  -- into the record instead of both rendering as one confident pin.
  lat           numeric,
  lng           numeric,
  accuracy_m    numeric,
  location      text,                              -- free-text landmark, if known

  -- WHY. 'no-safe-route' is the automatic trigger this migration exists for;
  -- the column is open so a manually raised request can say something else.
  reason        text not null default 'no-safe-route',

  -- WHAT THE ROUTER SAW. The evidence that produced the request: the roads it
  -- had to refuse, the modeled depth, the destinations it tried and failed to
  -- reach. jsonb because this is a snapshot of a live model at one instant —
  -- read as a whole by the responder view, never queried by column.
  hazard        jsonb not null default '{}'::jsonb,
  blocked_roads text[],

  -- STATUS. Pending → Responding → Rescued → Resolved.
  --   pending    nobody has picked it up yet
  --   responding a team is on the way
  --   rescued    the person is out of danger
  --   resolved   the record is closed (rescued, or stood down / duplicate)
  status        text not null default 'pending'
                check (status in ('pending', 'responding', 'rescued', 'resolved')),
  assigned_team text,

  requested_at  timestamptz not null default now(),
  responded_at  timestamptz,
  rescued_at    timestamptz,
  resolved_at   timestamptz,
  updated_at    timestamptz not null default now()
);

-- Point geometry, derived exactly like incidents.geom / evacuation_centers.geom
-- so rescue markers sit in the same spatial world as everything else and
-- PostGIS proximity queries ("which team is nearest") work without a rewrite.
alter table public.rescue_requests
  add column if not exists geom geometry(Point, 4326)
    generated always as (
      case
        when lng is not null and lat is not null
        then st_setsrid(st_makepoint(lng::double precision,
                                     lat::double precision), 4326)
      end
    ) stored;

comment on table public.rescue_requests is
  'Automatic rescue requests raised when the flood-aware router can find no safe route out for a resident. Created by the system, worked by CDRRMO.';
comment on column public.rescue_requests.hazard is
  'Snapshot of the routing verdict: flood level, modeled depth, blocked/flooded roads, destinations attempted. Evidence, not configuration.';

-- The per-request activity timeline, mirroring incident_updates.
create table if not exists public.rescue_request_updates (
  id           bigint generated always as identity primary key,
  request_id   bigint not null references public.rescue_requests(id) on delete cascade,
  label        text not null,
  note         text,
  created_by   text,
  created_at   timestamptz not null default now()
);

-- The dashboard reads "open requests, newest first" on every sync; the map
-- reads them by position. Both get an index.
create index if not exists rescue_requests_status_idx
  on public.rescue_requests (status, requested_at desc);
create index if not exists rescue_requests_requested_at_idx
  on public.rescue_requests (requested_at desc);
create index if not exists rescue_requests_account_idx
  on public.rescue_requests (account_id);
create index if not exists rescue_requests_geom_gix
  on public.rescue_requests using gist (geom);
create index if not exists rescue_request_updates_request_idx
  on public.rescue_request_updates (request_id, id);

-- `updated_at` maintained in the database, so a row touched by any path — the
-- admin UI, an RPC, the SQL editor — carries an honest timestamp.
create or replace function public.rescue_requests_touch()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists rescue_requests_touch_trg on public.rescue_requests;
create trigger rescue_requests_touch_trg
  before update on public.rescue_requests
  for each row execute function public.rescue_requests_touch();


-- ── Row-level security ──────────────────────────────────────────────────────
-- Written against the signed-JWT claims minted by auth-otp (account_id,
-- app_role, barangay) — the same posture as the Phase 2 policies in
-- 20260901140000_operational_tables_rls.sql, NOT the demo-grade `using (true)`
-- blanket, which this table deliberately never joins.
--
-- A rescue request says exactly where a named person is, alone, unable to
-- move. It is the most sensitive row in this database. Reads are therefore
-- narrower than incidents: CDRRMO, the barangay it falls in, and the resident
-- who raised it. Nothing here is readable by anon.
alter table public.rescue_requests        enable row level security;
alter table public.rescue_request_updates enable row level security;

drop policy if exists rescue_requests_read on public.rescue_requests;
create policy rescue_requests_read on public.rescue_requests
  for select to authenticated
  using (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangay = (auth.jwt() ->> 'barangay')
    or account_id = nullif(auth.jwt() ->> 'account_id', '')::integer
  );

-- A resident may only ever raise a request as THEMSELVES: account_id must
-- match their own claim — the same rule that closed the client-set-anything
-- gap on flood_reports. CDRRMO/staff may raise one on somebody's behalf (a
-- phone-in), which is why the role branch exists.
drop policy if exists rescue_requests_insert on public.rescue_requests;
create policy rescue_requests_insert on public.rescue_requests
  for insert to authenticated
  with check (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or account_id = nullif(auth.jwt() ->> 'account_id', '')::integer
  );

-- Working a request — assigning a team, moving it to Responding/Rescued — is
-- CDRRMO's job, plus the barangay the person is standing in, who in practice
-- reaches them first.
drop policy if exists rescue_requests_update on public.rescue_requests;
create policy rescue_requests_update on public.rescue_requests
  for update to authenticated
  using (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangay = (auth.jwt() ->> 'barangay')
  )
  with check (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangay = (auth.jwt() ->> 'barangay')
  );

-- Deletion is CDRRMO only. A finished request is the record of an event and
-- should be closed, not erased.
drop policy if exists rescue_requests_delete on public.rescue_requests;
create policy rescue_requests_delete on public.rescue_requests
  for delete to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));

-- Timeline rows follow their parent: same pragmatic role-gating as
-- incident_updates (no per-row join back to the parent's barangay).
drop policy if exists rescue_request_updates_read on public.rescue_request_updates;
create policy rescue_request_updates_read on public.rescue_request_updates
  for select to authenticated
  using (true);

drop policy if exists rescue_request_updates_write on public.rescue_request_updates;
create policy rescue_request_updates_write on public.rescue_request_updates
  for insert to authenticated
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff', 'barangay', 'resident'));

drop policy if exists rescue_request_updates_admin_modify on public.rescue_request_updates;
create policy rescue_request_updates_admin_modify on public.rescue_request_updates
  for update to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));

drop policy if exists rescue_request_updates_admin_delete on public.rescue_request_updates;
create policy rescue_request_updates_admin_delete on public.rescue_request_updates
  for delete to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));


-- ── Audit trail ─────────────────────────────────────────────────────────────
-- "Who marked that rescue Rescued, and when?" is precisely the kind of
-- question the Phase 6 audit log exists to answer, and a rescue request is
-- higher-stakes evidence than anything already covered by it. Reuses
-- public.audit_row() rather than logging separately, and is guarded so this
-- migration still applies on a database where the audit phase has not run.
do $audit$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'audit_row'
  ) then
    execute 'drop trigger if exists audit_rescue_requests on public.rescue_requests';
    execute 'create trigger audit_rescue_requests '
            'after insert or update or delete on public.rescue_requests '
            'for each row execute function public.audit_row()';
  end if;
end
$audit$;


-- ── Realtime ────────────────────────────────────────────────────────────────
-- "In real time" is the whole requirement, so these tables join the realtime
-- publication here rather than being switched on by hand in the dashboard and
-- silently missing in the next environment. AdminDataContext subscribes to
-- both and refetches the collection on any change; the 6 s poll remains the
-- fallback if the socket drops.
do $pub$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'rescue_requests'
    ) then
      execute 'alter publication supabase_realtime add table public.rescue_requests';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'rescue_request_updates'
    ) then
      execute 'alter publication supabase_realtime add table public.rescue_request_updates';
    end if;
  end if;
end
$pub$;

-- Full row images on UPDATE, so a realtime subscriber can tell WHICH request
-- changed status rather than receiving a primary key and having to guess.
alter table public.rescue_requests        replica identity full;
alter table public.rescue_request_updates replica identity full;

commit;
