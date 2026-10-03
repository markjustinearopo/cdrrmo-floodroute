import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

const modulePath = process.env.PGLITE_MODULE || '@electric-sql/pglite'
const { PGlite } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath)
const pg = new PGlite()
try {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create table accounts (id integer primary key, username text, email text,
      role text, barangay text, full_name text, position text, phone text,
      status text, created_at text, last_login text, avatar text,
      must_change_password boolean, email_verified_at text, mfa_enabled boolean,
      password_plain text, password_hash text);
    create table alerts (id serial primary key, status text, scheduled_for timestamptz, issued_at timestamptz);
    create table notifications (id serial primary key, message text);
    alter table notifications enable row level security;
    create policy notifications_authenticated_all on notifications to authenticated using (true) with check (true);
    create function app_login(text, text) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function app_change_password(integer, text, text) returns boolean language sql as $$ select false $$;
    create function app_update_own_profile(text, text, text, text, text) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function integration_config_is_public(jsonb) returns boolean language sql as $$ select true $$;
    create function whoami() returns jsonb language sql as $$ select auth.jwt() $$;
    insert into accounts(id, username, password_hash) values (1, 'fixture', 'private hash');
    insert into notifications(message) values ('Private operational detail');
    grant select (password_hash) on accounts to anon, authenticated;
  `)
  const tables = ['app_settings', 'barangay_officials', 'barangays', 'evacuation_centers',
    'flood_readings', 'flood_report_logs', 'flood_reports', 'hazard_zones', 'incident_updates',
    'incidents', 'integrations', 'residents', 'road_status', 'roads', 'roles', 'saved_routes',
    'rescue_requests', 'rescue_request_updates', 'road_blocks', 'audit_log', 'alert_delivery_jobs',
    'auth_codes', 'sms_codes', 'sms_messages', 'sms_subscribers', 'trusted_devices']
  for (const table of tables) await pg.exec(`create table ${table} (id serial primary key)`)
  await pg.exec('grant all on all tables in schema public to anon, authenticated')
  const migration = readFileSync('supabase/migrations/20261003130000_restored_application_access.sql', 'utf8')
  await pg.exec(migration)
  await pg.exec(migration)

  async function asUser(role, appRole, checks) {
    await pg.exec('begin')
    try {
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role, app_role: appRole })])
      await pg.exec(`set local role ${role}`)
      await checks()
    } finally { await pg.exec('rollback') }
  }
  for (const role of ['anon', 'authenticated']) {
    await asUser(role, 'resident', async () => {
      await assert.rejects(pg.exec('select password_hash from accounts'), /permission denied/)
    })
    await asUser(role, 'resident', async () => {
      await assert.rejects(pg.exec('truncate alerts'), /permission denied/)
    })
    await asUser(role, 'resident', async () => {
      await assert.rejects(pg.exec('select * from auth_codes'), /permission denied/)
    })
    await asUser(role, 'resident', async () => {
      await assert.rejects(pg.exec("select app_login('fixture', 'password')"), /permission denied/)
    })
  }
  await asUser('authenticated', 'resident', async () => {
    assert.equal((await pg.query('select * from notifications')).rows.length, 0)
    assert.equal((await pg.query('select id, username from accounts')).rows.length, 1)
  })
  await asUser('authenticated', 'resident', async () => {
    await assert.rejects(pg.exec('select promote_due_alerts()'), /operator session/)
  })
  await asUser('authenticated', 'admin', async () => {
    assert.equal((await pg.query('select * from notifications')).rows.length, 1)
    assert.equal((await pg.query('select promote_due_alerts() as changed')).rows[0].changed, false)
  })
  console.log('PASS: restored grants, private columns, server-only RPCs, notifications, promotion authority, and idempotency')
} finally { await pg.close() }
