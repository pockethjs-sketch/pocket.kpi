# Employee authentication cutover — 2026-09-18

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

- Old app token + anon key, no session, unapproved user, expired session: no CRM read or write.
- Approved user: only authorized organization and role; revoked membership immediately denied.
- Apps Script/old deployment/proxy paths cannot bypass checks.
- Administrator login works; save acknowledgement and pending journal recovery are verified safely.
- Automatic collection and backup still authenticate independently.
- Deployment success is not proof of authorization safety; do not mark complete until these checks pass.
- Rollback must retain closed public endpoints, not restore the vulnerable authentication scheme.
