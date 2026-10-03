import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createHmac } from 'node:crypto'
import { buildGraph, profileFor } from '../src/components/admin/routeEngine.js'
import { findSafeRoute } from '../src/components/admin/routeSafety.js'
import { SAFETY_COLLECTIONS, safetyDataReady, retryDelay, collectionNamesForRole } from '../src/services/dataHealth.js'
import { publicIntegrationConfig } from '../src/services/integrationConfig.js'
import { verifySessionToken, authorizeOperator } from '../supabase/functions/_shared/operatorAuth.ts'
import { alertScopes } from '../supabase/functions/_shared/alertScope.ts'
import { deliveryOutcome } from '../supabase/functions/_shared/scheduledDelivery.ts'

test('multiple barangays remain scoped and invalid filter characters are rejected', () => {
  assert.deepEqual(alertScopes('Casile', ['Casile', 'Niugan', 'Casile']), ['Casile', 'Niugan'])
  assert.deepEqual(alertScopes('All Barangays'), [])
  assert.throws(() => alertScopes('Casile),role.eq.admin'))
})
test('delivery acceptance is distinct from simulation, failures and empty audiences', () => {
  assert.equal(deliveryOutcome({ sent: 2 }, true), 'accepted')
  assert.equal(deliveryOutcome({ queued: 2 }, true), 'accepted')
  assert.equal(deliveryOutcome({ sent: 2, simulated: true }, true), 'failed')
  assert.equal(deliveryOutcome({ sent: 2, failed: 1 }, true), 'failed')
  assert.equal(deliveryOutcome({ sent: 0 }, true), 'skipped')
  assert.equal(deliveryOutcome({ sent: 2 }, false), 'failed')
})

const way = (id, coords) => ({ type: 'Feature', properties: { id, name: `Road ${id}`, named: true, highway: 'residential' }, geometry: { type: 'LineString', coordinates: coords } })
const straight = way(1, [[121, 14], [121.001, 14], [121.002, 14]])
const start = [14, 121]
const destinations = [{ name: 'Shelter', coords: [14, 121.002] }]
function plan(features, extra = {}) {
  const graph = buildGraph({ type: 'FeatureCollection', features })
  const opts = typeof extra === 'function' ? extra(graph) : extra
  return findSafeRoute(graph, start, destinations, { riskAt: () => 0, ...profileFor('evacuation'), ...opts })
}

test('partial flooding excludes every marked segment', () => {
  const result = plan([straight], (g) => ({ floodedEdges: new Set(g.adj.flat()) }))
  assert.equal(result.verdict, 'no-safe-route')
  assert.equal(result.evidence.roads[0].status, 'flooded')
})
test('a dry detour is used around a partially flooded segment', () => {
  const detour = way(2, [[121, 14], [121, 14.001], [121.002, 14.001], [121.002, 14]])
  const result = plan([straight, detour], (g) => ({ floodedEdges: new Set(g.adj.flat().filter((e) => e.wayId === 1)) }))
  assert.equal(result.verdict, 'safe')
  assert(result.plan.safe.segments.every((s) => s.wayId === 2))
})
test('whole-road closures and flooding remain excluded', () => {
  for (const status of ['blocked', 'flooded']) assert.equal(plan([straight], { statusMap: { 1: status } }).verdict, 'no-safe-route')
})
test('model hazard away from the middle vertex is excluded', () => {
  assert.equal(plan([straight], { riskAt: (_lat, lng) => lng < 121.0008 ? 1 : 0 }).verdict, 'no-safe-route')
})
test('operator reopening does not cancel a partial closure', () => {
  assert.equal(plan([straight], (g) => ({ statusMap: { 1: 'open' }, floodedEdges: new Set(g.adj.flat()) })).verdict, 'no-safe-route')
})
test('unavailable data does not become a safe verdict or a rescue diagnosis', () => {
  assert.equal(plan([straight], { dataReady: false }).verdict, 'unavailable')
})
test('healthy empty feeds differ from failed, missing, and stale feeds', () => {
  const now = Date.now()
  const health = Object.fromEntries(SAFETY_COLLECTIONS.map((key) => [key, { status: 'ready', lastSuccess: now }]))
  assert(safetyDataReady(health, now))
  assert(!safetyDataReady({}, now))
  assert(!safetyDataReady(health, now + 180001))
  assert(!safetyDataReady({ ...health, roadBlocks: { status: 'error', lastSuccess: now } }, now))
})
test('non-operators never load integrations and retries are bounded', () => {
  assert(!collectionNamesForRole('resident', ['integrations']).includes('integrations'))
  assert(!collectionNamesForRole(null, ['integrations']).includes('integrations'))
  assert.equal(retryDelay(1), 30000)
  assert.equal(retryDelay(20), 300000)
})
test('secret-bearing integration metadata is rejected and legacy secrets stripped', () => {
  assert.throws(() => publicIntegrationConfig({ privateKey: 'secret' }, true))
  assert.throws(() => publicIntegrationConfig({ apiKey: 'secret' }, true))
  assert.deepEqual(publicIntegrationConfig({ provider: 'textbee', privateKey: 'secret' }), { provider: 'textbee' })
  assert.deepEqual(publicIntegrationConfig({}, true), {})
})

