# CRM calendar daily verification — 2026-10-14

Daily 09:00 KST collection already fetches mr_type=1 schedules. The daily graph now reads latest raw calendar schedules through authenticated domain CRM reads, not the potentially incomplete lead.crmMeetings projection. Missing lead links do not remove schedules. No extra collection trigger or browser-triggered source fetch is added.

kpi-crm-sync verifies every expected schedule identity/hash against records persisted for the current sync run before marking COMPLETED. Store counts, source window, verification timestamp and verified flag in inflow_result.calendar. Calendar storage mismatch or verification failure marks FAILED with explicit calendar error, independently of CRM inflow reconciliation. Existing inflow and internal service/HMAC authorization remain unchanged. Zero schedules on a successful run is not a failure.

Domain returns only explicit calendar display fields, never raw notes/contact payload. Calendar views stay out of business mutations. Run history metadata is backward compatible; earlier runs without calendar verification are not treated as verified or as new failures.

The existing six-hour kpi monitor now checks calendar verification metadata and raw latest-version KST date counts. When an employee-authenticated path is available it compares calendar API counts. Without that path it distinguishes persisted-source verification from unverified screen comparison. Healthy/unchanged results remain quiet. No monitor writes or trigger edits.

Verification: 285 synthetic tests, security lint/build pass. Mocked complete/missing calendar paths tested; no production collection manually executed. Function v13 ACTIVE; deployed source match and unauthenticated401 confirmed. Next automatic09:00 run remains unobserved.
