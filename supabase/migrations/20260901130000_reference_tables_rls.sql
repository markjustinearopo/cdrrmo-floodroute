-- ============================================================================
-- Phase 2, table group 2: barangays, hazard_zones, evacuation_centers.
--
-- WHY THESE, WHY TOGETHER
-- The plan's own ordering: reference tables next, because they're read-mostly
-- and carry no PII — barangay names/boundaries, hazard zone polygons, and
-- shelter locations/capacity are public safety information the landing page
-- itself displays before anyone signs in (the "18 Barangay / 29 Evacuation
-- center" counts on /login). So none of these get an anon SELECT lockdown
-- the way accounts did — that would break the one legitimate pre-login use.
--
-- WHAT ACTUALLY NEEDS FIXING (verified against src/services/db.js and every
-- importer, not assumed):
--
--   barangays, hazard_zones — the app never writes to either directly (no
--   .insert/.update/.delete call site exists anywhere in db.js). Currently
--   still open to any signed-in user via the blanket 20260613130000 policy
--   regardless. Locking writes to admin/staff removes a write surface with
--   zero legitimate current use, and any future admin tooling still works.
--
--   evacuation_centers — real write paths exist. Admin manages the full list
--   (src/pages/admin/Evacuation.jsx). Barangay officials ALSO create/update/
--   remove centres, but only ever for their OWN barangay — confirmed in
--   src/pages/barangay/Evacuation.jsx:85 (`barangay: myBrgy`, from the
--   official's own cached session) for both add and update. That scoping is
--   entirely CLIENT-SIDE today: evacDb.update(id, updates) filters only by
--   id, with no barangay check, and the current permissive RLS means a
--   direct PATCH with an arbitrary id — someone else's barangay's centre —
--   already succeeds. This makes that scoping real: a barangay official can
--   only write rows where evacuation_centers.barangay already equals their
--   own JWT barangay claim (USING), and cannot move a centre to a different
--   barangay (WITH CHECK enforces the new value too).
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ── barangays: read for everyone (incl. anon, pre-login counts), write admin only ──
drop policy if exists barangays_anon_all on public.barangays;

create policy barangays_read on public.barangays
  for select to anon, authenticated
  using (true);

create policy barangays_admin_write on public.barangays
  for all to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));


-- ── hazard_zones: same shape ─────────────────────────────────────────────
drop policy if exists hazard_zones_anon_all on public.hazard_zones;

create policy hazard_zones_read on public.hazard_zones
  for select to anon, authenticated
  using (true);

create policy hazard_zones_admin_write on public.hazard_zones
  for all to authenticated
  using ((auth.jwt() ->> 'app_role') in ('admin', 'staff'))
  with check ((auth.jwt() ->> 'app_role') in ('admin', 'staff'));


-- ── evacuation_centers: read for everyone; write admin (any) or barangay (own) ──
drop policy if exists evacuation_centers_anon_all on public.evacuation_centers;

create policy evacuation_centers_read on public.evacuation_centers
  for select to anon, authenticated
  using (true);

create policy evacuation_centers_insert on public.evacuation_centers
  for insert to authenticated
  with check (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangay = (auth.jwt() ->> 'barangay')
  );

create policy evacuation_centers_update on public.evacuation_centers
  for update to authenticated
  using (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangay = (auth.jwt() ->> 'barangay')
  )
  with check (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangay = (auth.jwt() ->> 'barangay')
  );

create policy evacuation_centers_delete on public.evacuation_centers
  for delete to authenticated
  using (
    (auth.jwt() ->> 'app_role') in ('admin', 'staff')
    or barangay = (auth.jwt() ->> 'barangay')
  );

commit;

-- ---------------------------------------------------------------------------
-- VERIFY: node scripts/check-rls.mjs barangays
--         node scripts/check-rls.mjs hazard_zones
--         node scripts/check-rls.mjs evacuation_centers
-- ---------------------------------------------------------------------------
