# FloodRoute Defense Readiness Review

Date: 2026-10-02 (Asia/Manila)
Reviewed application commit: b7a46f3d94344eb35f754cf55b1a7d7050c504ca

Historical baseline review. Several source defects below have since been corrected.
See [the remediation handoff](2026-10-02-remediation-handoff.md) for current fixes,
verification evidence, deployment boundaries, and outstanding owner actions.

## Verdict

The project demonstrates a substantial decision-support workflow, but it is not ready to be represented as a validated emergency-routing service. The live backend is currently restricted, and source review plus isolated routing tests found unresolved safety and authorization defects. A successful Vercel deployment is not a backend health check.

This review changed no application code, production data, billing, or permissions. No SMS, email, or rescue request was sent. Findings below distinguish live observations, reproduced defects, source findings, and unverified deployment state.

## Findings, Ordered by Priority

### 1. P0: Live Supabase service is restricted

**Evidence:** Read-only requests to alerts, road_blocks, rescue_requests, rescue_request_updates, and integrations returned HTTP 402. The alerts response explicitly reported `exceed_egress_quota` and said the project owner must upgrade the plan or remove spend caps to restore service.

**Impact:** The deployed frontend can load while current database reads fail. A panel demo cannot depend on live data until access is restored. These responses do not establish whether the rescue/closure tables exist.

**Action:** Inspect usage and billing in the Supabase dashboard, choose an owner-approved remedy, then verify read/write and cross-role workflows using designated test records. Do not increase spending without owner authorization.

### 2. P1: Failed data reads are presented as empty or previously loaded data

**Evidence:** `src/context/AdminDataContext.jsx:251` replaces failed initial loads with EMPTY collections; subsequent refetch failures only log to the console at line 213. The initial loading state still completes. The same provider reloads every remote collection every six seconds at lines 299-308, even with Realtime subscribed.

**Impact:** A failed warning/closure feed can resemble an absence of warnings/closures. Repeated full reads also generate avoidable traffic. This polling is a plausible contributor to egress consumption, not a proven explanation of the quota overrun; usage logs are needed for attribution.

**Action:** Track collection health and last successful fetch, distinguish unavailable from empty, and qualify or disable safety verdicts when required data is unavailable. Use role-scoped data, incremental updates, visibility-aware fallback polling, backoff, and pagination.

### 3. P1: The strict route check can return safe through a flooded section

**Evidence:** `src/components/admin/routeSafety.js:184` passes `floodedEdges` through to the normal planner. `src/components/admin/routeEngine.js:426` gives those edges a finite risk penalty instead of excluding them. Whole-road flooded flags are excluded, so the two closure representations behave inconsistently.

**Reproduction:** Ran the actual route safety module and actual routing engine against a three-node, single-road graph. The browser-dependent flood module was replaced with its exact extracted `DEPTH_PER_RISK` constant and `estDepthFromRisk` function; no routing logic was replaced.

| Input | Actual verdict | Other output |
| --- | --- | --- |
| Both segments explicitly partially flooded | safe | floodedSegments = 2; meanRisk = 0.9 |
| Same road flagged wholly flooded | no-safe-route | Control behaved as intended |
| High modeled risk on the first segment, dry middle vertex | safe | meanRisk approximately 0.5 |

The third case exposes a related sampling problem at `routeSafety.js:93`: strict exclusion samples one vertex per whole road, while route costs sample individual segment midpoints. A hazardous part of a long road can be missed.

**Action:** Apply the strict safety policy at segment level, including partial flooded sections and modeled thresholds. Add tests for alternative paths, no safe path, partial hazards, unavailable hazard feeds, and changing conditions during navigation. Obtain domain-owner approval for the policy; a numerical threshold alone does not establish real-world safety.

### 4. P1: Rescue receipt can claim success before persistence and lose status tracking

**Evidence:** `src/context/AdminDataContext.jsx:428` assigns a temporary id; line 452 starts background persistence and returns the temporary object without mapping it to the saved database row. `src/hooks/useRescueTrigger.js:179` later matches only that temporary id, so it cannot find the real row after reconciliation. `src/components/resident/NoSafeRouteAlert.jsx:112` says the request has been sent unconditionally; line 181 also says sent when no error has arrived, including while still pending. The global persistence helper clears the shared save error after any successful save (`AdminDataContext.jsx:230`).

**Impact:** A resident may see a success assertion before acknowledgement, a contradictory success/error message after failure, or a status that remains stuck on the temporary request after responders update the real request.

