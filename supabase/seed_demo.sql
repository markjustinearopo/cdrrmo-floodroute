-- ============================================================
-- seed_demo.sql — Phase 1 demo/eval seed for CDRRMO FloodRoute.
--
-- Purpose: unblock the system. With empty tables nobody can log in
-- (accounts/roles = 0) and every dashboard renders blank. This seeds
-- the roles, login accounts (all 3 portals), and a realistic demo
-- dataset so the app is fully demonstrable.
--
-- Safe to re-run: every section is idempotent (ON CONFLICT or a
-- delete-by-marker before insert). Requires the 18 barangays to be
-- seeded already (seed_barangays.sql) — `barangay` is an FK on several
-- tables. Passwords are PLAINTEXT for now (app_login compares
-- password_plain directly); Phase 4 replaces this with hashing.
--
-- Demo logins:
--   Admin     →  ID: admin       PW: admin123
--   Operator  →  ID: operator    PW: operator123   (role = 'staff')
--   Brgy off. →  Barangay: Marinig  Staff ID: MAR-001  PW: brgy123
--   Brgy off. →  Barangay: Mamatid  Staff ID: MAM-001  PW: brgy123
--   Resident  →  Email: resident@demo.com  PW: resident123
--
-- NOTE: accounts.role is constrained by CHECK to ('admin','staff',
-- 'barangay','resident'). The "operator" account therefore uses role
-- 'staff' (admin-side portal); barangay officials use role 'barangay'.
-- ============================================================

begin;

-- ── Roles (PK = value; matches the accounts.role CHECK set) ──────────────────
insert into public.roles (value, label, description, is_system) values
  ('admin',    'CDRRMO Administrator', 'Full system access: monitoring, routing, alerts, users, config.', true),
  ('staff',    'CDRRMO Staff / EOC',   'Operations: alerts, incidents, road status, routing.',            true),
  ('barangay', 'Barangay Official',    'Single-barangay jurisdiction: local alerts, road passability.',   true),
  ('resident', 'Resident',             'Public read-only: flood map, routes, alerts.',                    true)
on conflict (value) do update
  set label = excluded.label, description = excluded.description, is_system = excluded.is_system;

-- ── Accounts (UNIQUE username/email; role limited by CHECK) ──────────────────
insert into public.accounts (username, email, password_plain, role, barangay, full_name, position, status) values
  ('admin',    'admin@cabuyao.gov.ph',             'admin123',    'admin',    null,      'CDRRMO Administrator',  'CDRRMO Head',        'active'),
  ('operator', 'eoc@cabuyao.gov.ph',               'operator123', 'staff',    null,      'EOC Duty Operator',     'Operations Officer', 'active'),
  ('MAR-001',  'marinig.official@cabuyao.gov.ph',  'brgy123',     'barangay', 'Marinig', 'Brgy. Marinig Official','Barangay Captain',   'active'),
  ('MAM-001',  'mamatid.official@cabuyao.gov.ph',  'brgy123',     'barangay', 'Mamatid', 'Brgy. Mamatid Official','Barangay Captain',   'active'),
  ('resident@demo.com', 'resident@demo.com',       'resident123', 'resident', 'Marinig', 'Juan Dela Cruz',        'Resident',           'active')
on conflict (username) do update
  set password_plain = excluded.password_plain, role = excluded.role,
      barangay = excluded.barangay, full_name = excluded.full_name,
      position = excluded.position, status = excluded.status;

-- ── Evacuation centres (marker: notes = 'SEED demo') ────────────────────────
delete from public.evacuation_centers where notes = 'SEED demo';
insert into public.evacuation_centers (name, barangay, facility_type, capacity, occupancy, status, manager, contact, lat, lng, notes) values
  ('Cabuyao Central School',     'Poblacion Uno', 'School',        800, 120, 'open',    'M. Santos',   '0917-100-2001', 14.280444, 121.124802, 'SEED demo'),
  ('Marinig Covered Court',      'Marinig',       'Covered Court', 500, 310, 'open',    'R. Bautista', '0917-100-2002', 14.271527, 121.149687, 'SEED demo'),
  ('Mamatid Elementary School',  'Mamatid',       'School',        650, 645, 'full',    'L. Cruz',     '0917-100-2003', 14.239543, 121.156229, 'SEED demo'),
  ('Banlic Barangay Hall',       'Banlic',        'Barangay Hall', 300,  40, 'open',    'A. Reyes',    '0917-100-2004', 14.232642, 121.141187, 'SEED demo');

-- ── Alerts (marker: issued_by = 'SEED') ─────────────────────────────────────
delete from public.alerts where issued_by = 'SEED';
insert into public.alerts (level, title, message, barangays, issued_by, issued_at, status, depth_m) values
  ('high',     'Severe Flood Warning',  'Water level has reached 1.8 m along the Marinig riverside. Evacuate low-lying areas immediately.', array['Marinig'],          'SEED', now() - interval '20 minutes', 'active', 1.8),
  ('high',     'Flash Flood Warning',   'Rapid water rise reported in Mamatid. Avoid creek-side roads and proceed to higher ground.',        array['Mamatid'],          'SEED', now() - interval '45 minutes', 'active', 1.5),
  ('moderate', 'Flood Advisory',        'Rising water along Banlic low points. Prepare to evacuate if conditions worsen.',                    array['Banlic'],           'SEED', now() - interval '1 hour',    'active', 0.8),
  ('moderate', 'Road Blockage Advisory','Bigaa national road partially impassable due to flooding. Use alternate routes.',                    array['Bigaa'],            'SEED', now() - interval '2 hours',   'active', 0.5),
  ('moderate', 'Weather Advisory',      'Intermittent moderate rain expected over Gulod through the evening. Monitor updates.',               array['Gulod'],            'SEED', now() - interval '3 hours',   'active', 0.2),
  ('high',     'Pre-emptive Evacuation','Lakeshore barangays advised to begin pre-emptive evacuation ahead of projected peak.',               array['Marinig','Mamatid'],'SEED', now() - interval '10 minutes', 'active', 1.6);

