-- ============================================================================
-- saved_routes: fill in the spatial columns that nothing ever wrote to.
--
-- WHAT WAS WRONG
-- 20260613120000_postgis_spatial.sql gave this table origin_lat/lng,
-- dest_lat/lng, a `path` LineString, an `override_path` LineString, two
-- GENERATED geometry columns (origin_geom, dest_geom) and GiST indexes over
-- them. The application never wrote a single one of them: every coordinate
-- went into the `data` jsonb blob instead.
--
-- So the generated columns were always NULL, the GiST indexes indexed
-- nothing, and no spatial query this system exists to answer -- "which saved
-- routes cross this flooded segment", "which end at a shelter that is now
-- full" -- could be written against it. A PostGIS schema no query can use is
-- decoration.
--
-- src/services/db.js now populates these on every insert and update. This
-- migration backfills the rows saved before that, reading the coordinates
-- out of the jsonb they were already stored in.
--
-- AXIS ORDER: the app stores [lat, lng] (Leaflet's order); PostGIS wants
-- (x y) = (lng lat). Hence (p->>1) for x and (p->>0) for y below. Getting
-- this backwards does not error -- it files every Cabuyao route off the
-- coast of Somalia.
-- ============================================================================

-- A jsonb array of [lat,lng] pairs -> a 4326 LineString. NULL when there are
-- fewer than two usable points, which st_makeline cannot make a line from.
create or replace function public.jsonb_latlng_to_linestring(pts jsonb)
returns geometry(LineString, 4326)
language sql
immutable
as $$
  select case
    when count(*) >= 2
    then st_setsrid(st_makeline(array_agg(pt order by ord)), 4326)
  end
  from (
    select st_makepoint((p->>1)::double precision, (p->>0)::double precision) as pt,
           ord
    from jsonb_array_elements(pts) with ordinality as t(p, ord)
    where jsonb_typeof(p) = 'array'
      and jsonb_array_length(p) >= 2
      and (p->>0) is not null
      and (p->>1) is not null
  ) q;
$$;

comment on function public.jsonb_latlng_to_linestring(jsonb) is
  'Convert a jsonb array of [lat,lng] pairs (the app''s coordinate order) into a WGS84 LineString.';

update public.saved_routes r
set
  -- Prefer the road-following path's own endpoints over the A/B anchors: the
  -- anchors are where the operator clicked, which can sit a few metres off
  -- the road the route actually starts on.
  origin_lat = coalesce(
    (r.data->'path'->0->>0)::double precision,
    (r.data->'points'->0->>0)::double precision
  ),
  origin_lng = coalesce(
    (r.data->'path'->0->>1)::double precision,
    (r.data->'points'->0->>1)::double precision
  ),
  dest_lat = coalesce(
    (r.data->'path'->(-1)->>0)::double precision,
    (r.data->'points'->(-1)->>0)::double precision
  ),
  dest_lng = coalesce(
    (r.data->'path'->(-1)->>1)::double precision,
    (r.data->'points'->(-1)->>1)::double precision
  ),
  path = coalesce(
    public.jsonb_latlng_to_linestring(r.data->'path'),
    public.jsonb_latlng_to_linestring(r.data->'points')
  ),
  override_path = public.jsonb_latlng_to_linestring(r.data->'override')
where r.data is not null
  and (
    jsonb_typeof(r.data->'path') = 'array'
    or jsonb_typeof(r.data->'points') = 'array'
  )
  -- Only rows that have not been filled in already, so re-running is a no-op
  -- rather than a rewrite of every row.
  and (r.origin_lat is null or r.path is null);

-- Length along the ground, in metres. geography casts give real distances
-- rather than degrees, which is what the column is documented to hold.
update public.saved_routes
set distance_m = round(st_length(path::geography))::integer
where path is not null
  and distance_m is null;
