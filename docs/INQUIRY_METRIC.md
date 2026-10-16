# Inquiry metric contract — 2026-10-16

## Canonical metric

- Inquiry DB is website submissions plus native META lead submissions, not CRM customer registrations or project registrations. It is a submission count, not cross-source unique people/companies.
- Website: authenticated GET `/crm/v3/income_inquiry`, `iciq_type=default`, both `state=0` and `state=1`, inclusive KST registration dates. Deduplicate `iciq_no` across read/unread transitions. Exclude deleted and other inquiry types. Validate pagination totals, filters, identities and dates; read to an empty page even when the server caps page size.
- META: `onsite_conversion.lead_grouped` only. Never add `lead`, pixel or other alias actions to this count. Require Asia/Seoul ad-account timezone, full pagination, unique date/campaign rows and integral nonnegative counts.
- Attribution: website `iciq_items.inflow_rt` first route classifies META/NAVER/GOOGLE/OTHER. Native META count adds to META channel. Website route META is still part of the website component. Channel sums equal the same inquiry total.
- Counts have no reliable new/existing customer classification. Filtered customer views must explicitly mark inquiry classification unavailable, not substitute customer inventory. Missing source coverage/failure is unknown, never a fabricated zero.

## Storage and security

- `marketing_inquiry_daily`: one organization/source/date count and four channel counts. Zero-filled dates are explicit facts. No inquiry IDs, names, contacts or content are stored here.
- `marketing_inquiry_sync_state`: source range/hash/expected_daily, last attempt/success, failure code. Expected daily values detect date shifts even if monthly sums and batch hashes are unchanged.
- `kpi_commit_inquiry_days`: service-role-only SECURITY INVOKER, validated complete date range and component sums, short organization/source lock, stale-write protection, scoped idempotent upsert, transactional reread. Both tables FORCE RLS and deny direct browser grants.
- Existing employee-authorized `kpi-domain-api?action=marketing` returns this report. Read in 500-row pages beyond PostgREST's default limit; inquiry/ad-ledger failures cannot masquerade as complete counts. No new public business-data route or authentication bypass.
- Existing daily CRM collector also collects full month-to-date website counts and separately records `crm_sync_runs.website_inquiry_result`. Failure remains visible and prevents an all-source successful refresh response while preserving successful CRM/calendar work.
- Existing daily advertising collector writes native META counts after its validated ad-ledger commit. No changes to collection schedules, CRM customer promotion, contracts, receipts or permissions.

## UI and verification

- Integrated performance, marketing overview, monthly rows, channel inquiry denominators, daily source table, CPL and Excel exports use the shared `src/data/inquiryMetrics.js` model. CRM customer details/quality remain explicitly separate reference populations.
- Graphs retain existing weekday display; full daily table, card and month total include weekends. A selected month in a year/range view uses that month's table footer, not the full-year card number.
- 2026-10-16 source/DB/model verification: January 1–October 16, 289 dates, both sources, zero daily/monthly/channel differences. October website 11 + META 103 = 114 at 08:36 UTC. These are a timestamped observation, not fixed expected values.
- Business snapshot remained revision `user-receipt-6702f8bfe81b948f78ffff6ac47f6cdf`, MD5 `ade2f0352c7d5b69c5c06c73ae8e8e1d`. No finance writes.
- 361 local tests, security lint, build contract, dependency audit passed. SQL synthetic idempotence/stale/validation/grant checks rolled back. Edge deployed CRM v16, marketing v11, domain v19. Negative employee-boundary probes HTTP401; legacy public gateways remain closed. Actual employee-authenticated DOM is not claimed as observed.
- Security advisor INFO for no client RLS policies is intentional on these server-only tables. Existing unrelated pg_net placement and leaked-password-protection warnings remain unchanged; see [Supabase advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Read-only monitoring

- Compare source/API counts, stored daily values and shared model/card/export totals over the same KST range and observation time. Compare both components and each date, not only a monthly total.
- Monitor source last_success_at/status/error_code, source_total/expected_daily, and CRM website_inquiry_result independently from CRM/calendar success. Late post-09:00 submissions are partial current-day values, not a failed prior scheduled snapshot.
- Current credential references may be used by the active collector/read-only diagnostic script; never recover older credentials, log tokens, impersonate employees or infer that browser validation occurred from admin SQL/model tests.
- `scripts/read-inquiry-source.mjs` is read-only, accepts credential-file paths at runtime and returns counts/hashes only. Monitoring must not call the commit RPC, collect/write/repair data, modify triggers or replace payment/CRM/premeeting checks.