test('worker caches only anonymous public tables and upgrades old caches', () => {
  const code = readFileSync('public/sw.js', 'utf8')
  const context = vm.createContext({ self: { addEventListener() {} }, atob, Request, URL })
  vm.runInContext(code, context)
  const token = (role) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`
  context.url = new URL('https://test.supabase.co/rest/v1/alerts?select=*')
  context.request = new Request(context.url, { headers: { authorization: `Bearer ${token('authenticated')}` } })
  assert.equal(vm.runInContext('isPublicDataRead(url, request)', context), false)
  context.request = new Request(context.url, { headers: { authorization: `Bearer ${token('anon')}` } })
  assert.equal(vm.runInContext('isPublicDataRead(url, request)', context), true)
  context.url = new URL('https://test.supabase.co/rest/v1/accounts?select=*')
  assert.equal(vm.runInContext('isPublicDataRead(url, request)', context), false)
  assert.match(code, /const VERSION = 'v2'/)
})

const secret = 'test-only-signing-secret'
function signed(claims, key = secret) {
  const input = `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`
  return `${input}.${createHmac('sha256', key).update(input).digest('base64url')}`
}
const claims = { role: 'authenticated', aud: 'authenticated', account_id: 7, app_role: 'admin', exp: Math.floor(Date.now() / 1000) + 300 }
test('operator identity requires a valid, unexpired signature', async () => {
  assert.equal((await verifySessionToken(signed(claims), secret)).account_id, 7)
  assert.equal(await verifySessionToken(signed(claims, 'wrong'), secret), null)
  assert.equal(await verifySessionToken(signed({ ...claims, exp: 1 }), secret), null)
  assert.equal(await verifySessionToken('local-7', secret), null)
  assert.equal(await verifySessionToken(signed({ ...claims, role: 'anon' }), secret), null)
})
test('current account status and role override JWT or body claims', async () => {
  globalThis.Deno = { env: { get: (key) => key === 'SESSION_JWT_SECRET' ? secret : '' } }
  const req = new Request('https://example.test', { headers: { authorization: `Bearer ${signed(claims)}` } })
  const db = (data) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data }) }) }) }) })
  assert.equal(await authorizeOperator(req, db({ role: 'resident', status: 'active' }), ['admin']), null)
  assert.equal(await authorizeOperator(req, db({ role: 'admin', status: 'disabled' }), ['admin']), null)
  assert.equal((await authorizeOperator(req, db({ role: 'admin', status: 'active' }), ['admin'])).role, 'admin')
  assert.equal(await authorizeOperator(req, db({ role: 'admin', status: 'active', session_version: 1 }), ['admin']), null)
  assert.equal(await authorizeOperator(req, db({ role: 'admin', status: 'active', barangay: 'Casile' }), ['admin']), null)
})
