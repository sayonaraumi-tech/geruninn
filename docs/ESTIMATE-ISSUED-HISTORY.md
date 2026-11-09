# 見積履歴: formal issuance handoff

Base: `fe958a197b3e2d75df1dcf610e80a16f0da9d195` (main after PR #34).

## Root cause and references

`renderEstimates()` previously rendered every live estimate, regardless of formal invoice issuance. Issuing an invoice writes a separate document and sale; payments update accounting, not the estimate's accepted status. `business-ui.js` hydration preserves that separation, so reloading continued to show the accepted estimate and its payment/conversion actions.

Authoritative path for current conversions:

- `estimates/{id}` retains `documentId` / `historyId` for its original estimate snapshot.
- Conversion carries `estimateId` and `projectId` into the invoice snapshot; formal save copies them into `documents/{id}` and the sale. A deterministic `invoice_<estimateId>` document ID and existing revision/immutable-document checks protect retries.
- Formal documents reference `saleId`; sales reference `documentId` / legacy `sourceId`; payments reference `saleId`. Receipt documents are not invoice issuance evidence.
- Legacy migration remaps explicit `estimateId`, document IDs, sale IDs and calendar IDs independently. It does not recover a missing estimate reference. Existing calendar matching is therefore insufficient proof that two records are the same estimate.

The new read-only selector accepts a confirmed invoice/onoda document's explicit `estimateId`, snapshot `estimateId`, or an exact document→sale→estimate reference. Conflicting nonempty estimate references retain the row. Customer, amount, project and calendar similarities never hide an estimate. Cloud rendering reads raw document payloads, retaining confirmation and lifecycle evidence rather than relying on the flattened printable history.

## Behavior and safety

Unwon and accepted estimates remain pending until reliable formal issuance evidence exists. Once issued, unpaid, partially paid and fully paid invoices leave the daily list. No payment or revenue is posted by rendering or hydration. History checkbox restores issued estimates with original open and saved-document access, without acceptance, payment or conversion actions. Stale direct commands also redirect to saved documents. Payment management stays in the sales ledger / saved invoice balance workflow.

Cancelled, void, duplicate and superseded issued invoices remain issuance history; cancellation does not silently reopen an estimate or authorize a second sale. Corrections use existing formal-document revision controls. An existing sale with explicit estimate identity or a shared calendar blocks conversion; a shared calendar does not establish identity or hide a row.

Missing legacy references remain visible. No automatic backfill or customer/amount matching is performed. To resolve such a historical row, an administrator must first verify the original estimate document ID, formal invoice document ID, sale ID and payment sale IDs against the source records. A separately reviewed exact-ID linking change would be needed; this PR intentionally performs no production data migration.

The provided screenshots show a 2026-10-03 accepted estimate for 112,376円, a 2026-10-07 invoice/sale and final payment dated 2026-10-08. The estimate screenshot reads 琢居株式会社; existing repository fixtures also contain the different spelling 塚居株式会社. Screenshots and fixtures cannot establish production record identity. No production IDs or linkage have been verified or altered, and no claim is made that a missing-reference production row will automatically disappear.

Only estimate list copy, a history checkbox, issuance selection and estimate actions change. PDF templates, calendar operations, accounting calculations, Firestore rules, audit commands and offline queue formats remain unchanged. The app-shell cache version is bumped; no localStorage or queue cleanup is introduced. No broad UI restyling is included.

## Validation

- Full unit/static/service-worker suite: 207 unit tests passed, including issuance, legacy exact references, conflicts, same-amount jobs, lifecycle history and read-only behavior.
- Firestore rules suite: 46 tests passed against `demo-tsukinowa` only.
- Desktop/mobile browser integration: formal save, hidden pending row, history/original read-only open, stale action protection, reload, partial/final payments and separate equal-amount estimates.
- All 13 local and all 8 emulator browser suites passed together against the published PR #34 baseline. The combined run covered A4 output, calendar resync, HOME, bank reconciliation, cash, suppliers, auth, queue replay and duplicate-payment prevention.
- Final targeted desktop/mobile rerun additionally verifies cancelled legacy sale identity after the live sales view filters it out; issuance resolution uses raw sales/receivables lifecycle history.

Test dependencies reuse the existing installed repository dependency versions (Firebase 12.19.0, Playwright 1.62.1) and a local Java 21 runtime. Production Firebase is never used. See PR validation results for final counts and any limitations.
