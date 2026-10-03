begin;

-- A restore must not reintroduce ALL privileges (especially TRUNCATE, which bypasses RLS).
do $$
declare item record; columns text;
begin
  for item in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and pg_get_userbyid(c.relowner) = current_user
  loop
    execute format('revoke all on table public.%I from public, anon, authenticated', item.relname);
  end loop;
  select string_agg(quote_ident(attname), ', ') into columns from pg_attribute
    where attrelid = 'public.accounts'::regclass and attnum > 0 and not attisdropped;
  execute format('revoke select (%1$s), insert (%1$s), update (%1$s), references (%1$s)
    on public.accounts from public, anon, authenticated', columns);
  for item in
    select p.oid::regprocedure as signature from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and pg_get_userbyid(p.proowner) = current_user
  loop
    execute format('revoke all on function %s from public, anon, authenticated', item.signature);
    execute format('grant execute on function %s to service_role', item.signature);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select on public.alerts, public.barangays, public.evacuation_centers,
  public.flood_readings, public.hazard_zones, public.road_status, public.app_settings to anon;

grant select, insert, update, delete on public.alerts, public.app_settings,
  public.barangay_officials, public.barangays, public.evacuation_centers,
  public.flood_readings, public.flood_report_logs, public.flood_reports,
  public.hazard_zones, public.incident_updates, public.incidents,
  public.integrations, public.notifications, public.residents, public.road_status,
  public.roads, public.roles, public.saved_routes, public.rescue_requests,
  public.rescue_request_updates, public.road_blocks to authenticated;
grant select on public.audit_log, public.alert_delivery_jobs to authenticated;

-- Never grant browser SELECT on password columns, even to administrators.
grant select (id, username, email, role, barangay, full_name, position, phone,
  status, created_at, last_login, avatar, must_change_password,
  email_verified_at, mfa_enabled) on public.accounts to authenticated;
grant insert (username, email, password_plain, role, barangay, full_name,
  position, phone, status, avatar, must_change_password, email_verified_at,
  mfa_enabled) on public.accounts to authenticated;
grant update (username, email, password_plain, role, barangay, full_name,
  position, phone, status, avatar, must_change_password, email_verified_at,
  mfa_enabled) on public.accounts to authenticated;
grant delete on public.accounts to authenticated;

do $$
declare item record;
begin
  for item in
    select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and pg_get_userbyid(c.relowner) = current_user
  loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated', item.relname);
    if exists (
      select 1 from pg_depend d join pg_class t on t.oid = d.refobjid
      where d.objid = item.oid and d.deptype in ('a', 'i')
        and t.relname not in ('auth_codes', 'sms_codes', 'sms_messages',
          'sms_subscribers', 'trusted_devices', 'audit_log', 'alert_delivery_jobs')
    ) then
      execute format('grant usage, select on sequence public.%I to authenticated', item.relname);
    end if;
  end loop;
end $$;

grant execute on function public.app_change_password(integer, text, text),
  public.app_update_own_profile(text, text, text, text, text),
  public.integration_config_is_public(jsonb), public.whoami() to authenticated;
-- app_login, app_register_resident and delivery RPCs stay server-only.

-- Operational notifications can include failed-verification details.
drop policy if exists notifications_authenticated_all on public.notifications;
drop policy if exists notifications_operator on public.notifications;
create policy notifications_operator on public.notifications to authenticated
  using ((auth.jwt()->>'app_role') in ('admin', 'staff'))
  with check ((auth.jwt()->>'app_role') in ('admin', 'staff'));

create or replace function public.promote_due_alerts()
returns boolean language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role'
    and coalesce(auth.jwt()->>'app_role', '') not in ('admin', 'staff') then
    raise exception 'An operator session is required.' using errcode = '42501';
  end if;
  update public.alerts set status = 'active', issued_at = now()
    where status = 'scheduled' and scheduled_for <= now();
  get diagnostics changed = row_count;
  return changed > 0;
end $$;
revoke all on function public.promote_due_alerts() from public, anon;
grant execute on function public.promote_due_alerts() to authenticated, service_role;

commit;
