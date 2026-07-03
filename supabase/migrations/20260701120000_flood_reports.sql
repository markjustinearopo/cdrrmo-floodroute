-- ============================================================================
-- CDRRMO FloodRoute — Resident flood reporting + official verification
-- Migration: 20260701120000_flood_reports
--
-- ADDITIVE and non-destructive. Adds the two tables behind the resident
-- "Report Flood Status" flow and the CDRRMO verification workflow, WITHOUT
-- touching any existing table:
--
--   1. flood_reports      — one row per resident-submitted flood report. Starts
--                           life as 'pending' and only becomes visible on the
--                           public map (+ feeds route planning) once an official
--                           approves it. Rejected reports stay hidden.
--   2. flood_report_logs  — the verification / status-history trail for each
--                           report (submitted → approved / rejected / notes).
--
-- Follows the existing conventions:
--   * PostGIS point derived from lat/lng (GENERATED ... STORED), SRID 4326.
--   * The same DEMO-GRADE permissive RLS posture as 20260613130000_app_wiring
--     (anon + authenticated full CRUD) so the browser app can read/write with
--     the public anon key. For production, replace with per-role policies.
-- ============================================================================

begin;

-- PostGIS is already enabled by 20260613120000_postgis_spatial; guard anyway so
-- this migration is safe to run standalone.
create extension if not exists postgis;

-- ----------------------------------------------------------------------------
-- 1) flood_reports — resident-submitted flood reports
-- ----------------------------------------------------------------------------
create table if not exists public.flood_reports (
  id                  bigint generated always as identity primary key,
  -- Who filed it. FK to the app's accounts table; nulled if the account is
  -- later removed so the report (and its history) survives.
  user_id             integer references public.accounts(id) on delete set null,
  reporter_name       text,                          -- denormalised display name
  barangay            text,                          -- barangay the point falls in
  lat                 numeric not null,
  lng                 numeric not null,
  flood_level         text not null default 'moderate'
                        check (flood_level in ('none','low','moderate','severe','impassable')),
  water_depth_ft      numeric,                        -- optional, recorded in FEET (CDRRMO unit)
  description         text,                           -- resident remarks
  photo               text,                           -- optional base64 data-URL evidence
  -- Approval workflow: pending → approved (public) | rejected (hidden).
  verification_status text not null default 'pending'
                        check (verification_status in ('pending','approved','rejected')),
  official_notes      text,                           -- CDRRMO note added on review
  verified_by         text,                           -- official/admin who decided
  verified_at         timestamptz,
  reported_at         timestamptz not null default now(),
  geom                geometry(Point, 4326) generated always as (
                        case
                          when lng is not null and lat is not null
                          then st_setsrid(st_makepoint(lng::double precision,
                                                       lat::double precision), 4326)
                        end
                      ) stored
);

comment on table public.flood_reports is
  'Resident-submitted flood reports. Only verification_status = approved rows are public / feed routing.';
comment on column public.flood_reports.geom is
  'Auto-derived point from lng/lat (WGS84).';

-- ----------------------------------------------------------------------------
-- 2) flood_report_logs — verification log + status history per report
-- ----------------------------------------------------------------------------
create table if not exists public.flood_report_logs (
  id           bigint generated always as identity primary key,
  report_id    bigint not null references public.flood_reports(id) on delete cascade,
  action       text not null,   -- submitted | approved | rejected | verification_requested | status_updated | note
  from_status  text,
  to_status    text,
  note         text,
  actor        text,            -- resident name (submitted) or official (decisions)
  created_at   timestamptz not null default now()
);

comment on table public.flood_report_logs is
  'Per-report verification/activity trail (submitted, approved, rejected, notes).';

-- ----------------------------------------------------------------------------
-- 3) Indexes
-- ----------------------------------------------------------------------------
create index if not exists flood_reports_geom_gix       on public.flood_reports     using gist (geom);
create index if not exists flood_reports_status_idx      on public.flood_reports     (verification_status);
create index if not exists flood_reports_reported_idx    on public.flood_reports     (reported_at desc);
create index if not exists flood_report_logs_report_idx  on public.flood_report_logs (report_id);

-- ----------------------------------------------------------------------------
-- 4) Row-level security — DEMO-GRADE permissive policy (matches app_wiring).
--    >>> SECURITY NOTE <<< anon + authenticated get full CRUD. Fine for a
--    thesis / demo build; tighten to per-role policies for production.
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['flood_reports','flood_report_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_anon_all', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      t || '_anon_all', t
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5) Realtime — add the new tables to the supabase_realtime publication so the
--    app's live cross-user sync fires instantly (the 6s poll is the fallback).
--    Guarded: ignore if the publication is missing or the table is already in it.
-- ----------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.flood_reports;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.flood_report_logs;
  exception when others then null;
  end;
end $$;

commit;
