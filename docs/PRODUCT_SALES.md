# Product sales overview

## Scope

The existing products page now defaults to sales, with a separate catalog/price-management tab. It reads the already-authorized in-memory leads and products. No new request, collection trigger, database schema, source Sheet, financial write or permission rule is introduced.

## Counting contract

- Active, distinct lead IDs whose current status is `계약 완료`, with a valid contract date in the global period and a positive finite contract amount; payment schedule sum is the existing fallback for a missing total.
- New/existing filter uses stored `ctype`, retaining the application's empty-as-new convention. Other nonempty types are explicitly counted as unclassified customer types.
- Count is **contracts represented by lead records**, not purchased units, payment installments or all historical repeat-contract events. Existing separate contract history/events are not added because they can overlap lead totals. This limitation is visible in the page.
- Saved `buildup`, `buildups` and `lineItems.buildup` (item name fallback) identify groups. A contract counts once per group and once in the overall total. Multiple-group sums can exceed the overall total.
- Exact current catalog group/item names and an explicit small legacy-label map are accepted. Ambiguous item names and unknown selections are not guessed from memos/company names or prices; unclassified rows and raw unknown selections remain inspectable. This is a saved-selection view, not a claim that every quotation item has a separate signed line-item contract.
- Global summary amount is summed once per contract. Drilldown shows full contract value, **not** allocated buildup revenue. No allocation from list prices or equal splits.
- Missing contract dates are excluded and available in an all-time exception list; no meeting/creation date substitution. Missing/invalid amounts are excluded and available for the selected period. ISO timestamps use Korea dates and invalid dates are rejected.

## UI and compatibility

- Total contracts/amount, multiple-group contracts, unclassified contracts, ranked counts with new/existing/unknown-type split, and click-through lists (30 rows/page).
- Global month/year/date range and local customer filter remain independent of catalog settings. No conversion-rate or monthly-target achievement is computed with mixed periods.
- Catalog add/edit/remove and item price/target changes retain existing `up` storage handlers; VIEWER inputs are disabled and write buttons hidden. Stored prices, targets, items and legacy records are not migrated/deleted by this change.
- Tests use synthetic records only. Browser QA blocks all external requests and checks filters, company-open callback, pagination, empty state and mobile document overflow. Production employee login and actual customer amounts are not exercised by these tests.

## Verification

232 unit/component tests passed; production build and security lint passed; dependency audit found zero vulnerabilities. Synthetic desktop/mobile sales screenshots inspected. Catalog fields and VIEWER-disabled controls are also tested against the actual page component. Deployment evidence belongs in the operations ledger.
