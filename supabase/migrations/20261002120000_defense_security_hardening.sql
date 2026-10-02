begin;

-- Residents carry a barangay claim too. A geographic match alone is not authority.
do $$
declare t text;
begin
  foreach t in array array['evacuation_centers', 'incidents'] loop
    execute format('drop policy if exists %I on public.%I', t || '_anon_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (
      (auth.jwt()->>''app_role'') in (''admin'', ''staff'') or
      ((auth.jwt()->>''app_role'') = ''barangay'' and barangay = auth.jwt()->>''barangay''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (
      (auth.jwt()->>''app_role'') in (''admin'', ''staff'') or
      ((auth.jwt()->>''app_role'') = ''barangay'' and barangay = auth.jwt()->>''barangay'')) with check (
      (auth.jwt()->>''app_role'') in (''admin'', ''staff'') or
      ((auth.jwt()->>''app_role'') = ''barangay'' and barangay = auth.jwt()->>''barangay''))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (
      (auth.jwt()->>''app_role'') in (''admin'', ''staff'') or
      ((auth.jwt()->>''app_role'') = ''barangay'' and barangay = auth.jwt()->>''barangay''))', t || '_delete', t);
  end loop;
end $$;

alter table public.integrations enable row level security;
-- Only CDRRMO administrators can schedule outbound delivery. Officials may
-- issue immediate warnings for exactly their own barangay, never city-wide.
drop policy if exists alerts_anon_all on public.alerts;
drop policy if exists alerts_insert on public.alerts;
drop policy if exists alerts_update on public.alerts;
drop policy if exists alerts_delete on public.alerts;
create policy alerts_insert on public.alerts for insert to authenticated with check (
  ((auth.jwt()->>'app_role') in ('admin', 'staff') and (status <> 'scheduled' or auth.jwt()->>'app_role' = 'admin'))
  or ((auth.jwt()->>'app_role') = 'barangay' and status <> 'scheduled' and barangays = array[auth.jwt()->>'barangay'])
);
create policy alerts_update on public.alerts for update to authenticated using (
  (auth.jwt()->>'app_role') in ('admin', 'staff')
  or ((auth.jwt()->>'app_role') = 'barangay' and status <> 'scheduled' and barangays = array[auth.jwt()->>'barangay'])
) with check (
  ((auth.jwt()->>'app_role') in ('admin', 'staff') and (status <> 'scheduled' or auth.jwt()->>'app_role' = 'admin'))
  or ((auth.jwt()->>'app_role') = 'barangay' and status <> 'scheduled' and barangays = array[auth.jwt()->>'barangay'])
);
create policy alerts_delete on public.alerts for delete to authenticated using (
  (auth.jwt()->>'app_role') in ('admin', 'staff')
  or ((auth.jwt()->>'app_role') = 'barangay' and status <> 'scheduled' and barangays = array[auth.jwt()->>'barangay'])
);
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'integrations' loop
    execute format('drop policy %I on public.integrations', p.policyname);
  end loop;
end $$;
revoke all on public.integrations from anon;
grant select, insert, update, delete on public.integrations to authenticated;
create policy integrations_operator on public.integrations for all to authenticated
  using ((auth.jwt()->>'app_role') in ('admin', 'staff'))
  with check ((auth.jwt()->>'app_role') in ('admin', 'staff'));

-- Strip legacy secrets without printing them. Any formerly exposed key must
-- still be rotated by its owner; deleting a value cannot undo disclosure.
update public.integrations i set config = coalesce((
  select jsonb_object_agg(key, value) from jsonb_each(
    case when jsonb_typeof(i.config) = 'object' then i.config else '{}'::jsonb end
  ) where key in ('endpoint', 'provider', 'senderName', 'fromEmail', 'publicKey')
    and jsonb_typeof(value) = 'string'
), '{}'::jsonb);

create or replace function public.integration_config_is_public(value jsonb)
returns boolean language sql immutable set search_path = public as $$
  select case when jsonb_typeof(value) is distinct from 'object' then false else
    not exists (select 1 from jsonb_each(value) item
      where item.key not in ('endpoint', 'provider', 'senderName', 'fromEmail', 'publicKey')
        or jsonb_typeof(item.value) <> 'string') end;
$$;
alter table public.integrations drop constraint if exists integrations_public_config;
alter table public.integrations add constraint integrations_public_config
  check (public.integration_config_is_public(config));

commit;
