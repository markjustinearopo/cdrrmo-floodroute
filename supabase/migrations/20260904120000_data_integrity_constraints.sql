-- ============================================================================
-- Phase 6 — constraints. Stop impossible rows at the database.
--
-- Every rule below is currently enforced only by the UI, which means it is
-- not enforced at all: PostgREST is a public HTTP API, and Phase 2's RLS
-- decides WHO may write, never WHAT is a sane value. A barangay official with
-- a valid session can still PATCH an evacuation centre to 900 evacuees in a
-- 500-capacity school, and nothing objects.
--
-- Checked against live data before writing: all 30 evacuation centres
-- currently satisfy these, so nothing needs repairing first and no existing
-- row will be rejected.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Evacuation centre occupancy has to be physically possible.
--
--    Occupancy drives the shelter recommendation a resident is given
--    (src/data/shelters.js excludes anything at 95%+ and badges 85%+). A
--    negative or over-capacity number does not just look wrong on a
--    dashboard — it feeds the decision about where to send a family in a
--    flood. A centre recorded at 900/500 reads as "full" and gets excluded;
--    one at -50 reads as empty and gets recommended first.
-- ---------------------------------------------------------------------------
alter table public.evacuation_centers
  drop constraint if exists evac_capacity_non_negative;
alter table public.evacuation_centers
  add constraint evac_capacity_non_negative
  check (capacity is null or capacity >= 0);

alter table public.evacuation_centers
  drop constraint if exists evac_occupancy_non_negative;
alter table public.evacuation_centers
  add constraint evac_occupancy_non_negative
  check (occupancy is null or occupancy >= 0);

alter table public.evacuation_centers
  drop constraint if exists evac_occupancy_within_capacity;
alter table public.evacuation_centers
  add constraint evac_occupancy_within_capacity
  check (
    capacity is null
    or occupancy is null
    or occupancy <= capacity
  );


-- ---------------------------------------------------------------------------
-- 2) An alert must target at least one barangay.
--
--    `barangays` is a text[] that readers used to truncate to [0]; that is
--    fixed in the app now, and an alert with an EMPTY array would reach
--    nobody while still appearing issued on the operator's screen. That is
--    the worst failure mode a warning channel has: it looks like it worked.
--
--    NULL is still allowed — several existing rows use it, and the app reads
--    a null list as city-wide.
-- ---------------------------------------------------------------------------
alter table public.alerts
  drop constraint if exists alerts_barangays_not_empty;
alter table public.alerts
  add constraint alerts_barangays_not_empty
  check (barangays is null or array_length(barangays, 1) >= 1);


-- ---------------------------------------------------------------------------
-- 3) Flood report depth has to be a real measurement.
--
--    water_depth_ft is entered by residents on a phone. A negative depth is
--    meaningless, and an absurd one distorts the verified-report picture an
--    operator uses to flag roads. 100 ft is far above any credible flood in
--    Cabuyao while leaving genuine extremes room.
-- ---------------------------------------------------------------------------
alter table public.flood_reports
  drop constraint if exists flood_reports_depth_sane;
alter table public.flood_reports
  add constraint flood_reports_depth_sane
  check (water_depth_ft is null or (water_depth_ft >= 0 and water_depth_ft <= 100));

commit;

-- ---------------------------------------------------------------------------
-- VERIFY (each should be rejected):
--
--   update public.evacuation_centers set occupancy = capacity + 1 where id = 17;
--   update public.alerts set barangays = '{}' where id = 139;
--   update public.flood_reports set water_depth_ft = -3 where id = 75;
--
-- Then roll back / re-set them. All three should raise a check violation.
-- ---------------------------------------------------------------------------
