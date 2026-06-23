# CDRRMO FloodRoute — Supabase database

Project: **cdrrmo-floodroute** (`sreazvhevxijkespxxac`), org **CDRRMO**, region `ap-southeast-1`, Postgres 17.

## Current state (read from the live project)

A core schema already exists on the remote — applied as migration
`20260610162301_cdrrmo_core_schema`. It has **11 tables, all empty, RLS enabled**
with a public-read (`SELECT` to `anon` + `authenticated`) policy on each:

| Table | Purpose |
|---|---|
| `barangays` | The 18 barangays + PSGC, population, elevation, flood susceptibility |
| `barangay_officials` | Barangay captains / officials, terms |
| `accounts` | Login accounts (admin / operator / officer / viewer) |
| `residents` | Resident registry (vulnerability flags, evac assignment) |
| `roads` | Bundled OSM road network (by `osm_way_id`) |
| `road_status` | Per-road flood / blockage status |
| `evacuation_centers` | Shelters, capacity, occupancy |
| `incidents` | Reported incidents |
| `alerts` | Issued flood alerts |
| `flood_readings` | Per-barangay rainfall / water-level / depth readings |
| `saved_routes` | Saved evacuation / response routes |

**It does not use PostGIS.** Every coordinate is stored as plain `lat`/`lng`
`numeric` columns; there are no boundary polygons, no road-line geometry, and no
flood-hazard polygon table.

## What this migration adds — `migrations/20260613120000_postgis_spatial.sql`

Additive and **non-destructive** (no `DROP`, no column changes, no data inserted):

1. Enables the **PostGIS** extension.
2. Adds spatial geometry to existing tables, auto-derived from the existing
   lat/lng via `GENERATED ALWAYS AS ... STORED` (zero data entry):
   - `barangays.center_geom` (Point) + `barangays.boundary` (MultiPolygon, to import)
   - `evacuation_centers.geom`, `incidents.geom` (Point)
   - `roads.geom` (LineString, to import real OSM geometry)
   - `saved_routes.origin_geom`, `dest_geom` (Point), `path`, `override_path` (LineString)
3. Adds the spatial / supporting tables the app still needs:
   - **`hazard_zones`** — flood-inundation / susceptibility polygons (the core
     PostGIS use case; served as GeoJSON to the hazard layer)
   - `incident_updates` — per-incident activity timeline
   - `notifications` — command-center feed
   - `integrations` — external-service config (Open-Meteo, SMS, SMTP, tiles, …)
   - `roles` — role definitions + permission matrix
   - `app_settings` — System Configuration + Alert Settings bag
4. Adds GiST spatial indexes and RLS policies matching the existing convention.

Coordinate order in PostGIS is **(longitude, latitude)**; SRID **4326** = WGS84.

## How to apply

**Option A — Supabase CLI** (if you link the project locally):

```bash
supabase link --project-ref sreazvhevxijkespxxac
supabase db push
```

**Option B — Claude / MCP**: ask Claude to apply
`20260613120000_postgis_spatial`. It will run the same SQL on the live project.

**Option C — SQL editor**: paste the migration file into the Supabase dashboard
SQL editor and run it.

## Two things to decide / be aware of

- **`accounts.password_plain`** stores passwords in clear text. That is unsafe
  for anything beyond a throwaway prototype. Recommended: move auth to Supabase
  Auth (`auth.users`) with a `profiles` table, or at minimum store a bcrypt hash
  via `pgcrypto`. Say the word and I'll add that as a follow-up migration.
- **Writes are currently service-role only** (RLS has read policies but no
  insert/update/delete policies). That's fine if the app talks to the DB through
  a trusted backend. If the browser will write directly with the `anon` key,
  we need per-role write policies — tell me and I'll add them.

### Alternative: clean PostGIS-native rebuild

If you'd rather start fresh with geometry as the source of truth (instead of
deriving it from lat/lng), I can write a from-scratch schema that `DROP`s the
current empty tables and recreates them PostGIS-first. Only worthwhile because
the tables are still empty — your call.

---

## App wiring (the React app now talks to Supabase)

Migration `migrations/20260613130000_app_wiring.sql` + the front-end changes
below connect the browser app directly to this database (no Node backend).

### Where to SEE your data in Supabase
- Dashboard: <https://supabase.com/dashboard/project/sreazvhevxijkespxxac>
- **Table Editor** (left sidebar) → pick a table (`evacuation_centers`,
  `alerts`, `incidents`, `accounts`, `notifications`, `integrations`, …) to
  browse / edit rows in a spreadsheet view.
- **SQL Editor** → run queries, e.g. `select * from evacuation_centers;`
- **Database → Roles/Policies** → the RLS policies.
- **Authentication** is NOT used — this app keeps its own `accounts` table, so
  users appear there, not under Supabase Auth.

### What the migration added
- Columns the UI needs: `alerts.status / scheduled_for / depth_m`,
  `incidents.location`, `road_status.name / barangay` (+ unique `osm_way_id`).
- Auth RPCs `app_login()` and `app_register_resident()` (SECURITY DEFINER, so
  the password check stays server-side). Login accepts an email **or** username.
- **DEMO-GRADE write access**: a permissive RLS policy giving anon +
  authenticated full CRUD on the app tables. ⚠️ With the public key, anyone can
  read/write every table (incl. `integrations`, which may hold API keys). Fine
  for a thesis/demo; lock down with Supabase Auth + per-role policies for prod.

### Reference data seeded
`seed_barangays.sql` inserts the 18 official barangays. **Required** — the
`barangay` column on accounts/residents/evacuation_centers/incidents/
flood_readings/barangay_officials is a foreign key to `barangays(name)`, so
nothing (not even a resident sign-up) saves until these rows exist. The DB is
otherwise empty (0 operational rows).

### Front-end files changed
| File | Change |
|---|---|
| `.env` | Added `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` |
| `src/services/supabase.js` | **New** — the Supabase client |
| `src/services/db.js` | **New** — maps app objects ↔ DB rows; all CRUD + auth + reads |
| `src/context/AdminDataContext.jsx` | Reads/writes Supabase (optimistic); same hook API, so pages are untouched |
| `src/services/api.js` | `authApi` (login/register), resource wrappers → `db.js`, role redirect |
| `src/pages/Login.jsx` / `Register.jsx` | Call `authApi` instead of the dead `/auth/*` backend |

### Wired vs. still localStorage
- **Supabase:** alerts · incidents (+ `incident_updates` timeline) · evacuation
  centers · users (`accounts`) · notifications · integrations · auth.
- **Still localStorage (deferred):** road reports + painted road-status overlay,
  saved routes (routing pages), barangay assignments, alert settings, system
  config, roles. These are coupled to the routing map overlay and can be
  migrated next.

### Run it
```bash
npm install   # @supabase/supabase-js is already in package.json
npm run dev
```
Then add an evacuation centre under **/admin/evacuation** and watch the row
appear in the Supabase Table Editor.
