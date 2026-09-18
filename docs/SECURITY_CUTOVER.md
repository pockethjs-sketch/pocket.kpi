# Employee authentication cutover — 2026-09-18

2026-09-18. User approved moving Pocket KPI to approved-employee authentication.
User subsequently requested the scheduled security cutover to run immediately.
Initial administrator email was supplied privately in the task; do not publish it here.

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
- Remaining release checks: published frontend, real administrator email verification/login, authenticated runtime read/save and signed sheet bridge. Do not describe these as verified until completed.
- Historical access-log audit and the operator-managed Nginx proxy are not yet verified. Removing the browser's proxy fallback does not secure a separately operated server.
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
