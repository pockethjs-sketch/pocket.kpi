# Pocket KPI secure-work rules

Read `docs/SECURITY_CUTOVER.md` before changing authentication, APIs, Supabase, Apps Script, CRM sync, deployment, or diagnostics. When the local operations repository is available, also read `../pocket-kpi-deploy/PROJECT_STATE.md` completely before any change.

## Secrets and production data

- Never retrieve retired credentials from Git history, old bundles, chat logs, browser storage, screenshots, or deployment logs.
- Never paste, print, echo, return, or commit passwords, JWTs, session cookies, provider credentials, HMAC values, service-role keys, refresh tokens, or customer payloads.
- Browser code may contain only the current Supabase `sb_publishable_` key. A publishable key identifies the project; it never authorizes business data without a verified employee session.
- Store server credentials only in Supabase Secrets, Vault, Apps Script Properties, or the deployment platform's protected secret store.
- Diagnostics must report status, timestamps, counts, hashes, revisions, and redacted error codes. Do not print company names, contacts, phone numbers, emails, memo bodies, or full source payloads.
- Do not use real customer records as fixtures. Use synthetic data and roll back database verification transactions.

## Authorization and changes

- Every business read or write must validate a real Supabase Auth session and current active organization membership on the server.
- Do not add shared browser tokens, anonymous business-data fallbacks, direct Apps Script access, or permissive CORS headers.
- Do not weaken RLS, grant broad table access, add `SECURITY DEFINER` to bypass a permission error, or expose service-role credentials.
- Read-only inspection does not authorize writes. Production writes require an explicit user request, an idempotent path, scoped targets, and post-write verification.
- Never restore a vulnerable public endpoint as rollback. Roll back functionality while keeping employee authentication and closed legacy paths.

## Verification and release

- Run `npm run security:check`, `npm test`, `npm run check`, and `npm run audit` before deployment.
- Security boundary probes use invalid synthetic credentials only. They must never recover or replay an old credential and must never request customer data.
- Keep `docs/SECURITY_CUTOVER.md` and the operations `PROJECT_STATE.md` current. Clearly distinguish locally tested, deployed, and verified-in-production states.
- If a requested test would require displaying a credential or downloading production customer data, replace it with a metadata-only or synthetic test and explain the evidence it provides.
