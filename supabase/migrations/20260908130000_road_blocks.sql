-- ============================================================================
-- Partial Road Block / Selective Road Closure
-- Migration: 20260908130000_road_blocks
--
-- WHY THIS TABLE EXISTS
-- `road_status` is keyed `unique (osm_way_id)`: one row per OSM way, one
-- status for the whole way. That shape encodes an assumption that turns out
-- to be false on the ground — that a road is either open or closed along its
-- entire length. In Cabuyao it usually is not. The National Highway is one
-- way id for kilometres; when the underpass floods, marking it `blocked` tells
-- the router that every metre of it is impassable, and the router dutifully
-- sends people the long way around a road that is fine for all but 200 m of
-- itself. Operators learned to under-report closures to avoid that, which is
-- the worst of both outcomes.
--
-- A road block is therefore its own record with its own GEOMETRY: the section
-- between two points an operator picked on the map. Several can exist on the
-- same way (the underpass AND the bridge approach), each with its own reason,
-- depth and lifecycle.
--
-- `road_status` IS NOT TOUCHED. Full-road closures keep working exactly as
-- they do today, through exactly the same table and the same code path. This
-- table is additive: a `scope = 'full'` row here is the same statement said in
-- the new vocabulary, and the app writes one only when the operator asks for
-- it. Nothing that works today stops working.
--
-- Additive and idempotent: no DROP of an existing object, safe to re-run.
-- ============================================================================

begin;

create table if not exists public.road_blocks (
  id            bigint generated always as identity primary key,

  -- WHICH ROAD. The OSM way this section belongs to. NOT unique — that is the
  -- entire point of this table. Deliberately not a foreign key to public.roads:
  -- the routable network is bundled with the client and a way can be blocked
  -- before the roads table has been backfilled with it.
  osm_way_id    bigint not null,
  road_name     text,
  barangay      text,

  -- HOW MUCH OF IT.
  --   'partial' — the section between start_* and end_* only
  --   'full'    — the whole way (the historical behaviour, expressible here
  --               so a single screen can manage both kinds)
  scope         text not null default 'partial'
                check (scope in ('partial', 'full')),

  -- WHERE IT STARTS AND ENDS. The two points the operator clicked, snapped
  -- onto the road centreline. Null on a 'full' block, which has no endpoints
  -- other than the way's own.
  start_lat     numeric,
  start_lng     numeric,
  end_lat       numeric,
  end_lng       numeric,

  -- THE BLOCKED SECTION ITSELF, as [[lat, lng], …] along the road centreline.
  -- Storing the geometry rather than "the road name plus two dots" is what
  -- lets the map draw the exact closed stretch and lets the router exclude
  -- exactly those segments — a name and two coordinates would force every
  -- reader to re-derive the shape, and they would not all derive the same one.
  geometry      jsonb not null default '[]'::jsonb,
  length_m      numeric,

  -- WHY.
  reason        text,
  -- Flood / hazard level, in the vocabulary the rest of the product already
  -- speaks (see services/systemConfig.levelFromDepth and data/floodReports).
  hazard_level  text check (hazard_level in ('low', 'moderate', 'high', 'severe')),
  depth_m       numeric,
  -- What the closure does to routing: 'blocked' removes the section from the
  -- graph, 'flooded' makes it expensive but passable — the same two words
  -- road_status uses, so one vocabulary covers both tables.
  effect        text not null default 'blocked'
                check (effect in ('blocked', 'flooded')),

  -- LIFECYCLE. Active blocks route; resolved ones stay as the record of what
  -- was closed when, which is what an after-action review actually needs.
  status        text not null default 'active'
                check (status in ('active', 'resolved')),

  -- WHO.
  account_id    integer references public.accounts(id) on delete set null,
  created_by    text,

  reported_at   timestamptz not null default now(),
  resolved_at   timestamptz,
  updated_at    timestamptz not null default now()
);

-- The real spatial object, alongside the jsonb the app reads. Written by the
-- client in the same statement as `geometry` (see roadBlocksDb.toRow in
-- src/services/db.js), so the two cannot drift; PostGIS/pgRouting queries —
-- "which blocks intersect this route", "what is closed within 500 m" — run
-- against this column without the app having to parse anything.
alter table public.road_blocks
  add column if not exists geom geometry(LineString, 4326);

comment on table public.road_blocks is
  'Selective road closures. Each row is one blocked SECTION of a road, with its own geometry; several may exist on the same osm_way_id.';
comment on column public.road_blocks.geometry is
  'The blocked section as [[lat, lng], …] along the road centreline. The app''s source of truth; `geom` is the PostGIS projection of it.';
comment on column public.road_blocks.scope is
  'partial = the section between start/end only; full = the entire way.';

create index if not exists road_blocks_way_idx
  on public.road_blocks (osm_way_id) where status = 'active';
create index if not exists road_blocks_status_idx
  on public.road_blocks (status, reported_at desc);
create index if not exists road_blocks_geom_gix
  on public.road_blocks using gist (geom);

-- `updated_at` maintained in the database, so a row touched by any path
-- carries an honest timestamp.
create or replace function public.road_blocks_touch()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists road_blocks_touch_trg on public.road_blocks;
create trigger road_blocks_touch_trg
  before update on public.road_blocks
  for each row execute function public.road_blocks_touch();


-- ── Row-level security ──────────────────────────────────────────────────────
-- Same posture as road_status, and for the same reason: which roads are
-- passable is public safety information. A resident has to be able to see the
-- closed section before they walk into it, and they must be able to see it
-- whether or not they are signed in. Writes are CDRRMO's alone — a barangay's
-- route into this is the existing app_settings change-request queue, which an
-- admin approves.
alter table public.road_blocks enable row level security;

drop policy if exists road_blocks_read on public.road_blocks;
create policy road_blocks_read on public.road_blocks
  for select to anon, authenticated
  using (true);

drop policy if exists road_blocks_admin_write on public.road_blocks;
create policy road_blocks_admin_write on public.road_blocks
  for all to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));


-- ── Audit trail ─────────────────────────────────────────────────────────────
-- road_status is audited (Phase 6) because "which roads were impassable at
-- 2 a.m.?" is a question a DRRMO gets asked afterwards. A partial closure is
-- the same question at finer resolution, so it is audited the same way.
-- Guarded, so this migration still applies where the audit phase has not run.
do $audit$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'audit_row'
  ) then
    execute 'drop trigger if exists audit_road_blocks on public.road_blocks';
    execute 'create trigger audit_road_blocks '
            'after insert or update or delete on public.road_blocks '
            'for each row execute function public.audit_row()';
  end if;
end
$audit$;


-- ── Realtime ────────────────────────────────────────────────────────────────
-- A closure has to reach every open map — the resident walking towards it most
-- of all — without anyone reloading. AdminDataContext subscribes to this table
-- and refetches on change; the 6 s poll is the fallback.
do $pub$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'road_blocks'
    ) then
      execute 'alter publication supabase_realtime add table public.road_blocks';
    end if;
  end if;
end
$pub$;

alter table public.road_blocks replica identity full;

commit;