-- ── Incidents (+ first timeline entry) (marker: reported_by = 'SEED') ────────
delete from public.incident_updates where incident_id in (select id from public.incidents where reported_by = 'SEED');
delete from public.incidents where reported_by = 'SEED';
insert into public.incidents (incident_type, barangay, priority, status, location, assigned_team, description, lat, lng, reported_at, reported_by) values
  ('Flooding',          'Marinig', 'critical', 'in-progress', 'Riverside Street',   'Rescue Team A', 'Waist-deep flooding, several households requesting assistance.', 14.271527, 121.149687, now() - interval '35 minutes', 'SEED'),
  ('Stranded Residents','Mamatid', 'critical', 'new',         'Creekside Subd.',    null,            '6 residents stranded on a rooftop, rising water.',              14.239543, 121.156229, now() - interval '25 minutes', 'SEED'),
  ('Road Impassable',   'Banlic',  'high',     'in-progress', 'Banlic-Pulo Road',   'Road Clearing', 'Road flooded and impassable to light vehicles.',                14.232642, 121.141187, now() - interval '1 hour',    'SEED'),
  ('Fallen Tree',       'Bigaa',   'medium',   'resolved',    'National Highway',   'Road Clearing', 'Tree across one lane; cleared and reopened.',                    14.283456, 121.129728, now() - interval '4 hours',   'SEED'),
  ('Power Outage',      'Gulod',   'low',      'new',         'Gulod Proper',       null,            'Localized power outage reported by residents.',                 14.254194, 121.162676, now() - interval '2 hours',   'SEED'),
  ('Landslide Risk',    'Niugan',  'high',     'new',         'Hillside Path',      null,            'Soil saturation noted on slope; monitoring requested.',         14.267845, 121.139431, now() - interval '50 minutes', 'SEED');

-- First "Reported" timeline entry for every demo incident.
insert into public.incident_updates (incident_id, label, created_at)
  select id,
         case when assigned_team is not null then 'Reported · assigned to ' || assigned_team else 'Reported' end,
         reported_at
  from public.incidents where reported_by = 'SEED';
-- Progress entries for the non-new ones.
insert into public.incident_updates (incident_id, label, created_at)
  select id, 'Status → in progress', reported_at + interval '8 minutes'
  from public.incidents where reported_by = 'SEED' and status = 'in-progress';
insert into public.incident_updates (incident_id, label, created_at)
  select id, 'Status → resolved', reported_at + interval '40 minutes'
  from public.incidents where reported_by = 'SEED' and status = 'resolved';

-- ── Flood readings (demo table; refresh wholesale) ──────────────────────────
delete from public.flood_readings;
insert into public.flood_readings (barangay, recorded_at, rainfall_mmh, water_level_m, flood_depth_m, risk_level) values
  ('Marinig', now() - interval '15 minutes', 12.4, 1.85, 1.5, 'high'),
  ('Mamatid', now() - interval '15 minutes',  9.8, 1.60, 1.2, 'high'),
  ('Banlic',  now() - interval '15 minutes',  6.2, 0.95, 0.6, 'moderate'),
  ('Bigaa',   now() - interval '15 minutes',  4.1, 0.70, 0.4, 'moderate'),
  ('Gulod',   now() - interval '15 minutes',  2.0, 0.30, 0.1, 'low'),
  ('Baclaran',now() - interval '15 minutes',  8.5, 1.20, 0.9, 'moderate');

-- ── Notifications (broadcast; demo table — refresh wholesale) ────────────────
delete from public.notifications;
insert into public.notifications (level, title, message, read) values
  ('high',     'Severe flood warning issued',  'Marinig riverside has reached 1.8 m. Evacuation underway.', false),
  ('high',     'Flash flood warning',          'Rapid water rise in Mamatid creek-side roads.',            false),
  ('moderate', 'Road blockage advisory',       'Bigaa national road partially impassable.',                false),
  ('moderate', 'New incident reported',         'Road Impassable — Banlic (Banlic-Pulo Road).',            true);

-- ── Hazard zones (inundation polygons; marker: source = 'SEED') ─────────────
delete from public.hazard_zones where source = 'SEED';
insert into public.hazard_zones (category, risk_class, depth_m, return_period_yr, barangay, source, geom)
  select 'inundation', risk_class, depth_m, 25, barangay, 'SEED',
         st_multi(st_buffer(st_setsrid(st_makepoint(lng, lat), 4326)::geography, radius_m)::geometry)
  from (values
    ('Marinig', 'high',     1.5, 121.149687, 14.271527, 450.0),
    ('Mamatid', 'high',     1.2, 121.156229, 14.239543, 400.0),
    ('Banlic',  'moderate', 0.7, 121.141187, 14.232642, 350.0),
    ('Bigaa',   'moderate', 0.5, 121.129728, 14.283456, 300.0),
    ('Gulod',   'low',      0.3, 121.162676, 14.254194, 300.0)
  ) as z(barangay, risk_class, depth_m, lng, lat, radius_m);

commit;
