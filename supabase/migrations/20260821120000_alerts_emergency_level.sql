-- ============================================================
-- Allow the EMERGENCY alert level.
--
-- WHY THIS EXISTS: alerts.level carries a CHECK constraint that permits only
-- the three levels the system shipped with — high, moderate, safe. The new
-- top tier ('emergency') is the one that takes over every signed-in screen and
-- sounds a siren until acknowledged, and without widening the constraint the
-- insert is rejected by Postgres with
--
--   new row for relation "alerts" violates check constraint "alerts_level_check"
--
-- The app's optimistic write made the alert appear for a moment and then
-- vanish on the failed persist, which is the worst possible failure mode for a
-- warning channel: the operator believes the city was warned and it was not.
--
-- The constraint is kept (rather than dropped) on purpose. It is what stops a
-- typo or a future bug writing a level nothing in the UI knows how to render.
-- ============================================================

alter table public.alerts
  drop constraint if exists alerts_level_check;

alter table public.alerts
  add constraint alerts_level_check
  check (level in ('emergency', 'high', 'moderate', 'low', 'safe'));

-- 'low' is included because levelFromDepth grades barangays into
-- safe/low/moderate/high, and an alert raised off that grading could
-- legitimately carry it. It was previously missing, so such an alert would
-- have been rejected the same way.
