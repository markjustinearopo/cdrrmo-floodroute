begin;

create table if not exists public.alert_delivery_jobs (
  id bigint generated always as identity primary key,
  alert_id bigint not null references public.alerts(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  status text not null default 'ready' check (status in ('ready', 'processing', 'accepted', 'skipped', 'failed', 'uncertain')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  unique (alert_id, channel)
);
alter table public.alert_delivery_jobs enable row level security;
revoke all on public.alert_delivery_jobs from anon, authenticated;
grant select on public.alert_delivery_jobs to authenticated;
grant all on public.alert_delivery_jobs to service_role;
grant usage, select on sequence public.alert_delivery_jobs_id_seq to service_role;
drop policy if exists alert_delivery_jobs_operator_read on public.alert_delivery_jobs;
create policy alert_delivery_jobs_operator_read on public.alert_delivery_jobs for select to authenticated
  using ((auth.jwt()->>'app_role') in ('admin', 'staff'));

create or replace function public.queue_scheduled_alert_delivery()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'scheduled' and new.status = 'active' and new.title not like '[DRILL] %' then
    insert into public.alert_delivery_jobs(alert_id, channel)
      values (new.id, 'email'), (new.id, 'sms') on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function public.queue_scheduled_alert_delivery() from public, anon, authenticated;
drop trigger if exists alerts_queue_scheduled_delivery on public.alerts;
create trigger alerts_queue_scheduled_delivery after update of status on public.alerts
  for each row execute function public.queue_scheduled_alert_delivery();

create or replace function public.claim_scheduled_alert_deliveries()
returns setof public.alert_delivery_jobs language plpgsql security definer set search_path = public as $$
begin
  -- A crashed send can have reached the provider. Do not automatically replay it.
  update public.alert_delivery_jobs set status = 'uncertain', finished_at = now(),
    result = '{"error":"Worker interrupted; check provider records before resending."}'::jsonb
    where status = 'processing' and started_at < now() - interval '5 minutes';
  update public.alert_delivery_jobs j set status = 'skipped', finished_at = now(),
    result = '{"reason":"Alert no longer active"}'::jsonb
    from public.alerts a where j.alert_id = a.id and a.status <> 'active' and j.status = 'ready';
  return query
    with selected as (
      select id from public.alert_delivery_jobs where status = 'ready'
      order by id for update skip locked limit 1
    )
    update public.alert_delivery_jobs j set status = 'processing', started_at = now()
      from selected s where j.id = s.id returning j.*;
end $$;
revoke all on function public.claim_scheduled_alert_deliveries() from public, anon, authenticated;
grant execute on function public.claim_scheduled_alert_deliveries() to service_role;

commit;
