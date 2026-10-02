# FloodRoute Remediation Handoff

Date: 2026-10-02. Preserves the existing portals, layouts, and features.

## Completed in Source

- Strict resident routing excludes partial flooded segments as well as whole-road closures, with modeled checks at actual graph segments. Live reroutes use the same refusal rules.
- Current safety feeds must be successfully loaded and fresh before resident guidance can run. Failed feeds are not an all-clear. Known active official warnings still outrank the model.
- Rescue requests and new alerts wait for a database acknowledgement and real ID before reporting success. Failed rescue submissions can retry without double-tap duplication. A failed history write cannot undo an accepted request.
- Polling is role-scoped, visibility-aware, reduced from six to sixty seconds, and backs off failed collections. Realtime synchronization remains. This reduces traffic; it does not reset Supabase usage or prove the cause of the overrun.
- Logout clears private local mirrors. The worker no longer caches authenticated database reads and purges old caches during its v2 upgrade.
- Integration forms accept public metadata only. Legacy secrets are stripped on reads, and a migration removes them and rejects future secret fields. Configured providers are distinguished from verified delivery; test email targets the operator's own address, not all residents.
- Alert sender functions require signed sessions and current active operator roles. Barangay email is limited to the official's own scope. MFA delivery failure does not grant a login session.
- RLS migration requires an official role as well as geographic scope for incident, shelter, and alert writes. Barangay users cannot alter city-wide or multi-barangay alerts. Only CDRRMO administrators can schedule outbound warnings.
- Scheduled-to-active transitions enqueue unique email/SMS jobs. The worker claims one job at a time; interrupted or ambiguous sends require inspection instead of automatic duplicate resends. Simulation is not treated as delivery.
- CI runs focused safety tests, Edge Function parsing including shared helpers, and the production build.

## Verification

- `npm test`: 14 focused safety/authentication/cache/scope/result tests pass.
- `npm run check:functions`: all four functions and three shared helpers parse; ten phone formats agree.
- `npm run build`: passes; existing large-bundle warnings remain.
- Isolated browser workflow tests: pending/rejected/accepted rescue and alert writes, duplicate taps, retries, real IDs, responder status, and HTTP 402 health states pass. All backend mutations are mocked.
- Responsive portal checks cover small phones, tablets, desktop, expanded sections, and dialogs. Healthy and unavailable states were checked; these are layout tests, not proof of production integration or a blanket guarantee that no overlap can ever occur.
- Both SQL migrations execute and can be reapplied in an isolated PGlite/PostgreSQL database. Permission tests deny resident writes, constrain official scope, and restrict scheduling. Queue tests cover unique jobs, drills, role restrictions, claims, and ambiguous resends. This does not validate the live schema or live policies.

SQL test reproduction (temporary dependency stays ignored):

```powershell
npm install --prefix tmp/pg-validation @electric-sql/pglite --no-save --package-lock=false
$env:PGLITE_MODULE="$PWD/tmp/pg-validation/node_modules/@electric-sql/pglite/dist/index.js"
node scripts/check-migrations.mjs
```

## Remaining Owner Actions

1. **Restore Supabase service.** Live read-only probes returned HTTP 402 with `exceed_egress_quota`. Billing/spend-cap decisions require the owner. A successful Vercel deploy cannot restore database access.
2. **Authorize backend deployment.** No Supabase access token, direct database connection, or confirmed management session is configured. The new SQL/functions are prepared, not applied to production. Check existing policies and pending migrations against a backup/staging project before applying them; permissive policies not named in this repository can still widen access.
3. **Rotate potentially exposed provider secrets.** Removing fields cannot undo earlier exposure. Only the provider/account owner can validate and rotate them, including any key previously stored in `integrations.config`.
4. **Validate actual delivery and response.** Approved email/SMS recipients, gateway handset/network/load, provider logs, rescue receipt and responder acceptance must be tested end to end. Queue/provider acceptance is not proof that a message reached a person. No real notification was sent during these checks.
5. **Validate operational assumptions.** Local flood observations, passability decisions, road coverage, shelter capacity/location verification, denied GPS, low-end phones, and first-time-user trials need field evidence and official input. Depth is a heuristic estimate; the exclusion threshold is not a certified safe walking-depth rule.
6. **Align defense claims and measurements.** The existing routing evaluation and thesis are not revised here. Measure end-to-end field-to-screen latency separately from algorithm time and test the actual resident strict-routing wrapper. Do not claim field-validated predictive accuracy, guaranteed safe passage, or confirmed rescue dispatch without evidence.

## Backend Activation Order

1. Restore backend availability and arrange approved deployment access. Back up and check the live schema, installed migration history, session JWT signing configuration, and existing policies.
2. Apply `20261002120000_defense_security_hardening.sql`, then `20261002130000_scheduled_alert_delivery.sql` using an authorized migration workflow. Resolve any older missing tables/constraints based on the actual database, not HTTP 402 responses.
3. Run the checks, then deploy `auth-otp`, `sms-alert`, `send-alert-email`, and `alert-scheduler` together. No `supabase/config.toml` is present here; confirm the deployed gateway settings. Keep gateway JWT verification enabled where the existing legacy-signed session tokens are supported, and retain the sender functions' own signature/active-role checks. Provider credentials remain server-side. Verify authenticated roles after deployment.
4. Review all existing scheduled records and recipient/channel settings before activation. Create Vault entries `floodroute_project_url` and `floodroute_scheduler_service_key` in the dashboard; never put the service key in tracked SQL or browser code.
5. Run `supabase/ENABLE_ALERT_SCHEDULER.sql`. It uses the [documented Supabase scheduling pattern](https://supabase.com/docs/guides/functions/schedule-functions). Check cron responses and the worker heartbeat. Review failed/uncertain jobs before any manual resend.
6. With approved test recipients and browsers closed, schedule a controlled alert, confirm queue records, provider acceptance and actual receipt. Resolve test records afterward. This is an operator-supervised acceptance test, not an automatic mass-send test.

Automatic threshold evaluation still requires an open command-center session.
The server worker handles scheduled delivery, not unattended flood-model alert
generation. Moving that evaluation to an unattended service requires validated
source freshness, shared throttling, and an approved automatic-warning policy.

The app remains a decision-support prototype until backend recovery, live
permission/delivery verification, and operational validation are complete.
