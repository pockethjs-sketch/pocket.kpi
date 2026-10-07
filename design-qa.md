# Card presentation release — 2026-10-07

final result: blocked

Source visual truth: ../pocket-kpi-blue-preview/blocks-performance.png and blocks-deals.png (user-approved local visual preview).

The earlier approved preview was inspected in Chrome at 1904 x 1013 screenshot pixels, including browser chrome. Post-migration implementation is prepared at http://127.0.0.1:8788/release.html using the current operating App with synthetic in-memory data and connect-src none. No operating customer or employee session is present in that fixture.

Final implementation capture/comparison after Tailwind 4 is unavailable: the user stopped Computer Use with Escape and subsequently explicitly requested deployment without further browser checks. No browser capture, console check, mobile sweep, full-view or focused post-upgrade comparison is claimed. The earlier source captures do not constitute final release QA.

User-directed release exception: deploy after automated tests, build, security lint, audit and public-asset verification, without representing visual QA as passed. Keep dependency/metric changes and design changes in separate commits for scoped rollback. Authentication/backend/data changes are outside this release.

Pending checks: layout rhythm and font wrapping under Tailwind 4, dark receivables controls, dense contract sticky headers, mobile overflow and actual employee login. No known browser finding is being asserted without a current capture.
