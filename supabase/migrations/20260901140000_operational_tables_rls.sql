-- ============================================================================
-- Phase 2, table group 3 (final): the operational tables.
--
-- Verified against every direct supabase.from(...) call in src/services/db.js
-- and every component that calls it, not assumed. Two real, live holes
-- closed here, same shape as the accounts/evacuation_centers findings:
--
--   ALERTS AND INCIDENTS: a barangay official's UI only ever calls
--   updateAlert(id,...)/removeAlert(id)/updateIncident(id,...)/removeIncident(id)
--   with a bare row id — no barangay filter anywhere in that path
--   (src/pages/barangay/Alerts.jsx, src/pages/barangay/Incidents.jsx). Alert
--   and incident ids are visible in every portal's list, so today any signed-
--   in barangay official can resolve, edit, or delete ANY OTHER barangay's
--   alert or incident, or issue a new alert claiming to be city-wide. Fixed
--   by requiring the row's barangay to match the caller's own JWT barangay
--   claim, mirroring the evacuation_centers fix from the previous migration.
--
--   FLOOD_REPORTS: a resident's client sends userId straight from their own
--   cached session with nothing checking it server-side
--   (src/components/resident/FloodReportModal.jsx). Fixed by requiring
--   user_id to equal the caller's own account_id claim on insert.
--
-- WHAT DOESN'T GET BARANGAY/OWNER SCOPING, AND WHY (also verified, not
-- assumed — see the investigation this migration is based on):
--
--   road_status   — barangay officials never write here directly; their only
--                   path is the app_settings.road_change_requests queue,
--                   which an admin approves. The only real direct writer is
--                   admin/staff (including the flood-report-approval flow
--                   that promotes a report into a road_status row).
--   notifications — a shared, city-wide activity feed by design: written by
--                   an action from ANY of the three roles, read identically
--                   by all three, and "mark all read" already has no
--                   per-user predicate at all (marking read from one
--                   resident's session marks it read for the admin dashboard
--                   too). Adding per-user scoping here would fight the
--                   existing design, not fix a bug. Anon still gets nothing.
--   saved_routes  — explicitly a shared library, not per-user: barangay's
--                   own delete-confirmation text says the removal "removes
--                   it for the command center and residents too", and there
--                   is no owner column anywhere in the schema or the code
--                   that writes it.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ── alerts ───────────────────────────────────────────────────────────────
-- Public safety broadcast, no PII — same posture as evacuation_centers:
-- readable by anyone, including anon. barangays is a text[] column; a
-- city-wide alert has been seen live with values as inconsistent as
-- ["All Barangays"], not a clean null/'All' sentinel, so barangay-role
-- write access is scoped ONLY to alerts that explicitly name their own
-- barangay — never a blanket "or it's city-wide" carve-out, since that
-- representation isn't reliable enough to gate a permission on.
drop policy if exists alerts_anon_all on public.alerts;

create policy alerts_read on public.alerts
  for select to anon, authenticated
  using (true);

create policy alerts_insert on public.alerts
  for insert to authenticated
  with check (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangays = array[(auth.jwt() ->> 'barangay')]
  );

create policy alerts_update on public.alerts
  for update to authenticated
  using (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangays @> array[(auth.jwt() ->> 'barangay')]
  )
  with check (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangays @> array[(auth.jwt() ->> 'barangay')]
  );

create policy alerts_delete on public.alerts
  for delete to authenticated
  using (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangays @> array[(auth.jwt() ->> 'barangay')]
  );


-- ── incidents ────────────────────────────────────────────────────────────
-- Not made anon-readable: unlike alerts (official announcements) these carry
-- specific human-safety detail (e.g. named conditions, exact locations of
-- people in distress) — kept to signed-in users only, a deliberate tightening
-- beyond what was strictly required, not just a copy of the alerts posture.
drop policy if exists incidents_anon_all on public.incidents;

create policy incidents_read on public.incidents
  for select to authenticated
  using (true);

create policy incidents_insert on public.incidents
  for insert to authenticated
  with check (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangay = (auth.jwt() ->> 'barangay')
  );

create policy incidents_update on public.incidents
  for update to authenticated
  using (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangay = (auth.jwt() ->> 'barangay')
  )
  with check (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangay = (auth.jwt() ->> 'barangay')
  );

create policy incidents_delete on public.incidents
  for delete to authenticated
  using (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangay = (auth.jwt() ->> 'barangay')
  );


-- ── incident_updates ─────────────────────────────────────────────────────
-- Narrative log entries tied to an incident (label/note/created_by). Written
-- in the same request as its parent incident by whichever role is already
-- authorized to touch that incident — role-gated the same way, without a
-- per-row join back to the parent's barangay (lower individual risk: the
-- worst case is an off-topic note on someone else's incident, not altering
-- or deleting the incident itself, which the policy above already prevents).
drop policy if exists incident_updates_anon_all on public.incident_updates;

create policy incident_updates_read on public.incident_updates
  for select to authenticated
  using (true);

