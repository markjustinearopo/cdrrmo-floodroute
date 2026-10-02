import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

const modulePath = process.env.PGLITE_MODULE || '@electric-sql/pglite'
const { PGlite } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath)
const pg = new PGlite()
try {
  await pg.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table public.incidents (id bigint generated always as identity, barangay text);
    create table public.evacuation_centers (id bigint generated always as identity, barangay text);
    create table public.alerts (id bigint generated always as identity primary key,
      title text not null, status text not null, barangays text[]);
    create table public.integrations (id text primary key, config jsonb);
    grant all on public.incidents, public.evacuation_centers, public.alerts, public.integrations to authenticated, service_role;
    grant usage, select on all sequences in schema public to authenticated, service_role;
    alter table public.incidents enable row level security;
    alter table public.evacuation_centers enable row level security;
    alter table public.alerts enable row level security;
    create policy incidents_read on public.incidents for select to authenticated using (true);
    create policy evacuation_centers_read on public.evacuation_centers for select to authenticated using (true);
    create policy alerts_read on public.alerts for select to authenticated using (true);
    insert into public.integrations values ('sms', '{"apiKey":"test-only","provider":"textbee"}');
  `)
  const migrations = [
    'supabase/migrations/20261002120000_defense_security_hardening.sql',
    'supabase/migrations/20261002130000_scheduled_alert_delivery.sql',
  ]
  for (const file of migrations) await pg.exec(readFileSync(file, 'utf8'))
  for (const file of migrations) await pg.exec(readFileSync(file, 'utf8'))
  console.log('PASS: both migrations execute and can be reapplied')

  async function asRole(role, sql, allowed) {
    await pg.exec('begin')
    try {
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ app_role: role, barangay: 'Marinig' })])
      await pg.exec('set local role authenticated')
      let failure
      try { await pg.exec(sql) } catch (error) { failure = error }
      if (allowed) assert.equal(failure, undefined, `${role} should be allowed: ${failure?.message}`)
      else assert(failure, `${role} must be denied`)
    } finally { await pg.exec('rollback') }
  }
  for (const table of ['incidents', 'evacuation_centers']) {
    await asRole('resident', `insert into ${table}(barangay) values ('Marinig')`, false)
    await asRole('barangay', `insert into ${table}(barangay) values ('Marinig')`, true)
    await asRole('barangay', `insert into ${table}(barangay) values ('Casile')`, false)
    await asRole('admin', `insert into ${table}(barangay) values ('Casile')`, true)
  }
  for (const role of ['resident', 'barangay', 'staff', 'admin']) {
    await asRole(role, "insert into alerts(title,status,barangays) values ('Immediate','active',array['Marinig'])", role !== 'resident')
    await asRole(role, "insert into alerts(title,status,barangays) values ('Scheduled','scheduled',array['Marinig'])", role === 'admin')
  }
  await asRole('barangay', "insert into alerts(title,status,barangays) values ('Multi','active',array['Marinig','Casile'])", false)
  const cleaned = await pg.query('select config from integrations')
  assert.deepEqual(cleaned.rows[0].config, { provider: 'textbee' })
  await asRole('admin', "insert into integrations values ('private', '{\"privateKey\":\"test-only\"}')", false)
  await asRole('resident', "insert into integrations values ('public', '{}')", false)
  console.log('PASS: resident writes denied, official scope enforced, scheduling restricted, secrets removed/rejected')

  await pg.exec("insert into alerts(title,status,barangays) values ('Warning','scheduled',array['Marinig'])")
  await pg.exec("update alerts set status='active' where title='Warning'")
  assert.equal((await pg.query('select * from alert_delivery_jobs')).rows.length, 2)
  await pg.exec("update alerts set status='active' where title='Warning'")
  assert.equal((await pg.query('select * from alert_delivery_jobs')).rows.length, 2)
  await pg.exec("insert into alerts(title,status) values ('[DRILL] Exercise','scheduled'); update alerts set status='active' where title like '[DRILL]%'")
  assert.equal((await pg.query('select * from alert_delivery_jobs')).rows.length, 2)
  await asRole('admin', 'select * from claim_scheduled_alert_deliveries()', false)
  await pg.exec('set role service_role')
  const claimed = await pg.query('select * from claim_scheduled_alert_deliveries()')
  assert.equal(claimed.rows.length, 1)
  assert.equal(claimed.rows[0].status, 'processing')
  await pg.exec('reset role')
  await pg.exec("update alert_delivery_jobs set started_at=now()-interval '10 minutes' where status='processing'")
  await pg.query('select * from claim_scheduled_alert_deliveries()')
  assert.equal((await pg.query("select * from alert_delivery_jobs where status='uncertain'")).rows.length, 1)
  assert.equal((await pg.query('select * from claim_scheduled_alert_deliveries()')).rows.length, 0)
  console.log('PASS: schedule-only queue, drill suppression, unique jobs, single claim and no automatic ambiguous resend')
} finally { await pg.close() }
