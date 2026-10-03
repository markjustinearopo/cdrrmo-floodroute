begin;

alter table public.accounts add column if not exists session_version integer not null default 0;

-- Definer lookup avoids recursive accounts RLS. Existing sessions use version zero.
create or replace function public.app_session_is_current()
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.accounts a
    where a.id::text = auth.jwt()->>'account_id'
      and a.status = 'active'
      and a.role = auth.jwt()->>'app_role'
      and a.barangay is not distinct from (auth.jwt()->>'barangay')
      and a.session_version::text = coalesce(auth.jwt()->>'session_version', '0')
  );
$$;
revoke all on function public.app_session_is_current() from public, anon;
grant execute on function public.app_session_is_current() to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['accounts','alerts','app_settings','audit_log','auth_codes',
    'barangay_officials','barangays','evacuation_centers','flood_readings','flood_report_logs',
    'flood_reports','hazard_zones','incident_updates','incidents','integrations','notifications',
    'residents','road_status','roads','roles','saved_routes','sms_codes','sms_messages',
    'sms_subscribers','trusted_devices','rescue_requests','rescue_request_updates',
    'road_blocks','alert_delivery_jobs']
  loop
    execute format('drop policy if exists current_account_required on public.%I', t);
    execute format('create policy current_account_required on public.%I as restrictive
      for all to authenticated using ((select public.app_session_is_current()))
      with check ((select public.app_session_is_current()))', t);
  end loop;
end $$;

create or replace function public.accounts_revoke_sessions()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.password_hash is distinct from old.password_hash
    or new.status is distinct from old.status or new.role is distinct from old.role
    or new.barangay is distinct from old.barangay or new.email is distinct from old.email
    or new.phone is distinct from old.phone or new.mfa_enabled is distinct from old.mfa_enabled then
    new.session_version := old.session_version + 1;
    delete from public.trusted_devices where account_id = old.id;
    update public.auth_codes set consumed_at = now()
      where account_id = old.id and consumed_at is null;
  else
    new.session_version := old.session_version;
  end if;
  return new;
end $$;
-- Activate this trigger only after the Edge Functions issue versioned sessions.
revoke all on function public.accounts_revoke_sessions() from public, anon, authenticated;

create or replace function public.audit_redact(p_data jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog, public as $$
declare result jsonb; k text; v jsonb;
begin
  if jsonb_typeof(p_data) = 'object' then
    result := '{}'::jsonb;
    for k, v in select * from jsonb_each(p_data) loop
      if lower(k) !~ '(password|secret|token|api.?key|code_hash|code_salt)' then
        result := result || jsonb_build_object(k, public.audit_redact(v));
      end if;
    end loop;
    return result;
  elsif jsonb_typeof(p_data) = 'array' then
    select coalesce(jsonb_agg(public.audit_redact(value)), '[]'::jsonb) into result
      from jsonb_array_elements(p_data);
    return result;
  end if;
  return p_data;
end $$;
revoke all on function public.audit_redact(jsonb) from public, anon, authenticated;

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare before_row jsonb; after_row jsonb;
begin
  if tg_op <> 'INSERT' then before_row := public.audit_redact(to_jsonb(old)); end if;
  if tg_op <> 'DELETE' then after_row := public.audit_redact(to_jsonb(new)); end if;
  insert into public.audit_log(actor_id, actor_role, action, table_name, row_id, before_data, after_data)
  values (nullif(auth.jwt()->>'account_id','')::integer, auth.jwt()->>'app_role', tg_op,
    tg_table_name, coalesce(after_row->>'id', before_row->>'id'), before_row, after_row);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
update public.audit_log set before_data = public.audit_redact(before_data),
  after_data = public.audit_redact(after_data)
where before_data is distinct from public.audit_redact(before_data)
   or after_data is distinct from public.audit_redact(after_data);

drop policy if exists flood_report_logs_write on public.flood_report_logs;
create policy flood_report_logs_write on public.flood_report_logs for insert to authenticated
with check (
  (auth.jwt()->>'app_role') in ('admin','staff') or
  ((auth.jwt()->>'app_role') = 'resident' and exists (
    select 1 from public.flood_reports r where r.id = report_id
      and r.user_id::text = auth.jwt()->>'account_id'))
);
drop policy if exists incident_updates_write on public.incident_updates;
create policy incident_updates_write on public.incident_updates for insert to authenticated
with check (
  (auth.jwt()->>'app_role') in ('admin','staff') or
  ((auth.jwt()->>'app_role') = 'barangay' and exists (
    select 1 from public.incidents i where i.id = incident_id
      and i.barangay = auth.jwt()->>'barangay'))
);
grant select on public.road_blocks to anon;

create or replace function public.app_change_password(p_id integer, p_current text, p_new text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare a public.accounts;
begin
  if not public.app_session_is_current() or p_id::text is distinct from (auth.jwt()->>'account_id') then
    raise exception 'An active self-account session is required.' using errcode = '42501';
  end if;
  if p_new is null or length(p_new) < 8 or octet_length(p_new) > 72 then
    raise exception 'Password must have at least 8 characters and at most 72 UTF-8 bytes.' using errcode = '22023';
  end if;
  select * into a from public.accounts where id = p_id for update;
  if p_current is null or a.password_hash is null
    or a.password_hash <> extensions.crypt(p_current, a.password_hash) then return false; end if;
  update public.accounts set password_plain = p_new, must_change_password = false where id = p_id;
  return true;
end $$;

create or replace function public.app_update_own_profile(p_full_name text, p_email text,
  p_phone text, p_position text, p_avatar text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare a public.accounts;
begin
  if not public.app_session_is_current() then
    raise exception 'An active account session is required.' using errcode = '42501';
  end if;
  select * into a from public.accounts where id::text = auth.jwt()->>'account_id' for update;
  if lower(trim(coalesce(p_email,''))) <> lower(trim(coalesce(a.email,'')))
    or regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g') <>
       regexp_replace(coalesce(a.phone,''), '[^0-9+]', '', 'g') then
    raise exception 'Contact your administrator to verify a change of email or recovery phone.' using errcode = '22023';
  end if;
  if nullif(trim(p_full_name),'') is null then
    raise exception 'Your name is required.' using errcode = '22023';
  end if;
  update public.accounts set full_name = trim(p_full_name), position = p_position, avatar = p_avatar
    where id = a.id returning * into a;
  return jsonb_build_object('id',a.id,'fullName',a.full_name,'email',a.email,
    'phone',a.phone,'position',a.position,'avatar',a.avatar);
end $$;

create or replace function public.promote_due_alerts()
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare changed integer;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' and
    (not public.app_session_is_current() or coalesce(auth.jwt()->>'app_role','') not in ('admin','staff')) then
    raise exception 'An active operator session is required.' using errcode = '42501';
  end if;
  update public.alerts set status = 'active', issued_at = now()
    where status = 'scheduled' and scheduled_for <= now();
  get diagnostics changed = row_count;
  return changed > 0;
end $$;

-- Atomic, persistent password budgets. Alias logins share an account bucket.
create table if not exists public.auth_login_limits (
  bucket text primary key, window_start timestamptz not null, attempts integer not null
);
create index if not exists auth_login_limits_window_idx on public.auth_login_limits(window_start);
alter table public.auth_login_limits enable row level security;
revoke all on public.auth_login_limits from public, anon, authenticated;
grant all on public.auth_login_limits to service_role;

create or replace function public.app_login(p_identifier text, p_password text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare a public.accounts; budget public.auth_login_limits; bucket_key text;
begin
  if p_identifier is null or length(p_identifier) > 320 or p_password is null
    or octet_length(p_password) > 72 then return null; end if;
  select * into a from public.accounts
    where lower(email) = lower(trim(p_identifier)) or lower(username) = lower(trim(p_identifier)) limit 1;
  bucket_key := case when a.id is not null then 'account:' || a.id::text
    else 'unknown:' || encode(extensions.digest(lower(trim(p_identifier)), 'sha256'), 'hex') end;
  insert into public.auth_login_limits as l values (bucket_key, now(), 1)
    on conflict (bucket) do update set
      window_start = case when l.window_start <= now()-interval '15 minutes' then now() else l.window_start end,
      attempts = case when l.window_start <= now()-interval '15 minutes' then 1 else l.attempts+1 end
    returning * into budget;
  if budget.attempts > 10 then
    raise exception 'Too many sign-in attempts. Try again in 15 minutes.' using errcode = 'PT429';
  end if;
  delete from public.auth_login_limits where window_start < now()-interval '1 day';
  if a.id is null or a.status not in ('active','pending') or a.password_hash is null
    or a.password_hash <> extensions.crypt(p_password, a.password_hash) then return null; end if;
  delete from public.auth_login_limits where bucket = bucket_key;
  if a.email_verified_at is null or a.status = 'pending' then
    return jsonb_build_object('unverified',true,'email',a.email,'fullName',a.full_name);
  end if;
  update public.accounts set last_login = now() where id = a.id;
  return jsonb_build_object('id',a.id,'email',a.email,'username',a.username,'role',a.role,
    'barangay',a.barangay,'fullName',a.full_name,'avatar',a.avatar,'status',a.status,
    'mfaEnabled',coalesce(a.mfa_enabled,false));
end $$;
revoke all on function public.app_login(text,text) from public, anon, authenticated;
grant execute on function public.app_login(text,text) to service_role;

create or replace function public.app_recovery_account(p_identifier text)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('id',id,'email',email,'full_name',full_name,'phone',phone,'status',status)
  from public.accounts where status='active' and email_verified_at is not null
    and (lower(email)=lower(trim(p_identifier)) or lower(username)=lower(trim(p_identifier))) limit 1;
$$;
revoke all on function public.app_recovery_account(text) from public, anon, authenticated;
grant execute on function public.app_recovery_account(text) to service_role;

-- One locked row covers both failed guesses and successful one-time consumption.
alter table public.auth_codes drop constraint if exists auth_codes_purpose_check;
alter table public.auth_codes add constraint auth_codes_purpose_check
  check (purpose in ('verify_email','login_mfa','reset_password'));
create or replace function public.app_consume_auth_code(p_email text, p_purpose text, p_code text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare c public.auth_codes;
begin
  select * into c from public.auth_codes where email = lower(p_email) and purpose = p_purpose
    and consumed_at is null order by created_at desc, id desc limit 1 for update;
  if not found or c.expires_at <= now() or c.attempts >= 5 then
    return jsonb_build_object('ok',false,'error','No valid code. Request a new one.');
  end if;
  if p_code is null or c.code_hash <> encode(extensions.digest(c.code_salt || trim(p_code),'sha256'),'hex') then
    update public.auth_codes set attempts = attempts+1,
      consumed_at = case when attempts+1 >= 5 then now() else null end where id = c.id;
    return jsonb_build_object('ok',false,'error','Incorrect code. Request a new code after five attempts.');
  end if;
  update public.auth_codes set consumed_at = now() where id = c.id;
  return jsonb_build_object('ok',true,'accountId',c.account_id,'channel',c.channel);
end $$;
revoke all on function public.app_consume_auth_code(text,text,text) from public, anon, authenticated;
grant execute on function public.app_consume_auth_code(text,text,text) to service_role;

-- Fail closed until a real verification provider is available.
update public.app_settings set value = value || '{"verificationFallback":false}'::jsonb where key = 'system_config';

commit;
