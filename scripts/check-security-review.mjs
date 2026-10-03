import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const modulePath = process.env.PGLITE_MODULE || '@electric-sql/pglite'
const { PGlite } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath)
const cryptoPath = isAbsolute(modulePath) ? pathToFileURL(join(dirname(modulePath), 'contrib/pgcrypto.js')).href : '@electric-sql/pglite/contrib/pgcrypto'
const { pgcrypto } = await import(cryptoPath)
const pg = new PGlite({ extensions: { pgcrypto } })
const tables = ['accounts','alerts','app_settings','audit_log','auth_codes',
  'barangay_officials','barangays','evacuation_centers','flood_readings','flood_report_logs',
  'flood_reports','hazard_zones','incident_updates','incidents','integrations','notifications',
  'residents','road_status','roads','roles','saved_routes','sms_codes','sms_messages',
  'sms_subscribers','trusted_devices','rescue_requests','rescue_request_updates','road_blocks','alert_delivery_jobs']
try {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table accounts(id integer primary key, username text, email text, full_name text,
      role text, status text, barangay text, password_hash text, password_plain text,
      must_change_password boolean, phone text, mfa_enabled boolean, email_verified_at timestamptz,
      position text, avatar text, last_login timestamptz);
    create table alerts(id integer primary key, status text, issued_at timestamptz, scheduled_for timestamptz);
    create table app_settings(key text primary key, value jsonb);
    create table audit_log(id serial primary key, actor_id integer, actor_role text, action text,
      table_name text, row_id text, before_data jsonb, after_data jsonb);
    create table auth_codes(id serial primary key, account_id integer, email text, purpose text,
      code_hash text, code_salt text, expires_at timestamptz, attempts smallint default 0,
      consumed_at timestamptz, created_at timestamptz default now(), channel text);
    create table trusted_devices(id integer primary key, account_id integer);
    create table flood_reports(id integer primary key, user_id integer);
    create table flood_report_logs(id serial primary key, report_id integer);
    create table incidents(id integer primary key, barangay text);
    create table incident_updates(id serial primary key, incident_id integer);
    create function accounts_hash_password() returns trigger language plpgsql as $$
      begin if new.password_plain is not null then
        new.password_hash := extensions.crypt(new.password_plain, extensions.gen_salt('bf'));
        new.password_plain := null; end if; return new; end $$;
    create trigger trg_accounts_hash_password before insert or update on accounts
      for each row execute function accounts_hash_password();
    insert into accounts(id,username,email,full_name,role,status,barangay,password_plain,email_verified_at,mfa_enabled)
      values (1,'admin','admin@example.test','Admin','admin','active',null,'initial-password',now(),false),
      (2,'official','official@example.test','Official','barangay','active','A','initial-password',now(),false),
      (3,'resident','resident@example.test','Resident','resident','active','A','initial-password',now(),false),
      (4,'other','other@example.test','Other','resident','active','B','initial-password',now(),false);
    insert into flood_reports values (10,3),(11,4);
    insert into incidents values (10,'A'),(11,'B');
    insert into app_settings values ('system_config','{"verificationFallback":true}');
    insert into audit_log(action,table_name,before_data,after_data) values
      ('UPDATE','accounts','{"password_hash":"old","full_name":"Keep"}',
      '{"password_plain":"test","nested":{"apiKey":"test","status":"keep"}}');
  `)
  for (const t of tables) {
    await pg.exec(`create table if not exists ${t}(id integer primary key);
      alter table ${t} enable row level security;
      grant select, insert, update, delete on ${t} to authenticated;
      create policy fixture_read on ${t} for select to authenticated using (true);`)
    if (!['incident_updates','flood_report_logs'].includes(t)) {
      await pg.exec(`create policy fixture_write on ${t} for all to authenticated using (true) with check (true)`)
    }
  }
  await pg.exec('grant usage on all sequences in schema public to authenticated; create policy public_roads on road_blocks for select to anon using(true); insert into road_blocks values(1)')
  const migration = readFileSync('supabase/migrations/20261004120000_security_review_fixes.sql','utf8')
  const activation = readFileSync('supabase/migrations/20261004130000_session_revocation_activation.sql','utf8')
  await pg.exec(migration)
  await pg.exec(activation)
  await pg.exec(migration)
  await pg.exec(activation)
  await pg.exec('create trigger audit_accounts after update on accounts for each row execute function audit_row()')
  const claims = (id, role, barangay = null, version = 0) => ({role:'authenticated',account_id:id,app_role:role,barangay,session_version:version})
  async function asUser(c, work, role = 'authenticated') {
    await pg.exec('begin')
    try {
      await pg.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(c)])
      await pg.exec(`set local role ${role}`)
      await work()
    } finally { await pg.exec('rollback') }
  }
  await asUser(claims(1,'admin'),async()=>assert.equal((await pg.query('select * from accounts')).rows.length,4))
  for (const c of [claims(999,'admin'),claims(2,'admin','A'),claims(2,'barangay','B'),claims(1,'admin',null,5)]) {
    await asUser(c,async()=>assert.equal((await pg.query('select * from accounts')).rows.length,0))
    await asUser(c,async()=>assert.rejects(pg.exec('select promote_due_alerts()'),/active operator/))
  }
  for (const change of ["status='suspended'","role='resident'","barangay='B'","mfa_enabled=true"]) {
    await pg.exec('begin')
    await pg.exec(`update accounts set ${change} where id=2`)
    await pg.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims(2,'barangay','A'))])
    assert.equal((await pg.query('select app_session_is_current() as ok')).rows[0].ok,false)
    await pg.exec('rollback')
  }
  for (const [c, sql, allowed] of [
    [claims(3,'resident','A'),'insert into flood_report_logs(report_id) values(10)',true],
    [claims(3,'resident','A'),'insert into flood_report_logs(report_id) values(11)',false],
    [claims(2,'barangay','A'),'insert into incident_updates(incident_id) values(10)',true],
    [claims(2,'barangay','A'),'insert into incident_updates(incident_id) values(11)',false],
    [claims(1,'admin'),'insert into incident_updates(incident_id) values(11)',true],
  ]) await asUser(c,async()=>allowed ? await pg.exec(sql) : await assert.rejects(pg.exec(sql),/row-level security/))
  await asUser({},async()=>assert.equal((await pg.query('select * from road_blocks')).rows.length,1),'anon')
  await asUser({},async()=>assert.rejects(pg.exec('insert into road_blocks values(2)'),/permission denied/),'anon')
  await asUser(claims(3,'resident','A'),async()=>assert.rejects(pg.exec("select app_change_password(4,'initial-password','replacement-password')"),/self-account/))
  await asUser(claims(3,'resident','A'),async()=>assert.rejects(pg.exec("select app_change_password(3,'initial-password','short')"),/at least 8/))
  await asUser(claims(3,'resident','A'),async()=>assert.rejects(pg.exec("select app_update_own_profile('Resident','changed@example.test',null,null,null)"),/administrator/))
  await asUser(claims(3,'resident','A'),async()=>{
    assert.equal((await pg.query("select app_change_password(3,'incorrect','replacement-password') as ok")).rows[0].ok,false)
    assert.equal((await pg.query("select app_change_password(3,'initial-password','replacement-password') as ok")).rows[0].ok,true)
    assert.equal((await pg.query('select app_session_is_current() as ok')).rows[0].ok,false)
  })
  const audit = (await pg.query('select before_data,after_data from audit_log order by id limit 1')).rows[0]
  assert.deepEqual(audit.before_data,{full_name:'Keep'})
  assert.deepEqual(audit.after_data,{nested:{status:'keep'}})
  await pg.exec("update accounts set full_name='Updated' where id=1")
  assert.equal((await pg.query("select count(*)::int as n from audit_log where before_data ? 'password_hash' or after_data ? 'password_hash'")).rows[0].n,0)
  for(let i=0;i<10;i++) await pg.query('select app_login($1,$2)',[i%2?'admin':'admin@example.test','bad'])
  await assert.rejects(pg.query('select app_login($1,$2)',['admin','initial-password']),/Too many/)
  await pg.exec("update auth_login_limits set window_start=now()-interval '16 minutes'")
  assert.equal((await pg.query("select app_login('admin','initial-password') as result")).rows[0].result.id,1)
  await asUser({},async()=>assert.rejects(pg.exec("select app_login('admin','initial-password')"),/permission denied/),'anon')
  await asUser(claims(1,'admin'),async()=>assert.rejects(pg.exec("select app_consume_auth_code('x','login_mfa','123456')"),/permission denied/))
  const addCode = async () => pg.exec(`insert into auth_codes(account_id,email,purpose,code_hash,code_salt,expires_at,channel)
    values(1,'admin@example.test','login_mfa',encode(extensions.digest('salt123456','sha256'),'hex'),'salt',now()+interval '10 minutes','email')`)
  const consume = async code => (await pg.query("select app_consume_auth_code('admin@example.test','login_mfa',$1) as result",[code])).rows[0].result
  await addCode()
  assert.equal((await consume('123456')).ok,true)
  assert.equal((await consume('123456')).ok,false)
  await addCode()
  for(let i=0;i<5;i++) assert.equal((await consume('wrong')).ok,false)
  assert.equal((await consume('123456')).ok,false)
  await addCode()
  const race = await Promise.all([consume('123456'),consume('123456')])
  assert.equal(race.filter(x=>x.ok).length,1)
  console.log('PASS: idempotency, current-account RLS, scope, password validation/revocation, audit redaction, road reads, alias throttling, OTP attempts/replay, private RPCs')
} finally { await pg.close() }
