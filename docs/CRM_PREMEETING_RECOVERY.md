# CRM company-list persistence and calendar refresh — 2026-10-16

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