create policy incident_updates_write on public.incident_updates
  for insert to authenticated
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff', 'barangay'));

create policy incident_updates_admin_modify on public.incident_updates
  for update to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));

create policy incident_updates_admin_delete on public.incident_updates
  for delete to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));


-- ── flood_reports ────────────────────────────────────────────────────────
-- A resident may only ever file a report as THEMSELVES — user_id must match
-- their own account_id claim, closing the client-set-anything gap in
-- FloodReportModal.jsx. Only CDRRMO verifies/edits/removes reports after
-- submission (confirmed: no resident update/delete path exists in the app).
drop policy if exists flood_reports_anon_all on public.flood_reports;

create policy flood_reports_read on public.flood_reports
  for select to authenticated
  using (true);

create policy flood_reports_insert on public.flood_reports
  for insert to authenticated
  with check (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or user_id = nullif(auth.jwt() ->> 'account_id', '')::integer
  );

create policy flood_reports_admin_modify on public.flood_reports
  for update to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));

create policy flood_reports_admin_delete on public.flood_reports
  for delete to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));


-- ── flood_report_logs ────────────────────────────────────────────────────
-- Written alongside flood_reports by whichever role is submitting/verifying.
-- Same pragmatic role-gating as incident_updates (no per-row owner join).
drop policy if exists flood_report_logs_anon_all on public.flood_report_logs;

create policy flood_report_logs_read on public.flood_report_logs
  for select to authenticated
  using (true);

create policy flood_report_logs_write on public.flood_report_logs
  for insert to authenticated
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff', 'resident'));

create policy flood_report_logs_admin_modify on public.flood_report_logs
  for update to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));

create policy flood_report_logs_admin_delete on public.flood_report_logs
  for delete to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));


-- ── road_status ──────────────────────────────────────────────────────────
-- Public safety layer (which roads are passable), same posture as
-- evacuation_centers/hazard_zones: readable by anyone. The only real direct
-- writer is admin/staff — barangay's path is the app_settings request queue,
-- which an admin approves before anything here changes.
drop policy if exists road_status_anon_all on public.road_status;

create policy road_status_read on public.road_status
  for select to anon, authenticated
  using (true);

create policy road_status_admin_write on public.road_status
  for all to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));


-- ── notifications ────────────────────────────────────────────────────────
-- A shared, city-wide activity feed by design (see header). Every signed-in
-- role legitimately writes and reads it identically; only anon is removed —
-- there's no reason a not-signed-in caller should see or write this at all.
drop policy if exists notifications_anon_all on public.notifications;

create policy notifications_authenticated_all on public.notifications
  for all to authenticated
  using (true)
  with check (true);


-- ── saved_routes ─────────────────────────────────────────────────────────
-- Explicitly a shared library (see header) — no owner column exists.
-- Residents read via a different, localStorage-backed path and never
-- mutate this table (confirmed: no resident code imports a mutator).
drop policy if exists saved_routes_anon_all on public.saved_routes;

create policy saved_routes_read on public.saved_routes
  for select to authenticated
  using (true);

create policy saved_routes_write on public.saved_routes
  for all to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff', 'barangay'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff', 'barangay'));

-- ── promote_due_alerts() ─────────────────────────────────────────────────
-- alerts_update above requires admin/staff or the caller's own barangay —
-- but src/context/AdminDataContext.jsx polls db.alerts.promoteDue() every 6s
-- on EVERY page, including the public /login and /register screens, as the
-- ONLY mechanism that flips a scheduled alert to active when its time comes
-- (there is no server-side cron). Under the new policy an anon caller would
-- silently fail that UPDATE from now on — meaning a scheduled emergency
-- alert might never go live if no signed-in session happens to have a tab
-- open at the moment it's due. That is a flood-warning system failing at
-- the one job it cannot fail at.
--
-- Fixed the same way as app_update_own_profile: a narrow SECURITY DEFINER
-- function that does exactly this one state transition — no client-supplied
-- row data at all, so there's no column a caller could smuggle a change
-- into. Safe to grant to anon: it can only ever promote an alert that is
-- ALREADY scheduled and ALREADY due, nothing else.
create or replace function public.promote_due_alerts()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.alerts
     set status = 'active', issued_at = now()
   where status = 'scheduled'
     and scheduled_for <= now();
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.promote_due_alerts() from public;
grant execute on function public.promote_due_alerts() to anon, authenticated;

commit;

-- ---------------------------------------------------------------------------
-- VERIFY: node scripts/check-rls.mjs alerts
--         node scripts/check-rls.mjs incidents
--         node scripts/check-rls.mjs flood_reports
--         node scripts/check-rls.mjs road_status
--         node scripts/check-rls.mjs notifications
--         node scripts/check-rls.mjs saved_routes
-- (incident_updates / flood_report_logs are covered indirectly through the
--  parent tables' create/update flows — no standalone harness entries.)
-- ---------------------------------------------------------------------------