**Action:** Await the saved request, retain its real id, and model sending, failed, acknowledged, and responder-status states separately. Keep errors scoped to their operation. Test slow writes, rejected writes, retries, and responder updates end to end.

### 5. P1: Migration policies omit the official-role check on barangay-scoped writes

**Evidence:** `supabase/migrations/20260901130000_reference_tables_rls.sql:76` and the update/delete conditions allow writes when the row barangay matches the JWT barangay, without also requiring `app_role = 'barangay'`. The incidents policies repeat this at `supabase/migrations/20260901140000_operational_tables_rls.sql:104`. `supabase/functions/auth-otp/index.ts:459` mints authenticated JWTs carrying both role and barangay for resident accounts too.

**Impact:** If these policies are deployed with the expected table privileges, a resident can satisfy the write-policy condition for local evacuation centers and incidents through direct API calls. Hiding admin controls in React is not sufficient authorization.

**Confidence:** Confirmed policy defect in repository source. Current deployed policy state and exploitability are unverified because live requests are restricted. No production write attempt was made.

**Action:** Require both official role and matching barangay; review all similar policies. On a dedicated test project, verify resident denial against actual same-barangay records, official access to own records, denial across barangays, and admin access. Tests targeting nonexistent rows do not prove a restrictive policy.

### 6. P1: Scheduled and automatic alerts depend on browser activity

**Evidence:** `src/services/alertDispatch.js:41` skips scheduled alerts. `src/context/AdminDataContext.jsx:304` promotes them and refetches but never dispatches SMS/email. The SQL `promote_due_alerts()` changes database status only (`supabase/migrations/20260901140000_operational_tables_rls.sql:264`). No server-side scheduler/dispatcher is implemented in the reviewed repository. Automatic alert evaluation runs in the admin browser (`src/components/admin/AutoAlertWatcher.jsx`), with a localStorage throttle ledger.

**Impact:** A scheduled alert becoming active does not establish outbound delivery. Automatic evaluation stops when the relevant browser closes; independent clients can race to issue duplicates. External jobs configured outside this repository have not been verified.

**Action:** Use a server-side scheduled job and durable delivery queue with idempotency, retries, and observable delivery status. Demonstrate a scheduled alert with all application tabs closed and an owner-approved test recipient. Separately verify physical SMS-gateway availability.

### 7. P1: Integration configuration is unsafe for secrets and is not connection proof

**Evidence:** `src/data/integrations.js` declares API/private-key form fields. `src/components/admin/settings/IntegrationsTab.jsx:60` collects every field, and `src/services/db.js:621` stores values in `integrations.config` without rejecting secrets. The integration is labeled connected merely because its first field is nonempty. The older app-wiring migration grants permissive access to integrations; no later integrations-specific lockdown was found in the reviewed migrations.

**Impact:** Entered credentials can be persisted in an inappropriate browser-facing configuration surface. The September 22 audit observed anonymous readability, but that is historical evidence, not a current live verification. No secret exposure was established in today's blocked checks. A masked password field is not access control.

**Action:** Remove private-key inputs, reject secret-bearing configuration server-side, and use server-only secret storage. Verify deployed integration-table grants/policies and rotate any credential proven exposed. Report actual provider health rather than form completeness.

### 8. P1: Offline caching is not isolated by signed-in user

**Evidence:** `public/sw.js:223` caches successful Supabase GET responses without checking whether they contain private account data or separating users. The fallback at line 229 retrieves from a shared data cache. `src/services/api.js:183` logs out by clearing the token, not the service-worker cache.

**Impact:** Private data can persist on a shared device after logout. Cross-account replay depends on request URLs and response Vary headers; it was not dynamically verified in this review. Public emergency data needs a separate explicit cache policy and per-dataset freshness indicators.

**Action:** Restrict persistent caching to an explicit public-data allowlist, migrate/purge existing private caches, and test admin logout followed by resident login and loss of connectivity in the same browser. Never describe this as a demonstrated data breach without evidence.

### 9. P1 Defense Gap: Risk scores are heuristics, not validated depth measurements

**Evidence:** `src/components/admin/floodRisk.js:153` combines elevation susceptibility, normalized weather/discharge, and a pooling heuristic. At lines 550-553, modeled depth is risk multiplied by 0.83. The code explicitly distinguishes its heuristic from a routed hydrological model.

