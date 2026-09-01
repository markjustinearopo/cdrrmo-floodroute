-- ============================================================================
-- Phase 2, final sweep: the six tables left after 20260901140000, plus the
-- untracked policies that were masking everything.
--
-- WHY THESE WERE LEFT UNTIL LAST
-- They were deliberately not touched in the earlier Phase 2 migrations because
-- they had not been traced yet, and dropping policies blind is how a working
-- page breaks silently. They have now been traced the same way as the other
-- ten: every supabase.from(...) call in src/services/db.js, and every
-- component that calls it.
--
-- THE WORST FINDING IN ALL OF PHASE 2 IS HERE.
--
--   `residents` is a VULNERABLE-PERSONS REGISTRY. 103 real rows carrying
--   full_name, address, phone, birthdate, household_size — and is_senior,
--   is_pwd, is_pregnant. Until this migration it was readable AND writable by
--   anyone holding the public anon key, which ships in the deployed browser
--   bundle. That is a list of exactly which houses in Cabuyao contain someone
--   elderly, disabled, or pregnant, published to the internet.
--
--   The app never reads or writes this table through PostgREST at all — there
--   is no supabase.from('residents') anywhere in src/. The only writer is
--   app_register_resident, which is SECURITY DEFINER and bypasses RLS. So
--   locking it to admin/staff costs the application exactly nothing.
--
-- The same "never touched from the browser" finding holds for
-- barangay_officials, roads and roles. flood_readings is read-only via
-- refDb.floodReadings. app_settings is the only one of the six with real,
-- varied write paths, and it gets a key-aware policy below.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) Drop the remaining untracked *_public_read policies.
--
--    Fifteen of these were found live on 2026-09-01. They exist in no
--    migration file in this repo — they were applied straight to production at
--    some point, outside version control. Nine were dropped alongside the
--    earlier Phase 2 migrations; these are the last six.
--
--    They matter because Postgres OR's policies together: one permissive
--    `using (true)` makes every restrictive policy on that table cosmetic.
--    This is why the harness kept reporting anon SELECT as ALLOWED on tables
--    that already had a correct restrictive policy written for them.
-- ---------------------------------------------------------------------------
drop policy if exists app_settings_public_read       on public.app_settings;
drop policy if exists barangay_officials_public_read on public.barangay_officials;
drop policy if exists flood_readings_public_read     on public.flood_readings;
drop policy if exists residents_public_read          on public.residents;
drop policy if exists roads_public_read              on public.roads;
drop policy if exists roles_public_read              on public.roles;

-- And the blanket demo policies from 20260613130000, where still present.
drop policy if exists residents_anon_all          on public.residents;
drop policy if exists barangay_officials_anon_all on public.barangay_officials;
drop policy if exists roads_anon_all              on public.roads;
drop policy if exists roles_anon_all              on public.roles;
drop policy if exists flood_readings_anon_all     on public.flood_readings;
drop policy if exists app_settings_anon_all       on public.app_settings;


-- ---------------------------------------------------------------------------
-- 1) residents — the vulnerable-persons registry. CDRRMO only.
--
--    Not even `authenticated` broadly: a resident has no business reading the
--    roster of who in their barangay is a PWD or pregnant. Registration still
--    works because app_register_resident is SECURITY DEFINER.
-- ---------------------------------------------------------------------------
alter table public.residents enable row level security;

create policy residents_admin_only on public.residents
  for all to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));


-- ---------------------------------------------------------------------------
-- 2) barangay_officials — directory of who holds which post.
--
--    Less sensitive than residents (a Punong Barangay's name, office address
--    and barangay hotline are public-facing by nature), but it also carries
--    personal email and birthdate, so it stops being world-readable. Signed-in
--    users may read it; only CDRRMO may change it.
-- ---------------------------------------------------------------------------
alter table public.barangay_officials enable row level security;

create policy barangay_officials_read on public.barangay_officials
  for select to authenticated
  using (true);

create policy barangay_officials_admin_write on public.barangay_officials
  for all to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));


