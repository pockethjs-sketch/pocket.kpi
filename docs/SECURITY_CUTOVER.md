# Employee authentication cutover — 2026-09-18

## 2026-10-20 Buildup v4.9: compact controls and left list per design mock (summary key deployed; frontend via PR #2)

- User requested smaller buttons matching a design mock and the left project list restyled to match. Frame-asset change (pinned by SHA-256) plus one display key: the list summary carries the sector id, and `cleanSummary` in `kpi-buildup-api` now keeps `sector` (string, already bounded to 300 chars like every summary string). No auth, RLS, CSP, sandbox, bridge, table or grant change; older rows simply lack the key and the list omits the sector.
- Deployed 2026-10-20 21:45 KST: `kpi-buildup-api` v4 ACTIVE (verify_jwt), deployed source re-read and spot-checked (regex and allowlist lines identical to the repository). Synthetic probes only: no session → function 401 `login_required`, malformed bearer → gateway 401 `UNAUTHORIZED_INVALID_JWT_FORMAT`. Logs show an employee request served 200 by v4 right after the deploy (status codes and counts only reviewed).
- Local: buildup tests 22/22 (summary test asserts `sector` kept, unknown keys dropped), full suite 379 pass with the two environment-only failures (`postcss`, `lucide-react` not installed here), security lint pass, bundle check pass; `npm run check`/`npm run audit` need packages/registry access not available in this session and run in CI on merge.

## 2026-10-21 Buildup v4.9: KPI TM memo in the consultation TM record (server deployed; frontend via PR #5)

- User requested the TM team's KPI lead fields (CRM company number `crmSheet.clientNo`, HTML-stripped TM memo `crmSheet.detailMemo`, first inquiry `crmSheet.inquiry`, TM diagnosis `score.tm.items`) inside the buildup project's TM record.
- The frame never receives a KPI session token and does not call `kpi-domain-api` (which returns every lead). The bridge gains one op, `crmLead`, accepting only a numeric schedule number and an optional numeric project number (no other keys). `kpi-buildup-api` handles it after the existing employee checks (Auth session, ACTIVE membership, buildup role/scope, no temporary password): it reads the organization's stored premeeting schedule (`buildup_premeetings`) for the CRM client/project number and looks up exactly one non-archived lead of the organization (`source_payload.id = crm-<client>`, then `crmSheet.clientNo`, then `projNo`); ambiguous matches return `found:false`.
- The response carries four fields only (`crmLeadView` in `_shared/crm-lead-tm.mjs`): client number, TM memo (line breaks kept, ≤6,000 chars), first inquiry (≤3,000), TM diagnosis labels/choices identical to KPI `SCORE_ITEMS` (unit-tested against `src/main.jsx`). No company name, contact, phone, e-mail or raw payload. Buildup users (scope all) can already read every lead in KPI and premeeting-scope accounts stay refused, so visibility does not widen. Same service-role client with explicit organization filters as the other actions. No migration, RLS, grant, CORS, CSP or sandbox change; the frame asset stays pinned by SHA-256.
- Deployed 2026-10-21: `kpi-buildup-api` v6 (11:53 KST), then v7 (11:57 KST, verify_jwt) with the helper's whitespace regex rewritten as ASCII `\s` so the deployed source matches the repository; v7 source re-read. Synthetic probes only: no session → function 401 `login_required`, malformed bearer → gateway 401 `UNAUTHORIZED_INVALID_JWT_FORMAT`. Employee traffic before and after the deploy: 200/204 only (status codes and counts reviewed). Production data check by counts only: 20 of 21 upcoming premeetings resolve to exactly one lead, 18 with a TM memo.
- Local: 399 tests (384 pass, 13 skip, 2 environment-only failures: `postcss`, `lucide-react` not installed), security lint pass, bundle check pass; buildup web harness 55/55 with synthetic `crmLead` responses. `npm run check`/`npm run audit` need registry access not available in this session; CI runs them on merge (the high-severity Vite advisory still has to be resolved by a lockfile update before any Pages deploy succeeds).

## 2026-10-21 Buildup v4.9: meeting recordings kept server-side, CLOVA precise transcription, AI correction (server deployed; frontend via PR #5)