**Impact:** A displayed depth or risk percentage is not, by itself, measured flood depth, probability of flooding, or proof of safe passage. On dry inputs the formula retains a susceptibility baseline, which also must not be presented as observed standing water.

**Action:** Document parameter sources and meaning; separate observed reports, official warnings, susceptibility, and forecasts. Validate against independent timestamped local flood observations before claiming predictive accuracy. Record error metrics, holdout conditions, missing-data behavior, and approved operational limits.

### 10. P2 Defense Gap: Evaluation metrics do not cover the complete resident workflow

**Evidence:** The local, untracked `scripts/evaluate-routing.mjs:335` measures the duration of `planRoute()` alone. It excludes report verification, API/network delay, database propagation, browser polling, rendering, and delivery. Line 350 counts operator-closed-road traversal separately from modeled-flooded traversal; line 414 labels only the former false passability. The evaluation uses `planRoute`, not the resident's `findSafeRoute` wrapper or rescue flow.

**Impact:** Computation latency must not be presented as end-to-end update latency. Zero operator-closed-road traversals does not mean zero unsafe recommendations. Synthetic scenarios verify algorithm behavior under assumptions, not actual flood-prediction accuracy. This script was inspected but not rerun during this review.

**Action:** Publish exact metric definitions and denominators; report no-route outcomes as well as generated routes. Add actual resident-path tests and independent ground truth. Version the evaluated source, dataset, settings, test machine, and results together.

## Additional Verification Backlog

- Inspect and test the fail-open MFA branch in `supabase/functions/auth-otp/index.ts:996`: failed second-factor delivery currently returns a session. Define a documented recovery policy rather than claiming MFA is always enforced.
- After backend recovery, verify deployment of rescue_requests, rescue_request_updates, and road_blocks migrations. The previous audit reported these missing; today's 402 responses cannot reconfirm that.
- Run role/permission tests on an isolated Supabase project. Do not blindly run scripts/check-rls.mjs on production: it includes writes, including mutations of existing fixture rows.
- Run approved end-to-end email and SMS tests; provider acceptance is not the same as recipient delivery.
- Verify deployment environment variables, backup/restore, usage alerts, incident monitoring, and a panel-demo recovery procedure.
- Refresh dependency auditing, security headers, attribution compliance, and CI checks. The September audit's dependency counts were not revalidated here.
- Test first-use offline behavior, stale-data warnings, denied GPS, low-end Android performance, and actual users completing common tasks without assistance.

## What to Say to the Panel

**What does it prove today?**

"FloodRoute integrates mapped road data, modeled flood-risk indicators, official road conditions, and evacuation information into a decision-support workflow. Routing output depends on the supplied data and policy; it is not a guarantee of safe passage."

**How accurate is it?**

"We distinguish routing correctness under controlled scenarios from flood-model accuracy. We need independent local observations to quantify predictive accuracy; interface evaluations and synthetic routing tests cannot establish that alone."

**Is it real-time?**

"It combines periodic external feeds with database synchronization. Each source has its own update interval. Our algorithm computation time is distinct from end-to-end time for a field update to reach another user."

**Does rescue requested mean help is dispatched?**

"No. Request submission, server acknowledgement, and responder acceptance are separate stages. We must show each stage accurately and provide a failure path. The current acknowledgement/status defects are outstanding fixes, not completed safeguards."

**Can it run unattended or offline?**

"Offline operation is limited to previously cached resources and bundled data, not current emergency conditions. Unattended scheduled delivery needs the server-side dispatcher identified in this review."

**Is it ready for public emergency reliance?**

"Not yet. The current release needs backend recovery, safety and authorization corrections, verified delivery, and operational validation before that claim is justified."

## Recommended Order

1. Restore backend availability and add visible health/freshness states; reduce unnecessary full-data polling.
2. Correct strict routing and rescue acknowledgements, with regression tests before release.
3. Correct and verify RLS, secret handling, offline privacy, and MFA policy.
4. Implement durable scheduled delivery and test approved recipients with browsers closed.
5. Align thesis claims and evaluation metrics with actual evidence; perform field and first-time-user validation.

## Scope and Limits

Today's evidence consists of targeted source/migration review, read-only live backend probes, and three isolated routing scenarios. Earlier responsive UI checks used mocked backend responses and cannot establish production integration or emergency safety. No full penetration test, hydrological validation, production permission test, real rescue drill, or fresh full UI audit was performed today. Outstanding findings are not fixed by this document.
