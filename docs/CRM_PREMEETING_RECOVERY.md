# CRM company-list persistence and calendar refresh — 2026-10-16

## Follow-up: normal employee CRM read silently capped at1000 (deployed)

- October15 raw3 and eligible relational/snapshot records3 match. Normal `action=crm`
  still used an unpaginated PostgREST read ordered by creation time. Active rows1034;
  these targets rank1028/1030/1032 and therefore sit beyond the default1000 result cap.
  The earlier DB recovery did not verify this API-read completeness; it was not a
  successful employee-screen test. The restricted-scope branch was already paginated.
- Use explicit500-row pages with original creation order plus ID tie-break. Compare
  exact count, revisions and assembled length; retry a bounded mixed-snapshot read,
  reject partial/error/count mismatch, and emit metadata-only leadReadVerification.
  Same-revision browser cache is rebuilt when its lead count differs from verified
  API count, so the retired1000-row cache cannot remain merely because revision matches.
- No business writes, collection, permission/RLS/Auth or global API-limit change.
  Tests exercise actual ADMIN/VIEWER handler1034 rows, missing middle page, revision/count
  changes, server truncation, exact boundaries and same-revision1000-cache recovery.
- Domain18ACTIVE/JWTtrue, all8 remote source files match, unauthenticated CRM401.
  Webe4cfd0302fb1a81aa56e1703e6542fad3c310231 / Actions38850424835 both jobs success;
  index-dR3IPDqB.js/main-WKNc-xKe.js200 and cache repair present.320tests/security/build
  pass, audit0. Relational/snapshot1034 and primary revision unchanged by this release.
  No actual employee credential/API-response/DOM observation was performed. The earlier
  seven historical visit-check differences remain pending, not silently overwritten.

## Cause and scope

Raw collection/inflow continued on Oct14–16. The operational company projection did not:
the existing full-state writer hit PostgreSQL SQLSTATE57014 (8-second request limit).
Each day had three stored schedules and zero company-list schedule references.
The independent raw/API/screen-model verifier did not cover that final persistence step.
The existing contract reload also dropped calendar/verification from its accepted read,
so an already open graph retained its old in-memory calendar.

## Changes

- Skip unchanged large lead/deal upserts only when every derived business column equals
  the incoming row. Maintain projected revisions for unchanged active snapshot rows;
  retain full-snapshot archive behavior and the atomic commit/audit/idempotency path.
  No global timeout increase, RLS/role/Auth change, or new SECURITY DEFINER function.
- Invoker-only, service-role-only `kpi_reconcile_crm_premeetings` reads latest stored
  MEETING versions per organization/ID, type1 and KST dates. Strong identity conflicts,
  archived/deleted matches and incompatible manual stages block rather than guess.
  Preserve existing money, receipts, notes, owner and nonempty dates. Append meeting IDs
  and history; create unlinked calendar companies only with stable CRM schedule IDs.
- Existing HMAC daily/recent-three-day Apps Script path verifies company persistence
  and date counts before collection success, storing metadata in
  `inflow_result.calendar.companyProjection`. Broad employee CRM/TM refresh does not
  gain a company-list writer. Source request window, once-daily09:00 trigger and backup
  stay unchanged. This does not introduce automatic collection on tab entry.
- Accepted same-revision refresh carries calendar/verification separately from saved
  business state. Refresh retains pending user edits and independent ad data. Visible
  pages check server revisions every five minutes/on focus (one-minute throttle),
  reloading reads only on revision/KST-day change. Failures retain the old screen and
  display an unconfirmed-read state, not a false save acknowledgement.

## Verification / release

- Synthetic SQL integration rollback: latest versions/moved dates, repeat schedules,
  KST midnight, unlinked companies, type filtering, protected fields/financial tuples,
  dry-run no writes, idempotency and ambiguous identity refusal.
- Production recovery rehearsed inside rollback: Oct14=3,15=3,16=3;
  three new calendar-only companies and six existing companies. Protected existing
  fields, other documents and finance identical; repeated reconciliation made0 writes.
- Actual employee browser remains unobserved. Raw/API/frontend-model verification
  is not represented as a successful authenticated DOM/browser test.
- Deployment and committed recovery verification are recorded in the operations ledger.

## Production outcome

- Collector v15 ACTIVE, five source files match; invalid unauthenticated collector/domain
  probes401. New RPC denies anon/authenticated EXECUTE and remains SECURITY INVOKER.
- Committed recovery: Oct14–16 nine schedules (3new/6existing companies), followed by
  Oct8–9 four schedules (1new/3existing). Each scoped transaction asserted all protected
  fields/financial tuples and repeat no-op. All35 October schedule IDs now have eligible
  company-list references, with matching KST days.
- Remaining, NOT applied: Oct7 five and Oct13 two existing schedules have source visit
  check1 but saved check0; one also differs in time within the same day. The attempted
  whole-month update was rejected by automatic safety review as outside the approved
  recovery scope. No bypass or partial workaround was used; explicit approval is needed.
  A full-month dry-run therefore reports7 pending metadata updates, not7 absent IDs.
- Web bdd70a7dd7c9f3c89865c6fa0858612a4998ff69, Actions38833542659 build/deploy success;
  public index-BVHLJOt4.js/main-DGVWeblT.js200 and new refresh/read-poll code confirmed.
  Final310 tests/security/build pass, audit0. Actual employee DOM and next09:00 run remain
  unobserved. Existing6-hour monitor now also checks companyProjection and monthly
  company reconciliation with p_dry_run=true only; no collection/repair was scheduled.
