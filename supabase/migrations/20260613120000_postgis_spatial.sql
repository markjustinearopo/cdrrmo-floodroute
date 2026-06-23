-- ============================================================================
-- CDRRMO FloodRoute — PostGIS spatial upgrade
-- Migration: 20260613120000_postgis_spatial
--
-- ADDITIVE and non-destructive. It builds on the existing core schema
-- (remote migration 20260610162301_cdrrmo_core_schema) WITHOUT dropping or
-- altering any existing column. It:
--   1. Enables the PostGIS extension.
--   2. Adds spatial geometry columns to existing tables, auto-derived from the
--      lat/lng columns already there (GENERATED ... STORED — no data entry).
--   3. Adds the spatial + supporting tables the app still needs — most
--      importantly `hazard_zones` (flood-inundation polygons: the core reason
--      PostGIS is in this stack).
--   4. Adds GiST spatial indexes and RLS policies that match the existing
--      public-read convention.
--
-- NO ROWS ARE INSERTED — this only sets up the structure.
--
-- Conventions:
--   * PostGIS coordinate order is (longitude, latitude) — x, y.
--   * SRID 4326 = WGS84 (GPS lat/lng), the same datum the Leaflet / Mapbox UI
--     and the bundled OSM road network already use.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Extensions
-- ----------------------------------------------------------------------------
create extension if not exists postgis;
create extension if not exists moddatetime schema extensions;

-- ----------------------------------------------------------------------------
-- 2) Spatial columns on existing tables (derived from existing lat/lng)
-- ----------------------------------------------------------------------------

-- barangays: point centroid (from center_lat/lng) + administrative boundary.
alter table public.barangays
  add column if not exists center_geom geometry(Point, 4326)
    generated always as (
      case
        when center_lng is not null and center_lat is not null
        then st_setsrid(st_makepoint(center_lng::double precision,
                                     center_lat::double precision), 4326)
      end
    ) stored,
  add column if not exists boundary geometry(MultiPolygon, 4326);

comment on column public.barangays.center_geom is
  'Auto-derived point from center_lng/center_lat (WGS84).';
comment on column public.barangays.boundary is
  'Administrative boundary polygon (OSM + PSA). Import from GeoJSON later.';

-- evacuation_centers: point location from lat/lng.
alter table public.evacuation_centers
  add column if not exists geom geometry(Point, 4326)
    generated always as (
      case
        when lng is not null and lat is not null
        then st_setsrid(st_makepoint(lng::double precision,
                                     lat::double precision), 4326)
      end
    ) stored;

comment on column public.evacuation_centers.geom is
  'Auto-derived point from lng/lat (WGS84).';

-- incidents: point location from lat/lng.
alter table public.incidents
  add column if not exists geom geometry(Point, 4326)
    generated always as (
      case
        when lng is not null and lat is not null
        then st_setsrid(st_makepoint(lng::double precision,
                                     lat::double precision), 4326)
      end
    ) stored;

comment on column public.incidents.geom is
  'Auto-derived point from lng/lat (WGS84).';

-- roads: full road centerline. Nullable — import the real OSM geometry here.
-- The start/mid/end lat/lng columns remain as a coarse fallback.
alter table public.roads
  add column if not exists geom geometry(LineString, 4326);

comment on column public.roads.geom is
  'Full road centerline (WGS84). Import from the bundled OSM road network.';

-- saved_routes: origin/destination points (derived) + the road-following path
-- line and any operator-drawn override line.
alter table public.saved_routes
  add column if not exists origin_geom geometry(Point, 4326)
    generated always as (
      case
        when origin_lng is not null and origin_lat is not null
        then st_setsrid(st_makepoint(origin_lng::double precision,
                                     origin_lat::double precision), 4326)
      end
    ) stored,
  add column if not exists dest_geom geometry(Point, 4326)
    generated always as (
      case
        when dest_lng is not null and dest_lat is not null
        then st_setsrid(st_makepoint(dest_lng::double precision,
                                     dest_lat::double precision), 4326)
      end
    ) stored,
  add column if not exists path geometry(LineString, 4326),
  add column if not exists override_path geometry(LineString, 4326);

comment on column public.saved_routes.path is
  'Road-following route geometry from the A* engine (WGS84).';
comment on column public.saved_routes.override_path is
  'Operator-drawn manual override route (OverrideRoutes screen).';

-- ----------------------------------------------------------------------------
-- 3) New spatial / supporting tables
-- ----------------------------------------------------------------------------

-- hazard_zones — processed flood-inundation / susceptibility polygons. This is
-- the D2 hazard store the front-end's hazardApi serves to the hazard layer as
-- GeoJSON, and the primary reason PostGIS is in this system.
create table if not exists public.hazard_zones (
  id                bigint generated always as identity primary key,
  category          text not null default 'inundation',  -- inundation | susceptibility | storm_surge | ...
  risk_class        text,                                 -- safe | low | moderate | high
  depth_m           numeric,                              -- representative flood depth (m)
  return_period_yr  integer,                              -- scenario, e.g. 5 / 25 / 100-yr
  barangay          text,                                 -- optional barangay tag
  source            text,                                 -- 'NOAH' | 'Open-Meteo' | 'survey' | ...
  properties        jsonb not null default '{}'::jsonb,
  geom              geometry(MultiPolygon, 4326) not null,
  valid_from        timestamptz,
  valid_to          timestamptz,
  created_at        timestamptz not null default now()
);
comment on table public.hazard_zones is
  'Flood-inundation / susceptibility polygons served as GeoJSON to the hazard layer.';

