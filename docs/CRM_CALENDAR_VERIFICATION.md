# CRM calendar daily verification — 2026-10-14

## Extended raw/API/total/daily cross-check

The existing daily job additionally scans latest organization-scoped MEETING rows across the reporting window (September30 through today KST). An independent raw ID/date oracle is compared against `crmCalendar` and the actual frontend `calendarPeriodEntries` and `dailyStageActivity` functions. Store metadata only in `inflow_result.calendar.aggregation`: source/API/screen-model totals and daily counts, identity mismatch count, dated differences, asOf and completedAt. No names, contacts, raw payloads or IDs are recorded in the verification result.

`calendar_aggregation_mismatch` and `calendar_aggregation_read_failed` are explicit failures before inflow promotion/COMPLETED; metadata is retained on failure when available. Successful zero-event updates remain normal. Existing storage verification and Auth/HMAC/RLS, collection/backup triggers and source request window remain unchanged. No extra upstream CRM collection is run by the monitor or by opening a tab.

Authorized CRM reads also return a fresh `calendarVerification` for the same raw snapshot as the calendar. Both integrated and Marketing Hub totals compare their displayed count against it. The integrated daily popup compares the actual all-day graph input before the intentional weekend-hiding transform. Missing/out-of-scope/stale evidence shows pending, not healthy/zero. Customer-type subfilters are distinguished from organization-wide verification. Mismatches show exact totals and dates without silently repairing data.

The six-hour monitor checks aggregation metadata and independently queries raw count-only SQL. When authenticated CRM API/browser evidence is available it checks those counts too. It must distinguish server computation parity, actual browser display and unavailable employee sessions: a server computation check is not a rendered-browser E2E test. Prior runs without the new aggregation object are pending until the next scheduled run, not false successes/failures. No new recurring task or cadence change. Healthy/unchanged remains quiet.

GitHub Pages CI now runs the repository synthetic regression suite, including actual card wiring, employee authorization and 21-versus29/October8 omission cases, before release. Operator-owned Apps Script source outside the repository is intentionally not copied into public CI: only the13 source-integration tests requiring that absent checkout are explicitly skipped there and run locally. A missing local checkout still fails. This closes the former build-only gate without pretending external integration was tested in CI.

Daily 09:00 KST collection already fetches mr_type=1 schedules. The daily graph now reads latest raw calendar schedules through authenticated domain CRM reads, not the potentially incomplete lead.crmMeetings projection. Missing lead links do not remove schedules. No extra collection trigger or browser-triggered source fetch is added.

kpi-crm-sync verifies every expected schedule identity/hash against records persisted for the current sync run before marking COMPLETED. Store counts, source window, verification timestamp and verified flag in inflow_result.calendar. Calendar storage mismatch or verification failure marks FAILED with explicit calendar error, independently of CRM inflow reconciliation. Existing inflow and internal service/HMAC authorization remain unchanged. Zero schedules on a successful run is not a failure.

Domain returns only explicit calendar display fields, never raw notes/contact payload. Calendar views stay out of business mutations. Run history metadata is backward compatible; earlier runs without calendar verification are not treated as verified or as new failures.

The existing six-hour kpi monitor now checks calendar verification metadata and raw latest-version KST date counts. When an employee-authenticated path is available it compares calendar API counts. Without that path it distinguishes persisted-source verification from unverified screen comparison. Healthy/unchanged results remain quiet. No monitor writes or trigger edits.

Verification: 285 synthetic tests, security lint/build pass. Mocked complete/missing calendar paths tested; no production collection manually executed. Function v13 ACTIVE; deployed source match and unauthenticated401 confirmed. Next automatic09:00 run remains unobserved.