-- ---------------------------------------------------------------------------
-- 3) roads / roles — reference data, never touched from the browser.
--
--    The routing network the app actually uses is bundled JSON
--    (src/data/cabuyaoRoads.json), not this table; `roles` is a lookup the UI
--    reads from its own constants. Neither is read via PostgREST anywhere in
--    src/, so both are closed to anon and left readable to signed-in users in
--    case future admin tooling wants them.
-- ---------------------------------------------------------------------------
alter table public.roads enable row level security;
alter table public.roles enable row level security;

create policy roads_read on public.roads
  for select to authenticated using (true);
create policy roads_admin_write on public.roads
  for all to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));

create policy roles_read on public.roles
  for select to authenticated using (true);
create policy roles_admin_write on public.roles
  for all to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));


-- ---------------------------------------------------------------------------
-- 4) flood_readings — sensor/gauge measurements.
--
--    Public safety data with no personal information, same posture as
--    hazard_zones and road_status: anyone may read, only CDRRMO may write.
-- ---------------------------------------------------------------------------
alter table public.flood_readings enable row level security;

create policy flood_readings_read on public.flood_readings
  for select to anon, authenticated
  using (true);

create policy flood_readings_admin_write on public.flood_readings
  for all to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));


-- ---------------------------------------------------------------------------
-- 5) app_settings — a key/value grab bag, so the policy is key-aware.
--
--    Live keys and who legitimately touches them:
--      system_config         — admin writes; must be READABLE BEFORE LOGIN,
--                              because it drives the maintenance banner and
--                              the registration lock on /login and /register.
--      alert_settings        — admin only (templates, auto-alert thresholds).
--      flood_areas           — admin only (the managed flood-prone areas).
--      road_traffic          — admin only (the congestion paint board).
--      road_change_requests  — barangay officials SUBMIT, admin approves.
--      user_prefs:<id>       — one row per account, that account's own prefs.
--
--    user_prefs is the reason this is key-aware rather than a flat
--    admin-vs-everyone rule: user_prefs:182 is testadmin's, and no other
--    signed-in user should be reading or overwriting it.
--
--    KNOWN LIMITATION, deliberately not fixed here: road_change_requests is a
--    single JSON array that the submitting client rewrites whole, so two
--    barangays submitting at the same moment can clobber each other. Fixing
--    that means splitting it into a real per-request table — a schema change
--    with live data in it, which is not something to do in the same migration
--    as a security lockdown. Tracked as follow-up work.
-- ---------------------------------------------------------------------------
alter table public.app_settings enable row level security;

-- Pre-login readers need exactly one key.
create policy app_settings_public_config on public.app_settings
  for select to anon, authenticated
  using (key = 'system_config');

create policy app_settings_read on public.app_settings
  for select to authenticated
  using (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or key not like 'user_prefs:%'
    or key = 'user_prefs:' || coalesce(auth.jwt() ->> 'account_id', '')
  );

create policy app_settings_insert on public.app_settings
  for insert to authenticated
  with check (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or key = 'user_prefs:' || coalesce(auth.jwt() ->> 'account_id', '')
    or (key = 'road_change_requests' and (auth.jwt() ->> 'app_role') = 'barangay')
  );

create policy app_settings_update on public.app_settings
  for update to authenticated
  using (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or key = 'user_prefs:' || coalesce(auth.jwt() ->> 'account_id', '')
    or (key = 'road_change_requests' and (auth.jwt() ->> 'app_role') = 'barangay')
  )
  with check (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or key = 'user_prefs:' || coalesce(auth.jwt() ->> 'account_id', '')
    or (key = 'road_change_requests' and (auth.jwt() ->> 'app_role') = 'barangay')
  );

create policy app_settings_delete on public.app_settings
  for delete to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));

commit;

-- ---------------------------------------------------------------------------
-- VERIFY: node scripts/check-rls.mjs residents
--         node scripts/check-rls.mjs barangay_officials
--         node scripts/check-rls.mjs app_settings
--         node scripts/check-rls.mjs flood_readings
--
-- Then confirm nothing regressed anywhere:
--         node scripts/check-rls.mjs
-- ---------------------------------------------------------------------------