- User requested stronger meeting recording (usually two people) with transcription correction via an external API, choosing CLOVA Speech, permanent retention and "precise transcription + AI correction"; plus the left list grouped by creation date and a "프로젝트 생성됨" marker in the overview.
- Migration `20261021053437_buildup_recordings` (applied): server-only `buildup_recordings` (RLS enable+force, no table policies, anon/authenticated revoked; service_role as for the other buildup tables) and the private Storage bucket `buildup-audio` (not public, 14 audio MIME types, no `storage.objects` policies, so browser roles cannot list/read/write it; size limit = project global upload limit). Objects live at `<org>/<owner>/<project>/<recording>.<ext>`.
- `kpi-buildup-api` v8: new actions run after the unchanged employee checks (Auth session, ACTIVE membership, buildup role/scope, no temporary password). Upload = server checks the employee's own existing consultation, MIME, size (≤500 MB) and duration (≤6 h), inserts the row and returns a single-use signed upload token for that path only; `audioUploaded` confirms the object exists. Playback = 10-minute signed URL. Listing/playback/transcript reads are owner-only, OWNER/ADMIN read-only for others (`canReadBuildupOwner`). `transcribe` is owner-only, ≤20 requests per employee per hour, idempotent while processing, and hands CLOVA a 6-hour signed URL of that one object (audio leaves Supabase to NAVER Cloud CLOVA Speech, as chosen by the user). The frame never sees storage paths, tokens or signed URLs; the bridge passes the audio as an ArrayBuffer. AI: Anthropic billing refusals (HTTP 400 "credit balance" / "usage limit") are mapped to fixed codes `ai_credit_low` / `ai_limit_reached`; the frame pauses its 20-second auto analysis for that window.
- New `kpi-buildup-stt-callback` v1 with verify_jwt=false (CLOVA cannot send a Supabase JWT). Authentication is a per-job 32-byte random secret in the callback URL; only its SHA-256 is stored (`callback_hash`), compared in constant time, accepted only while that recording is `processing`, cleared on use and replaced when a job is restarted. The update is conditioned on the same id/status/hash. No CORS headers, no data returned, no payload logging; only segment times, speaker labels, text and confidence are stored. Residual risk: the secret appears in the callback URL (request logs visible to project administrators) until the single use.
- New secrets needed (not set; user action): `CLOVA_SPEECH_INVOKE_URL`, `CLOVA_SPEECH_SECRET`. Without them `transcribe` returns 503 `stt_not_configured` and the screen says so.
- Deployed 2026-10-21: migration applied and re-read (RLS true/true, 0 table policies, no anon/authenticated grants, bucket private, 0 storage object policies, 0 rows); `kpi-buildup-api` v8 ACTIVE 14:39 KST (verify_jwt) and `kpi-buildup-stt-callback` v1 ACTIVE 14:40 KST; both deployed sources re-read and compared equal to the repository. Synthetic probes only: callback with unknown recording/wrong secret 401, malformed parameters 401, GET 405; API with malformed bearer → gateway 401. Usage ledger reviewed by counts only: since 12:09 KST every company-key AI call (149) was refused by Anthropic with HTTP 400 after ~$5.2 of morning usage; after the v8 deploy the same refusals (8) were classified as billing (503 `ai_credit_low`/`ai_limit_reached`, matched on the provider's credit-balance/usage-limit wording), confirming exhausted credit or a spend limit. Provider messages are not stored.
- Local: 413 tests (398 pass, 13 skip, 2 environment-only failures), security lint pass, bundle check pass; buildup web harness 77/77 with synthetic storage/CLOVA/AI, local 63/63, shared 31/31, key file 6/6, unit tests pass. `npm run check`/`npm run audit` run in CI on merge.

## 2026-10-20 Buildup v4.9: upcoming CRM premeetings in the overview (server deployed; frontend via PR #2)

- User requested the KPI premeeting company list (today onward, refreshed 08:00 KST daily, today loaded now) inside the buildup "프로젝트 전체 보기".
- New server-only tables `buildup_premeetings` / `buildup_premeeting_runs` (RLS enable+force, no anon/authenticated grants, no phone/e-mail/address columns) and `buildup_store_premeetings()` (security invoker, execute granted to service_role only) that atomically replaces the today..+30-day window, marks schedules missing from the CRM as removed and purges rows older than 30 days. KPI leads, `crm_raw_records` and the KPI premeeting projection are not read or written.
- New Edge Function `kpi-buildup-premeetings` (verify_jwt) accepts only the existing internal schedule secret header (`KPI_MARKETING_CRON_SECRET` reused, Vault `kpi_marketing_cron_secret`); pg_cron `pocket-buildup-premeetings` `0 23 * * *` UTC. It reads the same CRM calendar endpoint as `kpi-crm-sync` with `CRM_BEARER_TOKEN`, refuses a full 1000-row page as possibly truncated, and returns counts only. No new secrets.
- `kpi-buildup-api` gains read-only `premeetings` after the existing employee checks; owner names of already-prepared consultations are returned only to OWNER/ADMIN. The bridge allows one argument-free `premeetings` op. Summary whitelist adds `crm` (schedule number) so prepared consultations link back.
- Deployed 2026-10-20 19:43 KST as four migrations (tables; privilege revoke — default REFERENCES/TRIGGER/TRUNCATE for anon/authenticated removed; store function without the retention DELETE, which now runs in the Edge Function scoped to the organization; schedule). Grants re-read (postgres/service_role only), function security invoker with service_role EXECUTE only, cron active. Store function verified with synthetic rows inside an exception-rolled-back block. `kpi-buildup-premeetings` v1 and `kpi-buildup-api` v3 ACTIVE; synthetic probes 401 (no/wrong cron secret, no employee session) and no run rows created by refused calls. Initial manual run: 21 fetched = 21 stored (counts only reviewed).

## 2026-10-20 Buildup v4.9: workspace AI fixed to Claude Opus 5.5 (frontend via PR #2)

- User requested AI insights in the buildup workspace on Opus 5.5. Asset-only change: the frame always requests `claude-opus-5-5` through the existing bridge and `kpi-buildup-api`. No API, auth, RLS, CSP, sandbox, bridge or model-allowlist change; the asset stays pinned by SHA-256 in tests.
- The company key stays server-only in Supabase Secrets `ANTHROPIC_API_KEY`. A secure-input request for it (value never passes through the assistant) was dismissed by the user, so it is still unregistered; until then the function returns `ai_not_configured` and the frame stays rule-based. No redeploy is needed after registration.

## 2026-10-20 Employee account administration and first-login password change (functions deployed; frontend via this PR)

- User requested: keep MASTER unchanged, add `design@pocket.company` and `ceo@pocket.company` with an administrator-set temporary password that must be replaced at first login, and give MASTER an account-management screen to view and manage accounts.
- New Edge Function `kpi-account-api` (verify_jwt) authorizes every action with `authorizeEmployee` (Auth getUser + current ACTIVE membership). Self actions: `status`, `change_password` (12+ chars, not one repeated character; clears `app_metadata.pk_password_change`, which only the service role sets or clears). While the flag is set every other action returns 403 `password_change_required`. Admin actions (OWNER/ADMIN, scope all): list, create (confirmed Auth user with flag → profile → ACTIVE membership → claimed invitation; compensating deletes on failure), reset temporary password (sets the flag), role change, pause (membership ARCHIVED + Auth ban) / resume, rename. ADMIN can be granted or managed only by OWNER; MASTER/OWNER/SERVICE and one's own account are never manageable. The MASTER alias address is never returned. Passwords go only to Supabase Auth and are never stored in tables, audit rows, logs or responses; `employee_account` audit rows hold role/active/temporary flags only. No migration, RLS, grant or CORS change (existing explicit origin allowlist).
- `kpi-buildup-api` v2 refuses flagged sessions. `kpi-domain-api` is unchanged: flagged sessions are stopped by the login gate (EmployeeEntry asks `status` before importing the KPI app; fail-open on a status error for availability) and by the account/buildup APIs. Follow-up if required: enforce the flag inside `kpi-domain-api` as well.
- A one-time bootstrap secret for creating the two accounts was refused by the secret-store write approval policy; the bootstrap path was removed before release, and the deployed v2 has no unauthenticated account-creation path. Only unclaimed EDITOR invitations for the two addresses were inserted (scoped, idempotent upsert, re-read). MASTER creates the Auth accounts from the screen after release; the temporary password never passes through repository, docs or SQL.
- Verification: local 385 tests (371 pass, 13 skip, 1 environment-only `lucide-react` failure), security lint pass, 13-flow component harness with a synthetic server. Production: `kpi-account-api` v2 and `kpi-buildup-api` v2 ACTIVE with verify_jwt; synthetic probes only — malformed JWT 401, forged-signature JWT 401, missing header reaches the function and returns 401 `login_required`, old bootstrap request 401. Real MASTER/employee browser flows remain unverified (no credentials used).

## 2026-10-20 KPI-only warehouse UI refinement (deployed; browser unverified)

- Released d6a32e557ecdf15c2acfbc0ba0914c6fca29ef39 / Actions39410868003 build+deployment success. 10:52UTC live HTML/9 JS-CSS/5 fonts/license HTTP200; actual entry index-m1EY0KYS.js/main-CJHmthPA.js, UI CSS main-BrrgOI4n.css. Main code matches after asset-name normalization; UI CSS/fonts/buildup bytes exact. Shared index CSS differs only in40 LAB rounding values (max0.0001), not selectors or layout. Browser and employee session remain unverified by user choice.

- User limited this change to existing KPI UI and selected code/automated checks only, then explicitly approved deployment. Shared presentation primitives and KPI-scoped tokens replace overlapping theme overrides. Auth/API/RLS, KPI calculations/storage/sync, chooser and external hub are unchanged. The already-deployed buildup v4.8 update on main is retained without modification; no backend or migration deployment is part of this release.
- Latest-main integration passed386 tests/security/build/artifact checks and npm audit0 in a separate release checkout so the original dirty working tree stays intact. Nine core token contrast pairs pass4.5:1; not a whole-screen accessibility or visual QA claim. Dark receivables/frozen contract-header geometry have explicit exceptions. Poppins Latin assets include public OFL. Actual employee UI remains unverified. See KPI_UI_REFINEMENT.md.

## 2026-10-20 Buildup intelligence v4.8: per-employee storage, admin read, company AI key, page-side recording

- User requested replacing the buildup tab with v4.8 and deploying to the connected GitHub/Supabase, choosing per-employee storage with admin overview and a company AI key held in Supabase. The frame stays an opaque-origin sandbox (no same-origin/top-navigation/popups) with `connect-src 'none'`; camera/microphone/location remain denied in the frame. No KPI page permission, KPI table, RLS, auth flow or existing API changes.
- New server-only tables `buildup_projects` (PK organization+owner+project, revision CAS, soft delete) and `buildup_ai_usage` (model/token counts only). RLS enabled+forced, no policies, no anon/authenticated grants. New Edge Function `kpi-buildup-api` (verify_jwt) authorizes every request with `authorizeEmployee` (Auth getUser + current ACTIVE membership). Owners write only their own rows; OWNER/ADMIN read others; nobody edits/deletes another employee's consultation; premeeting-scope accounts are refused. CORS uses the existing explicit origin allowlist.
- Bridge: one private MessagePort per frame load; allowlisted operations with argument/size validation; the employee token and Supabase client never enter the frame; errors return as short codes. Recording runs in the KPI page because an opaque origin cannot open the microphone; only transcript text, recorder state and the audio file cross to the frame; audio is not uploaded.
- AI requests are proxied with the company key from Supabase Secrets `ANTHROPIC_API_KEY` (not yet registered by the operator at release time; until then the function returns `ai_not_configured`). Model allowlist, token/input caps and a 240 calls/hour/employee limit apply; prompts are not stored or logged.
- Verification: migration `20261020072624` applied; grants/RLS re-read; advisor adds only INFO `rls_enabled_no_policy` for the two server-only tables. Function v1 ACTIVE, deployed source equals local. Synthetic probes only (no credentials): missing header 401, malformed JWT 401, publishable key as bearer reaches the function and returns 401 `invalid_session`. Local tests/security lint pass (see WORKSPACES.md); full npm build/audit run in CI because the package registry is unreachable from this session. Real employee browser use remains unverified.

## 2026-10-20 KPI / sales buildup workspace shell (deployed; browser unverified)

- Follow-up: chooser-only Marketing Hub anchor opens the exact approved https://pocket-mkt.github.io/ in a new tab with noopener/noreferrer/no-referrer; no session/state/query transfer, internal navigation, API or permission change. Link HTTP200 and local366 tests/security/build/audit0 passed. Release eb04c840a475da1fdaeff6d47b08f1f917a6f1ec/Actions39359969857 build+deployment successful;02:39UTC actual9 assets200, main matches local except asset names with approved link/new-tab attributes. Browser click unverified.
- Add only an employee-gated workspace chooser and persistent switcher above the existing KPI app. KPI page permissions, authenticated API/storage/journal/sync behavior and EmployeeEntry authorization-before-import remain unchanged. No database, role, RLS, API or deployment-configuration changes.
- User-supplied standalone sales document is lazy-loaded in an opaque-origin sandbox with network/form CSP restrictions, no same-origin/top-navigation/popups permission, no KPI state/session bridge, and camera/microphone/location denied. Its original bytes are preserved. This is not shared consultation persistence: in-frame localStorage is unavailable; current-window-only input and explicit file export limits are shown to users. Static bundled source is not a server-enforced confidential document store.
- Local365 tests/security/build/audit0 passed; release2f5f5b98675208fb6b34533f46e41e27b4d91bb6 and Actions39357887298 build/deployment succeeded. At02:16UTC public HTML and all9 referenced assets were HTTP200; workspace main matched local code except platform-generated asset filenames and the lazy buildup chunk matched byte-for-byte. Browser UI remains unverified because no controllable general browser is connected. See WORKSPACES.md; existing unrelated local edits below remain preserved and excluded from release.

## 2026-10-08 Two-page supplemental editing (validated locally; activation pending)

- User authorized the existing two-menu employee to edit premeeting companies and receivables. Keep ACTIVE/VIEWER membership, direct-table RLS, invitations, other staff and administrator permissions unchanged. Add a server-only per-organization/user grant; each mutation revalidates the active membership, grant, current revision, eligible existing lead and allowed fields before the existing atomic commit.
- Only existing premeeting/contract records can be edited: contract/payment amounts and dates, receipt checks, owners, notes, classifications and related append-only activity. Whole-record creation/deletion, source identifiers, unrelated collections/documents, administration and collection triggers remain denied. Grant is not a global EDITOR promotion. Existing read scope is unchanged; menu restriction is not a new API read-isolation guarantee.
- Keep undeployed `access_scope` invitation changes inactive; runtime queries now match production columns. Do not apply the previously rejected common membership/RLS migration.
- Limited frontend saves journal explicit edits rather than display migrations. Failed journals stay account-isolated until ACK; no automatic cleanup/recovery claim. Show prominent save state, distinguish pending from confirmed success. Synthetic handler/storage authorization tests plus 279 tests, security lint/build checks passed; npm audit reports 0 vulnerabilities. Actual employee browser save/recovery remains unverified.

## 2026-10-07 Approved card presentation release (deployed)

- Deployed `d95c0e5f0d196231ddab162744af45ed78912cd1`, Actions `37578206880`: build and deployment success. 274 tests, security lint, build contract and full audit (0 vulnerabilities) passed. Public HTML/9 assets/license return200; actual CI entry/main filenames verified. Six assets match local SHA-256; two JS files match after asset-name normalization. Base CSS differs only in tiny platform floating-point LAB color conversion, not selector coverage. Final browser QA remains unverified per explicit user direction.

- User explicitly requested deployment without further desktop/browser interaction after stopping Computer Use. Final post-Tailwind browser regression is unverified; this is a disclosed user-directed release, not a visual-QA pass.
- Promote the approved bright blue presentation only: semantic library icons, quiet card borders, local SUIT font with OFL license, existing tables/navigation/controls preserved, dark receivables retained. Move comparison/ROAS explanations to bottom notes. Replace the misleading Sheets connection badge with the existing Supabase operation state; unknown/pending/error never become healthy. No new API call or claim of service-wide uptime.
- No synthetic fixture, preview routing, fake employee session, disabled network or fake save state is included in the release. Existing authenticated startup, menu permissions, storage, calculations, background collection and backup remain unchanged. Remove the obsolete separate Sheet sync button only; existing combined manual synchronization remains.
- Dependency audit reports 0 vulnerabilities. Automated verification and public deployment asset checks are recorded below/operations ledger; production customer payloads and actual employee credentials are not used for verification.

## 2026-10-07 Approved build dependency upgrade (local, release pending)

- User approved resolving the audit blocker and deploying the reviewed design. Upgraded Tailwind and its official PostCSS adapter to pinned 4.3.3, and source-map-js to a compatible patched release. The install audit reports 0 vulnerabilities (previously 8); no audit suppression or force bypass.
- Explicit source scanning is limited to src/index. Preserve legacy ring/shadow/placeholder/border/cursor defaults for visual compatibility. Existing employee authentication, API requests, business calculations and data are unchanged. 271 tests, security lint, build and build-contract pass locally. Browser regression and production deployment are separate subsequent gates.

## 2026-10-07 Marketing overview labels and table consistency (local only)

- Deployment explicitly deferred by the user after the full dependency audit returned 8 pre-existing issues (6 high, 2 moderate). No audit bypass, forced dependency upgrade, commit, push or deployment. Operating presentation fixes remain local and separate from the isolated card-design preview.
- Add explicit inflow-date basis beside paid-company card/header and distinguish current confirmed receipts from receipt-date reporting. Existing cohort, actualPaid, contract-date ROAS, exports and handlers are unchanged.
- Explain monthly target colors, ungraded existing-customer ROAS and separate channel ROAS 100% threshold. Missing results are neutral; total channel ROAS uses the same color threshold as channel rows. Standardize only these two tables to 12px body text and 40px rows.
- No production data/API/auth/session/RLS/sync/backup change, no new requests. 271 tests, security lint, production build and build-contract checks passed. Browser visual recheck was interrupted by changing desktop/window state; not claimed verified. No deployment or dependency change.

## 2026-10-07 CRM inflow recovery / server promotion deployed

- Root cause: the daily Apps Script premeeting path collected raw newarrivals through `kpi-crm-sync`, but consumed only meetings. Operational lead promotion was browser-only; removing tab-entry auto refresh on September 30 left no unattended inflow writer. Raw collection COMPLETED therefore did not mean operational CRM updated.
- Applied migration `20261007013617_crm_inflow_server_reconciliation`; added invoker-only, server-role-only `kpi_reconcile_crm_inflow` and separate `crm_sync_runs.inflow_result/inflow_completed_at`. No RLS relaxation, Auth/membership edits, client keys, or new public data access. Verified EXECUTE denied to anon/authenticated, allowed to service_role.
- Deployed **kpi-crm-sync v12**, ACTIVE; downloaded deployed source equals local source. Existing custom service/HMAC authentication preserved; unauthenticated synthetic POST returned401. The daily existing 09:00KST call now awaits raw persistence, reconciliation and relational verification before COMPLETED. Previously collected rows since September30 are reconsidered even when today's feed is empty. Browser tab-entry auto collection remains disabled; no frontend or Apps Script deployment needed.
- Approved recovery at **2026-10-07 10:38:43 KST**:36 unique customers (not raw project/inquiry rows),27 added and9 existing calendar-only leads enriched. Snapshot and relational ledger agree:September30=6;October1=1,October2=9,October6=20;October total**30**, active leads959. Original nonempty acquisition dates and user fields are preserved. Archived relational identities are excluded by this inflow reconciler; premeeting deletion behavior was not changed.
- Recovery transaction compared every existing lead except the four permitted inflow fields and every active financial deal/plan/receipt tuple before/after; all unchanged. Repeating reconciliation made0 changes and preserved revision. Recovery metadata annotated the latest collection without changing its original collection timestamps/counts. Current revision `crm-inflow-db633e834aeca9ac38cdf1496761e8eb`.
- Verification:9 new mocked-handler/security tests,268 total tests, security lint and production build/build-contract pass. Synthetic PostgreSQL integration transaction verified new/existing/repeat/client-dedup/deleted/ambiguous behavior and rolled back. Production dry run:36 already applied,0 missing/blocked. Actual next09:00 unattended execution has not occurred yet; do not claim it was observed.
- Existing `kpi` heartbeat updated in place, same six-hour cadence: read-only ads plus separate CRM collection/promotion freshness, dry-run unapplied/blocked counts. Healthy/unchanged status stays quiet. No collection trigger was added or changed.
- Separate pre-existing build dependency audit finding:full npm audit reports8 issues (6 high,2 moderate) in dev-tool chains; `npm audit --omit=dev` reports0. No dependency versions changed; no frontend deployment. Review braces/chokidar/Tailwind, postcss-selector-parser and source-map-js separately rather than force-upgrading Tailwind during data recovery. Supabase advisor retained existing pg_net public-schema and leaked-password-protection warnings; no new client table grants/policies.

## 2026-10-02 Section Excel export

- Upper-right XLSX download snapshots explicit columns from the currently mounted, authorized view and its filtered data. No whole-state serialization, credential/storage reads, additional API requests, source mutations, backend/auth/RLS changes or upload destinations. Existing menu presentation is not a new server-side authorization boundary.
- Local exports contain business data in ordinary unencrypted files; recipients must be controlled by the operator. Current screen/period semantics and exceptional period-independent views are recorded in workbook scope labels. Paginated previews export all filtered rows; Notion imported receivables remain separate from the operational ledger.
- Lazy browser-only OOXML writer preserves exact numeric values, dates and text identifiers, freezes headers and adds filters. Text is inline literal, never a formula or external hyperlink. Limits fail explicitly rather than truncate. No dependency added.
- 259 unit tests and build/security gates pass. Isolated browser QA with synthetic fixtures covers 26 download/view combinations, filter/tab isolation, full 35-row lists and no download-triggered API calls. Independent XLSX reopen and ZIP checks pass; npm audit reports zero vulnerabilities. Deployment status is tracked in PROJECT_STATE; no production customer/session data was read for QA.

## 2026-10-02 Channel ROAS drilldown

- Marketing hub channel/total ROAS opens a read-only company breakdown from already employee-authorized CRM state. Uses the same contract-date selection and amount helper as the table; shows exact contract amounts, source channel, type/date/owner and ad denominator. Unknown/zero spend remains non-computable, with rows still available.
- No new fetch, data writes, authorization changes or collection triggers. Company buttons invoke the existing authorized detail view. Synthetic tests and static deployment verification are tracked in PROJECT_STATE; no production customer payload is needed for QA.

## 2026-10-02 Main contract/receipt ROAS presentation

- Main contract card retains contract-date ROAS and adds confirmed-receipt ROAS for the same selected contract cohort/customer type and ad-spend denominator. Reuses existing actualPaid semantics, including partial CRM deposits and undated confirmed installments; not a receipt-date cashflow metric. No fabricated receipt dates or historical cash deltas.
- Frontend-only aggregation of already authorized state. No new API, business writes, auth/RLS, collection or backup changes. Synthetic calculations/rendering and release gates are recorded in the operations ledger; production employee-session UI remains separately unverified.

## 2026-09-30 Confirmation-only template editor

- Simplify template presentation to the existing pre[buildup].confirm field, keeping buildup selection/copy/edit and VIEWER read-only behavior. Remove TM, before-meeting reminder and post-meeting tabs from this editor only. Preserve all stored templates and existing task/sequence behavior; no source reset or automatic-message trigger change.
- Synthetic extracted-handler test verifies only the selected confirmation is changed, including empty-document initialization. Account/menu rules and backend authorization are unchanged. Release verification is tracked in the operations ledger.

## 2026-09-30 Restore message/script navigation

- Restore Other > Messages/scripts and its hub card using the unchanged stored templates and existing save path. No source-data reset, backend deployment, membership or RLS changes. VIEWER textareas are read-only; copy remains available.
- Keep organization KPI retired and retain both restricted menu profiles. The designated two-menu VIEWER does not gain template visibility. Synthetic navigation/account regression tests added; release verification is tracked separately in the operations ledger.

## 2026-09-30 Two-menu viewer presentation

- Current membership metadata confirms the requested employee has ACTIVE VIEWER membership. Apply an identity-specific frontend menu preference after verified session resolution: premeeting companies and receivables only, with premeeting as the initial page. Hide cross-page search and keep MASTER/other employees unchanged. Public configuration contains an organization/user fingerprint, not an email or credential.
- This is explicitly **menu visibility, not server-side data isolation**. Existing VIEWER read authorization and write denial remain unchanged; bootstrap/API read scope is not narrowed. No production DB, RLS, claim RPC or Edge changes; the previously rejected scope migration remains unapplied.
- 237 synthetic tests pass; isolated browser confirms exactly two navigation entries, both page transitions and no runtime errors. No employee session or customer data was used. Release tracked separately in the operations ledger.

## 2026-09-30 Product sales presentation

- Read-only aggregation of already employee-authorized CRM/product state, with no new API, schema, source collection, service credential or authorization change. Existing catalog mutation handlers are preserved; VIEWER catalog editing is disabled in addition to existing server enforcement.
- Counts distinguish per-lead contracts from multi-buildup memberships and separate historical events; no financial value is rewritten or allocated. See PRODUCT_SALES.md. Synthetic-only validation, with no production customer payload retrieved. Deployment is tracked separately in the operations ledger.

## 2026-09-30 Existing viewer approval

- Operator replaced the restricted editor request with ordinary VIEWER access and explicitly accepted full business/financial visibility. Registered one specified employee in the existing organization-scoped invitation table using an idempotent insert; no credential or email address is committed here.
- Production reread confirms VIEWER approval, unclaimed, with no Auth signup yet. Employee must use the existing first-use password/email-confirmation flow. No invitation email was sent by this database registration and successful employee login is not yet verified.
- No schema/RLS/claim-function/Edge/frontend change, no business writes, and no MASTER change. The rejected scope migration remains unapplied; this approval is for the existing full-read role, not premeeting-only access. Fourteen synthetic authorization tests passed, including VIEWER write denial.

## 2026-09-30 Menu retirement and scoped-account preparation

- Retire templates/org navigation without deleting stored business documents; settings now opens email-based account registration. MASTER remains unchanged.
- Prepared premeeting-only server membership scope, scoped API reads/mutations, isolated cache, partial-state initialization without legacy seeding, and direct REST restriction. These backend files and migration are **not applied to production**: automatic safety review rejected the common RLS/claim-function change pending explicit operator approval of its impact on existing direct database clients.
- Do not create the requested limited employee as an ordinary all-access employee. Frontend blocks limited registration until the authenticated session advertises scope support. Existing all-access registration remains the existing employee-invitation flow. Password creation and email verification stay self-service; no shared credential or auth-user SQL insertion.
- 224 tests and scoped synthetic browser read/edit/save/manual-sync passed, with no marketing fetch or runtime exceptions. Production employee login and restricted account activation remain unverified. Web-only release is tracked in the operations ledger; neither migration nor Edge deployment is implied by a Pages release.

## 2026-09-30 Stale login-entry chunk recovery

- Public read-only check confirmed the reported previous main asset returns HTTP404 while the current page references a newer entry (GitHub Pages HTML max-age=600). An already-open login entry can hold an obsolete dynamic import path after deployment; this is an application-file load failure, not evidence of a rejected password.
- Only after employee session/membership verification, recognized chunk transport errors may reload the same origin/path with a cache-busting query. A sessionStorage guard allows one automatic attempt per ten minutes; offline/storage failure uses an explicit retry button. Auth failures and application evaluation errors never enter this recovery path.
- No sign-out, auth-storage clear, customer-journal deletion, permission bypass, or backend change. Existing authorization-before-import is preserved. Synthetic tests cover error classification, loop protection, offline fallback and retained storage. Production business authentication is not tested with recovered/shared credentials.
- Local verification: 219 tests passed, npm audit zero vulnerabilities. Build/deployment status is recorded separately in the operations ledger.

## 2026-09-30 Manual sync orchestration

- Explicit premeeting and DB/quality refresh actions now include the existing authenticated contract-sheet reconciliation after primary save acknowledgement, followed by a current DB reload. Page/TM entry no longer collects CRM data; premeeting tab entry no longer reads the source sheet/rebuilds its review queue. Saved DB/status reads and user-input journal replay remain enabled.
- No endpoint, Auth, organization permission, source-sheet write, database schema, server trigger, or backup change. The single-browser busy guard prevents overlapping manual jobs; changed-field merging preserves edits made during CRM fetches. Partial success is reported rather than mislabelled as full success.
- Tests use synthetic inputs and actual extracted frontend handlers; deployment verification uses public static asset hashes only. No credentials or production customer payload are retrieved. Actual signed-in manual synchronization is a separate runtime check.
- Local verification: 214 tests passed, security lint and production build contract passed, npm audit reported zero vulnerabilities. Web deployment is tracked separately in the operations ledger.

## 2026-09-30 Sheet-authoritative financial reconciliation

- User explicitly authorized O-column totals to replace different web totals and H checkmarks to confirm 100% receipts (percentages mean cumulative partial receipts). The existing authenticated sheet synchronization atomically reconciles totals, schedules, H confirmations and before/after activity logs. No direct business-table write or authentication bypass is introduced.
- Confirmed historical metadata shows a web user-edit installment later conflicting with a Sheet-applied total; frontend schedule normalization restored the older total. Both fields now move together. Previously received amounts/dates/notes are preserved; overpayments, ambiguous identities, recurring contracts and CRM-managed schedules remain held instead of inventing refunds or deleting receipts.
- Employee authorization, organization checks, HMAC, revision conflict replanning, source-sheet read-only behavior and backup/collection schedules remain unchanged. Production execution and verification are separate from code deployment.

## 2026-09-30 Legacy-auth save rejection / contract lookup prerequisite

- Production frontend mutation builder filtered `auth` inside nested patches but not at the document root. Filtered bootstrap + local normalization therefore produced a forbidden `documents.auth` write. A synthetic reproduction confirms the server rejection and subsequent 45-second commit wait; recent production metadata also shows a mutation HTTP 403. No browser session/body was retrieved, so that specific response code is not claimed as inspected.
- Exclude only the retired top-level `auth` document in new/rebuilt mutations. Preserve all business patches, including nested fields; keep failed journals until normal replay is acknowledged. Server-side legacy-auth rejection, employee session and membership checks remain unchanged.
- Distinguish the local pending-save timeout from a Sheet read failure in the existing alert. No new review-list UI, source-sheet write, trigger, schema or permission change.
- Four synthetic regression tests cover auth addition/update/deletion, payment and memo preservation, network-failed mixed-journal replay and auth-only no-op. Deployment and live H-column reconciliation are recorded separately; neither is implied by local test success.

## 2026-09-28 Contract H payment parsing fix (Apps Script v61)

- Expands Apps Script H-column parsing to exact checkmarks/checkbox/V and cumulative percentages. Amount matching, identity ambiguity checks, revision-guarded atomic mutation and existing financial input protection remain in place. No public endpoint or employee authentication changes.
- Authorized Supabase metadata inspection found the user-specified record has an unpaid schedule and premeeting status. Current Google admin OAuth can inspect/update Script source, but Sheets API reports SERVICE_DISABLED and scripts.run returns 403. No source payment value has been assumed and no production payment correction has been made.
- Synthetic verification and deployment outcomes are recorded separately. Direct Sheet values, credentials and customer payloads are not committed.
- 193 tests, security lint, production build verification passed; dependency audit returned zero vulnerabilities. Production main deployment/HEAD now use version 61, backend `2026-09-28-contract-payment-percent-v31`; published and local Code hashes match and other four project files are unchanged. No source Sheet or business DB rows were directly changed. Authenticated synchronization/live H-value verification remains blocked by the current Google management OAuth execution scope.

## 2026-09-28 Receivables contrast hotfix

- Release `a7db298`, Actions `36366224155` succeeded. Live entry and all seven JS/CSS hashes match the tested build; 183 tests and security/build checks passed, dependency audit 0 vulnerabilities. No production business data read/write was performed.
- CSS-only production change, scoped to dark table controls: fixes light-form important colors overriding select/option/textarea and white shared delete-button backgrounds. No authentication, financial data, API or mutation handler changes.
- Synthetic browser verification uses extracted production control markup and Btn/DangerBtn, no signed-in session or production calls. Confirms computed foreground/background, payment select change, two-step delete, mobile layout and zero runtime exceptions. The native OS popup itself is not screenshot-verified; identical option nodes were inspected in listbox presentation.

## 2026-09-28 Receivables table presentation release request

- User reviewed the isolated synthetic preview and approved applying the presentation to existing live data. Only frontend rendering changes; employee Auth, organization-scoped API reads, database rows, financial calculations and save handlers remain unchanged.
- Synthetic preview files/screenshots stay in ignored `artifacts/` and are not part of the production build. No production session or customer payload was retrieved for this release.
- 181 tests, security lint, production build contract and dependency audit (0 vulnerabilities) passed. Preview: 8 synthetic records, 10 columns, paid filter 2 rows, mobile page overflow absent, runtime exceptions 0. Authenticated production read/write E2E remains unverified. Deployment status is recorded separately after CI completes.
- Released as `ab4f163`; GitHub Actions `36365556346` succeeded. Live HTML references the expected entry; all seven public JS/CSS assets return HTTP 200 and match the tested build SHA-256. No production business reads/writes were used to verify deployment. Synthetic fixtures are excluded from Git and the build.

## 2026-09-24 Notion receivables presentation release

- Frontend-only stage grouping deployed in commit `a0b6e5e`, Actions `35994648716` succeeded. No API, Auth, RLS, database rows, or backup changes; the existing employee-authenticated read boundary remains unchanged.
- 175 synthetic tests, security lint, build verification, and dependency audit (zero vulnerabilities) passed. The live HTML references the new entry and all six public JS/CSS assets match the tested build SHA-256. Authenticated visual/interaction verification is still separate and has not been performed in this release.

## 2026-09-23 Notion receivables read boundary

- The existing `notion_contract_payment_records` import is shown only through `kpi-domain-api?action=notion_receivables`, after the same verified employee-session and active-organization-membership checks as other business reads. The query is organization-scoped, paginated, and selects display columns only; `raw_payload` is never sent to the browser.
- The table has RLS enabled and no browser-role SELECT policy. A scoped migration revokes all remaining `public`/`anon`/`authenticated` table privileges, including incidental TRUNCATE/REFERENCES/TRIGGER grants; the existing service-role importer keeps its permissions. No broad schema grant or public fallback is added.
- Imported source rows are read-only reference data, separate from financial mutations and calculations. See `docs/NOTION_RECEIVABLES.md` for reconciliation limits and verification gates.

2026-09-18. User approved moving Pocket KPI to approved-employee authentication.
User subsequently requested the scheduled security cutover to run immediately.
Initial administrator email was supplied privately in the task; do not publish it here.

## 2026-09-19 follow-up hardening

- Replaced the browser's legacy JWT-shaped anon credential with the project's current `sb_publishable_` key. This remains a public project identifier; authorization still requires a verified employee session and active organization membership.
- Removed the boundary script's Git-history lookup and retired-token replay. Production denial probes now use an obviously invalid synthetic session and never recover old credentials.
- Removed the retired `x-kpi-app-token` CORS allowance from `kpi-domain-api`.
- Removed the separate support-board project's browser credential and direct REST read. The support page now reads the existing `supportBoard` document through the employee-authenticated KPI domain endpoint. The stored snapshot exists; automatic refresh from the separate project is paused until a server-to-server integration is configured.
- Added repository `AGENTS.md` secure-work rules and `npm run security:check`. CI now rejects committed environment files, private keys, secret-key literals, legacy JWT literals, customer-payload console dumps, and boundary tests that recover credentials from Git history.
- Domain function v12 is active. Invalid session probes return HTTP401, and principal Apps Script URLs still return `employee_gateway_required` before any Sheet read.
- Local verification: 151 tests passed, production build contract passed, dependency audit reported zero vulnerabilities. Real administrator login/read/write remains a separate release gate.

## 2026-09-19 MASTER presentation restore

- Restored the familiar `MASTER` presentation for server-approved `OWNER` and `ADMIN` employees. The header, role badge, and activity-log actor now use `MASTER`; `EDITOR` and `VIEWER` use `USER`.
- This is a presentation and permission-compatibility change only. It does not restore the retired shared MASTER password, static browser token, anonymous fallback, or direct public data route.
- The server remains authoritative: only a verified employee session with an active current membership can be mapped to MASTER. Unknown or missing roles never become MASTER.
- No database, Sheet, Apps Script, collection, backup, or stored business data was changed. 154 tests, the security lint, production build verification, and dependency audit passed.
- Follow-up: the login identifier now accepts the `MASTER` alias as well as employee email. Supabase password authentication itself accepts only email/phone, so MASTER is resolved to an administrator email linked locally in that browser. The address is never embedded in the public bundle. On the first use, the administrator supplies the approved email and completes the standard confirmation link; subsequent logins on that browser can use MASTER. The server membership remains the sole source of MASTER authority.
- Final MASTER flow replaces that interim browser-email mapping: `kpi-master-auth` owns a synthetic, auto-confirmed Auth identity and returns a normal Supabase session only after server-side password verification. A 256-bit one-time setup link creates the identity and OWNER membership; no employee email is requested or stored for MASTER. The setup rejects the historical password hash, deletes the unused OWNER email invitation after success, and cannot run again once the identity exists. Ordinary employees continue to use verified individual email sessions.
- The endpoint is intentionally `verify_jwt=false` because it is the password-session issuer. It accepts only POST, restricts browser CORS, requires a 12–256 character password, uses Supabase Auth password verification and generic failures, and requires the server-only one-time setup token for enrollment. Invalid setup and login probes returned HTTP403/401 without data. Version 1 is active; the frontend setup link must still be consumed before MASTER exists.
- Local verification: 161 tests, security lint and production build contract passed. No business data, CRM, Sheet, Apps Script, marketing collection, or backup path changed.

## Confirmed from local source

- Browser sends a static app token plus an anon key to kpi-domain-api.
- The function checks the static token before privileged reads AND mutation writes.
- Apps Script doGet/doPost independently accept the old static token.
- Marketing collection also has an app-token authorization branch.
- Existing organization_memberships provides organization/user/state/role records.
- No production CRM records were fetched during this security preparation.
- No logs have been audited; third-party access is neither established nor ruled out.

## Implemented boundaries

`_shared/employee-access.mjs` requires a verified Auth user and current approved membership.
It rejects anonymous, unconfirmed, revoked, wrong-organization and service identities;
read/write/admin permissions are distinct. Auth or membership errors deny access.
Eight synthetic tests exercise these boundaries without external requests.
The helper is now wired to the domain handler. Auth.getUser verifies sessions and the current organization membership is checked for every action. VIEWER writes and EDITOR administration are denied. Server-approved email invitations are claimed once, only after verified email ownership; a revoked membership is not recreated.

- Login entry dynamically imports the CRM app only after the server session check. Browser caches/journals are namespaced per verified user. Legacy unowned journals are left intact and never auto-replayed under a new account.
- Legacy browser password hashes are excluded from bootstrap; the legacy auth document is not writable from employee sessions. Settings secrets remain server-side.
- Apps Script HTTP GET rejects immediately. POST only accepts expiring, domain-separated HMAC from the employee-authenticated domain API and an explicit action allowlist. Automatic internal functions and backup triggers are unchanged.
- Marketing sync accepts server Cron/HMAC only, not the retired browser token.
- Initial administrator email is stored in the private-access invitation table, not this repository.

## Production progress

- Migration `employee_auth_cutover` applied. Invitation table has RLS and no anon/authenticated grants; claim RPC is service-role-only SECURITY INVOKER.
- KPI Auth redirect configured to the deployed Pages URL; minimum password length 12 and email confirmation enabled. Other project settings are unchanged.
- Domain and marketing handlers deployed; old public token + anon credential returns HTTP401 for negative session/mutation/collector tests. No customer payload was retrieved for these tests.
- Apps Script version60 applied to nine versioned deployments, including old URLs and the owner-only executor; HEAD uses the same source. Three principal HTTP URLs verified to return `employee_gateway_required` before reading any data.
- 149 local tests pass, including actual domain-handler authorization/patch contract and Apps Script HMAC tests. Frontend build passes.
- Frontend commit `81e94c9`, Actions `35354669324` succeeded. Live entry `index-Bu3X848I.js`. Isolated production browser: login visible; CRM module not imported; zero business API requests before login; sentinel legacy cache hidden; original journal preserved; zero page errors; mobile no horizontal overflow.
- A real service-role transaction test exposed missing SELECT on auth.users in the initial claim RPC. Corrected with `employee_claim_verified_identity`: the server passes Auth.getUser's confirmed email, no privileges on auth.users were added. Synthetic claim and revoke/reclaim tests passed, all test records rolled back. Domain v10 includes this correction.
- `KPI_PUBLIC_APP_TOKEN` secret removed from this project; server-only Cron/HMAC/backup credentials preserved.
- Integrity check: revision `20260918091132386-0rcrbhkx`, 847 active leads, 484 active deals, 456 active marketing rows unchanged. No synthetic users/invitations remained.
- Remaining release checks: real administrator email verification/login, authenticated runtime read/save and signed sheet bridge. Do not describe these as verified until completed.
- Historical access-log audit and the operator-managed Nginx proxy are not yet verified. Removing the browser's proxy fallback does not secure a separately operated server.
- The separate support-board project itself is outside this project's administrative access. Pocket KPI no longer exposes or uses its browser key, but that project's own Data API/RLS posture must be audited by its owner.
- RLS advisor: server-only tables intentionally have no client policies; existing `pg_net` extension placement warning is unrelated and left unchanged. See https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public.

## Release checklist (historical plan; check runtime evidence above)

1. Establish administrative deployment access through the supported Supabase/Apps Script CLI or connector; never reuse public frontend values as an administrator credential.
2. Verify existing Auth and membership setup without exporting business payloads. Bind the requested administrator to a verified Auth user ID; no auto-approval based on user-editable metadata.
3. Wire getUser(token) and current organization_memberships lookup to every domain action. Protect admin settings and enforce VIEWER write denial. Review direct Data API/RLS permissions separately.
4. Gate the frontend before importing the CRM app or displaying its local cache; use real employee sessions. Preserve old pending journals, isolate per account and never automatically replay one user's edits under a different identity.
5. Remove public-token access to Apps Script GET/POST and legacy deployments; preserve separately authenticated server schedules and backups. Disable unauthenticated proxy fallbacks. Coordinate any inaccessible internal Nginx proxy with its operator.
6. Remove marketing app-token authorization while preserving authenticated Cron/HMAC collection. Do not change other projects or their credentials.
7. Preserve access logs before they expire. Audit read/write access without logging tokens, customer payloads or passwords.
8. Coordinate the approved maintenance window, close old paths, revoke exposed app tokens and deploy frontend/backend together. Do not re-publish a replacement shared secret in the frontend.

## Release gates

- 2026-10-02 login resilience: Auth transport aborts after 20 seconds (including response body); SDK operations have a 30-second watchdog with reload recovery for stuck locks. No automatic signup/password/mutation retries. Successful sign-in explicitly rechecks server membership; overlapping checks are queued and sign-out invalidates stale results. Registration is separated from existing-account login. Authentication, membership, menu policy, cache isolation, and unsaved journals remain unchanged. Tests use synthetic credentials only; actual EJH password login is not claimed as verified.

- Old app token + anon key, no session, unapproved user, expired session: no CRM read or write.
- Approved user: only authorized organization and role; revoked membership immediately denied.
- Apps Script/old deployment/proxy paths cannot bypass checks.
- Administrator login works; save acknowledgement and pending journal recovery are verified safely.
- Automatic collection and backup still authenticate independently.
- Deployment success is not proof of authorization safety; do not mark complete until these checks pass.
- Rollback must retain closed public endpoints, not restore the vulnerable authentication scheme.
