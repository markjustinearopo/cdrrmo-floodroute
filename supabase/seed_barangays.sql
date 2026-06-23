-- ============================================================================
-- CDRRMO FloodRoute — barangay reference data (the 18 official barangays).
--
-- This is REFERENCE / LOOKUP data, not demo records: the `barangay` column on
-- accounts, residents, evacuation_centers, incidents, flood_readings and
-- barangay_officials is a FOREIGN KEY to barangays(name), so these 18 rows must
-- exist before any of those records (including resident sign-ups) can be saved.
--
-- `classification` is required (check: lakeshore | lowland | upland). The values
-- below are best-effort from Cabuyao geography — VERIFY against your own data.
-- center_lat/lng/population/etc. are left null for now; the front-end computes
-- map centroids from its bundled GeoJSON, so they are not required to operate.
-- Backfill them later if you want them in the database too.
-- ============================================================================

insert into public.barangays (name, classification) values
  ('Baclaran','lakeshore'),
  ('Banay-Banay','lowland'),
  ('Banlic','lakeshore'),
  ('Bigaa','lakeshore'),
  ('Butong','lakeshore'),
  ('Casile','upland'),
  ('Diezmo','lowland'),
  ('Gulod','lakeshore'),
  ('Mamatid','lakeshore'),
  ('Marinig','lakeshore'),
  ('Niugan','lakeshore'),
  ('Pittland','lowland'),
  ('Poblacion Dos','lowland'),
  ('Poblacion Tres','lowland'),
  ('Poblacion Uno','lowland'),
  ('Pulo','lowland'),
  ('Sala','lakeshore'),
  ('San Isidro','upland')
on conflict (name) do nothing;
