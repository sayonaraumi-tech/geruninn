# Formal originals and independent workflows

Opening a stored estimate, invoice, receipt or Onoda document locks its inputs. PDF output renders the stored snapshot and does not enqueue or execute a save, allocate a number, or post accounting/Calendar records. Changing original fields programmatically is rejected. The administrator’s revision action creates a separate draft and retains the audited original. Snapshot rendering does not refill missing dates or recalculate Onoda prices/tolls.

New documents are durable in the account-scoped outbox before Firestore is contacted. Google is a background dependency only. Firestore must be available to allocate a globally unique formal number; while unavailable, the draft remains pending and an explicit reason is visible. Independent cash receipts create one receipt-cash sale, cash-received payment and cash ledger row. Independent bank receipts do not create sales; explicitly linked receipts only record a payment against the existing sale. Existing active independent cash receipts missing accounting are backfilled after login without changing snapshots or numbering.

Ordinary document filenames share category inference and use YYYY-MM-DD_customer_categories_document-type.pdf. Categories are deduplicated with ・ and inferred dynamically for old snapshots; receipts fall back to linked invoice content or 但し書き. Illegal filename characters, including the CF category’s slash, become underscores.

Estimate issue date and optional work date remain distinct. Acceptance uses an existing work date without prompting, or succeeds undated. Date assignment uses stable project, local Calendar and Google event identifiers; concurrent/repeated assignment addresses one event. Google changes update the schedule while formal customer, amount, document status and confirmed payments remain authoritative. Google reconnection retries pending create/patch operations; 409 reuses the existing deterministic event.

Only an explicitly parsed customer, work, positive amount and 現金 create an event-anchored calendar-cash sale, cash-received payment and cash mirror. Ordinary events create schedules only. Unlocked cash events update their existing records; a formal invoice takes over the same sale anchor. Cancellation or loss of cash/amount information retains accounting and marks review required.

Voiding requires an administrator reason and blocks any live payment, excluding bank markers and soft deletions. The original snapshot and audit remain; its sale/receivable becomes nonlive and leaves dashboards, receivables and payment choices. Repeated void is idempotent. Firestore failures expose error codes/reasons separately from Google disconnected/pending states. Backup readiness reads repository state rather than UI badge text.

## Validation

Run the normal test suite, test:rules, test:browser, test:business-browser, test:document-numbering-browser, test:outstanding-browser, test:historical-browser, test:auth-persistence, test:estimate-calendar and test:business-workflow. Browser fixtures cover 390px/1280px; use HTML2PDF_BUNDLE for actual A4 PDF rendering. Production credentials and customer data are not used by the tests. Deploy firestore.rules to tsukinowa-business with the authenticated Firebase CLI as well as publishing main to Pages.


## Production stabilization gate (2026-10-06)

Screenshot root cause: a legacy project workDate such as `2026/10/7` passed Accounting.date(), but acceptance discarded its normalized return value. schedule() constructed `2026/10/7T00:00:00Z`, then toISOString() threw Safari's `Invalid Date`. The blocked outbox then held subsequent void/accept/save commands. schedule() now uses the normalized date; the repository also normalizes nested dates before writes, validates finite timestamps, and the UI safely formats legacy timestamp data. Existing Invalid Date blocked entries are backed up per operation before their safe retry. Other permanently failed commands remain recoverable via the archive control; this never deletes committed business rows. Cloud diagnostic export is available even while the outbox is blocked.

A committed-operation UI callback cannot block the next outbox item. Lifecycle operations show explicit queued/success/failure messages. Void marks linked sales/receivables nonlive and accepted projects are excluded with their void estimate. Markers/deleted payments do not prevent void. Duplicate selection lists active same-type/customer documents within 31 days and shows number/date/amount; no ID entry is required.

Hard deletion is restricted to explicit `sourceType=system-error`, unconfirmed, unnumbered, unlinked documents. The UI first exports and stores a local backup; the atomic deletion retains the original payload/revision in an immutable operation and audit. Any known accounting, payment, bank or formal association rejects deletion. Numbered formal originals always require void/duplicate.

Estimate saves never push construction changes to Google. Accepted dated estimates use one deterministic event; undated acceptance creates no construction event. Google date/time/location update project/estimate workDate/workStart/workEnd/location. Formal customer/money/status remain authoritative. Concurrent acceptance retries a rule rejection only if its observed business revision changed; permission failures without contention are reported.

The production gate includes actual Firestore emulator transactions and desktop/mobile controls. Google HTTP requests and OAuth are mocked in automation; production OAuth/API verification must be reported separately. Test logs and screenshots are recorded in the task's acceptance outputs, not counted as real Google account validation.

Production smoke also exposed two legacy-data cases covered before the final release: UTC-normalized event times now render in Asia/Tokyo, and a receipt explicitly linked to an already-posted calendar cash event reuses that sale/payment rather than posting again. Legacy backfill follows the same explicit association. An administrator reconciliation archives an exact matching imported duplicate only when the receipt, calendar ID, amount, date and sole automatic cash payment agree; the original document, retired rows and audit remain available. Bank-linked or mismatched records require review.
