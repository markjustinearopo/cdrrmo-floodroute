import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

const modulePath = process.env.PGLITE_MODULE || '@electric-sql/pglite'
const { PGlite } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath)
const pg = new PGlite()

try {
  await pg.exec(`
    create role authenticated;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema public, auth to authenticated;
    create table rescue_requests (
      id integer primary key, account_id integer, barangay text, status text
    );
    create table rescue_request_updates (
      id integer primary key, request_id integer references rescue_requests(id), label text
    );
    grant select, update on rescue_requests to authenticated;
    grant select, insert on rescue_request_updates to authenticated;
    alter table rescue_requests enable row level security;
    alter table rescue_request_updates enable row level security;
    create policy rescue_requests_read on rescue_requests for select to authenticated using (true);
    create policy rescue_requests_update on rescue_requests for update to authenticated using (true);
    create policy rescue_request_updates_read on rescue_request_updates for select to authenticated using (true);
    create policy rescue_request_updates_write on rescue_request_updates for insert to authenticated with check (true);
    insert into rescue_requests values
      (1, 101, 'Marinig', 'pending'), (2, 102, 'Marinig', 'pending'),
      (3, 103, 'Casile', 'pending');
    insert into rescue_request_updates values (1, 1, 'Own'), (2, 2, 'Other'), (3, 3, 'Other barangay');
  `)
  const migration = readFileSync('supabase/migrations/20261003120000_rescue_scope_hardening.sql', 'utf8')
  await pg.exec(migration)
  await pg.exec(migration)

  async function asUser(claims, checks) {
    await pg.exec('begin')
    try {
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)])
      await pg.exec('set local role authenticated')
      await checks()
    } finally {
      await pg.exec('rollback')
    }
  }

  await asUser({ app_role: 'resident', account_id: 101, barangay: 'Marinig' }, async () => {
    assert.deepEqual((await pg.query('select id from rescue_requests order by id')).rows, [{ id: 1 }])
    assert.deepEqual((await pg.query('select id from rescue_request_updates order by id')).rows, [{ id: 1 }])
    assert.equal((await pg.query("update rescue_requests set status='responding' returning id")).rows.length, 0)
    await pg.exec("insert into rescue_request_updates values (4, 1, 'Own update')")
  })
  await asUser({ app_role: 'resident', account_id: 101, barangay: 'Marinig' }, async () => {
    await assert.rejects(pg.exec("insert into rescue_request_updates values (4, 2, 'Forbidden')"), /row-level security/)
  })
  await asUser({ app_role: 'barangay', account_id: 201, barangay: 'Marinig' }, async () => {
    assert.deepEqual((await pg.query('select id from rescue_requests order by id')).rows, [{ id: 1 }, { id: 2 }])
    assert.deepEqual((await pg.query('select id from rescue_request_updates order by id')).rows, [{ id: 1 }, { id: 2 }])
    assert.equal((await pg.query("update rescue_requests set status='responding' where id=2 returning id")).rows.length, 1)
    assert.equal((await pg.query("update rescue_requests set status='responding' where id=3 returning id")).rows.length, 0)
  })
  await asUser({ app_role: 'barangay', account_id: 201, barangay: 'Marinig' }, async () => {
    await assert.rejects(pg.exec("insert into rescue_request_updates values (4, 3, 'Forbidden')"), /row-level security/)
  })
  for (const role of ['admin', 'staff']) {
    await asUser({ app_role: role, account_id: 301 }, async () => {
      assert.equal((await pg.query('select id from rescue_requests')).rows.length, 3)
      assert.equal((await pg.query('select id from rescue_request_updates')).rows.length, 3)
      assert.equal((await pg.query("update rescue_requests set status='responding' returning id")).rows.length, 3)
    })
  }
  console.log('PASS: rescue privacy, response authority, timeline scope, and idempotent migration')
} finally {
  await pg.close()
}
