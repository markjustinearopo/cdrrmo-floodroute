-- ============================================================================
-- CDRRMO FloodRoute — app wiring support
-- Migration: 20260613130000_app_wiring
--
-- Prepares the schema for the browser app to talk to Supabase directly:
--   1. Adds the few columns the front-end persists that the core schema lacked.
--   2. Adds login / resident-registration RPCs (so auth works without a Node
--      backend) that keep `password_plain` server-side.
--   3. Opens DEMO-GRADE write access: a permissive RLS policy granting the
--      anon + authenticated roles full CRUD on the app tables.
--
--      >>> SECURITY NOTE <<<
--      With the public anon key + these permissive policies, ANYONE can read
--      and write every listed table (including `integrations`, which may hold
--      API keys). This is fine for a thesis / demo build. For production, move
--      auth to Supabase Auth and replace these with per-role policies.
-- ============================================================================

begin;

-- 1) Columns the front-end uses ---------------------------------------------
alter table public.alerts
  add column if not exists status       text default 'active',  -- active | scheduled | resolved
  add column if not exists scheduled_for timestamptz,
  add column if not exists depth_m      numeric;

alter table public.incidents
  add column if not exists location text;  -- free-text spot within the barangay

alter table public.road_status
  add column if not exists name     text,  -- road display name on the report
  add column if not exists barangay text;

-- one live status row per road, so a new report supersedes the old one (upsert).
create unique index if not exists road_status_osm_way_id_key
  on public.road_status (osm_way_id);

-- 2) Auth RPCs (SECURITY DEFINER — password check stays server-side) ---------
create or replace function public.app_login(p_identifier text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_acc public.accounts;
begin
  -- Verify the bcrypt HASH, not password_plain. The accounts_hash_password
  -- trigger (see 20260623120000_auth_hashing_avatar.sql) nulls password_plain
  -- after hashing, so a `password_plain = p_password` check fails every login.
  -- Do NOT revert this.
  select * into v_acc
  from public.accounts
  where (lower(email) = lower(p_identifier) or lower(username) = lower(p_identifier))
    and password_hash is not null
    and password_hash = extensions.crypt(p_password, password_hash)
    and coalesce(status, 'active') <> 'suspended'
  limit 1;

  if not found then
    return null;
  end if;

  update public.accounts set last_login = now() where id = v_acc.id;

  return jsonb_build_object(
    'id', v_acc.id,
    'email', v_acc.email,
    'username', v_acc.username,
    'role', v_acc.role,
    'barangay', v_acc.barangay,
    'fullName', v_acc.full_name,
    'status', v_acc.status
  );
end;
$$;

create or replace function public.app_register_resident(
  p_email text, p_password text, p_full_name text, p_barangay text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id integer;
begin
  if exists (select 1 from public.accounts where lower(email) = lower(p_email)) then
    raise exception 'Email already registered';
  end if;

  insert into public.accounts (username, email, password_plain, role, barangay, full_name, status)
  values (p_email, p_email, p_password, 'resident', p_barangay, p_full_name, 'active')
  returning id into v_id;

  insert into public.residents (full_name, barangay)
  values (p_full_name, p_barangay);

  return jsonb_build_object(
    'id', v_id, 'email', p_email, 'role', 'resident',
    'barangay', p_barangay, 'fullName', p_full_name
  );
end;
$$;

revoke all on function public.app_login(text, text) from public;
revoke all on function public.app_register_resident(text, text, text, text) from public;
grant execute on function public.app_login(text, text) to anon, authenticated;
grant execute on function public.app_register_resident(text, text, text, text) to anon, authenticated;

-- 3) Demo-grade permissive write policies -----------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'alerts','incidents','incident_updates','evacuation_centers','accounts',
    'road_status','notifications','integrations','app_settings','residents',
    'saved_routes','roles','flood_readings','hazard_zones','barangays',
    'barangay_officials','roads'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_anon_all', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true)',
      t || '_anon_all', t
    );
  end loop;
end $$;

commit;
