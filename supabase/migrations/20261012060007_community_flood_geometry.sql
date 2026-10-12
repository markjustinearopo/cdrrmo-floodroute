-- Additive support for reported extents and a public, approved-only map feed.
-- Anonymous visitors receive no reporter identity, photos, remarks or logs.
begin;
alter table public.flood_reports add column if not exists reported_geometry jsonb;
alter table public.flood_reports enable row level security;
alter table public.flood_reports drop constraint if exists flood_reports_geometry_shape;
alter table public.flood_reports add constraint flood_reports_geometry_shape check (
 reported_geometry is null or (
  jsonb_typeof(reported_geometry)='object'
  and reported_geometry->>'type' in ('Point','MultiPoint','Polygon')
  and jsonb_typeof(reported_geometry->'coordinates')='array'
  and octet_length(reported_geometry::text)<=12000
  and public.st_isvalid(public.st_geomfromgeojson(reported_geometry::text))
  and public.st_npoints(public.st_geomfromgeojson(reported_geometry::text))<=31
  and public.st_coveredby(public.st_geomfromgeojson(reported_geometry::text),public.st_makeenvelope(120,-90,180,90,4326))
 )
);
drop policy if exists flood_reports_community_read on public.flood_reports;
create policy flood_reports_community_read on public.flood_reports for select to anon using (verification_status='approved');
revoke all on public.flood_reports from anon;
grant select (id,barangay,lat,lng,flood_level,water_depth_ft,verification_status,reported_at,verified_at,reported_geometry) on public.flood_reports to anon;
create or replace view public.community_flood_reports with (security_invoker=true) as
 select id,barangay,lat,lng,flood_level,water_depth_ft,verification_status,reported_at,verified_at,reported_geometry
 from public.flood_reports where verification_status='approved';
revoke all on public.community_flood_reports from public,anon,authenticated;
grant select on public.community_flood_reports to anon,authenticated;
notify pgrst, 'reload schema';
commit;
