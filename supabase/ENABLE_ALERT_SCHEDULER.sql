-- Apply the migrations and deploy alert-scheduler first. Store the project URL
-- and service-role key in Vault as floodroute_project_url and
-- floodroute_scheduler_service_key. Never paste secrets into tracked files.
-- Supabase-supported scheduling pattern:
-- https://supabase.com/docs/guides/functions/schedule-functions
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'floodroute_project_url')
    or not exists (select 1 from vault.decrypted_secrets where name = 'floodroute_scheduler_service_key') then
    raise exception 'Scheduler Vault entries are missing; create them before activation.';
  end if;
end $$;

select cron.schedule('floodroute-alert-delivery', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'floodroute_project_url') || '/functions/v1/alert-scheduler',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'floodroute_scheduler_service_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