-- incident_updates — the per-incident activity timeline
-- (Reported -> Assigned -> In progress -> Resolved + free-text notes).
create table if not exists public.incident_updates (
  id           bigint generated always as identity primary key,
  incident_id  integer not null references public.incidents(id) on delete cascade,
  label        text not null,
  note         text,
  created_by   text,
  created_at   timestamptz not null default now()
);

-- notifications — command-center notification feed.
create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  level       text not null default 'moderate',   -- high | moderate | info
  title       text,
  message     text,
  account_id  integer references public.accounts(id) on delete cascade,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- integrations — external-service configuration (Open-Meteo weather + flood,
-- SMS gateway, SMTP, map tiles, sensor feed, push). The dynamic counterpart of
-- the front-end INTEGRATION_CATALOG.
-- NOTE: API keys / passwords land in `config`. For production secrets prefer
-- Supabase Vault rather than a plain jsonb column.
create table if not exists public.integrations (
  id          text primary key,                    -- 'weather' | 'floodhub' | 'sms' | 'email' | 'maptiles' | 'sensors' | 'push'
  enabled     boolean not null default false,
  status      text not null default 'disconnected',-- connected | disconnected | error
  config      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- roles — role definitions + the permission matrix (module x action) as jsonb.
create table if not exists public.roles (
  value       text primary key,                    -- 'admin' | 'operator' | 'officer' | 'viewer' | 'resident'
  label       text not null,
  description text,
  is_system   boolean not null default false,
  permissions jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- app_settings — single-row-per-key config bag. Holds the System Configuration
-- object and the Alert Settings object as two rows.
create table if not exists public.app_settings (
  key         text primary key,                    -- 'system_config' | 'alert_settings'
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4) Spatial + lookup indexes
-- ----------------------------------------------------------------------------
create index if not exists barangays_center_geom_gix    on public.barangays         using gist (center_geom);
create index if not exists barangays_boundary_gix       on public.barangays         using gist (boundary);
create index if not exists evac_geom_gix                on public.evacuation_centers using gist (geom);
create index if not exists incidents_geom_gix           on public.incidents          using gist (geom);
create index if not exists roads_geom_gix               on public.roads              using gist (geom);
create index if not exists saved_routes_path_gix        on public.saved_routes       using gist (path);
create index if not exists hazard_zones_geom_gix        on public.hazard_zones       using gist (geom);
create index if not exists hazard_zones_category_idx    on public.hazard_zones       (category);
create index if not exists incident_updates_incident_idx on public.incident_updates  (incident_id);
create index if not exists notifications_created_idx    on public.notifications      (created_at desc);

-- ----------------------------------------------------------------------------
-- 5) updated_at triggers (new tables that carry an updated_at column)
-- ----------------------------------------------------------------------------
drop trigger if exists integrations_set_updated on public.integrations;
create trigger integrations_set_updated before update on public.integrations
  for each row execute function extensions.moddatetime(updated_at);

drop trigger if exists app_settings_set_updated on public.app_settings;
create trigger app_settings_set_updated before update on public.app_settings
  for each row execute function extensions.moddatetime(updated_at);

-- ----------------------------------------------------------------------------
-- 6) Row-level security on the new tables
--    (mirrors the core schema's public-read posture: SELECT to anon +
--    authenticated; writes go through the service role / future per-role
--    policies. `integrations` is deliberately NOT publicly readable because it
--    may hold secrets.)
-- ----------------------------------------------------------------------------
alter table public.hazard_zones     enable row level security;
alter table public.incident_updates enable row level security;
alter table public.notifications    enable row level security;
alter table public.integrations     enable row level security;
alter table public.roles            enable row level security;
alter table public.app_settings     enable row level security;

drop policy if exists hazard_zones_public_read     on public.hazard_zones;
drop policy if exists incident_updates_public_read on public.incident_updates;
drop policy if exists notifications_public_read    on public.notifications;
drop policy if exists roles_public_read            on public.roles;
drop policy if exists app_settings_public_read     on public.app_settings;

create policy hazard_zones_public_read     on public.hazard_zones     for select to anon, authenticated using (true);
create policy incident_updates_public_read on public.incident_updates for select to anon, authenticated using (true);
create policy notifications_public_read    on public.notifications    for select to anon, authenticated using (true);
create policy roles_public_read            on public.roles            for select to anon, authenticated using (true);
create policy app_settings_public_read     on public.app_settings     for select to anon, authenticated using (true);
-- (No anon/authenticated policy on public.integrations — service role only.)

commit;
