# 계약 총괄 — 담당자별 시트형 비교

Date: 2026-09-15

## Target and evidence

- Source: `C:/Users/PK-INV~1/AppData/Local/Temp/codex-clipboard-2a5c0b10-633d-4d42-8393-7f5ca512372c.png`, 1526 × 654 pixels.
- Implementation: `artifacts/contract-sheet-desktop.png`, 1526 × 800 pixels; `artifacts/contract-sheet-mobile.png`, 390 × 844 pixels.
- Browser: isolated headless Chrome, deviceScaleFactor 1. Local production component imported into a fixture; synthetic data, no production reads or writes.
- Comparison: reference and desktop capture opened together. Compare the table region; the fixture includes a search input and the source includes spreadsheet chrome/blank rows. Contents differ intentionally: 3 owners, 17 contracts, a long company name and a 9-digit amount exercise alignment and overflow.

## Findings

- Typography: dark 12px company/amount text and 14px owner names; larger than the reference's dense small text. Exact won amounts replace abbreviated units. Long company names truncate with full name on hover.
- Layout: one semantic table repeats 5 columns per owner. Shared row numbers, equal row heights, and aligned subtotals reproduce the source's comparison structure. Minimum 12 rows instead of 20 avoids excessive blank space for small months.
- Colors: charcoal title band, salmon/yellow/blue owner headers, red program text and overall total follow the reference. Softer internal grid lines preserve readability.
- Assets: the reference is native spreadsheet text and cells; no raster assets are needed.
- Copy: labels explicitly identify contract value, not deposits. Existing contract selection and amount helpers are passed into the component.
- Focused comparison: names, program text, numeric columns and aligned subtotal row were legible in the original-resolution captures; no additional crop was necessary.

## Verification

- 3 owner groups each occupy 5 columns at the same Y position; 13 body rows and 17 contracts in the fixture.
- Overall amount = ₩204,581,789; no amount cell clipping at the desktop viewport.
- Company click invokes the detail callback with the expected lead ID.
- Empty search renders an explicit empty state.
- At 390px, the table scrolls horizontally without widening the page; row-number column stays fixed.
- Browser runtime exceptions: 0.
- Supplemental payment/build-up analysis is collapsed in ContractHubView, leaving the contract comparison first.
- Limit: browser interaction verification uses the production table component in an isolated fixture, not a signed-in production account or real financial data.

## Comparison history

- Initial revised capture: shared table replaces vertically wrapping cards. No actionable P0/P1/P2 visual differences for the user's requested adaptation; row count, slightly larger text, and fewer blank rows are intentional.

final result: passed

## Follow-up: 신규 / 기존 구분

- Added customer-type filter and compact company labels, preserving the five-column table.
- Ran actual ContractHubView code against new/existing/missing-type sample leads: all three selections produced the expected owner rows, contract sum, paid sum and outstanding sum. Missing type follows the existing app's 신규 default.
- Build and 49 existing tests passed. This follow-up verifies classification behavior; no signed-in production-data audit was performed.
